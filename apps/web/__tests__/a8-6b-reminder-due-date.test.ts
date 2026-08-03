import { describe, expect, it } from 'vitest';
import { dueDateProblem } from '@/lib/reminders/due-date';

describe('A8.6b due-date input validation', () => {
  it('accepts a canonical organization-local calendar date', () => {
    expect(dueDateProblem('2026-08-20')).toBeNull();
    expect(dueDateProblem('2028-02-29')).toBeNull();
  });

  it('asks for a date rather than complaining when nothing is chosen', () => {
    expect(dueDateProblem('')).toBe('Choose a due date.');
  });

  it('rejects anything that is not the contracted shape', () => {
    for (const value of [
      '2026-8-20',
      '20-08-2026',
      '2026/08/20',
      'tomorrow',
      '2026-08-20T00:00:00Z',
    ]) {
      expect(dueDateProblem(value), value).toBe('Enter the due date as a calendar date.');
    }
  });

  it('rejects dates that look right but do not exist', () => {
    for (const value of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2027-02-29']) {
      expect(dueDateProblem(value), value).toBe('That is not a real calendar date.');
    }
  });

  /*
   * The regression this function exists to prevent.
   *
   * `new Date('2026-01-01')` parses as UTC midnight and then reads back as 31 December in any
   * timezone behind UTC. A validator that round-tripped through local time would reject or silently
   * shift the first day of a year, a month, or a DST transition — the dates an Owner is most likely
   * to pick.
   */
  it('does not shift a date across a timezone boundary', () => {
    const boundaries = ['2026-01-01', '2026-12-31', '2026-03-08', '2026-11-01', '2026-06-30'];
    const original = process.env.TZ;

    for (const timeZone of ['UTC', 'America/Vancouver', 'Pacific/Kiritimati', 'Pacific/Niue']) {
      process.env.TZ = timeZone;
      for (const value of boundaries) {
        expect(dueDateProblem(value), `${value} in ${timeZone}`).toBeNull();
      }
    }

    process.env.TZ = original;
  });
});
