import { formatETag } from '@aicaa/domain';
import type { PersistedReminderSchedule } from '@aicaa/db';

/**
 * The reminder resource's concurrency token (A8.3b audit F5).
 *
 * The original A8.3b implementation asked callers for a *Task* `If-Match`, which the audit showed
 * cannot protect a reminder: a reminder write deliberately does not bump `Task.version`, so two
 * Owners could hold the same valid Task token, each believing their due-date change was current, and
 * the second silently overwrote the first. On real PostgreSQL a change racing a removal produced a
 * committed `reminder.due_date.removed` event alongside a surviving active schedule.
 *
 * So the reminder resource carries its own version, persisted as
 * `task_reminder_schedules.reminder_version` and incremented by every transition that changes what
 * an Owner's decision was based on: opening a generation, reactivating, suspending, resuming,
 * stopping. Because a stop-then-reactivate can return to a generation number it already used, the
 * generation alone is not a sufficient token — the version is what distinguishes "still the schedule
 * you read" from "the schedule you read, stopped and restarted".
 *
 * The version is never a request field and never appears in a response body on its own. It is
 * readable only as the opaque token, so a client cannot construct a token for a state it has not
 * observed.
 */

/**
 * The version reported when no schedule row exists — whether the Task has no due date at all, or
 * carries one with no schedule behind it.
 *
 * Both are pre-establishment states, and the only mutation either permits is establishment, which is
 * guarded by the unique index on `task_id` rather than by a version: two concurrent establishments
 * cannot both create a row no matter what token they present. Version `0` is therefore a stable,
 * honest token for "nothing to overwrite yet", and a schedule's first version is `1`, so the two can
 * never be confused.
 */
export const NO_SCHEDULE_REMINDER_VERSION = 0;

/** Format the strong ETag for a Task's reminder resource. */
export function reminderETag(taskId: string, reminderVersion: number): string {
  return formatETag('task-reminder', taskId, reminderVersion);
}

/** The version a caller must present to mutate the reminder state they just observed. */
export function currentReminderVersion(schedule: PersistedReminderSchedule | null): number {
  return schedule === null ? NO_SCHEDULE_REMINDER_VERSION : schedule.reminderVersion;
}
