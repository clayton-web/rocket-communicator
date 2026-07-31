import { describe, expect, it } from 'vitest';
import {
  compareLocalDates,
  countSuccessfulOverdueDeliveries,
  decideAdvanceReminder,
  hasAdvanceOccurrenceElapsed,
  hasReachedOverdueDeliveryCeiling,
  hasReminderSchedule,
  isDueDateChangeMaterial,
  OVERDUE_SUCCESSFUL_DELIVERY_CEILING,
  parseLocalDate,
  selectNextOverdueOccurrence,
  type LocalDate,
  type ReminderOccurrenceOutcome,
} from '../src/index.js';

/**
 * A8.2 scheduling policy evidence (D102-D106).
 *
 * The clock is always an argument. Every expectation below is a literal instant confirmed
 * independently against `Intl` in America/Vancouver — 09:00 local is `16:00Z` while Pacific
 * Daylight Time is in effect and `17:00Z` while Pacific Standard Time is, which is exactly the
 * distinction a fixed 24-hour offset would erase.
 */

function localDate(value: string): LocalDate {
  return parseLocalDate(value);
}

function repeat(entry: ReminderOccurrenceOutcome, count: number): ReminderOccurrenceOutcome[] {
  return Array.from({ length: count }, () => entry);
}

function successfulOverdueDeliveries(count: number): ReminderOccurrenceOutcome[] {
  return repeat({ occurrence: 'overdue', outcome: 'success' }, count);
}

describe('reminder schedule existence (D102)', () => {
  it('exists only when the Owner selected a due date', () => {
    expect(hasReminderSchedule(null)).toBe(false);
    expect(hasReminderSchedule(localDate('2026-07-31'))).toBe(true);
  });
});

describe('advance reminder disposition (D105)', () => {
  it('schedules 09:00 local on the day before the due date', () => {
    const disposition = decideAdvanceReminder({
      dueLocalDate: localDate('2026-07-31'),
      establishedAt: '2026-07-29T12:00:00.000Z',
    });

    expect(disposition.kind).toBe('scheduled');
    expect(disposition.occurrenceLocalDate).toBe('2026-07-30');
    expect(disposition.occurrenceAt).toBe('2026-07-30T16:00:00.000Z');
  });

  it('still sends that morning when the schedule is established before 09:00', () => {
    const disposition = decideAdvanceReminder({
      dueLocalDate: localDate('2026-07-31'),
      // 08:59:59.999 local on the advance day.
      establishedAt: '2026-07-30T15:59:59.999Z',
    });

    expect(disposition.kind).toBe('scheduled');
    expect(disposition.occurrenceAt).toBe('2026-07-30T16:00:00.000Z');
  });

  it('skips with advance_window_elapsed once the occurrence instant has arrived', () => {
    const disposition = decideAdvanceReminder({
      dueLocalDate: localDate('2026-07-31'),
      establishedAt: '2026-07-30T16:00:00.000Z',
    });

    expect(disposition).toEqual({
      kind: 'skipped',
      reason: 'advance_window_elapsed',
      occurrenceLocalDate: '2026-07-30',
      occurrenceAt: '2026-07-30T16:00:00.000Z',
    });
  });

  it('gives a Task established on its due date no advance reminder', () => {
    const disposition = decideAdvanceReminder({
      dueLocalDate: localDate('2026-07-31'),
      establishedAt: '2026-07-31T15:00:00.000Z',
    });

    expect(disposition.kind).toBe('skipped');
  });

  it('gives a Task established after a past due date no advance reminder', () => {
    const disposition = decideAdvanceReminder({
      dueLocalDate: localDate('2020-01-01'),
      establishedAt: '2026-07-30T12:00:00.000Z',
    });

    expect(disposition).toEqual({
      kind: 'skipped',
      reason: 'advance_window_elapsed',
      occurrenceLocalDate: '2019-12-31',
      occurrenceAt: '2019-12-31T17:00:00.000Z',
    });
  });

  it('resolves the advance occurrence across a daylight-saving transition', () => {
    // The day before a spring-forward due date is still Pacific Standard Time.
    expect(
      decideAdvanceReminder({
        dueLocalDate: localDate('2026-03-08'),
        establishedAt: '2026-03-06T12:00:00.000Z',
      }).occurrenceAt,
    ).toBe('2026-03-07T17:00:00.000Z');

    expect(
      decideAdvanceReminder({
        dueLocalDate: localDate('2026-11-02'),
        establishedAt: '2026-10-30T12:00:00.000Z',
      }).occurrenceAt,
    ).toBe('2026-11-01T17:00:00.000Z');
  });

  it('uses the calendar day before the due date across month and year boundaries', () => {
    const cases: ReadonlyArray<[string, string]> = [
      ['2026-03-01', '2026-02-28'],
      ['2024-03-01', '2024-02-29'],
      ['2027-01-01', '2026-12-31'],
      ['2026-04-01', '2026-03-31'],
    ];

    for (const [due, expected] of cases) {
      expect(
        decideAdvanceReminder({
          dueLocalDate: localDate(due),
          establishedAt: '2019-01-01T00:00:00.000Z',
        }).occurrenceLocalDate,
        due,
      ).toBe(expected);
    }
  });

  it('is derived entirely from its establishment inputs', () => {
    const input = {
      dueLocalDate: localDate('2026-07-31'),
      establishedAt: '2026-07-29T12:00:00.000Z' as const,
    };

    expect(decideAdvanceReminder(input)).toEqual(decideAdvanceReminder(input));
  });
});

/**
 * The boundary a Waiting resume asks about (A8 lifecycle audit H-2).
 *
 * `decideAdvanceReminder` answers "should this generation have an advance reminder at all"; this
 * answers "can the advance occurrence it already scheduled still be sent". Both must draw the line in
 * the same place, or a Task suspended and resumed at exactly 09:00 on its advance morning would be
 * treated differently from one established at that instant.
 */
describe('advance occurrence elapse boundary (D105, D107)', () => {
  const advanceAt = '2026-07-30T16:00:00.000Z' as const;

  it('reports an occurrence strictly in the future as not elapsed', () => {
    expect(hasAdvanceOccurrenceElapsed(advanceAt, '2026-07-30T15:59:59.999Z')).toBe(false);
  });

  it('reports an occurrence exactly at the reference instant as elapsed', () => {
    // `<=`, matching `decideAdvanceReminder`, which schedules only when the occurrence is strictly
    // after its reference instant. Anything not strictly ahead is already too late to send.
    expect(hasAdvanceOccurrenceElapsed(advanceAt, advanceAt)).toBe(true);
  });

  it('reports an occurrence one millisecond past as elapsed', () => {
    expect(hasAdvanceOccurrenceElapsed(advanceAt, '2026-07-30T16:00:00.001Z')).toBe(true);
  });

  it('agrees with the establishment decision at the same instant', () => {
    // The generation the establishment decision refuses to schedule is exactly the one this predicate
    // calls elapsed, so the two cannot drift apart.
    const dueLocalDate = localDate('2026-07-31');
    const scheduled = decideAdvanceReminder({
      dueLocalDate,
      establishedAt: '2026-07-30T15:59:59.999Z',
    });
    expect(scheduled.kind).toBe('scheduled');
    expect(hasAdvanceOccurrenceElapsed(scheduled.occurrenceAt, '2026-07-30T15:59:59.999Z')).toBe(
      false,
    );

    const skipped = decideAdvanceReminder({ dueLocalDate, establishedAt: advanceAt });
    expect(skipped.kind).toBe('skipped');
    expect(hasAdvanceOccurrenceElapsed(skipped.occurrenceAt, advanceAt)).toBe(true);
  });
});

describe('next overdue occurrence selection (D106)', () => {
  it('begins on the calendar day strictly after the due date', () => {
    const occurrence = selectNextOverdueOccurrence({
      dueLocalDate: localDate('2026-07-31'),
      now: '2026-07-31T20:00:00.000Z',
    });

    expect(occurrence.occurrenceLocalDate).toBe('2026-08-01');
    expect(occurrence.occurrenceAt).toBe('2026-08-01T16:00:00.000Z');
  });

  it('never returns the due date itself, even long before the due date', () => {
    const occurrence = selectNextOverdueOccurrence({
      dueLocalDate: localDate('2026-12-25'),
      now: '2026-07-30T20:00:00.000Z',
    });

    expect(occurrence.occurrenceLocalDate).toBe('2026-12-26');
    expect(occurrence.occurrenceAt).toBe('2026-12-26T17:00:00.000Z');
  });

  it('advances to the following local day once today 09:00 has elapsed', () => {
    expect(
      selectNextOverdueOccurrence({
        dueLocalDate: localDate('2026-07-31'),
        now: '2026-08-01T16:00:00.000Z',
      }).occurrenceAt,
    ).toBe('2026-08-02T16:00:00.000Z');

    expect(
      selectNextOverdueOccurrence({
        dueLocalDate: localDate('2026-07-31'),
        now: '2026-08-01T15:59:59.999Z',
      }).occurrenceAt,
    ).toBe('2026-08-01T16:00:00.000Z');
  });

  it('produces no backlog for a long-past due date', () => {
    const occurrence = selectNextOverdueOccurrence({
      dueLocalDate: localDate('2019-05-05'),
      now: '2026-07-30T20:00:00.000Z',
    });

    // Thousands of mornings were missed; exactly one future occurrence is selected.
    expect(occurrence.occurrenceLocalDate).toBe('2026-07-31');
    expect(occurrence.occurrenceAt).toBe('2026-07-31T16:00:00.000Z');
  });

  it('selects this morning when a long-past due date is resumed before 09:00', () => {
    const occurrence = selectNextOverdueOccurrence({
      dueLocalDate: localDate('2019-05-05'),
      // 07:00 local.
      now: '2026-07-30T14:00:00.000Z',
    });

    expect(occurrence.occurrenceAt).toBe('2026-07-30T16:00:00.000Z');
  });

  it('holds 09:00 local across both daylight-saving transitions', () => {
    expect(
      selectNextOverdueOccurrence({
        dueLocalDate: localDate('2026-03-06'),
        // 10:00 PST on 7 March, so 7 March 09:00 has elapsed.
        now: '2026-03-07T18:00:00.000Z',
      }).occurrenceAt,
    ).toBe('2026-03-08T16:00:00.000Z');

    expect(
      selectNextOverdueOccurrence({
        dueLocalDate: localDate('2026-10-30'),
        // 10:00 PDT on 31 October.
        now: '2026-10-31T17:00:00.000Z',
      }).occurrenceAt,
    ).toBe('2026-11-01T17:00:00.000Z');
  });

  it('always returns exactly one future occurrence strictly after the due date', () => {
    const cases: ReadonlyArray<[string, string]> = [
      ['2019-05-05', '2026-07-30T20:00:00.000Z'],
      ['2026-07-31', '2026-07-31T20:00:00.000Z'],
      ['2026-07-31', '2026-08-01T16:00:00.000Z'],
      ['2026-03-07', '2026-03-08T16:00:00.000Z'],
      ['2026-10-31', '2026-11-01T17:00:00.000Z'],
      ['2026-12-31', '2027-01-01T17:00:00.000Z'],
    ];

    for (const [due, now] of cases) {
      const occurrence = selectNextOverdueOccurrence({ dueLocalDate: localDate(due), now });
      const label = `${due} @ ${now}`;

      expect(
        compareLocalDates(occurrence.occurrenceLocalDate, localDate(due)),
        label,
      ).toBeGreaterThan(0);
      expect(Date.parse(occurrence.occurrenceAt) > Date.parse(now), label).toBe(true);
    }
  });
});

describe('due-date materiality (D104)', () => {
  it('treats the same canonical due date as immaterial', () => {
    expect(isDueDateChangeMaterial(localDate('2026-07-31'), localDate('2026-07-31'))).toBe(false);
    expect(isDueDateChangeMaterial(null, null)).toBe(false);
  });

  it('treats a different due date as material', () => {
    expect(isDueDateChangeMaterial(localDate('2026-07-31'), localDate('2026-08-01'))).toBe(true);
    expect(isDueDateChangeMaterial(localDate('2026-07-31'), localDate('2026-07-30'))).toBe(true);
  });

  it('treats setting and removing a due date as material', () => {
    expect(isDueDateChangeMaterial(null, localDate('2026-07-31'))).toBe(true);
    expect(isDueDateChangeMaterial(localDate('2026-07-31'), null)).toBe(true);
  });
});

describe('overdue delivery ceiling (D106)', () => {
  it('counts only successful overdue deliveries', () => {
    const mixed: ReminderOccurrenceOutcome[] = [
      { occurrence: 'overdue', outcome: 'success' },
      { occurrence: 'advance', outcome: 'success' },
      { occurrence: 'overdue', outcome: 'retryable_failure' },
      { occurrence: 'overdue', outcome: 'permanent_failure' },
      { occurrence: 'overdue', outcome: 'ambiguous' },
      { occurrence: 'overdue', outcome: 'skipped' },
      { occurrence: 'overdue', outcome: 'claimed' },
      { occurrence: 'advance', outcome: 'skipped' },
      { occurrence: 'overdue', outcome: 'success' },
    ];

    expect(countSuccessfulOverdueDeliveries(mixed)).toBe(2);
    expect(hasReachedOverdueDeliveryCeiling(mixed)).toBe(false);
  });

  it('is not reached by the thirteenth successful overdue delivery', () => {
    const thirteen = successfulOverdueDeliveries(OVERDUE_SUCCESSFUL_DELIVERY_CEILING - 1);

    expect(countSuccessfulOverdueDeliveries(thirteen)).toBe(13);
    expect(hasReachedOverdueDeliveryCeiling(thirteen)).toBe(false);
  });

  it('is reached by the fourteenth successful overdue delivery', () => {
    const fourteen = successfulOverdueDeliveries(OVERDUE_SUCCESSFUL_DELIVERY_CEILING);

    expect(countSuccessfulOverdueDeliveries(fourteen)).toBe(14);
    expect(hasReachedOverdueDeliveryCeiling(fourteen)).toBe(true);
  });

  it('is never reached by non-successful outcomes or by advance reminders', () => {
    const neverCounted: ReminderOccurrenceOutcome[] = [
      ...repeat({ occurrence: 'advance', outcome: 'success' }, 20),
      ...(
        ['retryable_failure', 'permanent_failure', 'ambiguous', 'skipped', 'claimed'] as const
      ).flatMap((outcome) => repeat({ occurrence: 'overdue', outcome }, 20)),
    ];

    expect(countSuccessfulOverdueDeliveries(neverCounted)).toBe(0);
    expect(hasReachedOverdueDeliveryCeiling(neverCounted)).toBe(false);
    expect(hasReachedOverdueDeliveryCeiling([])).toBe(false);
  });
});
