// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  OWNER_DISPLAY_TIME_ZONE,
  UNKNOWN_DATE_TEXT,
  formatOwnerDate,
  formatOwnerDateTime,
  isRenderableInstant,
} from '@/lib/presentation/datetime';
import { deriveTaskTitle, summaryPointText } from '@/lib/presentation/task-title';
import { OWNER_TASK_NOTE_DISPLAY_LIMIT, noteBoundNotice } from '@/lib/presentation/task-notes';
import {
  assignmentLabel,
  deliveryStatusLabel,
  deliveryTone,
  taskStatusLabel,
  taskStatusTone,
  taskUrgencyLabel,
  urgencyTone,
} from '@/lib/presentation/task-status';

/**
 * P1.4 Owner presentation evidence (D117).
 *
 * The timezone assertions use exact expected strings rather than "contains a year". A
 * substring check would pass while rendering the wrong day, which is precisely the failure
 * D117 exists to prevent: an Owner in Vancouver reading a due date that silently shifted.
 *
 * `TZ=UTC` and `TZ=Asia/Tokyo` runs of this file are what prove no machine-local fallback.
 * Asia/Tokyo is the decisive one — it is ahead of Vancouver, so a leaked process timezone
 * shows up as the wrong *calendar day*, not merely a wrong hour.
 */

describe('Owner display timezone (D117)', () => {
  it('is the documented Vancouver IANA zone', () => {
    expect(OWNER_DISPLAY_TIME_ZONE).toBe('America/Vancouver');
  });

  it('renders the Owner timezone regardless of the process timezone', () => {
    // 2026-01-15T20:30:00Z is 12:30 on 2026-01-15 in Vancouver (PST, UTC-8).
    expect(formatOwnerDateTime('2026-01-15T20:30:00.000Z')).toBe('Jan 15, 2026, 12:30 p.m. PST');
  });

  it('resolves daylight saving from the instant rather than an offset', () => {
    // Standard time in January, daylight time in July: PST then PDT, both UTC-8/-7 by zone.
    expect(formatOwnerDateTime('2026-01-15T20:30:00.000Z')).toContain('PST');
    expect(formatOwnerDateTime('2026-07-15T19:30:00.000Z')).toBe('Jul 15, 2026, 12:30 p.m. PDT');
  });

  it('renders the correct local day across the spring-forward transition', () => {
    // Vancouver springs forward 2026-03-08 at 02:00 PST -> 03:00 PDT.
    // 09:59:59Z is 01:59:59 PST on Mar 8; 10:00:00Z is 03:00:00 PDT the same day.
    expect(formatOwnerDateTime('2026-03-08T09:59:59.000Z')).toBe('Mar 8, 2026, 1:59 a.m. PST');
    expect(formatOwnerDateTime('2026-03-08T10:00:00.000Z')).toBe('Mar 8, 2026, 3:00 a.m. PDT');
  });

  it('renders the correct local day across the fall-back transition', () => {
    // Vancouver falls back 2026-11-01 at 02:00 PDT -> 01:00 PST. The same wall-clock hour
    // occurs twice, and only the zone abbreviation distinguishes the two instants.
    expect(formatOwnerDateTime('2026-11-01T08:30:00.000Z')).toBe('Nov 1, 2026, 1:30 a.m. PDT');
    expect(formatOwnerDateTime('2026-11-01T09:30:00.000Z')).toBe('Nov 1, 2026, 1:30 a.m. PST');
  });

  it('shows the Vancouver calendar day, not the UTC day, near midnight', () => {
    // 2026-01-16T04:30:00Z is still 2026-01-15 in Vancouver. A machine-local fallback under
    // TZ=UTC or TZ=Asia/Tokyo would report the 16th here.
    expect(formatOwnerDate('2026-01-16T04:30:00.000Z')).toBe('Jan 15, 2026');
    expect(formatOwnerDateTime('2026-01-16T04:30:00.000Z')).toBe('Jan 15, 2026, 8:30 p.m. PST');
  });

  it('always includes a timezone indicator when a time is shown', () => {
    expect(formatOwnerDateTime('2026-05-01T12:00:00.000Z')).toMatch(/\bP[SD]T\b/);
  });

  it('omits a timezone indicator for date-only output, which needs none', () => {
    expect(formatOwnerDate('2026-05-01T12:00:00.000Z')).toBe('May 1, 2026');
    expect(formatOwnerDate('2026-05-01T12:00:00.000Z')).not.toMatch(/P[SD]T/);
  });

  it.each([
    ['an empty string', ''],
    ['whitespace', '   '],
    ['unparseable text', 'not-a-date'],
    ['null', null],
    ['undefined', undefined],
  ])('reports %s as an unknown date rather than fabricating one', (_label, value) => {
    expect(formatOwnerDate(value)).toBe(UNKNOWN_DATE_TEXT);
    expect(formatOwnerDateTime(value)).toBe(UNKNOWN_DATE_TEXT);
    expect(isRenderableInstant(value)).toBe(false);
  });

  it('fails loudly rather than silently falling back on an unsupported zone', async () => {
    // Proves the guard is real: an invalid zone must throw at formatter construction, which
    // is what stops a bad constant from degrading to machine-local time.
    expect(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Mars/Olympus_Mons' })).toThrow();

    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('../lib/presentation/datetime.ts', import.meta.url), 'utf8'),
    );
    // No offset arithmetic, no scheduling, no environment override, no machine-local default.
    expect(source).not.toMatch(/getTimezoneOffset|\*\s*60\s*\*\s*60|process\.env|addDays|setDate/);
    expect(source).toContain('assertSupportedTimeZone(OWNER_DISPLAY_TIME_ZONE)');
  });
});

describe('Task title derivation (P1.4)', () => {
  it('uses the first summary point that carries text', () => {
    const title = deriveTaskTitle({
      id: 'task_abcdef123456',
      summaryPoints: [
        { kind: 'confirmed_fact', label: 'Fact', value: 'Invoice 4102 needs approval' },
      ],
    });

    expect(title).toBe('Invoice 4102 needs approval');
  });

  it('falls back to the label when a point carries no value', () => {
    const title = deriveTaskTitle({
      id: 'task_abcdef123456',
      summaryPoints: [{ kind: 'next_action', label: 'Call the supplier back' }],
    });

    expect(title).toBe('Call the supplier back');
  });

  it('skips a leading empty point instead of rendering a blank heading', () => {
    const title = deriveTaskTitle({
      id: 'task_abcdef123456',
      summaryPoints: [
        { kind: 'confirmed_fact', label: '', value: '   ' },
        { kind: 'request', label: 'Send the revised quote' },
      ],
    });

    expect(title).toBe('Send the revised quote');
  });

  it('is deterministic when no summary point has text', () => {
    const task = { id: 'task_abcdef123456', summaryPoints: [] };

    // Same input, same title: the fallback appears in headings and links, so instability
    // would look to the Owner like the Task had been renamed.
    expect(deriveTaskTitle(task)).toBe('Task task_abc');
    expect(deriveTaskTitle(task)).toBe(deriveTaskTitle(task));
  });

  it('preserves the pre-P1.4 fallback shape exactly', () => {
    const id = 'task_D2sZqQAZymdJCYxM';

    expect(deriveTaskTitle({ id, summaryPoints: [] })).toBe(`Task ${id.slice(0, 8)}`);
  });

  it('truncates an unreasonably long title with an ellipsis', () => {
    const long = 'x'.repeat(400);
    const title = deriveTaskTitle({
      id: 'task_abcdef123456',
      summaryPoints: [{ kind: 'confirmed_fact', label: 'Fact', value: long }],
    });

    expect(title).toHaveLength(120);
    expect(title.endsWith('…')).toBe(true);
  });

  it('trims surrounding whitespace from point text', () => {
    expect(summaryPointText({ kind: 'request', label: '  Padded  ' })).toBe('Padded');
  });
});

describe('Task status presentation (P1.4)', () => {
  const ALL_STATUSES = ['open', 'in_progress', 'waiting', 'completed', 'dismissed'] as const;

  it.each([
    ['open', 'Open'],
    ['in_progress', 'In progress'],
    ['waiting', 'Waiting'],
    ['completed', 'Completed'],
    ['dismissed', 'Dismissed'],
  ] as const)('labels %s as %s', (status, expected) => {
    expect(taskStatusLabel(status)).toBe(expected);
  });

  it('maps every contract status to a human label with no raw enum leaking', () => {
    for (const status of ALL_STATUSES) {
      const label = taskStatusLabel(status);
      expect(label).toBeTruthy();
      expect(label).not.toContain('_');
    }
  });

  it('labels derived urgency without implying reminder automation', () => {
    expect(taskUrgencyLabel('due_soon')).toBe('Due soon');
    expect(taskUrgencyLabel('overdue')).toBe('Overdue');
    // No urgency is a valid, common state and must not render a label at all.
    expect(taskUrgencyLabel(null)).toBeNull();
    expect(taskUrgencyLabel(undefined)).toBeNull();
  });

  it.each([
    ['pending', 'Delivery pending'],
    ['sent', 'Sent'],
    ['failed', 'Delivery failed'],
  ] as const)('labels delivery %s as %s', (status, expected) => {
    expect(deliveryStatusLabel(status)).toBe(expected);
  });

  it('renders no delivery label when there is no delivery to describe', () => {
    expect(deliveryStatusLabel(null)).toBeNull();
    expect(deliveryStatusLabel(undefined)).toBeNull();
  });

  it('states assignment state explicitly in both directions', () => {
    expect(assignmentLabel(true)).toBe('Assigned');
    expect(assignmentLabel(false)).toBe('Unassigned');
  });

  it('treats a dismissed Task as a settled outcome, not a failure', () => {
    expect(taskStatusTone('dismissed')).toBe('neutral');
    expect(taskStatusTone('completed')).toBe('positive');
    expect(taskStatusTone('open')).toBe('neutral');
  });

  it('escalates tone for overdue and failed delivery only', () => {
    expect(urgencyTone('overdue')).toBe('critical');
    expect(urgencyTone('due_soon')).toBe('caution');
    expect(deliveryTone('failed')).toBe('critical');
    expect(deliveryTone('pending')).toBe('caution');
    expect(deliveryTone('sent')).toBe('positive');
  });

  it('renders no state that the contract does not already provide', async () => {
    const { readFileSync } = await import('node:fs');
    // Comments discuss `dueAt`; only executable code is under assertion here.
    const code = readFileSync(
      new URL('../lib/presentation/task-status.ts', import.meta.url),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    // Presentation only: no clock, no comparison against now, no new urgency rule.
    expect(code).not.toMatch(/Date\.|now\(|dueAt|waitingUntil|setTimeout/);
  });
});

describe('Task note bound wording (P1.4)', () => {
  it('matches the database query limit exactly', async () => {
    const { TASK_DETAIL_NOTE_LIMIT } = await import('@aicaa/db');

    // The display constant is restated in the presentation layer to keep the Prisma client out
    // of the component import graph. This assertion is what stops the two from drifting.
    expect(OWNER_TASK_NOTE_DISPLAY_LIMIT).toBe(TASK_DETAIL_NOTE_LIMIT);
    expect(OWNER_TASK_NOTE_DISPLAY_LIMIT).toBe(100);
  });

  it('says nothing below the limit', () => {
    expect(noteBoundNotice(0)).toBeNull();
    expect(noteBoundNotice(1)).toBeNull();
    expect(noteBoundNotice(99)).toBeNull();
  });

  it('states what was shown once the limit is reached', () => {
    expect(noteBoundNotice(100)).toBe('Showing up to the 100 most recent notes.');
  });

  it('never claims that more notes definitely exist', () => {
    const notice = noteBoundNotice(100) ?? '';

    // At exactly the limit the Task may have exactly 100 notes. Asserting otherwise would be a
    // guess dressed as a fact, and proving it would need a contract change P1.4 cannot make.
    expect(notice).not.toMatch(/more|older|additional|truncat|hidden|not shown/i);
  });
});
