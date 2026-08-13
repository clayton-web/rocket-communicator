import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DUE_SOON_CALENDAR_DAYS,
  REMINDER_SCHEDULING_TIME_ZONE,
  addLocalDays,
  deriveTaskUrgency,
  parseLocalDate,
} from '../src/index.js';

/**
 * Canonical due-date urgency (S6.1 / D177).
 *
 * `now` is 05:00 America/Vancouver on 2026-07-13 — 12:00Z while Pacific Daylight Time is in
 * force — so the organization-local calendar date is 2026-07-13. Tests that cross a UTC date
 * boundary use a later instant the same civil night.
 */
const NOW = '2026-07-13T12:00:00.000Z';
const TODAY = parseLocalDate('2026-07-13');
const YESTERDAY = parseLocalDate('2026-07-12');
const TOMORROW = parseLocalDate('2026-07-14');
const DAY_AFTER_TOMORROW = parseLocalDate('2026-07-15');

describe('deriveTaskUrgency (canonical dueLocalDate)', () => {
  it('uses a one-calendar-day due-soon look-ahead', () => {
    expect(DEFAULT_DUE_SOON_CALENDAR_DAYS).toBe(1);
    expect(REMINDER_SCHEDULING_TIME_ZONE).toBe('America/Vancouver');
  });

  it('has no due-date urgency when dueLocalDate is absent', () => {
    expect(deriveTaskUrgency('open', null, NOW)).toBeNull();
    expect(deriveTaskUrgency('open', undefined, NOW)).toBeNull();
    expect(deriveTaskUrgency('in_progress', null, NOW)).toBeNull();
  });

  it('treats a future canonical local date beyond tomorrow as not urgent', () => {
    expect(deriveTaskUrgency('open', DAY_AFTER_TOMORROW, NOW)).toBeNull();
    expect(deriveTaskUrgency('open', parseLocalDate('2026-08-01'), NOW)).toBeNull();
  });

  it('treats today as due_soon and tomorrow as the due-soon boundary', () => {
    expect(deriveTaskUrgency('open', TODAY, NOW)).toBe('due_soon');
    expect(deriveTaskUrgency('open', TOMORROW, NOW)).toBe('due_soon');
    expect(deriveTaskUrgency('in_progress', TODAY, NOW)).toBe('due_soon');
    expect(addLocalDays(TODAY, DEFAULT_DUE_SOON_CALENDAR_DAYS)).toBe(TOMORROW);
    expect(
      deriveTaskUrgency('open', addLocalDays(TODAY, DEFAULT_DUE_SOON_CALENDAR_DAYS + 1), NOW),
    ).toBe(null);
  });

  it('treats a canonical local date before today as overdue', () => {
    expect(deriveTaskUrgency('open', YESTERDAY, NOW)).toBe('overdue');
    expect(deriveTaskUrgency('in_progress', parseLocalDate('2020-01-01'), NOW)).toBe('overdue');
  });

  it('does not derive urgency while waiting, completed, or dismissed', () => {
    expect(deriveTaskUrgency('waiting', YESTERDAY, NOW)).toBeNull();
    expect(deriveTaskUrgency('completed', YESTERDAY, NOW)).toBeNull();
    expect(deriveTaskUrgency('dismissed', TODAY, NOW)).toBeNull();
  });

  it('compares calendar dates in America/Vancouver when the UTC date differs', () => {
    // 2026-07-14T06:30:00Z is 23:30 on 2026-07-13 in Vancouver (PDT, UTC-7).
    // UTC's calendar date is already 2026-07-14; the organization-local date is not.
    const lateEveningVancouver = '2026-07-14T06:30:00.000Z';
    expect(deriveTaskUrgency('open', parseLocalDate('2026-07-13'), lateEveningVancouver)).toBe(
      'due_soon',
    );
    expect(deriveTaskUrgency('open', parseLocalDate('2026-07-12'), lateEveningVancouver)).toBe(
      'overdue',
    );
    expect(deriveTaskUrgency('open', parseLocalDate('2026-07-14'), lateEveningVancouver)).toBe(
      'due_soon',
    );
    expect(
      deriveTaskUrgency('open', parseLocalDate('2026-07-15'), lateEveningVancouver),
    ).toBeNull();

    // 2026-01-15T07:30:00Z is 23:30 on 2026-01-14 in Vancouver (PST, UTC-8).
    const lateEveningVancouverPst = '2026-01-15T07:30:00.000Z';
    expect(deriveTaskUrgency('open', parseLocalDate('2026-01-14'), lateEveningVancouverPst)).toBe(
      'due_soon',
    );
    expect(deriveTaskUrgency('open', parseLocalDate('2026-01-13'), lateEveningVancouverPst)).toBe(
      'overdue',
    );
  });

  it('does not take assignment or evidence as inputs; an unassigned Task may still be overdue', () => {
    expect(deriveTaskUrgency('open', YESTERDAY, NOW)).toBe('overdue');
    expect(deriveTaskUrgency('open', TODAY, NOW)).toBe('due_soon');
  });
});
