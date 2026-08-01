import 'server-only';
import {
  REMINDER_SCHEDULING_TIME_ZONE,
  decideReminderScheduling,
  selectNextOverdueOccurrence,
  type LocalDate,
  type UtcInstant,
} from '@aicaa/domain';
import type { DbClient } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
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
import type { ReminderTransport, ReminderTransportResult } from './transport';

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
 * ## Overdue only
 *
 * The due scan selects on `next_overdue_occurrence_at`, so the only occurrences this service ever
 * claims are `overdue` ones. The advance terminalization and settlement paths exist in persistence
 * and are exercised by tests, but no worker code path reaches them: delivering advance reminders is
 * A8.4b work and needs its own scan predicate and index before it can claim anything.
 */

/** Aggregate counters. Counts only — never a Task summary, recipient, address, or provider body. */
export interface ReminderProcessAggregate {
  readonly deliveryEnabled: boolean;
  /**
   * Whether a transport was injected. False means the invocation fell closed and did nothing: no
   * scan, no claim, no write (A8.4a audit H3).
   */
  readonly transportConfigured: boolean;
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
  /** True when the soft deadline cut the invocation short before its work was exhausted. */
  readonly deadlineStopped: boolean;
  readonly requestId: string;
}

export interface RunReminderProcessInput {
  readonly db: DbClient;
  readonly requestId: string;
  /**
   * The transport to send through. **Required for any work to happen** (A8.4a audit H3).
   *
   * Nothing in production supplies one. That is the point: A8.4a has no real transport, and a
   * worker that quietly manufactured a fake would record deliveries it never made.
   */
  readonly transport?: ReminderTransport;
  readonly now?: string;
  readonly startedAtMs?: number;
  readonly deadlineMs?: number;
  readonly maxSchedules?: number;
  readonly env?: NodeJS.ProcessEnv;
}

type CountKeys = Exclude<
  keyof ReminderProcessAggregate,
  'deliveryEnabled' | 'transportConfigured' | 'deadlineStopped' | 'requestId'
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
  deadlineStopped: false,
};

export async function runInternalReminderProcess(
  input: RunReminderProcessInput,
): Promise<{ response: ReminderProcessAggregate }> {
  const deliveryEnabled = isReminderDeliveryEnabled(input.env ?? process.env);
  const transport = input.transport;

  if (!deliveryEnabled || !transport) {
    // Two ways to do nothing, reported apart so an operator can tell them apart.
    //
    // Delivery off is the dark default and needs no explanation. No transport is the fail-closed
    // path: the flag was turned on in an environment that has nothing to send with, and the only
    // safe response is to scan nothing, claim nothing, write nothing, and say so. Returning before
    // `loadDbRuntime` means the disabled invocation does not even open the database.
    return {
      response: {
        deliveryEnabled,
        transportConfigured: transport !== undefined,
        ...ZERO_AGGREGATE,
        requestId: input.requestId,
      },
    };
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

  const due = outOfTime()
    ? []
    : await runtime.listDueReminderSchedulesGlobally(input.db, {
        dueAtOrBefore: now,
        limit: input.maxSchedules ?? MAX_SCHEDULES_PER_PROCESS,
      });

  for (const schedule of due) {
    if (outOfTime()) {
      break;
    }
    counters.schedulesScanned += 1;
    await processOneSchedule({ ...context, schedule, transport });
  }

  return {
    response: {
      deliveryEnabled: true,
      transportConfigured: true,
      ...counters,
      requestId: input.requestId,
    },
  };
}

type DbRuntime = Awaited<ReturnType<typeof loadDbRuntime>>;
type DueSchedule = Awaited<ReturnType<DbRuntime['listDueReminderSchedulesGlobally']>>[number];
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
        nextOverdueOccurrence: nextOccurrenceFor(occurrence, now),
      });
      if (!settled.alreadySettled) {
        counters.unsettledOccurrencesSettled += 1;
        if (settled.ceilingReached) {
          counters.ceilingStops += 1;
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
  args: ProcessContext & { schedule: DueSchedule; transport: ReminderTransport },
): Promise<void> {
  const { runtime, db, schedule, now } = args;
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
  args: ProcessContext & { schedule: DueSchedule; transport: ReminderTransport },
): Promise<void> {
  const { runtime, db, schedule, now, transport, counters } = args;

  const claim = await runtime.claimReminderOccurrence(db, {
    id: newEntityId('rocc'),
    organizationId: schedule.organizationId,
    scheduleId: schedule.id,
    generation: schedule.generation,
    occurrenceKind: 'overdue',
    occurrenceLocalDate: schedule.nextOverdueOccurrenceLocalDate,
    occurrenceAt: schedule.nextOverdueOccurrenceAt,
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
  const refusal = await evaluatePreSendGuards(runtime, db, schedule, now);
  if (refusal) {
    await settle(args, attemptId, claimSequence, { outcome: 'skipped', skipReason: refusal });
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
      taskId: schedule.taskId,
      occurrenceKind: 'overdue',
      occurrenceLocalDate: schedule.nextOverdueOccurrenceLocalDate,
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
  args: ProcessContext & { schedule: DueSchedule },
  attemptId: string,
  claimSequence: number,
  outcome: {
    outcome: 'success' | 'retryable_failure' | 'permanent_failure' | 'ambiguous' | 'skipped';
    skipReason?: 'no_active_assignment' | 'task_not_eligible' | 'schedule_superseded';
    failureCode?: string;
    providerAcceptedAt?: string;
    providerMessageRef?: string;
  },
): Promise<void> {
  const { runtime, db, schedule, now, counters } = args;

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
    nextOverdueOccurrence: nextOccurrenceFor(schedule, now),
  });

  if (finalized.ceilingReached) {
    counters.ceilingStops += 1;
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
 * Capability and recipient-link requirements beyond "an active assignment exists" are deliberately
 * not checked: the A8.4b envelope question decides what a reminder is addressed to, and inventing
 * an answer here would be inventing product law.
 */
async function evaluatePreSendGuards(
  runtime: DbRuntime,
  db: DbClient,
  schedule: DueSchedule,
  now: string,
): Promise<'no_active_assignment' | 'task_not_eligible' | 'schedule_superseded' | null> {
  const snapshot = await runtime.readReminderPreSendSnapshot(
    db,
    schedule.organizationId,
    schedule.taskId,
  );
  if (!snapshot) {
    return 'task_not_eligible';
  }

  // Completed, dismissed, and Waiting all resolve to "not now", and the A8.2 policy says which is
  // which — the worker does not restate D107.
  if (decideReminderScheduling(snapshot.taskStatus).kind !== 'schedule_active') {
    return 'task_not_eligible';
  }
  if (!snapshot.hasActiveAssignment) {
    return 'no_active_assignment';
  }
  if (snapshot.dueLocalDate === null) {
    return 'schedule_superseded';
  }

  const current = snapshot.schedule;
  if (
    !current ||
    current.id !== schedule.id ||
    current.status !== 'active' ||
    current.generation !== schedule.generation ||
    current.nextOverdueOccurrenceAt === null ||
    current.nextOverdueOccurrenceAt !== schedule.nextOverdueOccurrenceAt
  ) {
    return 'schedule_superseded';
  }

  // The armed occurrence must genuinely have arrived. A scan reading `lte: now` and a guard reading
  // the row again cannot disagree unless the schedule moved, which the checks above already caught;
  // this is the belt on those braces, and it costs one comparison.
  if (Date.parse(schedule.nextOverdueOccurrenceAt) > Date.parse(now)) {
    return 'schedule_superseded';
  }
  return null;
}
