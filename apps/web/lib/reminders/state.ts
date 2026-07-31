import type { components } from '@aicaa/contracts/schema';
import type { PersistedReminderSchedule } from '@aicaa/db';

export type TaskReminderState = components['schemas']['TaskReminderState'];
type TaskReminderOccurrence = components['schemas']['TaskReminderOccurrence'];
type TaskReminderAdvance = components['schemas']['TaskReminderAdvance'];
type TaskReminderScheduleState = components['schemas']['TaskReminderScheduleState'];

/**
 * Project a persisted Reminder Schedule onto the Owner-facing contract.
 *
 * This is a projection, not a computation: every value below is read from the row the domain wrote
 * at establishment. Nothing here re-derives an occurrence, re-decides an advance disposition, or
 * re-counts a delivery — that law lives in packages/domain (D103, D127), and recomputing it at read
 * time is how a UI and a worker come to disagree about the same schedule.
 *
 * The fields deliberately dropped are as important as the ones kept. `claimedBy`, `claimedAt`, and
 * `claimExpiresAt` are worker-coordination internals, and `id` is a database row identifier; none of
 * them mean anything to an Owner, and publishing them would make future lease changes a breaking
 * contract change.
 */
function occurrence(localDate: string | null, at: string | null): TaskReminderOccurrence | null {
  if (localDate === null || at === null) {
    return null;
  }
  return { localDate, at };
}

function advance(schedule: PersistedReminderSchedule): TaskReminderAdvance {
  return {
    disposition: schedule.advanceDisposition,
    occurrence: occurrence(schedule.advanceOccurrenceLocalDate, schedule.advanceOccurrenceAt),
  };
}

function scheduleState(schedule: PersistedReminderSchedule): TaskReminderScheduleState {
  return schedule.status;
}

/** State for a Task whose Owner has not chosen a due date, so no schedule exists (D102). */
export function noDueDateState(taskId: string): TaskReminderState {
  return {
    taskId,
    dueLocalDate: null,
    schedulingTimeZone: null,
    state: 'no_due_date',
    generation: null,
    advance: null,
    nextOverdueOccurrence: null,
    overdueDeliveredCount: null,
    requiresOwnerAttention: false,
    stopReason: null,
  };
}

/**
 * State for a Task carrying a canonical due date with no schedule behind it.
 *
 * No A8.3b path produces this, because establishing the due date and the schedule is one
 * transaction. It is representable anyway so the read route can never lie about a row it does not
 * understand — silently reporting `no_due_date` for a Task that has one would send an Owner looking
 * for a due date they had already set.
 */
export function unscheduledDueDateState(taskId: string, dueLocalDate: string): TaskReminderState {
  return {
    ...noDueDateState(taskId),
    dueLocalDate,
    state: 'not_scheduled',
  };
}

/**
 * Project a schedule plus the Task's canonical due date.
 *
 * `dueLocalDate` is read from the Task, not from the schedule row, and the two legitimately differ:
 * a schedule stopped by due-date removal keeps its generation's snapshot of the date it was
 * scheduling against, while the Task no longer has a due date at all. Reporting the snapshot would
 * tell an Owner they still have a due date they had just removed.
 */
export function toTaskReminderState(
  schedule: PersistedReminderSchedule,
  canonicalDueLocalDate: string | null,
): TaskReminderState {
  return {
    taskId: schedule.taskId,
    dueLocalDate: canonicalDueLocalDate,
    schedulingTimeZone: schedule.schedulingTimeZone,
    state: scheduleState(schedule),
    generation: schedule.generation,
    advance: advance(schedule),
    nextOverdueOccurrence: occurrence(
      schedule.nextOverdueOccurrenceLocalDate,
      schedule.nextOverdueOccurrenceAt,
    ),
    overdueDeliveredCount: schedule.overdueDeliveredCount,
    requiresOwnerAttention: schedule.requiresOwnerAttention,
    stopReason: schedule.stopReason,
  };
}
