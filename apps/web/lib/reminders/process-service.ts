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
import {
  FakeReminderTransport,
  type ReminderTransport,
  type ReminderTransportResult,
} from './transport';

/**
 * A8.4a reminder occurrence processing.
 *
 * This is the worker-safety foundation, not a worker that sends reminders. It claims occurrences,
 * validates eligibility, invokes an **injected transport**, and finalizes results through the safe
 * occurrence transaction. The only transport that exists is the fake one, delivery is disabled by
 * default, and nothing here imports Gmail or any provider.
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
 * 3. **Never hold a database transaction across the transport call.** The claim, the marker, and the
 *    finalization are three separate transactions with the network call between the second and third.
 *
 * ## Five-minute wake-up semantics
 *
 * Nothing here repeats every five minutes. Persisted occurrence instants are the scheduling
 * authority; this service asks which of them have arrived. A missed invocation is recovered by the
 * next one, overlapping invocations are made safe by the unique occurrence identity rather than by
 * not overlapping, and a backlog drains a bounded batch at a time. No in-memory timer is load-bearing.
 */

/** Aggregate counters. Counts only — never a Task summary, recipient, address, or provider body. */
export interface ReminderProcessAggregate {
  readonly deliveryEnabled: boolean;
  readonly schedulesScanned: number;
  readonly occurrencesClaimed: number;
  readonly delivered: number;
  readonly skipped: number;
  readonly failedRetryable: number;
  readonly failedPermanent: number;
  readonly ambiguous: number;
  readonly recoveredClaims: number;
  readonly ceilingStops: number;
  readonly requestId: string;
}

export interface RunReminderProcessInput {
  readonly db: DbClient;
  readonly requestId: string;
  /** Injected so tests can script outcomes. Production has no real transport in this slice. */
  readonly transport?: ReminderTransport;
  readonly now?: string;
  readonly startedAtMs?: number;
  readonly deadlineMs?: number;
  readonly maxSchedules?: number;
  readonly env?: NodeJS.ProcessEnv;
}

type Counters = {
  -readonly [K in Exclude<keyof ReminderProcessAggregate, 'deliveryEnabled' | 'requestId'>]: number;
};

const ZERO_AGGREGATE: Counters = {
  schedulesScanned: 0,
  occurrencesClaimed: 0,
  delivered: 0,
  skipped: 0,
  failedRetryable: 0,
  failedPermanent: 0,
  ambiguous: 0,
  recoveredClaims: 0,
  ceilingStops: 0,
};

export async function runInternalReminderProcess(
  input: RunReminderProcessInput,
): Promise<{ response: ReminderProcessAggregate }> {
  const deliveryEnabled = isReminderDeliveryEnabled(input.env ?? process.env);
  if (!deliveryEnabled) {
    // Dark deployment. No scan, no claim, no write, no transport — the endpoint exists and answers,
    // and that is all it does until an Owner-approved decision turns it on.
    return {
      response: { deliveryEnabled: false, ...ZERO_AGGREGATE, requestId: input.requestId },
    };
  }

  const startedAtMs = input.startedAtMs ?? Date.now();
  const deadlineMs = input.deadlineMs ?? startedAtMs + PROCESS_MAX_DURATION_MS;
  const now = input.now ?? new Date(startedAtMs).toISOString();
  const transport = input.transport ?? new FakeReminderTransport();
  const runtime = await loadDbRuntime();
  const counters = { ...ZERO_AGGREGATE };

  const outOfTime = () => Date.now() > deadlineMs - PROCESS_STOP_MARGIN_MS;

  // Recovery first. An abandoned occurrence blocks its own identity, so a schedule with one is
  // unprocessable until it is settled — clearing them before scanning means the same invocation
  // that finds the wreckage can also make progress past it.
  counters.recoveredClaims = await recoverAbandonedClaims(runtime, input.db, now, outOfTime);

  const due = await runtime.listDueReminderSchedulesGlobally(input.db, {
    dueAtOrBefore: now,
    limit: input.maxSchedules ?? MAX_SCHEDULES_PER_PROCESS,
  });

  for (const schedule of due) {
    if (outOfTime()) {
      break;
    }
    counters.schedulesScanned += 1;
    await processOneSchedule({ runtime, db: input.db, schedule, now, transport, counters });
  }

  return {
    response: { deliveryEnabled: true, ...counters, requestId: input.requestId },
  };
}

type DbRuntime = Awaited<ReturnType<typeof loadDbRuntime>>;
type DueSchedule = Awaited<ReturnType<DbRuntime['listDueReminderSchedulesGlobally']>>[number];

/**
 * Settle occurrences whose claimant vanished (A8.3a audit F2).
 *
 * The classification is entirely `provider_call_started_at`. Null means nothing left the building,
 * so the lease is simply released and the occurrence returns to the pool for an ordinary retry. Set
 * means a provider may hold the message, and no amount of reasoning recovers the truth — so the
 * occurrence is finalized ambiguous, consumes its local day, and is never retried.
 */
async function recoverAbandonedClaims(
  runtime: DbRuntime,
  db: DbClient,
  now: string,
  outOfTime: () => boolean,
): Promise<number> {
  const expired = await runtime.listExpiredOccurrenceClaims(db, {
    now,
    limit: MAX_RECOVERIES_PER_PROCESS,
  });

  let recovered = 0;
  for (const claim of expired) {
    if (outOfTime()) {
      break;
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
        await runtime.finalizeAbandonedInFlightOccurrence({
          db,
          organizationId: claim.organizationId,
          attemptId: claim.id,
          scheduleId: claim.scheduleId,
          claimSequence: claim.claimSequence,
          completedAt: now,
          expectedGeneration: claim.generation,
        });
      }
      recovered += 1;
    } catch {
      // A concurrent recoverer won the fence. Its work is this work; nothing is owed here.
    }
  }
  return recovered;
}

async function processOneSchedule(args: {
  runtime: DbRuntime;
  db: DbClient;
  schedule: DueSchedule;
  now: string;
  transport: ReminderTransport;
  counters: Counters;
}): Promise<void> {
  const { runtime, db, schedule, now, transport, counters } = args;
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
    await processOneOccurrence({ runtime, db, schedule, now, transport, counters });
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

async function processOneOccurrence(args: {
  runtime: DbRuntime;
  db: DbClient;
  schedule: DueSchedule;
  now: string;
  transport: ReminderTransport;
  counters: Counters;
}): Promise<void> {
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
    // reachable only if the budget was lowered between attempts, because the branch below spends
    // the last attempt permanently rather than leaving a retryable row nobody may claim.
    return;
  }
  counters.occurrencesClaimed += 1;

  const attemptId = claim.attempt.id;
  const claimSequence = claim.claimSequence;
  /**
   * Whether this is the last attempt this occurrence will ever get.
   *
   * A retryable failure recorded here would be the final word while still being labelled
   * "try again": no worker could claim it, so the schedule would keep scanning an occurrence it can
   * never finish and would never arm the next one. Spending the last attempt as a permanent failure
   * settles the occurrence truthfully and stops the schedule for the Owner to look at.
   */
  const lastAttempt = claim.attempt.attemptCount >= MAX_OCCURRENCE_ATTEMPTS;

  // ---- Pre-send guards: re-read everything, immediately before the call. ----
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
 * Finalize one occurrence through the safe transaction, computing the next occurrence first.
 *
 * The next occurrence is always computed with the A8.2 domain and always supplied optimistically;
 * the transaction decides whether the schedule is still in a state that may receive it.
 */
async function settle(
  args: {
    runtime: DbRuntime;
    db: DbClient;
    schedule: DueSchedule;
    now: string;
    counters: Counters;
  },
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

  // Anchored on the generation's due date, never on the occurrence just processed: D106 defines the
  // series from the due date, and re-deriving it from today would slide the series forward a day
  // every time one was delivered.
  const next = selectNextOverdueOccurrence({
    dueLocalDate: schedule.dueLocalDate as LocalDate,
    now: now as UtcInstant,
    timeZone: schedule.schedulingTimeZone || REMINDER_SCHEDULING_TIME_ZONE,
  });

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
    nextOverdueOccurrence: {
      occurrenceLocalDate: next.occurrenceLocalDate,
      occurrenceAt: next.occurrenceAt,
    },
  });

  if (finalized.ceilingReached) {
    counters.ceilingStops += 1;
  }
}

/**
 * Everything that must still be true at the moment of sending, re-read rather than remembered.
 *
 * The schedule was read by a scan that may be seconds old, and an Owner can complete a Task in that
 * interval. Returns the truthful skip reason, or null when the send may proceed.
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
  const task = await runtime.getTaskById(db, schedule.organizationId, schedule.taskId);

  // Completed, dismissed, and Waiting all resolve to "not now", and the A8.2 policy says which is
  // which — the worker does not restate D107.
  if (decideReminderScheduling(task.status).kind !== 'schedule_active') {
    return 'task_not_eligible';
  }
  if (!task.assignment) {
    return 'no_active_assignment';
  }

  const current = await runtime.findReminderScheduleByTaskId(
    db,
    schedule.organizationId,
    schedule.taskId,
  );
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

  const dueLocalDate = await runtime.getTaskDueLocalDate(
    db,
    schedule.organizationId,
    schedule.taskId,
  );
  if (dueLocalDate === null) {
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
