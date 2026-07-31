/**
 * Organization-local calendar dates (A8.2, D103).
 *
 * A due date is a calendar date, not an instant. "2026-03-08" names a day on the
 * organization's wall calendar; it does not name a moment, and it does not become one until a
 * timezone and a wall-clock hour are applied (see `occurrence.ts`).
 *
 * Everything here is calendar arithmetic. No duration is ever added: D103 prohibits computing
 * occurrences by adding fixed 24-hour offsets, because 09:00 local must survive daylight-saving
 * transitions, and a day is not always 24 hours long in a transitioning zone. `Date.UTC` appears
 * below only as a Gregorian **field normalizer** — it consults no timezone database and no
 * machine-local state.
 */

import { validationError } from '../errors/domain-errors.js';

/**
 * A canonical `YYYY-MM-DD` organization-local calendar date.
 *
 * Branded so a raw string cannot reach scheduling logic without passing validation. Every value
 * of this type is zero-padded and names a real Gregorian date, which is what makes
 * lexicographic comparison in `compareLocalDates` correct.
 */
export type LocalDate = string & { readonly __brand: 'LocalDate' };

export interface LocalDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * Supported year bounds.
 *
 * The lower bound is not cosmetic. `Date.UTC` maps years 0–99 to 1900–1999, so a two-digit year
 * would normalize to a different century and produce a silently wrong date. Requiring four
 * significant digits makes that legacy behaviour unreachable rather than merely unlikely.
 */
export const MIN_LOCAL_DATE_YEAR = 1000;
export const MAX_LOCAL_DATE_YEAR = 9999;

/**
 * Canonical form only: exactly four digits, two digits, two digits, separated by hyphens.
 *
 * Noncanonical input is rejected rather than repaired. Accepting "2026-2-3" would mean two
 * different strings denote the same date, which breaks brand-level string equality — and
 * equality is how a same-date save is recognised as immaterial (D104).
 */
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const DAYS_IN_MONTH_COMMON_YEAR = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return DAYS_IN_MONTH_COMMON_YEAR[month - 1];
}

/** Why `value` is not a canonical local date, or `null` when it is one. */
function localDateRejection(value: unknown): string | null {
  if (typeof value !== 'string') {
    return 'Local date must be a string.';
  }

  const match = LOCAL_DATE_PATTERN.exec(value);
  if (match === null) {
    return `Local date must be canonical YYYY-MM-DD (received "${value}").`;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < MIN_LOCAL_DATE_YEAR || year > MAX_LOCAL_DATE_YEAR) {
    return `Local date year must be between ${MIN_LOCAL_DATE_YEAR} and ${MAX_LOCAL_DATE_YEAR} (received "${value}").`;
  }
  if (month < 1 || month > 12) {
    return `Local date month must be between 01 and 12 (received "${value}").`;
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return `Local date day ${match[3]} does not exist in ${match[1]}-${match[2]} (received "${value}").`;
  }

  return null;
}

/** Whether `value` is a canonical `YYYY-MM-DD` string naming a real Gregorian date. */
export function isLocalDate(value: unknown): value is LocalDate {
  return localDateRejection(value) === null;
}

/** Parse a canonical `YYYY-MM-DD` local date, or throw a validation error. */
export function parseLocalDate(value: string): LocalDate {
  const rejection = localDateRejection(value);
  if (rejection !== null) {
    throw validationError(rejection, [{ field: 'localDate', message: rejection }]);
  }
  return value as LocalDate;
}

/** Build a local date from calendar fields, validating the result. */
export function localDateFromParts(year: number, month: number, day: number): LocalDate {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw validationError(`Local date parts must be integers (received ${year}-${month}-${day}).`, [
      { field: 'localDate', message: 'Local date parts must be integers.' },
    ]);
  }
  const formatted = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return parseLocalDate(formatted);
}

/** Split a local date into its calendar fields. */
export function localDateParts(date: LocalDate): LocalDateParts {
  const value = parseLocalDate(date);
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
  };
}

/**
 * Move a local date by whole calendar days.
 *
 * `Date.UTC` normalizes an out-of-range day-of-month against the Gregorian calendar
 * (2026-01-32 becomes 2026-02-01), including leap years and century rules. That is calendar
 * field arithmetic, not duration arithmetic: no millisecond quantity is added here, so the
 * result is unaffected by daylight saving in any zone. UTC is used precisely because it has no
 * transitions and cannot consult machine-local state.
 */
export function addLocalDays(date: LocalDate, days: number): LocalDate {
  if (!Number.isSafeInteger(days)) {
    throw validationError(`Calendar day offset must be a whole number (received ${days}).`, [
      { field: 'days', message: 'Calendar day offset must be a whole number.' },
    ]);
  }

  const { year, month, day } = localDateParts(date);
  const normalized = new Date(Date.UTC(year, month - 1, day + days));
  if (Number.isNaN(normalized.getTime())) {
    throw validationError(
      `Calendar day offset ${days} moves "${date}" outside the supported range.`,
    );
  }

  return localDateFromParts(
    normalized.getUTCFullYear(),
    normalized.getUTCMonth() + 1,
    normalized.getUTCDate(),
  );
}

/**
 * Chronological ordering: negative when `a` is earlier, zero when equal, positive when later.
 *
 * String comparison is correct here — and only here — because every `LocalDate` is
 * fixed-width and zero-padded, so lexicographic order is calendar order.
 */
export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  const left = parseLocalDate(a);
  const right = parseLocalDate(b);
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}
