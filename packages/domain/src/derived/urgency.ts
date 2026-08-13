/**
 * Read-time due/overdue display labels (D177, D109).
 *
 * Derived from the canonical organization-local calendar date (`dueLocalDate` /
 * `due_local_date`), never from vestigial instant-typed `dueAt`. Not a scheduling
 * mechanism: reminder occurrences are computed from the due date by schedule-policy
 * (D103). Labels are not persisted.
 *
 * Comparison is local-calendar arithmetic in an explicit IANA zone, not a 24-hour
 * millisecond window. A date-only due date has no due time, and D103 prohibits
 * restating local days as fixed durations.
 *
 * - no due date, or `waiting` / `completed` / `dismissed` → no urgency
 * - due local date before today in the organization timezone → `overdue`
 * - due today or tomorrow → `due_soon`
 * - due later → none
 *
 * Assignment, D168 responsibility evidence, and `dueAt` are not inputs. An
 * evidence-free or unassigned Task may still be due or overdue; due state is not
 * Owner-responsibility (D155, D164, D168, D177).
 */

import type { TaskStatus } from '../entities/task.js';
import { REMINDER_SCHEDULING_TIME_ZONE } from '../reminders/constants.js';
import { addLocalDays, compareLocalDates, type LocalDate } from '../reminders/local-date.js';
import { localDateOfInstant } from '../reminders/occurrence.js';
import type { UtcInstant } from '../types/timestamps.js';

export type DerivedTaskUrgency = 'due_soon' | 'overdue';

/** Inclusive calendar-day look-ahead for `due_soon` (today and tomorrow). */
export const DEFAULT_DUE_SOON_CALENDAR_DAYS = 1;

export function deriveTaskUrgency(
  status: TaskStatus,
  dueLocalDate: LocalDate | null | undefined,
  now: UtcInstant,
  timeZone: string = REMINDER_SCHEDULING_TIME_ZONE,
): DerivedTaskUrgency | null {
  if (status === 'completed' || status === 'dismissed' || status === 'waiting') {
    return null;
  }
  if (!dueLocalDate) {
    return null;
  }
  const today = localDateOfInstant(now, timeZone);
  if (compareLocalDates(dueLocalDate, today) < 0) {
    return 'overdue';
  }
  const dueSoonUntil = addLocalDays(today, DEFAULT_DUE_SOON_CALENDAR_DAYS);
  if (compareLocalDates(dueLocalDate, dueSoonUntil) <= 0) {
    return 'due_soon';
  }
  return null;
}
