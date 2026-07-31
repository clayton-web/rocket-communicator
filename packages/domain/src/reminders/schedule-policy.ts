/**
 * Due-date reminder scheduling policy (A8.2, D102–D106).
 *
 * Pure decisions, nothing else. Every function takes the current instant as an argument and
 * returns what should happen; none reads a clock, a database, a request, an environment
 * variable, or a machine timezone, and none performs I/O. Persistence, generations, claiming,
 * delivery, and the audit trail belong to later A8 slices — this module only says *when* an
 * occurrence falls and *whether* one is owed.
 *
 * The rules implemented here are product law from WORKFLOWS.md §10a:
 *
 * - no due date, no schedule;
 * - exactly one advance reminder, 09:00 local on the day before the due date;
 * - overdue reminders at 09:00 local on days strictly after the due date;
 * - never a backlog — only the next future occurrence is ever selected;
 * - a different due date is material and opens a new generation; the same date is not;
 * - overdue delivery stops at 14 successful overdue deliveries in a generation.
 */

import { DomainError } from '../errors/domain-errors.js';
import { parseUtcInstant, type UtcInstant } from '../types/timestamps.js';
import {
  OVERDUE_SUCCESSFUL_DELIVERY_CEILING,
  REMINDER_LOCAL_HOUR,
  REMINDER_LOCAL_MINUTE,
  REMINDER_SCHEDULING_TIME_ZONE,
} from './constants.js';
import { addLocalDays, compareLocalDates, type LocalDate } from './local-date.js';
import { localDateOfInstant, resolveLocalWallClock } from './occurrence.js';

/**
 * Zone and hour are overridable only so the transition behaviour of the resolver can be
 * exercised at hours that actually transition — Vancouver's 09:00 does not. Production callers
 * omit them and get the documented constants (D103).
 */
interface OccurrenceClockOptions {
  readonly timeZone?: string;
  readonly localHour?: number;
}

export interface ReminderOccurrence {
  readonly occurrenceLocalDate: LocalDate;
  readonly occurrenceAt: UtcInstant;
}

/**
 * The advance-reminder decision, made **once** at schedule establishment and then persisted
 * (D105). A later scheduler run must never reclassify it, which is why it is derived purely
 * from the establishment inputs passed here.
 */
export type AdvanceReminderDisposition =
  | ({ readonly kind: 'scheduled' } & ReminderOccurrence)
  | ({
      readonly kind: 'skipped';
      readonly reason: 'advance_window_elapsed';
    } & ReminderOccurrence);

export interface AdvanceReminderEstablishmentInput extends OccurrenceClockOptions {
  readonly dueLocalDate: LocalDate;
  /** The instant the Owner established this schedule generation. */
  readonly establishedAt: UtcInstant;
}

export interface NextOverdueOccurrenceInput extends OccurrenceClockOptions {
  readonly dueLocalDate: LocalDate;
  /** The instant the selection is made at. */
  readonly now: UtcInstant;
}

/** An overdue reminder occurrence and how its delivery attempt ended. */
export interface ReminderOccurrenceOutcome {
  readonly occurrence: 'advance' | 'overdue';
  readonly outcome:
    'success' | 'retryable_failure' | 'permanent_failure' | 'ambiguous' | 'skipped' | 'claimed';
}

function occurrenceAt(
  localDate: LocalDate,
  options: OccurrenceClockOptions,
): { readonly occurrence: ReminderOccurrence; readonly epochMs: number } {
  const resolution = resolveLocalWallClock({
    localDate,
    hour: options.localHour ?? REMINDER_LOCAL_HOUR,
    minute: REMINDER_LOCAL_MINUTE,
    timeZone: options.timeZone ?? REMINDER_SCHEDULING_TIME_ZONE,
  });
  return {
    occurrence: { occurrenceLocalDate: localDate, occurrenceAt: resolution.instant },
    epochMs: resolution.epochMs,
  };
}

/** A Task without a due date has no reminder schedule at all (D102). */
export function hasReminderSchedule(dueLocalDate: LocalDate | null): boolean {
  return dueLocalDate !== null;
}

/**
 * Decide the single advance reminder for a schedule generation (D105).
 *
 * Scheduled when 09:00 local on the day before the due date is still ahead of the establishment
 * instant — including a schedule established at 07:00 that same morning, which may still send.
 * Otherwise the occurrence is recorded as skipped with reason `advance_window_elapsed`: no
 * advance reminder is ever sent immediately or retroactively, and a Task created on or after its
 * due date gets none.
 */
export function decideAdvanceReminder(
  input: AdvanceReminderEstablishmentInput,
): AdvanceReminderDisposition {
  const { occurrence, epochMs } = occurrenceAt(addLocalDays(input.dueLocalDate, -1), input);
  const establishedAtMs = parseUtcInstant(input.establishedAt).getTime();

  if (epochMs > establishedAtMs) {
    return { kind: 'scheduled', ...occurrence };
  }
  return { kind: 'skipped', reason: 'advance_window_elapsed', ...occurrence };
}

/**
 * Select the next overdue occurrence — always exactly one, always in the future (D106).
 *
 * Elapsed calendar days are skipped rather than accumulated: a due date years in the past
 * produces tomorrow morning, not a backlog of missed mornings. The candidate starts at the day
 * after the due date, jumps forward to today when the due date is already past, and moves to the
 * next local day when today's 09:00 has already elapsed.
 */
export function selectNextOverdueOccurrence(input: NextOverdueOccurrenceInput): ReminderOccurrence {
  const timeZone = input.timeZone ?? REMINDER_SCHEDULING_TIME_ZONE;
  const nowMs = parseUtcInstant(input.now).getTime();

  const firstOverdueLocalDate = addLocalDays(input.dueLocalDate, 1);
  const todayLocalDate = localDateOfInstant(input.now, timeZone);
  const startLocalDate =
    compareLocalDates(firstOverdueLocalDate, todayLocalDate) >= 0
      ? firstOverdueLocalDate
      : todayLocalDate;

  const options: OccurrenceClockOptions = { timeZone, localHour: input.localHour };
  const candidate = occurrenceAt(startLocalDate, options);
  if (candidate.epochMs > nowMs) {
    return candidate.occurrence;
  }

  // Today's occurrence has elapsed. Exactly one more day is needed: any later local day is
  // wholly in the future, so a second miss would mean the zone resolver is wrong.
  const following = occurrenceAt(addLocalDays(startLocalDate, 1), options);
  if (following.epochMs <= nowMs) {
    throw new DomainError(
      'INTERNAL_ERROR',
      `Next overdue occurrence after "${startLocalDate}" did not resolve to a future instant.`,
    );
  }
  return following.occurrence;
}

/**
 * Whether saving a due date opens a new schedule generation (D104).
 *
 * Only a *different* local calendar date is material. Re-saving the same date must not reset the
 * delivery count, because that would let repeated saves defeat the ceiling. Setting or removing
 * a due date is material: one starts a schedule, the other stops it.
 */
export function isDueDateChangeMaterial(
  previousDueLocalDate: LocalDate | null,
  nextDueLocalDate: LocalDate | null,
): boolean {
  if (previousDueLocalDate === null || nextDueLocalDate === null) {
    return previousDueLocalDate !== nextDueLocalDate;
  }
  return compareLocalDates(previousDueLocalDate, nextDueLocalDate) !== 0;
}

/**
 * Count deliveries that consume the ceiling: successful **overdue** deliveries only (D106).
 *
 * A failed, ambiguous, skipped, or merely claimed occurrence reached nobody, and the advance
 * reminder is a different occurrence kind. Counting any of them would silence follow-up early —
 * the Recipient would stop hearing from the system while the Task is still open.
 */
export function countSuccessfulOverdueDeliveries(
  outcomes: readonly ReminderOccurrenceOutcome[],
): number {
  return outcomes.filter((entry) => entry.occurrence === 'overdue' && entry.outcome === 'success')
    .length;
}

/** Whether this generation has reached the 14 successful overdue deliveries ceiling (D106). */
export function hasReachedOverdueDeliveryCeiling(
  outcomes: readonly ReminderOccurrenceOutcome[],
): boolean {
  return countSuccessfulOverdueDeliveries(outcomes) >= OVERDUE_SUCCESSFUL_DELIVERY_CEILING;
}
