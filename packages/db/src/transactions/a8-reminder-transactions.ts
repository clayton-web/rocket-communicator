import type { LocalDate } from '@aicaa/domain';
import { hasReachedOverdueDeliveryCeiling } from '../../../domain/dist/index.js';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import {
  toReminderOccurrenceOutcome,
  toStorableLocalDate,
  type PersistedReminderDeliveryAttempt,
  type PersistedReminderSchedule,
} from '../mappers/reminder-mappers.js';
import { requireTaskScope } from '../repositories/reminder-scope-guard.js';
import {
  createReminderSchedule,
  incrementOverdueDeliveredCount,
  setNextOverdueOccurrence,
  stopReminderSchedule,
  type CreateReminderScheduleInput,
} from '../repositories/reminder-schedule-repository.js';
import {
  listReminderDeliveryAttemptsForGeneration,
  recordReminderDeliveryOutcome,
  recordSkippedReminderOccurrence,
  type TerminalReminderDeliveryOutcome,
} from '../repositories/reminder-delivery-attempt-repository.js';
import type { ReminderSkipReason } from '../mappers/reminder-mappers.js';

/**
 * A8.3a multi-record reminder persistence (D104–D107, D109).
 *
 * These are the flows where two or more rows must agree or neither should exist. They orchestrate
 * repository primitives inside one transaction; they still make no scheduling decision. The only
 * domain function called is `hasReachedOverdueDeliveryCeiling`, a pure predicate over a count —
 * imported rather than reimplemented so D106's ceiling has exactly one definition in the codebase.
 *
 * No delivery happens here. Nothing in this module sends email, calls Gmail, or contacts any
 * provider: it records what a future A8.4 worker will have done.
 */

export interface EstablishReminderScheduleInput {
  readonly db: DbClient;
  readonly schedule: CreateReminderScheduleInput;
  /**
   * Present when the advance occurrence had already elapsed at establishment (D105). Recording it
   * in the same transaction as the schedule is what makes the decision "made once and persisted":
   * a schedule can never exist with its advance decision still pending, so a later run has nothing
   * to reclassify.
   */
  readonly skippedAdvanceAttempt?: {
    readonly id: string;
    readonly skipReason: Extract<ReminderSkipReason, 'advance_window_elapsed'>;
    readonly recordedAt: string;
  };
}

export interface EstablishReminderScheduleResult {
  readonly schedule: PersistedReminderSchedule;
  readonly skippedAdvanceAttempt: PersistedReminderDeliveryAttempt | null;
}

/**
 * Establish a Task's Reminder Schedule and, atomically, the Task's canonical local due date.
 *
 * Writing `tasks.due_local_date` here rather than in the generic Task update path is deliberate on
 * two counts. It keeps the canonical due date and the generation's snapshot of it from ever
 * disagreeing, and it means the column stays null for every historical Task — D109 forbids existing
 * due-date data from activating reminders, and a due date only becomes canonical when an Owner
 * explicitly establishes a schedule against it.
 *
 * The Task's `version` is intentionally not bumped: `due_local_date` is not part of any Owner-facing
 * contract in this slice, so nothing an ETag describes has changed.
 */
export async function persistEstablishedReminderSchedule(
  input: EstablishReminderScheduleInput,
): Promise<EstablishReminderScheduleResult> {
  return input.db.$transaction(async (tx) => {
    // `createReminderSchedule` has already resolved the Task and refused a caller claiming the
    // wrong organization, so the Task is known to exist and to be writable in this scope.
    const schedule = await createReminderSchedule(tx, input.schedule);

    await tx.task.update({
      where: { id: schedule.taskId },
      data: { dueLocalDate: schedule.dueLocalDate },
    });

    if (!input.skippedAdvanceAttempt) {
      return { schedule, skippedAdvanceAttempt: null };
    }

    const skipped = await recordSkippedReminderOccurrence(tx, {
      id: input.skippedAdvanceAttempt.id,
      organizationId: schedule.organizationId,
      scheduleId: schedule.id,
      generation: schedule.generation,
      occurrenceKind: 'advance',
      occurrenceLocalDate: schedule.advanceOccurrenceLocalDate,
      occurrenceAt: schedule.advanceOccurrenceAt,
      skipReason: input.skippedAdvanceAttempt.skipReason,
      recordedAt: input.skippedAdvanceAttempt.recordedAt,
    });

    return { schedule, skippedAdvanceAttempt: skipped };
  });
}

export interface RecordOverdueDeliveryInput {
  readonly db: DbClient;
  readonly organizationId: string;
  readonly scheduleId: string;
  readonly attemptId: string;
  /** The generation the delivery was made under. A superseded generation must not be credited. */
  readonly generation: number;
  readonly completedAt: string;
  /**
   * The next occurrence the caller computed with the A8.2 domain, supplied optimistically. It is
   * discarded when this delivery reaches the ceiling, because a stopped schedule must carry no
   * future occurrence.
   */
  readonly nextOverdueOccurrence: {
    readonly occurrenceLocalDate: LocalDate;
    readonly occurrenceAt: string;
  } | null;
}

export interface RecordOverdueDeliveryResult {
  readonly attempt: PersistedReminderDeliveryAttempt;
  readonly schedule: PersistedReminderSchedule;
  /** True when this delivery was the one that reached the D106 ceiling. */
  readonly ceilingReached: boolean;
}

/**
 * Record a successful overdue delivery: complete the attempt, credit the per-generation count, and
 * either arm the next occurrence or stop at the ceiling — all or nothing (D106).
 *
 * Splitting these would allow a crash to leave a delivery recorded but uncounted, which is how a
 * Recipient ends up receiving a 15th, 16th, and 17th overdue reminder from a schedule that believes
 * it has sent 14.
 *
 * Reaching the ceiling stops the schedule permanently and raises Owner attention; it never restarts
 * automatically, and only an Owner-authorized material due-date change (D104) resets the count.
 */
export async function persistSuccessfulOverdueDelivery(
  input: RecordOverdueDeliveryInput,
): Promise<RecordOverdueDeliveryResult> {
  return input.db.$transaction(async (tx) => {
    const attempt = await recordReminderDeliveryOutcome(tx, {
      organizationId: input.organizationId,
      attemptId: input.attemptId,
      outcome: 'success',
      completedAt: input.completedAt,
    });

    await incrementOverdueDeliveredCount(tx, {
      organizationId: input.organizationId,
      scheduleId: input.scheduleId,
      expectedGeneration: input.generation,
    });

    // The ceiling is judged against the recorded occurrences, not the denormalized counter, and by
    // the domain rather than by a comparison written here. The counter is a cache for reads; the
    // attempt rows are what actually happened, and D106 defines the ceiling over them.
    const history = await listReminderDeliveryAttemptsForGeneration(
      tx,
      input.organizationId,
      input.scheduleId,
      input.generation,
    );
    const ceilingReached = hasReachedOverdueDeliveryCeiling(
      history.map(toReminderOccurrenceOutcome),
    );

    if (ceilingReached) {
      const stopped = await stopReminderSchedule(tx, {
        organizationId: input.organizationId,
        scheduleId: input.scheduleId,
        reason: 'overdue_ceiling_reached',
        stoppedAt: input.completedAt,
        requiresOwnerAttention: true,
      });
      return { attempt, schedule: stopped, ceilingReached };
    }

    const armed = await setNextOverdueOccurrence(tx, {
      organizationId: input.organizationId,
      scheduleId: input.scheduleId,
      expectedGeneration: input.generation,
      nextOverdueOccurrence: input.nextOverdueOccurrence,
    });
    return { attempt, schedule: armed, ceilingReached };
  });
}

export interface RecordNonDeliveryOutcomeInput {
  readonly db: DbClient;
  readonly organizationId: string;
  readonly scheduleId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly outcome: Exclude<TerminalReminderDeliveryOutcome, 'success'>;
  readonly completedAt: string;
  readonly skipReason?: ReminderSkipReason | null;
  readonly failureCode?: string | null;
  readonly nextOverdueOccurrence: {
    readonly occurrenceLocalDate: LocalDate;
    readonly occurrenceAt: string;
  } | null;
  /**
   * Set for a permanent delivery failure, which suspends further sends and raises Owner attention
   * (D107). Supplied by the caller because "permanent" is a delivery classification, not a fact
   * persistence can read off a row.
   */
  readonly stopForPermanentFailure?: boolean;
}

/**
 * Record a failed, ambiguous, or skipped occurrence and arm the next one.
 *
 * The per-generation count is deliberately untouched: D106 excludes retryable failures, permanent
 * failures, ambiguity, skips, and claims from the ceiling. A skipped day is also not consumed —
 * the one-delivery-per-local-day index covers successful rows only — so a Task skipped today for
 * having no active assignment can still be reminded today once an assignment exists.
 */
export async function persistNonDeliveryOutcome(
  input: RecordNonDeliveryOutcomeInput,
): Promise<{ attempt: PersistedReminderDeliveryAttempt; schedule: PersistedReminderSchedule }> {
  return input.db.$transaction(async (tx) => {
    const attempt = await recordReminderDeliveryOutcome(tx, {
      organizationId: input.organizationId,
      attemptId: input.attemptId,
      outcome: input.outcome,
      completedAt: input.completedAt,
      skipReason: input.skipReason ?? null,
      failureCode: input.failureCode ?? null,
    });

    if (input.stopForPermanentFailure) {
      const stopped = await stopReminderSchedule(tx, {
        organizationId: input.organizationId,
        scheduleId: input.scheduleId,
        reason: 'permanent_delivery_failure',
        stoppedAt: input.completedAt,
        requiresOwnerAttention: true,
      });
      return { attempt, schedule: stopped };
    }

    const armed = await setNextOverdueOccurrence(tx, {
      organizationId: input.organizationId,
      scheduleId: input.scheduleId,
      expectedGeneration: input.generation,
      nextOverdueOccurrence: input.nextOverdueOccurrence,
    });
    return { attempt, schedule: armed };
  });
}

/**
 * Clear a Task's canonical local due date and stop its schedule, atomically (D107).
 *
 * Removing the due date stops the schedule; doing both in one transaction prevents the state where
 * a Task has no due date but an active schedule still holding a future occurrence.
 */
export async function persistDueDateRemoval(input: {
  readonly db: DbClient;
  readonly organizationId: string;
  readonly taskId: string;
  readonly scheduleId: string;
  readonly stoppedAt: string;
}): Promise<PersistedReminderSchedule> {
  return input.db.$transaction(async (tx) => {
    const scope = await requireTaskScope(tx, input.organizationId, input.taskId);
    await tx.task.update({
      where: { id: scope.taskId },
      data: { dueLocalDate: null },
    });
    return stopReminderSchedule(tx, {
      organizationId: input.organizationId,
      scheduleId: input.scheduleId,
      reason: 'due_date_removed',
      stoppedAt: input.stoppedAt,
    });
  });
}

/** Read the Task's canonical organization-local due date (D109). Null when none is set. */
export async function getTaskDueLocalDate(
  db: DbClient,
  organizationId: string,
  taskId: string,
): Promise<string | null> {
  const row = await db.task.findFirst({
    where: { id: taskId, organizationId },
    select: { dueLocalDate: true },
  });
  return row?.dueLocalDate ?? null;
}

/**
 * Re-point a Task's canonical due date when a new generation opens (D104).
 *
 * Separate from `persistEstablishedReminderSchedule` because the caller must first decide, with the
 * domain `isDueDateChangeMaterial`, whether a new generation is owed at all — re-saving the same
 * date must change nothing.
 */
export async function persistCanonicalDueLocalDate(input: {
  readonly db: DbClient | DbTransaction;
  readonly organizationId: string;
  readonly taskId: string;
  readonly dueLocalDate: LocalDate;
}): Promise<void> {
  const scope = await requireTaskScope(input.db, input.organizationId, input.taskId);
  const dueLocalDate = toStorableLocalDate(input.dueLocalDate, 'dueLocalDate');
  await input.db.task.update({
    where: { id: scope.taskId },
    data: { dueLocalDate },
  });
}
