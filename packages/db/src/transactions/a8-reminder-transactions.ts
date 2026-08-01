import type { LocalDate, TaskStatus } from '@aicaa/domain';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import {
  mapReminderSchedule,
  toStorableLocalDate,
  type PersistedReminderDeliveryAttempt,
  type PersistedReminderSchedule,
} from '../mappers/reminder-mappers.js';
import { lockTaskScopeForReminderMutation } from '../repositories/reminder-scope-guard.js';
import {
  createReminderSchedule,
  stopReminderSchedule,
  type CreateReminderScheduleInput,
} from '../repositories/reminder-schedule-repository.js';
import { recordSkippedReminderOccurrence } from '../repositories/reminder-delivery-attempt-repository.js';
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
 *
 * ## Universal lock order (A8.3b re-audit M1)
 *
 * Every transaction here that touches both a Task and a schedule now runs in the same order as the
 * Owner and lifecycle transactions: lock the Task row, then read or write the schedule, then write
 * the Task, then audit. Establishment originally wrote schedule-before-Task with no lock while
 * removal wrote Task-before-schedule, and real PostgreSQL deadlocked the pair. Holding the Task lock
 * for the whole transaction is also what lets the removal precondition trust its own re-read: no
 * schedule can become live behind a caller that holds this lock.
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
    // Task row lock first, then schedule, then Task (A8.3b re-audit M1). This transaction used to
    // write the schedule before the Task and take no lock, while `persistDueDateRemoval` wrote the
    // Task first — the exact cycle PostgreSQL reported as `deadlock detected` in the A8.3b audit.
    // The order is now identical across every reminder mutation, so no pair of them can deadlock.
    await lockTaskScopeForReminderMutation(
      tx,
      input.schedule.organizationId,
      input.schedule.taskId,
    );

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

/*
 * `persistSuccessfulOverdueDelivery` and `persistNonDeliveryOutcome` lived here until A8.4a and are
 * deliberately gone rather than deprecated.
 *
 * Both were the shape the A8.3a audit named in F1: they recorded the occurrence outcome and then
 * compare-and-set the schedule *in statements that threw*, so a due-date change committed while a
 * provider call was in flight aborted the transaction and erased the record of a message that had
 * already been sent. Leaving them exported alongside a safe replacement would have left the unsafe
 * one reachable, and F8 asks for exactly the opposite: one public success path.
 *
 * `finalizeReminderOccurrence` in `a8-4a-occurrence-transactions.ts` replaces both. It keeps the
 * occurrence unconditional and makes every schedule write a non-throwing conditional update.
 */

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
    // Lock, then schedule, then Task (A8.3b re-audit M1). The write order is reversed from the
    // original: this transaction wrote the Task first while establishment wrote the schedule first,
    // which is what made the two deadlock against each other on real PostgreSQL.
    const scope = await lockTaskScopeForReminderMutation(tx, input.organizationId, input.taskId);
    const stopped = await stopReminderSchedule(tx, {
      organizationId: scope.organizationId,
      scheduleId: input.scheduleId,
      reason: 'due_date_removed',
      stoppedAt: input.stoppedAt,
    });
    await tx.task.update({
      where: { id: scope.taskId },
      data: { dueLocalDate: null },
    });
    return stopped;
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

/** The two halves of the Owner reminder representation, read from one database snapshot. */
export interface CoherentReminderProjection {
  readonly dueLocalDate: string | null;
  readonly schedule: PersistedReminderSchedule | null;
}

/**
 * Read the Task's canonical due date and its schedule as one consistent snapshot (re-audit H-A).
 *
 * The Owner `GET` used to issue these as two independent statements on two pooled connections. The
 * re-audit raced that against a concurrent removal and reproduced the same impossible response H-1
 * was about: an `active` schedule reported behind a `null` canonical due date, with an ETag already
 * stale on arrival. Nothing was corrupt — each read was individually true, of two different moments.
 *
 * `RepeatableRead` fixes it at the cost of one transaction per read. PostgreSQL takes the snapshot
 * at the first statement and holds it for the second, so the pair describes one instant that
 * actually existed. A read-only snapshot is the right tool rather than a Task row lock: an ordinary
 * `GET` has no business blocking an Owner's write, and it needs consistency, not exclusion.
 *
 * The transaction is marked read-only so the intent is enforced by the database rather than by
 * convention, and so a future edit cannot quietly turn a projection into a write path.
 */
export async function readCoherentReminderProjection(
  db: DbClient,
  organizationId: string,
  taskId: string,
): Promise<CoherentReminderProjection> {
  return db.$transaction(
    async (tx) => {
      const [task, schedule] = [
        await tx.task.findFirst({
          where: { id: taskId, organizationId },
          select: { dueLocalDate: true },
        }),
        await tx.taskReminderSchedule.findFirst({ where: { taskId, organizationId } }),
      ];
      return {
        dueLocalDate: task?.dueLocalDate ?? null,
        schedule: schedule ? mapReminderSchedule(schedule) : null,
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}

/**
 * Everything the worker must re-check immediately before a send, as one snapshot (A8.4a audit).
 *
 * `hasActiveAssignment` rather than the assignment itself: the worker's only question is whether
 * one exists, and returning the row would put a Recipient identity into a structure the aggregate
 * telemetry path also touches.
 */
export interface ReminderPreSendSnapshot {
  readonly taskStatus: TaskStatus;
  readonly hasActiveAssignment: boolean;
  readonly dueLocalDate: string | null;
  readonly schedule: PersistedReminderSchedule | null;
}

/**
 * Read the Task, its assignment, its canonical due date, and its schedule from one snapshot.
 *
 * The pre-send guard used to issue three independent statements on three pooled connections and
 * then reason across their results. Every individual read was true; the conclusion drawn from them
 * was of no single moment, and the A8.4a audit flagged the same shape H-A had already found in the
 * Owner `GET`. The failure it permits is narrow — the guard could see an eligible Task beside a
 * schedule that a concurrent generation change had already superseded, or the reverse — but the
 * decision it feeds is "send an email to a real person", which is the wrong place to be reasoning
 * across two moments.
 *
 * `RepeatableRead` for the same reason and at the same cost as `readCoherentReminderProjection`:
 * PostgreSQL takes the snapshot at the first statement and holds it, so the four reads describe one
 * instant that existed. Read-only by declaration, because a guard that wrote anything would be
 * holding a transaction open at exactly the moment the worker must not be.
 *
 * This closes the *incoherent read*. It does not, and cannot, close the race between the guard and
 * the provider call: an Owner may complete the Task in the microsecond after this returns. Nothing
 * short of holding a lock across the network call would close that, which is forbidden for much
 * better reasons — so the final authority stays where it belongs, on the immutable occurrence row
 * and on conditional settlement, which together mean a send racing a lifecycle change is recorded
 * truthfully and changes nothing about the schedule that moved.
 */
export async function readReminderPreSendSnapshot(
  db: DbClient,
  organizationId: string,
  taskId: string,
): Promise<ReminderPreSendSnapshot | null> {
  return db.$transaction(
    async (tx) => {
      const task = await tx.task.findFirst({
        where: { id: taskId, organizationId },
        select: { status: true, dueLocalDate: true },
      });
      if (!task) {
        return null;
      }
      // "Active" is `cleared_at IS NULL`, the same predicate `getTaskById` uses. Cleared rows are
      // immutable history and a returned assignment must not keep a reminder addressable.
      const activeAssignment = await tx.taskAssignment.findFirst({
        where: { taskId, organizationId, clearedAt: null },
        select: { id: true },
      });
      const schedule = await tx.taskReminderSchedule.findFirst({
        where: { taskId, organizationId },
      });
      return {
        taskStatus: task.status,
        hasActiveAssignment: activeAssignment !== null,
        dueLocalDate: task.dueLocalDate ?? null,
        schedule: schedule ? mapReminderSchedule(schedule) : null,
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
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
  // Takes the Task lock even though it writes only the Task, so that a caller composing it with a
  // schedule write cannot accidentally invert the universal order (A8.3b re-audit M1). Re-locking a
  // row this transaction already holds is a no-op.
  const scope = await lockTaskScopeForReminderMutation(
    input.db,
    input.organizationId,
    input.taskId,
  );
  const dueLocalDate = toStorableLocalDate(input.dueLocalDate, 'dueLocalDate');
  await input.db.task.update({
    where: { id: scope.taskId },
    data: { dueLocalDate },
  });
}
