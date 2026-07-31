import type { TaskStatus } from '@aicaa/domain';
import { decideReminderScheduling } from '../../../domain/dist/index.js';
import type { DbClient } from '../client/create-prisma-client.js';
import type { AuditEventRecord } from '../mappers/domain-mappers.js';
import { createAuditEvent, type CreateAuditEventInput } from '../repositories/audit-repository.js';
import { recordSkippedReminderOccurrence } from '../repositories/reminder-delivery-attempt-repository.js';
import {
  isLiveReminderSchedule,
  NO_SCHEDULE_REMINDER_VERSION,
  type PersistedReminderDeliveryAttempt,
  type PersistedReminderSchedule,
  type ReminderSkipReason,
} from '../mappers/reminder-mappers.js';
import {
  bumpReminderVersionForOwnerChange,
  createReminderSchedule,
  findReminderScheduleByTaskId,
  openNextReminderGeneration,
  stopReminderSchedule,
  type CreateReminderScheduleInput,
  type OpenNextReminderGenerationInput,
  type ReminderScheduleInitialStatus,
} from '../repositories/reminder-schedule-repository.js';
import {
  lockTaskScopeForReminderMutation,
  type LockedTaskScope,
} from '../repositories/reminder-scope-guard.js';
import {
  domainConflict,
  optimisticConcurrency,
  rethrowAsConcurrencyFailure,
} from '../errors/persistence-errors.js';

/**
 * A8.3b Owner-facing reminder units of work.
 *
 * A8.3a supplied the persistence primitives and the transactions a future worker needs. These are
 * the transactions the *Owner API* needs, and they differ in one respect that matters: each one
 * writes an audit event in the same transaction as the state it describes. That is the whole reason
 * they exist as a separate layer rather than as sequential calls from the route service — an audit
 * row claiming a schedule was established, committed independently of the schedule itself, is
 * exactly the untruthful history D100 forbids. If the schedule write fails, the event must not
 * exist; if the event write fails, neither must the schedule.
 *
 * These transactions still compute nothing. Occurrences, dispositions, and the current instant all
 * arrive as arguments from the A8.2 domain by way of the route service (D103, D127).
 *
 * ## One lock order (A8.3b audit F2, re-audit M1)
 *
 * All three begin by locking the Task row, then write the schedule, then the Task's due date. The
 * original A8.3b implementation ordered establishment and generation-change as schedule-then-Task
 * and removal as Task-then-schedule; on real PostgreSQL a concurrent change and removal deadlocked,
 * and the victim escaped as a 500. The lock also serializes the compare-and-set reads below, so the
 * loser of a race reads the winner's committed state and reports a truthful precondition failure
 * instead of racing past it. PGlite serializes everything on one connection and could not reveal
 * this, which is why the proof lives in a real-PostgreSQL test.
 *
 * The A8.3a transactions in `a8-reminder-transactions.ts` and the lifecycle reconciler in
 * `a8-lifecycle-reminder-effects.ts` now follow the identical order. That is deliberate and load
 * bearing rather than tidiness: because *every* path that can make a schedule live takes this Task
 * lock first, a transaction holding the lock may treat what it reads about the schedule as stable
 * for its whole duration — which is precisely what the removal precondition below relies on.
 */

/** The advance occurrence that had already elapsed when the Owner chose the date (D105). */
export interface SkippedAdvanceAttemptInput {
  readonly id: string;
  readonly skipReason: Extract<ReminderSkipReason, 'advance_window_elapsed'>;
  readonly recordedAt: string;
}

export interface OwnerReminderMutationResult {
  readonly schedule: PersistedReminderSchedule;
  readonly skippedAdvanceAttempt: PersistedReminderDeliveryAttempt | null;
  readonly audit: AuditEventRecord;
}

/**
 * Run an Owner reminder unit of work, translating a database serialization refusal into the
 * repository's typed concurrency error.
 *
 * The compare-and-set preconditions inside these transactions catch the races they can see. This
 * catches the ones the database resolves for us: even with a single lock order, PostgreSQL may abort
 * a transaction under `40001`/`40P01`, and that must reach the caller as "read it again", never as
 * an unexplained failure.
 */
async function runOwnerReminderTransaction<T>(
  db: DbClient,
  context: string,
  work: (tx: Parameters<Parameters<DbClient['$transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  try {
    return await db.$transaction(work);
  } catch (error) {
    rethrowAsConcurrencyFailure(error, context);
  }
}

/**
 * Re-check, under the Task lock, that the Task's lifecycle state still permits the schedule the Owner
 * asked for (A8 lifecycle wiring).
 *
 * The route service already gated on Task status, but from a read taken before the lock, which is a
 * guess about what the Task will be when the write commits. The real PostgreSQL suite showed the
 * guess being wrong in the way that matters: a `PUT` that had read an `open` Task raced a dismissal,
 * and reactivated a schedule on a Task that was terminal by the time it committed — leaving a
 * dismissed Task holding a claimable occurrence, which is the state D107 exists to prevent.
 *
 * `decideReminderScheduling` is the same domain policy the route service consults, so this is the
 * identical rule applied to authoritative state rather than a second, subtly different copy of it.
 * A Task that moved to a *different* schedulable state also refuses: an Owner who asked for an active
 * schedule on an `open` Task did not ask for a suspended one on a Waiting Task, and quietly
 * substituting it would commit a decision the Owner never made.
 */
function assertLockedTaskAllowsSchedule(
  scope: LockedTaskScope,
  intendedStatus: ReminderScheduleInitialStatus,
): void {
  const disposition = decideReminderScheduling(scope.status as TaskStatus);
  const permitted =
    disposition.kind === 'schedule_active'
      ? 'active'
      : disposition.kind === 'schedule_suspended'
        ? 'suspended_waiting'
        : null;

  if (permitted === null) {
    throw domainConflict(
      `Task ${scope.taskId} is ${scope.status}; reminders cannot be scheduled for it.`,
    );
  }
  if (permitted !== intendedStatus) {
    throw domainConflict(
      `Task ${scope.taskId} became ${scope.status} while this reminder change was in flight; ` +
        `it now requires a ${permitted} schedule rather than ${intendedStatus}.`,
    );
  }
}

async function recordSkippedAdvance(
  tx: Parameters<Parameters<DbClient['$transaction']>[0]>[0],
  schedule: PersistedReminderSchedule,
  skipped: SkippedAdvanceAttemptInput,
): Promise<PersistedReminderDeliveryAttempt> {
  return recordSkippedReminderOccurrence(tx, {
    id: skipped.id,
    organizationId: schedule.organizationId,
    scheduleId: schedule.id,
    generation: schedule.generation,
    occurrenceKind: 'advance',
    occurrenceLocalDate: schedule.advanceOccurrenceLocalDate,
    occurrenceAt: schedule.advanceOccurrenceAt,
    skipReason: skipped.skipReason,
    recordedAt: skipped.recordedAt,
  });
}

/**
 * Establish a Task's first Reminder Schedule, its canonical due date, and the audit event.
 *
 * Mirrors A8.3a's `persistEstablishedReminderSchedule` and adds the audit row. The Task's `version`
 * is deliberately not bumped: `due_local_date` is not part of the Task contract, so nothing an ETag
 * describes has changed, and bumping it would invalidate a client's Task ETag for a change that
 * client cannot see.
 */
export async function persistOwnerReminderEstablishment(input: {
  readonly db: DbClient;
  readonly schedule: CreateReminderScheduleInput;
  readonly skippedAdvanceAttempt?: SkippedAdvanceAttemptInput;
  readonly audit: CreateAuditEventInput;
}): Promise<OwnerReminderMutationResult> {
  return runOwnerReminderTransaction(input.db, 'Reminder establishment', async (tx) => {
    const scope = await lockTaskScopeForReminderMutation(
      tx,
      input.schedule.organizationId,
      input.schedule.taskId,
    );
    assertLockedTaskAllowsSchedule(scope, input.schedule.status ?? 'active');

    const schedule = await createReminderSchedule(tx, input.schedule);

    await tx.task.update({
      where: { id: schedule.taskId },
      data: { dueLocalDate: schedule.dueLocalDate },
    });

    const skippedAdvanceAttempt = input.skippedAdvanceAttempt
      ? await recordSkippedAdvance(tx, schedule, input.skippedAdvanceAttempt)
      : null;

    const audit = await createAuditEvent(tx, input.audit);
    return { schedule, skippedAdvanceAttempt, audit };
  });
}

/**
 * Close the current generation, open the next one, update the canonical due date, and audit it.
 *
 * Prior delivery attempts are untouched — history is superseded, never rewritten (D107, D109) — so
 * the new generation starts with a zero overdue count while every earlier attempt remains readable
 * against the generation it belonged to.
 *
 * `openNextReminderGeneration` matches on `expectedGeneration`, so two Owners changing the due date
 * concurrently cannot both succeed; the loser gets an optimistic-concurrency failure rather than a
 * silently discarded change.
 */
export async function persistOwnerReminderGenerationChange(input: {
  readonly db: DbClient;
  readonly generation: OpenNextReminderGenerationInput;
  readonly skippedAdvanceAttempt?: SkippedAdvanceAttemptInput;
  readonly audit: CreateAuditEventInput;
}): Promise<OwnerReminderMutationResult> {
  return runOwnerReminderTransaction(input.db, 'Reminder generation change', async (tx) => {
    const scope = await lockTaskScopeForReminderMutation(
      tx,
      input.generation.organizationId,
      input.generation.taskId,
    );
    assertLockedTaskAllowsSchedule(scope, input.generation.status ?? 'active');

    const schedule = await openNextReminderGeneration(tx, input.generation);

    await tx.task.update({
      where: { id: schedule.taskId },
      data: { dueLocalDate: schedule.dueLocalDate },
    });

    const skippedAdvanceAttempt = input.skippedAdvanceAttempt
      ? await recordSkippedAdvance(tx, schedule, input.skippedAdvanceAttempt)
      : null;

    const audit = await createAuditEvent(tx, input.audit);
    return { schedule, skippedAdvanceAttempt, audit };
  });
}

export interface OwnerReminderRemovalResult {
  /** Null only when the Task had a canonical due date but no schedule row at all. */
  readonly schedule: PersistedReminderSchedule | null;
  /** Null when there was nothing to remove, since no removal happened to audit. */
  readonly audit: AuditEventRecord | null;
  /** False when the Task already had no due date and no live schedule, so nothing was written. */
  readonly changed: boolean;
}

/**
 * What the removal transaction found once it held the Task lock, and what it did about it.
 *
 * Handed to the caller's audit builder so the event describes authoritative state rather than the
 * state the caller happened to read before the lock (A8.3b re-audit H1).
 */
export interface OwnerReminderRemovalOutcome {
  /** The schedule as it existed under the lock, before this transaction touched it. */
  readonly priorSchedule: PersistedReminderSchedule | null;
  /** The Task's canonical due date as it existed under the lock. */
  readonly priorDueLocalDate: string | null;
  /** The schedule this transaction stopped, or null when there was no live schedule to stop. */
  readonly stoppedSchedule: PersistedReminderSchedule | null;
}

/**
 * Clear the canonical due date, stop the schedule, and audit the removal — atomically.
 *
 * ## Every branch has a transactional precondition (A8.3b re-audit H1)
 *
 * The earlier version of this function accepted `scheduleId: string | null` and an optional
 * `expectedReminderVersion`, both derived from a read the *caller* performed before the lock. When
 * that read said "no live schedule", the caller passed `null` and no version, and this transaction
 * then cleared `tasks.due_local_date` and wrote `reminder.due_date.removed` with no precondition of
 * any kind — it did not even re-check that a schedule existed. The re-audit reproduced the
 * consequence on real PostgreSQL: racing a reactivation, both committed, and the surviving state was
 * an **active** schedule holding a claimable occurrence while `tasks.due_local_date` was `NULL` and
 * the audit trail contained a removal event behind it.
 *
 * So the caller no longer decides. It supplies only the reminder version it observed, and this
 * transaction re-reads the schedule under the Task lock and classifies it authoritatively. The
 * version must match in every branch, including the branch where no schedule exists — absence is
 * asserted, not assumed, and `NO_SCHEDULE_REMINDER_VERSION` (0) is the token that asserts it.
 *
 * What makes the re-read trustworthy is the universal lock order: every mutation that can make a
 * schedule live acquires this same Task row lock first, so a schedule observed as absent or stopped
 * while the lock is held cannot become active before this transaction commits. The precondition and
 * the lock order are one mechanism, not two.
 *
 * A stale caller therefore loses with `OPTIMISTIC_CONCURRENCY` and writes nothing — no due-date
 * clear, no stop, no audit event. No reminder row is ever deleted: removing a due date is not
 * erasing the record of reminders already sent (D107, D109).
 *
 * **"Nothing to remove" is also decided here**, for the same reason. The caller reads the due date
 * and the schedule in separate statements, so under contention it can observe a due date already
 * cleared by a winning removal alongside a schedule version from before that removal — a torn read
 * that looks like "already removed" while the caller's token is stale. A short-circuit above this
 * transaction on that view answered `200` with a pre-mutation ETag, contradicting the rule that
 * replaying a mutation with its pre-mutation token is `412`. Deciding it under the lock puts the
 * version precondition ahead of the decision, so the answer is either a refusal or a truthful no-op
 * that writes nothing and reports `changed: false`.
 */
export async function persistOwnerReminderDueDateRemoval(input: {
  readonly db: DbClient;
  readonly organizationId: string;
  readonly taskId: string;
  readonly stoppedAt: string;
  /**
   * The reminder version the Owner observed, from the reminder ETag. Required — there is no branch
   * in which a removal may proceed without proving which state it was asked to remove.
   */
  readonly expectedReminderVersion: number;
  /** Builds the audit event from authoritative in-transaction state. */
  readonly audit: (outcome: OwnerReminderRemovalOutcome) => CreateAuditEventInput;
}): Promise<OwnerReminderRemovalResult> {
  return runOwnerReminderTransaction(input.db, 'Reminder due-date removal', async (tx) => {
    const scope = await lockTaskScopeForReminderMutation(tx, input.organizationId, input.taskId);

    const priorSchedule = await findReminderScheduleByTaskId(
      tx,
      scope.organizationId,
      scope.taskId,
    );
    const observedVersion = priorSchedule?.reminderVersion ?? NO_SCHEDULE_REMINDER_VERSION;
    if (observedVersion !== input.expectedReminderVersion) {
      throw optimisticConcurrency(
        `Reminder state for task ${scope.taskId} changed since reminder version ` +
          `${input.expectedReminderVersion}; it is now at ${observedVersion}.`,
      );
    }

    const taskRow = await tx.task.findUnique({
      where: { id: scope.taskId },
      select: { dueLocalDate: true },
    });
    const priorDueLocalDate = taskRow?.dueLocalDate ?? null;

    // Nothing to remove, decided here rather than by the caller. The caller cannot read the due date
    // and the schedule in one snapshot, so its pre-lock view can pair a due date already cleared by a
    // winning removal with a schedule version from before that removal — a torn read that looks like
    // "already removed" while the caller's token is stale. Deciding under the lock means the version
    // precondition above has already run, so a stale caller is refused instead of being told its
    // removal succeeded, and a caller whose token is current gets a truthful no-op that writes
    // nothing: no audit event for a removal that did not happen, and no version bump.
    if (priorDueLocalDate === null && !isLiveReminderSchedule(priorSchedule)) {
      return { schedule: priorSchedule, audit: null, changed: false };
    }

    // Schedule before Task, matching the other transactions in this module. Every branch that has a
    // row to write against moves the reminder version, so the removal is protected against a
    // concurrent Owner holding the same token whether or not there was a live schedule to stop.
    let stoppedSchedule: PersistedReminderSchedule | null = null;
    let schedule = priorSchedule;
    if (isLiveReminderSchedule(priorSchedule)) {
      stoppedSchedule = await stopReminderSchedule(tx, {
        organizationId: scope.organizationId,
        scheduleId: priorSchedule.id,
        reason: 'due_date_removed',
        stoppedAt: input.stoppedAt,
        expectedReminderVersion: priorSchedule.reminderVersion,
      });
      schedule = stoppedSchedule;
    } else if (priorSchedule !== null) {
      // Reassigned rather than discarded: the caller projects this into the response ETag, and
      // returning the pre-bump row would hand back a token that is already stale.
      schedule = await bumpReminderVersionForOwnerChange(tx, {
        organizationId: scope.organizationId,
        scheduleId: priorSchedule.id,
        expectedReminderVersion: priorSchedule.reminderVersion,
      });
    }

    await tx.task.update({
      where: { id: scope.taskId },
      data: { dueLocalDate: null },
    });

    const audit = await createAuditEvent(
      tx,
      input.audit({ priorSchedule, priorDueLocalDate, stoppedSchedule }),
    );
    return { schedule, audit, changed: true };
  });
}
