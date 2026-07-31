import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  compareLocalDates,
  DomainError,
  isLocalDate,
  localDateFromParts,
  localDateOfInstant,
  localDateParts,
  MAX_LOCAL_DATE_YEAR,
  MIN_LOCAL_DATE_YEAR,
  OVERDUE_SUCCESSFUL_DELIVERY_CEILING,
  parseLocalDate,
  REMINDER_LOCAL_HOUR,
  REMINDER_LOCAL_MINUTE,
  REMINDER_SCHEDULING_TIME_ZONE,
  resolveLocalWallClock,
  type LocalDate,
} from '../src/index.js';

/**
 * A8.2 local-calendar and timezone evidence (D103).
 *
 * Expected instants are written as literals rather than computed, because computing them with
 * the same helpers under test would assert only that the code agrees with itself. Each literal
 * below was confirmed independently by formatting it back through `Intl` in the target zone —
 * for example `2026-03-08T16:00:00.000Z` renders as "2026-03-08, 09:00 PDT" in Vancouver.
 *
 * The 2026 North American transitions used throughout: spring forward **8 March 2026** (02:00
 * local becomes 03:00) and fall back **1 November 2026** (02:00 local becomes 01:00).
 */

const VANCOUVER = 'America/Vancouver';
const LONDON = 'Europe/London';
const TOKYO = 'Asia/Tokyo';

function localDate(value: string): LocalDate {
  return parseLocalDate(value);
}

function captureDomainError(run: () => unknown): DomainError {
  try {
    run();
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('Expected a DomainError to be thrown.');
}

function nineAmVancouver(value: string) {
  return resolveLocalWallClock({
    localDate: localDate(value),
    hour: REMINDER_LOCAL_HOUR,
    minute: REMINDER_LOCAL_MINUTE,
    timeZone: VANCOUVER,
  });
}

describe('local date parsing (A8.2)', () => {
  it('accepts canonical dates and returns the same string', () => {
    expect(parseLocalDate('2026-07-31')).toBe('2026-07-31');
    expect(parseLocalDate('2024-02-29')).toBe('2024-02-29');
    expect(parseLocalDate('2000-02-29')).toBe('2000-02-29');
    expect(isLocalDate('1000-01-01')).toBe(true);
    expect(isLocalDate('9999-12-31')).toBe(true);
  });

  it('rejects dates that do not exist', () => {
    for (const value of [
      '2026-02-30',
      '2026-02-29',
      '2100-02-29',
      '1900-02-29',
      '2026-04-31',
      '2026-06-31',
      '2026-09-31',
      '2026-11-31',
      '2026-01-32',
    ]) {
      expect(isLocalDate(value), value).toBe(false);
      expect(() => parseLocalDate(value), value).toThrow(DomainError);
    }
  });

  it('rejects out-of-range month and day values', () => {
    for (const value of ['2026-00-10', '2026-13-01', '2026-99-01', '2026-01-00']) {
      expect(isLocalDate(value), value).toBe(false);
    }
  });

  it('rejects malformed and noncanonical strings', () => {
    for (const value of [
      '',
      ' ',
      '2026-7-31',
      '2026-07-3',
      '26-07-31',
      '20260731',
      '2026/07/31',
      '2026-07-31 ',
      ' 2026-07-31',
      '2026-07-31T00:00:00Z',
      '2026-07-31T09:00:00-07:00',
      '+2026-07-31',
      '2026-07-311',
      'not-a-date',
    ]) {
      expect(isLocalDate(value), JSON.stringify(value)).toBe(false);
      expect(() => parseLocalDate(value), JSON.stringify(value)).toThrow(DomainError);
    }
  });

  it('rejects years outside the supported four-digit range', () => {
    // Years 0-99 are the dangerous case: `Date.UTC` would map them into the 1900s.
    expect(isLocalDate('0099-01-01')).toBe(false);
    expect(isLocalDate('0999-12-31')).toBe(false);
    expect(MIN_LOCAL_DATE_YEAR).toBe(1000);
    expect(MAX_LOCAL_DATE_YEAR).toBe(9999);
  });

  it('rejects non-string input', () => {
    for (const value of [null, undefined, 20260731, new Date(0), {}]) {
      expect(isLocalDate(value)).toBe(false);
    }
  });

  it('splits and rebuilds calendar fields', () => {
    expect(localDateParts(localDate('2026-03-08'))).toEqual({ year: 2026, month: 3, day: 8 });
    expect(localDateFromParts(2026, 3, 8)).toBe('2026-03-08');
    expect(() => localDateFromParts(2026, 2, 30)).toThrow(DomainError);
    expect(() => localDateFromParts(2026, 13, 1)).toThrow(DomainError);
    expect(() => localDateFromParts(2026.5, 1, 1)).toThrow(DomainError);
  });
});

describe('local calendar arithmetic (A8.2, D103)', () => {
  it('handles leap years in both directions', () => {
    expect(addLocalDays(localDate('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addLocalDays(localDate('2024-02-29'), 1)).toBe('2024-03-01');
    expect(addLocalDays(localDate('2024-03-01'), -1)).toBe('2024-02-29');
    expect(addLocalDays(localDate('2024-01-01'), 366)).toBe('2025-01-01');
    // Century rule: 1900 and 2100 are not leap years, 2000 is.
    expect(addLocalDays(localDate('2100-02-28'), 1)).toBe('2100-03-01');
    expect(addLocalDays(localDate('2000-02-28'), 1)).toBe('2000-02-29');
  });

  it('handles February boundaries in a common year', () => {
    expect(addLocalDays(localDate('2026-02-28'), 1)).toBe('2026-03-01');
    expect(addLocalDays(localDate('2026-03-01'), -1)).toBe('2026-02-28');
    expect(addLocalDays(localDate('2026-01-31'), 1)).toBe('2026-02-01');
  });

  it('handles month, quarter, and year boundaries', () => {
    expect(addLocalDays(localDate('2026-03-31'), 1)).toBe('2026-04-01');
    expect(addLocalDays(localDate('2026-06-30'), 1)).toBe('2026-07-01');
    expect(addLocalDays(localDate('2026-09-30'), 1)).toBe('2026-10-01');
    expect(addLocalDays(localDate('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addLocalDays(localDate('2027-01-01'), -1)).toBe('2026-12-31');
    expect(addLocalDays(localDate('2026-01-01'), -1)).toBe('2025-12-31');
    expect(addLocalDays(localDate('2026-01-01'), 365)).toBe('2027-01-01');
  });

  it('is unaffected by daylight-saving transition days', () => {
    // The local day before a spring-forward day is 23 hours long, but it is still one day.
    expect(addLocalDays(localDate('2026-03-07'), 1)).toBe('2026-03-08');
    expect(addLocalDays(localDate('2026-10-31'), 1)).toBe('2026-11-01');
  });

  it('returns the same date for a zero offset and rejects fractional offsets', () => {
    expect(addLocalDays(localDate('2026-07-31'), 0)).toBe('2026-07-31');
    expect(() => addLocalDays(localDate('2026-07-31'), 1.5)).toThrow(DomainError);
    expect(() => addLocalDays(localDate('2026-07-31'), Number.NaN)).toThrow(DomainError);
  });

  it('orders dates chronologically', () => {
    expect(compareLocalDates(localDate('2026-07-30'), localDate('2026-07-31'))).toBeLessThan(0);
    expect(compareLocalDates(localDate('2026-08-01'), localDate('2026-07-31'))).toBeGreaterThan(0);
    expect(compareLocalDates(localDate('2026-07-31'), localDate('2026-07-31'))).toBe(0);
    expect(compareLocalDates(localDate('2026-12-31'), localDate('2027-01-01'))).toBeLessThan(0);
  });
});

describe('09:00 America/Vancouver resolution across 2026 transitions (D103)', () => {
  it('resolves the spring transition day and its neighbours', () => {
    expect(nineAmVancouver('2026-03-07').instant).toBe('2026-03-07T17:00:00.000Z');
    expect(nineAmVancouver('2026-03-08').instant).toBe('2026-03-08T16:00:00.000Z');
    expect(nineAmVancouver('2026-03-09').instant).toBe('2026-03-09T16:00:00.000Z');
  });

  it('resolves the fall transition day and its neighbours', () => {
    expect(nineAmVancouver('2026-10-31').instant).toBe('2026-10-31T16:00:00.000Z');
    expect(nineAmVancouver('2026-11-01').instant).toBe('2026-11-01T17:00:00.000Z');
    expect(nineAmVancouver('2026-11-02').instant).toBe('2026-11-02T17:00:00.000Z');
  });

  it('treats 09:00 as an ordinary wall time on transition days', () => {
    for (const date of ['2026-03-07', '2026-03-08', '2026-03-09', '2026-11-01']) {
      const resolution = nineAmVancouver(date);
      expect(resolution.kind, date).toBe('exact');
      expect(resolution.resolvedLocalDate, date).toBe(date);
      expect(resolution.resolvedHour, date).toBe(9);
      expect(resolution.resolvedMinute, date).toBe(0);
    }
  });

  it('keeps 09:00 local by shortening and lengthening the interval, not by adding a fixed day', () => {
    const hour = 60 * 60 * 1000;
    const springGapMs =
      nineAmVancouver('2026-03-08').epochMs - nineAmVancouver('2026-03-07').epochMs;
    const fallGapMs = nineAmVancouver('2026-11-01').epochMs - nineAmVancouver('2026-10-31').epochMs;
    const ordinaryGapMs =
      nineAmVancouver('2026-07-31').epochMs - nineAmVancouver('2026-07-30').epochMs;

    expect(springGapMs).toBe(23 * hour);
    expect(fallGapMs).toBe(25 * hour);
    expect(ordinaryGapMs).toBe(24 * hour);
  });
});

describe('transitioning target hours (D103)', () => {
  it('returns the first valid instant at or after a skipped wall time', () => {
    // 02:00-02:59 does not exist in Vancouver on 2026-03-08; the clock jumps to 03:00 PDT.
    const resolution = resolveLocalWallClock({
      localDate: localDate('2026-03-08'),
      hour: 2,
      timeZone: VANCOUVER,
    });

    expect(resolution.kind).toBe('skipped_forward');
    expect(resolution.instant).toBe('2026-03-08T10:00:00.000Z');
    expect(resolution.resolvedHour).toBe(3);
    expect(resolution.resolvedMinute).toBe(0);
    expect(resolution.resolvedLocalDate).toBe('2026-03-08');
    expect(resolution.requestedHour).toBe(2);
  });

  it('returns the first valid instant for a skipped wall time in a second zone', () => {
    // London moves 01:00 GMT to 02:00 BST on 2026-03-29.
    const resolution = resolveLocalWallClock({
      localDate: localDate('2026-03-29'),
      hour: 1,
      timeZone: LONDON,
    });

    expect(resolution.kind).toBe('skipped_forward');
    expect(resolution.instant).toBe('2026-03-29T01:00:00.000Z');
    expect(resolution.resolvedHour).toBe(2);
  });

  it('selects the earlier instant when a wall time is repeated', () => {
    // 01:00 happens twice in Vancouver on 2026-11-01: 08:00Z (PDT) and 09:00Z (PST).
    const resolution = resolveLocalWallClock({
      localDate: localDate('2026-11-01'),
      hour: 1,
      timeZone: VANCOUVER,
    });

    expect(resolution.kind).toBe('repeated_earliest');
    expect(resolution.instant).toBe('2026-11-01T08:00:00.000Z');
    expect(resolution.resolvedHour).toBe(1);
    expect(resolution.resolvedLocalDate).toBe('2026-11-01');
  });

  it('selects the earlier instant for a repeated wall time in a second zone', () => {
    // London repeats 01:00 on 2026-10-25: 00:00Z (BST) and 01:00Z (GMT).
    const resolution = resolveLocalWallClock({
      localDate: localDate('2026-10-25'),
      hour: 1,
      timeZone: LONDON,
    });

    expect(resolution.kind).toBe('repeated_earliest');
    expect(resolution.instant).toBe('2026-10-25T00:00:00.000Z');
  });

  it('resolves a non-transitioning zone at the same hour', () => {
    const resolution = resolveLocalWallClock({
      localDate: localDate('2026-01-01'),
      hour: 9,
      timeZone: TOKYO,
    });

    expect(resolution.kind).toBe('exact');
    expect(resolution.instant).toBe('2026-01-01T00:00:00.000Z');
  });

  it('resolves minutes inside a repeated hour to the earlier instant', () => {
    const resolution = resolveLocalWallClock({
      localDate: localDate('2026-11-01'),
      hour: 1,
      minute: 30,
      timeZone: VANCOUVER,
    });

    expect(resolution.kind).toBe('repeated_earliest');
    expect(resolution.instant).toBe('2026-11-01T08:30:00.000Z');
  });
});

describe('resolver input validation (D103)', () => {
  it('rejects an unsupported timezone rather than falling back to a default', () => {
    const error = captureDomainError(() =>
      resolveLocalWallClock({
        localDate: localDate('2026-07-31'),
        hour: 9,
        timeZone: 'Mars/Olympus_Mons',
      }),
    );

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects out-of-range wall-clock fields', () => {
    for (const hour of [-1, 24, 9.5, Number.NaN]) {
      expect(() =>
        resolveLocalWallClock({ localDate: localDate('2026-07-31'), hour, timeZone: VANCOUVER }),
      ).toThrow(DomainError);
    }
    expect(() =>
      resolveLocalWallClock({
        localDate: localDate('2026-07-31'),
        hour: 9,
        minute: 60,
        timeZone: VANCOUVER,
      }),
    ).toThrow(DomainError);
  });
});

describe('local calendar date of an instant (D103)', () => {
  it('uses the requested zone, not the machine zone', () => {
    expect(localDateOfInstant('2026-01-01T07:59:00.000Z', VANCOUVER)).toBe('2025-12-31');
    expect(localDateOfInstant('2026-01-01T08:00:00.000Z', VANCOUVER)).toBe('2026-01-01');
    expect(localDateOfInstant('2026-01-01T07:59:00.000Z', TOKYO)).toBe('2026-01-01');
    expect(localDateOfInstant('2026-03-08T16:00:00.000Z', VANCOUVER)).toBe('2026-03-08');
  });

  it('round-trips a resolved occurrence back to its local date', () => {
    for (const date of ['2026-03-08', '2026-11-01', '2026-07-31', '2026-12-31']) {
      expect(localDateOfInstant(nineAmVancouver(date).instant, VANCOUVER), date).toBe(date);
    }
  });
});

describe('reminder scheduling constants (D103, D106)', () => {
  it('schedules in the organization timezone at 09:00', () => {
    expect(REMINDER_SCHEDULING_TIME_ZONE).toBe('America/Vancouver');
    expect(REMINDER_LOCAL_HOUR).toBe(9);
    expect(REMINDER_LOCAL_MINUTE).toBe(0);
  });

  it('caps overdue delivery at fourteen successes', () => {
    expect(OVERDUE_SUCCESSFUL_DELIVERY_CEILING).toBe(14);
  });
});
