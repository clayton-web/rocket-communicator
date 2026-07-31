import { formatETag } from '@aicaa/domain';
import { NO_SCHEDULE_REMINDER_VERSION, type PersistedReminderSchedule } from '@aicaa/db';

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
 *
 * ## What the token covers: configuration and lifecycle, not delivery progress (A8.3b re-audit L1)
 *
 * `reminder_version` tracks **Owner-controlled reminder configuration and lifecycle state**. It is a
 * mutation precondition, and deliberately not a validator for the whole GET representation.
 *
 * The re-audit observed the gap: `nextOverdueOccurrence` and `overdueDeliveredCount` appear in the
 * representation but do not bump the version, so a client holding a current ETag could be reading a
 * stale value for either. The decision is to keep it that way and make the contract say so, rather
 * than to widen the version.
 *
 * Widening it is the option that looks safer and is not. Those two fields are the ones a future A8.4
 * worker owns: it advances the occurrence and counts deliveries on its own schedule, with no Owner
 * involved. If either bumped the version, every delivery would invalidate every outstanding Owner
 * ETag, so an Owner editing a due date would race the worker and lose — a `412` caused by nothing the
 * Owner did and nothing they can see, on a resource whose configuration had not changed at all. The
 * cost would be real and recurring; the benefit would be cache validation the API does not offer,
 * because every reminder response is already `no-store` and there is no cache to validate.
 *
 * So the division is by ownership: the version moves when the Owner's own decisions move — a
 * generation opening, a reactivation, a suspension, a resume, a stop — and stays put while the worker
 * records progress against a configuration nobody changed. `API_CONTRACT.md` states this scope, and it
 * is why worker occurrence and count updates must never increment the version.
 */

export { NO_SCHEDULE_REMINDER_VERSION };

/** Format the strong ETag for a Task's reminder resource. */
export function reminderETag(taskId: string, reminderVersion: number): string {
  return formatETag('task-reminder', taskId, reminderVersion);
}

/** The version a caller must present to mutate the reminder state they just observed. */
export function currentReminderVersion(schedule: PersistedReminderSchedule | null): number {
  return schedule === null ? NO_SCHEDULE_REMINDER_VERSION : schedule.reminderVersion;
}
