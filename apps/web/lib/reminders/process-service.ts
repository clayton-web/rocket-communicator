import 'server-only';
import {
  REMINDER_SCHEDULING_TIME_ZONE,
  decideReminderScheduling,
  isAdvanceDeliveryWindowOpen,
  selectNextOverdueOccurrence,
  type LocalDate,
  type TaskSummaryPoint,
  type UtcInstant,
} from '@aicaa/domain';
import type { DbClient, OwnerNotificationSystemCapture } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import {
  isOwnerEventCaptureEnabled,
  OWNER_NOTIFICATION_INTENT_ID_PREFIX,
} from '@/lib/notifications/capture-config';
import { newEntityId } from '@/lib/tasks/internal';
import {
  MAX_OCCURRENCE_ATTEMPTS,
  MAX_RECOVERIES_PER_PROCESS,
  MAX_SCHEDULES_PER_PROCESS,
  OCCURRENCE_CLAIM_LEASE_MS,
  PROCESS_MAX_DURATION_MS,
  PROCESS_STOP_MARGIN_MS,
  REMINDER_PROCESS_SYSTEM_ID,
  SCHEDULE_CLAIM_LEASE_MS,
  isReminderDeliveryEnabled,
} from './process-config';
import type {
  ReminderDeliveryMaterial,
  ReminderTransport,
  ReminderTransportProvider,
  ReminderTransportResult,
} from './transport';

/**
 * Who observed a reminder schedule stopping or finding nobody assigned (A8.5d, D133). Distinct from
 * `REMINDER_PROCESS_SYSTEM_ID`, which identifies the worker holding the claim and is documented as
 * never being an actor.
 */
export const REMINDER_ENGINE_SYSTEM_ID = 'reminder_engine' as const;

/**
 * A8.4a reminder occurrence processing.
 *
 * This is the worker-safety foundation, not a worker that sends reminders. It claims occurrences,
 * validates eligibility, invokes an **injected transport**, and finalizes results through the safe
 * occurrence transactions. Delivery is disabled by default, no transport is injected anywhere
 * outside tests, and nothing here imports Gmail, a provider, or even the fake transport.
 *
 * ## The ordering that makes it safe
 *
 * Everything difficult about a reminder worker is the interval between "we decided to send" and "we
 * know what happened", because the process can die anywhere inside it and an Owner can change the
 * schedule underneath it. Three rules cover that interval:
 *
 * 1. **Claim the occurrence, not the schedule.** Occurrence identity is
 *    `(schedule, generation, kind, local date)` and is unique in the database. The schedule lease is
 *    a scan hint; losing it wastes queries, losing the occurrence race prevents a duplicate send.
 * 2. **Commit the in-flight marker before calling the transport.** A crash then leaves durable
 *    evidence that a provider may hold the message, so recovery finalizes ambiguous instead of
 *    resending. Marking afterwards would make a crash mid-call look like a crash before it.
 * 3. **Never hold a database transaction across the transport call.** The claim, the marker, the
 *    terminalization, and the settlement are four separate transactions, with the network call
 *    between the second and third.
 *
 * ## Recovery debt comes before new work (A8.4a audit B1, B2, H1)
 *
 * Every crash point in the list above leaves a specific, findable residue, and each one blocks
 * something. The audit found two that blocked a schedule *permanently* because nothing swept them,
 * so the invocation order now discharges all four classes of debt before scanning for new work:
 *
 * 1. terminal occurrences whose schedule settlement never ran;
 * 2. expired leases with no provider marker — released, and retried normally;
 * 3. expired leases *with* a provider marker — finalized ambiguous, and the series advanced;
 * 4. occurrences that spent their retry budget without ever terminalizing.
 *
 * Each class is bounded independently. A hundred rows of one kind of wreckage must not consume the
 * whole invocation and starve the other three, and none of them may starve the due scan.
 *
 * ## Five-minute wake-up semantics
 *
 * Nothing here repeats every five minutes. Persisted occurrence instants are the scheduling
 * authority; this service asks which of them have arrived. A missed invocation is recovered by the
 * next one, overlapping invocations are made safe by the unique occurrence identity rather than by
 * not overlapping, and a backlog drains a bounded batch at a time. No in-memory timer is load-bearing.
 *
 * ## Two scans, one pipeline (A8.4b.3)
 *
 * Advance and overdue reminders are found by two separate bounded scans and then processed by the
 * same claim, guard, send, and settle path. Separate scans because the questions differ — overdue
 * follows a pointer re-armed after every occurrence, advance reads one immutable instant per
 * generation gated on a disposition that settles once — and a single query could not report which
 * occurrence it had found. One pipeline because everything after "which occurrence" is identical:
 * occurrence identity already includes the kind, so a claim, a lease, a retry budget, a crash, and a
 * settlement behave the same whichever kind is being processed.
 *
 * Advance goes first. It is the older instant whenever both are due, and a schedule can hold both
 * only after the worker has been down long enough for the due date itself to pass — the exact case
 * where the advance occurrence needs to be settled as a missed morning rather than left claiming to
 * be scheduled. Each scan carries its own batch bound, so a backlog of one kind cannot starve the
 * other, the same reasoning the recovery classes above use.
 *
 * The kind changes exactly two things downstream: which guards apply, and which schedule field the
 * settlement moves. It does not change the message. D105 makes the advance reminder a difference in
 * *timing*, not in content, and the reminder body states the due date rather than asserting anything
 * about lateness, so the same builder is truthful the morning before and every morning after.
 *
 * ## Authorization is an invocation-level fact (A8.4b.1)
 *
 * A8.4b.1 gives the transport seam a real Gmail implementation, which introduces a prerequisite the
 * fake never had: an authorized Owner Gmail connection. It is resolved exactly **once, before the
 * first claim**, through the abstract `ReminderTransportProvider` — never per schedule, per Task, per
 * Recipient, or per occurrence.
 *
 * The ordering is the whole point. Resolving later would let an invocation claim occurrences, consume
 * their local calendar days under D106, and only then discover that nothing could ever have been
 * sent. An unusable connection is a fact about the deployment; charging it to whichever Task the scan
 * happened to reach first would write a permanent delivery failure onto a schedule that did nothing
 * wrong. So an unavailable provider ends the invocation before it starts: zero claims, zero occurrence
 * rows, zero attempts, zero schedule mutations, zero provider calls, and `transportAuthorized: false`
 * so an operator can see which of the three ways to do nothing this was.
 *
 * This file still imports nothing from Gmail or any provider. The seam is abstract, the Gmail
 * implementation lives beside the Gmail primitives, the route composes them, and
 * `a8-4a-worker-safety-guards.test.ts` fails the build if that ever stops being true.
 */

/** Aggregate counters. Counts only — never a Task summary, recipient, address, or provider body. */
export interface ReminderProcessAggregate {
  readonly deliveryEnabled: boolean;
  /**
   * Whether a transport was injected. False means the invocation fell closed and did nothing: no
   * scan, no claim, no write (A8.4a audit H3).
   */
  readonly transportConfigured: boolean;
  /**
   * Whether this invocation held a usable provider authorization when it began scanning (A8.4b.1).
   *
   * Only meaningful when {@link deliveryEnabled} and {@link transportConfigured} are both true; it is
   * false by default in the other two cases, where authorization was never attempted. Read as a
   * triple, the three flags name which of the three ways to do nothing this was.
   *
   * False with the other two true means the Owner's Gmail connection is missing, lacks the send
   * scope, or could not produce an access token, and the invocation stopped before its first claim:
   * no occurrence exists, no schedule moved, nothing was sent. Which cause applied is not reported.
   * True with a directly-injected transport, which is already-authorized by construction.
   */
  readonly transportAuthorized: boolean;
  readonly schedulesScanned: number;
  readonly occurrencesClaimed: number;
  /** Occurrences another worker held, or that no worker may claim again. */
  readonly claimRefusals: number;
  readonly delivered: number;
  readonly skipped: number;
  readonly failedRetryable: number;
  readonly failedPermanent: number;
  readonly ambiguous: number;
  readonly recoveredClaims: number;
  /** Occurrences that spent their retry budget without terminalizing, and were terminalized here. */
  readonly retryBudgetTerminalizations: number;
  /** Terminal occurrences whose schedule settlement was completed by this invocation's sweep. */
  readonly unsettledOccurrencesSettled: number;
  /** Settlements this invocation could not complete, leaving durable debt for the next one. */
  readonly settlementsDeferred: number;
  readonly ceilingStops: number;
  /**
   * Schedules stopped by D129 — three consecutive terminal ambiguous overdue occurrences in one
   * generation (A8.4b.2).
   *
   * Reported apart from `ceilingStops` because the two say opposite things about a deployment. A
   * ceiling stop is a schedule finishing its job; an ambiguity stop is the system admitting it does
   * not know whether the last three reminders reached anybody. A run where this is non-zero is the
   * one an operator should look at.
   */
  readonly ambiguityStops: number;
  /** True when the soft deadline cut the invocation short before its work was exhausted. */
  readonly deadlineStopped: boolean;
  readonly requestId: string;
}

export interface RunReminderProcessInput {
  readonly db: DbClient;
  readonly requestId: string;
  /**
   * An already-authorized transport, injected directly. **Test and fake seam only.**
   *
   * A8.4a required this for any work to happen (audit H3) and A8.4b.1 keeps that rule: a transport
   * must arrive from outside, because a worker that quietly manufactured one would record deliveries
   * it never made. What changed is that production now supplies {@link transportProvider} instead, so
   * that the authorization step happens where it can be ordered before the first claim. A caller that
   * passes this is asserting authorization is already settled — true for a fake, and true for the
   * transport a provider returns.
   */
  readonly transport?: ReminderTransport;
  /**
   * The production seam: resolve authorization once, then send through what it returns (A8.4b.1).
   *
   * Preferred over {@link transport} when both are supplied, because it is the only one of the two
   * that can fail before any claim happens.
   */
  readonly transportProvider?: ReminderTransportProvider;
  readonly now?: string;
  readonly startedAtMs?: number;
  readonly deadlineMs?: number;
  readonly maxSchedules?: number;
  readonly env?: NodeJS.ProcessEnv;
}

type CountKeys = Exclude<
  keyof ReminderProcessAggregate,
  | 'deliveryEnabled'
  | 'transportConfigured'
  | 'transportAuthorized'
  | 'deadlineStopped'
  | 'requestId'
>;
type Counters = { -readonly [K in CountKeys]: number } & { deadlineStopped: boolean };

const ZERO_AGGREGATE: Counters = {
  schedulesScanned: 0,
  occurrencesClaimed: 0,
  claimRefusals: 0,
  delivered: 0,
  skipped: 0,
  failedRetryable: 0,
  failedPermanent: 0,
  ambiguous: 0,
  recoveredClaims: 0,
  retryBudgetTerminalizations: 0,
  unsettledOccurrencesSettled: 0,
  settlementsDeferred: 0,
  ceilingStops: 0,
  ambiguityStops: 0,
  deadlineStopped: false,
};

export async function runInternalReminderProcess(
  input: RunReminderProcessInput,
): Promise<{ response: ReminderProcessAggregate }> {
  const deliveryEnabled = isReminderDeliveryEnabled(input.env ?? process.env);
  const provider = input.transportProvider;
  const transportConfigured = provider !== undefined || input.transport !== undefined;

  if (!deliveryEnabled || !transportConfigured) {
    // Two ways to do nothing, reported apart so an operator can tell them apart.
    //
    // Delivery off is the dark default and needs no explanation. No transport is the fail-closed
    // path: the flag was turned on in an environment that has nothing to send with, and the only
    // safe response is to scan nothing, claim nothing, write nothing, and say so. Returning before
    // `loadDbRuntime` means the disabled invocation does not even open the database.
    return {
      response: {
        deliveryEnabled,
        transportConfigured,
        transportAuthorized: false,
        ...ZERO_AGGREGATE,
        requestId: input.requestId,
      },
    };
  }

  // ---- Authorization, once, before anything is claimed (A8.4b.1). ----
  //
  // Ahead of `loadDbRuntime` in the failure case as well, for the same reason the disabled path is:
  // an invocation that cannot send must not need a database to establish that. A provider that needs
  // one to resolve opens it itself.
  let transport: ReminderTransport;
  if (provider) {
    const resolution = await provider.resolve();
    if (resolution.state === 'unavailable') {
      return {
        response: {
          deliveryEnabled: true,
          transportConfigured: true,
          transportAuthorized: false,
          ...ZERO_AGGREGATE,
          requestId: input.requestId,
        },
      };
    }
    transport = resolution.transport;
  } else {
    // Directly-injected transport: already authorized by construction (tests and fakes).
    transport = input.transport as ReminderTransport;
  }

  const startedAtMs = input.startedAtMs ?? Date.now();
  const deadlineMs = input.deadlineMs ?? startedAtMs + PROCESS_MAX_DURATION_MS;
  const now = input.now ?? new Date(startedAtMs).toISOString();
  const runtime = await loadDbRuntime();
  const counters = { ...ZERO_AGGREGATE };

  const outOfTime = () => {
    if (Date.now() > deadlineMs - PROCESS_STOP_MARGIN_MS) {
      counters.deadlineStopped = true;
      return true;
    }
    return false;
  };
  const context = { runtime, db: input.db, now, counters };

  // ---- Recovery debt, oldest wound first, each class bounded on its own. ----
  await settleUnsettledOccurrences(context, outOfTime);
  await recoverAbandonedClaims(context, outOfTime);
  await terminalizeExhaustedOccurrences(context, outOfTime);

  const limit = input.maxSchedules ?? MAX_SCHEDULES_PER_PROCESS;

  const advanceDue = outOfTime()
    ? []
    : await runtime.listDueAdvanceReminderSchedulesGlobally(input.db, {
        dueAtOrBefore: now,
        limit,
      });
  const overdueDue = outOfTime()
    ? []
    : await runtime.listDueReminderSchedulesGlobally(input.db, {
        dueAtOrBefore: now,
        limit,
      });

  const candidates: DueOccurrenceCandidate[] = [
    ...advanceDue.map((row): DueOccurrenceCandidate => ({
      id: row.id,
      organizationId: row.organizationId,
      taskId: row.taskId,
      generation: row.generation,
      dueLocalDate: row.dueLocalDate,
      schedulingTimeZone: row.schedulingTimeZone,
      occurrenceKind: 'advance',
      occurrenceLocalDate: row.advanceOccurrenceLocalDate,
      occurrenceAt: row.advanceOccurrenceAt,
    })),
    ...overdueDue.map((row): DueOccurrenceCandidate => ({
      id: row.id,
      organizationId: row.organizationId,
      taskId: row.taskId,
      generation: row.generation,
      dueLocalDate: row.dueLocalDate,
      schedulingTimeZone: row.schedulingTimeZone,
      occurrenceKind: 'overdue',
      occurrenceLocalDate: row.nextOverdueOccurrenceLocalDate,
      occurrenceAt: row.nextOverdueOccurrenceAt,
    })),
  ];

  for (const candidate of candidates) {
    if (outOfTime()) {
      break;
    }
    counters.schedulesScanned += 1;
    await processOneSchedule({ ...context, candidate, transport });
  }

  return {
    response: {
      deliveryEnabled: true,
      transportConfigured: true,
      transportAuthorized: true,
      ...counters,
      requestId: input.requestId,
    },
  };
}

type DbRuntime = Awaited<ReturnType<typeof loadDbRuntime>>;

/**
 * One occurrence the scans found, flattened so the pipeline below never asks which scan produced it.
 *
 * The schedule identity, the generation's due date, and the zone are the same questions for both
 * kinds; the three `occurrence*` fields are the answer to "which occurrence", read from whichever
 * pair of columns the scan selected on. Flattening here rather than branching in five later places
 * is what keeps the claim, the lease, the retry budget, the crash paths, and the settlement written
 * once — and it means occurrence identity in this file is exactly the tuple the database enforces.
 */
type DueOccurrenceCandidate = {
  readonly id: string;
  readonly organizationId: string;
  readonly taskId: string;
  readonly generation: number;
  readonly dueLocalDate: string;
  readonly schedulingTimeZone: string;
  readonly occurrenceKind: 'advance' | 'overdue';
  readonly occurrenceLocalDate: LocalDate;
  readonly occurrenceAt: string;
};
type ProcessContext = {
  runtime: DbRuntime;
  db: DbClient;
  now: string;
  counters: Counters;
};

/**
 * The next occurrence in a generation's series, computed once, the same way, everywhere.
 *
 * Anchored on the generation's due date rather than on the occurrence being settled: D106 defines
 * the series from the due date, and re-deriving it from today would slide the series forward a day
 * every time one was delivered or recovered.
 *
 * Recovery paths call this with the schedule's *current* due date and time zone. That is correct
 * even when the schedule has moved on, because settlement arms the result only while the generation
 * still matches — a moved schedule discards it untouched.
 */
function nextOccurrenceFor(
  schedule: { dueLocalDate: string; schedulingTimeZone: string },
  now: string,
): { occurrenceLocalDate: LocalDate; occurrenceAt: string } {
  const next = selectNextOverdueOccurrence({
    dueLocalDate: schedule.dueLocalDate as LocalDate,
    now: now as UtcInstant,
    timeZone: schedule.schedulingTimeZone || REMINDER_SCHEDULING_TIME_ZONE,
  });
  return { occurrenceLocalDate: next.occurrenceLocalDate, occurrenceAt: next.occurrenceAt };
}

/**
 * The A8.5d capture decision for one settlement (D133, D135).
 *
 * Offered to every settlement and spent by the few that turn out to establish a ratified event — a
 * ceiling reached, a permanent failure, three unconfirmed sends, or a reminder with nobody to reach.
 * The settlement transaction decides which, from the effect it just applied; this decides only
 * whether capture is on at all, and does so before the transaction opens so a Production deployment
 * with the A8.5 migration unapplied issues no statement against an A8.5 table.
 *
 * Minting an identifier that usually goes unused is the cheap half of that bargain. The alternative
 * is persistence generating identifiers, which it does nowhere else.
 */
function ownerEventCapture(): OwnerNotificationSystemCapture | undefined {
  return isOwnerEventCaptureEnabled()
    ? {
        id: newEntityId(OWNER_NOTIFICATION_INTENT_ID_PREFIX),
        systemId: REMINDER_ENGINE_SYSTEM_ID,
      }
    : undefined;
}

/**
 * Discharge settlement debt left by a crash between the two finalization phases (audit H1).
 *
 * Splitting terminalization from settlement is what makes a recorded delivery survive a settlement
 * failure, and this is the other half of that bargain: the seam between them is a crash point, and
 * a crash point without a sweep is a silent divergence. A terminal occurrence with no settlement
 * marker means the message is recorded and the schedule has not been told — not counted, not
 * advanced, not stopped, its advance disposition not settled.
 *
 * The transport is not involved and cannot be: everything needed is already durable on the row.
 * Settlement is idempotent, so a row two workers both pick up is settled exactly once.
 */
async function settleUnsettledOccurrences(
  context: ProcessContext,
  outOfTime: () => boolean,
): Promise<void> {
  const { runtime, db, now, counters } = context;
  const unsettled = await runtime.listUnsettledTerminalOccurrences(db, {
    limit: MAX_RECOVERIES_PER_PROCESS,
  });

  for (const occurrence of unsettled) {
    if (outOfTime()) {
      return;
    }
    try {
      const settled = await runtime.settleReminderOccurrenceSchedule({
        db,
        organizationId: occurrence.organizationId,
        attemptId: occurrence.id,
        settledAt: now,
        ownerNotification: ownerEventCapture(),
        nextOverdueOccurrence: nextOccurrenceFor(occurrence, now),
      });
      if (!settled.alreadySettled) {
        counters.unsettledOccurrencesSettled += 1;
        if (settled.ceilingReached) {
          counters.ceilingStops += 1;
        }
        if (settled.repeatedAmbiguityStop) {
          counters.ambiguityStops += 1;
        }
      }
    } catch {
      // Still owed, still findable, still bounded. A row that fails settlement repeatedly consumes
      // one slot of this sweep's budget and nothing else — it cannot starve the due scan below.
      counters.settlementsDeferred += 1;
    }
  }
}

/**
 * Settle occurrences whose claimant vanished (A8.3a audit F2).
 *
 * The classification is entirely `provider_call_started_at`. Null means nothing left the building,
 * so the lease is simply released and the occurrence returns to the pool for an ordinary retry. Set
 * means a provider may hold the message, and no amount of reasoning recovers the truth — so the
 * occurrence is finalized ambiguous, consumes its local day, and is never retried.
 *
 * The ambiguous branch supplies the next occurrence (audit B1). It used to supply nothing, which
 * settlement faithfully wrote through as `next_overdue_occurrence_at = NULL` on a schedule left
 * `active`, with no stop reason and no attention flag: the series ended and no row said so.
 * Consuming today's occurrence is not the same act as ending the series.
 */
async function recoverAbandonedClaims(
  context: ProcessContext,
  outOfTime: () => boolean,
): Promise<void> {
  const { runtime, db, now, counters } = context;
  const expired = await runtime.listExpiredOccurrenceClaims(db, {
    now,
    limit: MAX_RECOVERIES_PER_PROCESS,
  });

  for (const claim of expired) {
    if (outOfTime()) {
      return;
    }
    try {
      if (claim.providerCallStartedAt === null) {
        await runtime.releaseReminderOccurrenceClaim({
          db,
          organizationId: claim.organizationId,
          attemptId: claim.id,
          claimSequence: claim.claimSequence,
        });
      } else {
        const finalized = await runtime.finalizeAbandonedInFlightOccurrence({
          db,
          organizationId: claim.organizationId,
          attemptId: claim.id,
          scheduleId: claim.scheduleId,
          claimSequence: claim.claimSequence,
          completedAt: now,
          expectedGeneration: claim.generation,
          nextOverdueOccurrence: nextOccurrenceFor(claim, now),
        });
        if (finalized.settlementDeferred) {
          counters.settlementsDeferred += 1;
        }
      }
      counters.recoveredClaims += 1;
    } catch {
      // A concurrent recoverer won the fence. Its work is this work; nothing is owed here.
    }
  }
}

/**
 * Terminalize occurrences no worker can ever claim again (A8.4a audit B2).
 *
 * The hot loop the audit reproduced: a crash on the last permitted attempt, before the provider
 * marker, leaves a non-terminal row at the attempt ceiling. Recovery releases the dead lease —
 * correctly, because nothing had been sent — and then nothing else can happen to it. The claim path
 * refuses it with `retry_budget_exhausted`, so the schedule stays active and armed at an instant
 * already in the past, and every invocation for the rest of the deployment's life scans it, takes
 * its lease, is refused, and releases the lease again.
 *
 * A refusal no future invocation can turn into progress is a terminal fact nobody wrote down.
 * Writing it down stops the schedule under the ordinary permanent-failure policy, which also takes
 * it out of the scan.
 *
 * Runs after the two claim-recovery sweeps deliberately: a crashed final attempt is released by
 * `recoverAbandonedClaims` and becomes eligible here in the *same* invocation, so the loop is
 * closed on the first run that sees it rather than the second.
 */
async function terminalizeExhaustedOccurrences(
  context: ProcessContext,
  outOfTime: () => boolean,
): Promise<void> {
  const { runtime, db, now, counters } = context;
  const exhausted = await runtime.listRetryBudgetExhaustedOccurrences(db, {
    now,
    maxAttempts: MAX_OCCURRENCE_ATTEMPTS,
    limit: MAX_RECOVERIES_PER_PROCESS,
  });

  for (const occurrence of exhausted) {
    if (outOfTime()) {
      return;
    }
    try {
      const terminalized = await runtime.terminalizeExhaustedRetryOccurrence({
        db,
        organizationId: occurrence.organizationId,
        attemptId: occurrence.id,
        maxAttempts: MAX_OCCURRENCE_ATTEMPTS,
        completedAt: now,
        now,
        ownerNotification: ownerEventCapture(),
        nextOverdueOccurrence: nextOccurrenceFor(occurrence, now),
      });
      if (terminalized === null) {
        // Another worker got there first, or the row stopped qualifying. Both are fine.
        continue;
      }
      counters.retryBudgetTerminalizations += 1;
      counters.failedPermanent += 1;
      if (terminalized.settlementDeferred) {
        counters.settlementsDeferred += 1;
      }
    } catch {
      // Bounded like every other recovery class; the next invocation finds the row unchanged.
    }
  }
}

async function processOneSchedule(
  args: ProcessContext & { candidate: DueOccurrenceCandidate; transport: ReminderTransport },
): Promise<void> {
  const { runtime, db, candidate: schedule, now } = args;
  const claimedAt = now;

  // Advisory scan lease. A refusal means another invocation is already looking at this schedule, so
  // moving on is strictly better than racing it to the occurrence.
  const leased = await runtime.claimReminderScheduleForProcessing(db, {
    organizationId: schedule.organizationId,
    scheduleId: schedule.id,
    claimedBy: REMINDER_PROCESS_SYSTEM_ID,
    claimedAt,
    claimExpiresAt: new Date(Date.parse(now) + SCHEDULE_CLAIM_LEASE_MS).toISOString(),
    now,
  });
  if (!leased) {
    return;
  }

  try {
    await processOneOccurrence(args);
  } finally {
    await runtime
      .releaseReminderScheduleClaim(db, {
        organizationId: schedule.organizationId,
        scheduleId: schedule.id,
        claimedBy: REMINDER_PROCESS_SYSTEM_ID,
        claimedAt: leased.claimedAt ?? claimedAt,
      })
      .catch(() => undefined);
  }
}

async function processOneOccurrence(
  args: ProcessContext & { candidate: DueOccurrenceCandidate; transport: ReminderTransport },
): Promise<void> {
  const { runtime, db, candidate: schedule, now, transport, counters } = args;

  const claim = await runtime.claimReminderOccurrence(db, {
    id: newEntityId('rocc'),
    organizationId: schedule.organizationId,
    scheduleId: schedule.id,
    generation: schedule.generation,
    occurrenceKind: schedule.occurrenceKind,
    occurrenceLocalDate: schedule.occurrenceLocalDate,
    occurrenceAt: schedule.occurrenceAt,
    claimedBy: REMINDER_PROCESS_SYSTEM_ID,
    claimedAt: now,
    claimExpiresAt: new Date(Date.parse(now) + OCCURRENCE_CLAIM_LEASE_MS).toISOString(),
    now,
    maxAttempts: MAX_OCCURRENCE_ATTEMPTS,
  });

  if (!claim.claimed) {
    // Every refusal is another worker's business or settled history. `retry_budget_exhausted` is
    // the one that used to be neither: it is now swept into a terminal outcome before the scan
    // runs, so reaching it here means the sweep is one invocation behind, not that anything is
    // stuck. The counter is what would make a genuine stall visible.
    counters.claimRefusals += 1;
    return;
  }
  counters.occurrencesClaimed += 1;

  const attemptId = claim.attempt.id;
  const claimSequence = claim.claimSequence;
  /**
   * Whether this is the last attempt this occurrence will ever get.
   *
   * A retryable failure recorded here would be the final word while still being labelled
   * "try again": no worker could claim it, so the occurrence would need the exhaustion sweep to
   * finish it on a later invocation. Spending the last attempt as a permanent failure settles it
   * truthfully now and stops the schedule for the Owner to look at.
   */
  const lastAttempt = claim.attempt.attemptCount >= MAX_OCCURRENCE_ATTEMPTS;

  // ---- Pre-send guards: re-read everything, from one snapshot, immediately before the call. ----
  const verdict = await evaluatePreSendGuards(runtime, db, schedule, now);
  if (verdict.kind === 'skip') {
    await settle(args, attemptId, claimSequence, {
      outcome: 'skipped',
      skipReason: verdict.reason,
    });
    counters.skipped += 1;
    return;
  }

  // Durable, committed, and before the call. Recovery reads this rather than the exception.
  await runtime.markProviderCallStarted(db, {
    organizationId: schedule.organizationId,
    attemptId,
    claimSequence,
    startedAt: now,
  });

  let result: ReminderTransportResult;
  try {
    result = await transport.send({
      occurrenceId: attemptId,
      organizationId: schedule.organizationId,
      taskId: schedule.taskId,
      occurrenceKind: schedule.occurrenceKind,
      occurrenceLocalDate: schedule.occurrenceLocalDate,
      delivery: verdict.delivery,
    });
  } catch {
    // The marker is already committed, so this occurrence is ambiguous whether the throw happened
    // before or after the provider saw it. The transport cannot be trusted to know the difference,
    // and guessing "not sent" risks a duplicate reminder.
    await settle(args, attemptId, claimSequence, {
      outcome: 'ambiguous',
      failureCode: 'transport_threw',
    });
    counters.ambiguous += 1;
    return;
  }

  switch (result.kind) {
    case 'accepted':
      await settle(args, attemptId, claimSequence, {
        outcome: 'success',
        providerAcceptedAt: now,
        providerMessageRef: result.providerMessageRef,
      });
      counters.delivered += 1;
      return;
    case 'retryable':
      if (lastAttempt) {
        await settle(args, attemptId, claimSequence, {
          outcome: 'permanent_failure',
          failureCode: 'retry_budget_exhausted',
        });
        counters.failedPermanent += 1;
        return;
      }
      await settle(args, attemptId, claimSequence, {
        outcome: 'retryable_failure',
        failureCode: result.failureCode,
      });
      counters.failedRetryable += 1;
      return;
    case 'permanent':
      await settle(args, attemptId, claimSequence, {
        outcome: 'permanent_failure',
        failureCode: result.failureCode,
      });
      counters.failedPermanent += 1;
      return;
    default:
      await settle(args, attemptId, claimSequence, {
        outcome: 'ambiguous',
        failureCode: result.failureCode,
      });
      counters.ambiguous += 1;
  }
}

/**
 * Finalize one occurrence through the safe two-phase transaction pair.
 *
 * The next occurrence is always computed with the A8.2 domain and always supplied optimistically;
 * settlement decides whether the schedule is still in a state that may receive it.
 *
 * A deferred settlement is counted rather than thrown. The occurrence is terminal and correct — the
 * whole point of phase A committing alone — and the sweep at the top of the next invocation applies
 * the schedule effect. Treating it as a send failure here would be the F1 inversion in miniature.
 */
async function settle(
  args: ProcessContext & { candidate: DueOccurrenceCandidate },
  attemptId: string,
  claimSequence: number,
  outcome: {
    outcome: 'success' | 'retryable_failure' | 'permanent_failure' | 'ambiguous' | 'skipped';
    skipReason?: ReminderSkipDecision;
    failureCode?: string;
    providerAcceptedAt?: string;
    providerMessageRef?: string;
  },
): Promise<void> {
  const { runtime, db, candidate: schedule, now, counters } = args;

  const finalized = await runtime.finalizeReminderOccurrence({
    db,
    organizationId: schedule.organizationId,
    attemptId,
    scheduleId: schedule.id,
    claimSequence,
    outcome: outcome.outcome,
    completedAt: now,
    expectedGeneration: schedule.generation,
    skipReason: outcome.skipReason ?? null,
    failureCode: outcome.failureCode ?? null,
    providerAcceptedAt: outcome.providerAcceptedAt ?? null,
    providerMessageRef: outcome.providerMessageRef ?? null,
    ownerNotification: ownerEventCapture(),
    nextOverdueOccurrence: nextOccurrenceFor(schedule, now),
  });

  if (finalized.ceilingReached) {
    counters.ceilingStops += 1;
  }
  if (finalized.repeatedAmbiguityStop) {
    counters.ambiguityStops += 1;
  }
  if (finalized.settlementDeferred) {
    counters.settlementsDeferred += 1;
  }
}

/**
 * Everything that must still be true at the moment of sending, re-read as one snapshot.
 *
 * The schedule was read by a scan that may be seconds old, and an Owner can complete a Task in that
 * interval. Returns the truthful skip reason, or null when the send may proceed.
 *
 * The Task, its assignment, its canonical due date, and its schedule now arrive from a single
 * `RepeatableRead` read rather than from three independent statements the caller compared across.
 * Individually true reads of three different moments can compose into a conclusion that was never
 * true of any of them, and "send an email to a real person" is the wrong decision to reach that way.
 *
 * What this cannot close is the race between the guard and the call itself — an Owner may complete
 * the Task microseconds later. Nothing short of holding a lock across the network call would, and
 * that is forbidden for much better reasons. The final authority is the immutable occurrence row
 * plus conditional settlement: a send racing a lifecycle change is recorded truthfully and changes
 * nothing about the schedule that moved.
 *
 * ## The capability gate (D130, A8.4b.1)
 *
 * A8.4a left this open, because what a reminder is addressed to was still an open product question.
 * D130 answered it: the reminder carries no link and tells the Recipient to use the original
 * assignment email. That answer makes the health of *that* email's capability a precondition for
 * sending, because the reminder's only call to action is useless once it is dead — and the occurrence
 * it would spend is a scarce resource, one per local calendar day, capped at fourteen (D106). Sending
 * a reminder that instructs somebody to follow a revoked link consumes a day and delivers nothing.
 *
 * So a non-actionable capability is a truthful skip: `skipped` / `no_actionable_capability`, recorded
 * on the immutable occurrence row, with no provider call. It is deliberately not a delivery failure —
 * nothing failed to deliver, and the Owner's remedy is to re-send the assignment rather than to
 * investigate a transport. It reads the canonical capability row from the same snapshot as everything
 * else, so it cannot be reasoning about a capability that was live at a different instant than the
 * Task, the assignment, and the schedule were.
 *
 * ## The delivery material
 *
 * A `proceed` verdict carries what the transport needs, taken from this same snapshot: the address the
 * original assignment email went to, the persisted summary points, the canonical local due date, and
 * the schedule's own IANA timezone. Read here rather than in the transport so every fact the send is
 * built from comes from the one instant the guards approved.
 */
type PreSendVerdict =
  | { readonly kind: 'skip'; readonly reason: ReminderSkipDecision }
  | { readonly kind: 'proceed'; readonly delivery: ReminderDeliveryMaterial };

type ReminderSkipDecision =
  | 'no_active_assignment'
  | 'task_not_eligible'
  | 'schedule_superseded'
  | 'no_actionable_capability'
  | 'advance_window_elapsed';

const SKIP = (reason: ReminderSkipDecision): PreSendVerdict => ({ kind: 'skip', reason });

/**
 * Reduce persisted summary points to the display lines a reminder body is built from.
 *
 * The same rule the assignment email applies — prefer a point's value, fall back to its label —
 * deliberately restated here rather than imported from the A7 outbound builders. `lib/reminders` may
 * not import Gmail code, and that guard is worth more than five lines of reuse. It is also not
 * accidental duplication: D130 makes reminder content diverge from assignment content on purpose, and
 * the reminder builder redacts what this returns before rendering it.
 */
function summaryLinesFor(points: readonly TaskSummaryPoint[]): string[] {
  return points
    .map((point) =>
      ('value' in point && typeof point.value === 'string' ? point.value : point.label).trim(),
    )
    .filter((line) => line.length > 0);
}

async function evaluatePreSendGuards(
  runtime: DbRuntime,
  db: DbClient,
  schedule: DueOccurrenceCandidate,
  now: string,
): Promise<PreSendVerdict> {
  const snapshot = await runtime.readReminderPreSendSnapshot(
    db,
    schedule.organizationId,
    schedule.taskId,
    now,
  );
  if (!snapshot) {
    return SKIP('task_not_eligible');
  }

  // Completed, dismissed, and Waiting all resolve to "not now", and the A8.2 policy says which is
  // which — the worker does not restate D107.
  if (decideReminderScheduling(snapshot.taskStatus).kind !== 'schedule_active') {
    return SKIP('task_not_eligible');
  }
  if (!snapshot.hasActiveAssignment) {
    return SKIP('no_active_assignment');
  }
  if (snapshot.dueLocalDate === null) {
    return SKIP('schedule_superseded');
  }

  const current = snapshot.schedule;
  if (
    !current ||
    current.id !== schedule.id ||
    current.status !== 'active' ||
    current.generation !== schedule.generation
  ) {
    return SKIP('schedule_superseded');
  }

  // Whichever occurrence this is, the row must still be offering it. Overdue reads a pointer that
  // re-arms, advance reads a disposition that settles once, and both must still match the value the
  // scan saw — a change to either means the schedule moved between the scan and here.
  if (schedule.occurrenceKind === 'advance') {
    if (
      current.advanceDisposition !== 'scheduled' ||
      current.advanceOccurrenceAt !== schedule.occurrenceAt
    ) {
      return SKIP('schedule_superseded');
    }
  } else if (
    current.nextOverdueOccurrenceAt === null ||
    current.nextOverdueOccurrenceAt !== schedule.occurrenceAt
  ) {
    return SKIP('schedule_superseded');
  }

  // The armed occurrence must genuinely have arrived. A scan reading `lte: now` and a guard reading
  // the row again cannot disagree unless the schedule moved, which the checks above already caught;
  // this is the belt on those braces, and it costs one comparison.
  if (Date.parse(schedule.occurrenceAt) > Date.parse(now)) {
    return SKIP('schedule_superseded');
  }

  /**
   * D105's calendar-day boundary, and the only guard that is genuinely about the advance kind.
   *
   * Overdue reminders tolerate arbitrary lateness: the armed occurrence is still owed however long
   * the worker was away, and a late one is a late nudge about a Task that is still late. An advance
   * reminder cannot be late at all, because its whole content is "this is due tomorrow" and a
   * worker that reaches it the next morning would be sending a false statement about a Task that is
   * due today. So the morning is missed rather than delivered, and the occurrence records that as
   * the same `advance_window_elapsed` fact establishment records when a schedule is created too
   * late to have an advance morning in the first place.
   *
   * A skip rather than a filter in the scan: leaving the row unclaimed would leave it in the index
   * for good, still saying `scheduled`, with nothing in the system that would ever correct it.
   */
  if (
    schedule.occurrenceKind === 'advance' &&
    !isAdvanceDeliveryWindowOpen({
      advanceOccurrenceLocalDate: schedule.occurrenceLocalDate,
      at: now as UtcInstant,
      timeZone: current.schedulingTimeZone || REMINDER_SCHEDULING_TIME_ZONE,
    })
  ) {
    return SKIP('advance_window_elapsed');
  }

  // D130: no actionable original capability, no reminder, no provider call.
  if (snapshot.capabilityState !== 'actionable' || snapshot.deliveryTarget === null) {
    return SKIP('no_actionable_capability');
  }

  return {
    kind: 'proceed',
    delivery: {
      recipientEmail: snapshot.deliveryTarget.recipientEmail,
      summaryLines: summaryLinesFor(snapshot.deliveryTarget.summaryPoints),
      dueLocalDate: snapshot.dueLocalDate,
      timeZone: current.schedulingTimeZone || REMINDER_SCHEDULING_TIME_ZONE,
    },
  };
}
