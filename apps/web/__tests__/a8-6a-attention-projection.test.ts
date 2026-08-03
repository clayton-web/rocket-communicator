import { describe, expect, it } from 'vitest';
import type { OwnerAttentionReminderRow } from '@aicaa/db';
import { toOwnerAttentionItem, toOwnerAttentionView } from '@/lib/reminders/attention';
import { formatOwnerLocalDate, UNKNOWN_DATE_TEXT } from '@/lib/presentation/datetime';

/**
 * A8.6a — the Owner attention projection.
 *
 * Two things are under test: that the sentences shown to an Owner are true, and that nothing the
 * Owner has no business seeing survives the projection.
 *
 * The wording assertions are deliberately specific. Attention copy is the product here — an Owner
 * decides what to do next from these sentences alone — so a reworded stop reason should have to be
 * a deliberate edit rather than something a refactor can do quietly.
 */

function row(overrides: Partial<OwnerAttentionReminderRow> = {}): OwnerAttentionReminderRow {
  return {
    taskId: 'task_1',
    taskSummaryPoints: [
      { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Confirm the venue booking' },
    ],
    taskDueLocalDate: '2026-08-10',
    status: 'stopped',
    stopReason: 'overdue_ceiling_reached',
    overdueDeliveredCount: 14,
    ...overrides,
  } as OwnerAttentionReminderRow;
}

describe('A8.6a attention projection', () => {
  describe('stop reasons that raise attention', () => {
    it('explains a reached ceiling as finished, and as not restarting on its own', () => {
      const item = toOwnerAttentionItem(row({ stopReason: 'overdue_ceiling_reached' }));
      expect(item.headline).toBe('Reminders have finished for this Task.');
      expect(item.explanation).toContain('will not start again on its own');
      expect(item.badge).toBe('Reminders finished');
      expect(item.badgeTone).toBe('caution');
    });

    it('explains a permanent delivery failure as stopped, with nothing further coming', () => {
      const item = toOwnerAttentionItem(row({ stopReason: 'permanent_delivery_failure' }));
      expect(item.headline).toBe('Reminders stopped after a delivery failure.');
      expect(item.explanation).toContain('Nothing further will be sent');
      expect(item.badgeTone).toBe('critical');
    });

    /**
     * D129's distinction, which the copy exists to preserve: Rocket does not know the reminder was
     * missed, only that it could not confirm otherwise. Claiming the Recipient did not receive it
     * would send an Owner to re-send something that may already have arrived.
     */
    it('describes ambiguity as unconfirmed rather than as undelivered', () => {
      const item = toOwnerAttentionItem(row({ stopReason: 'repeated_ambiguous_outcomes' }));
      expect(item.headline).toBe('Reminders stopped because delivery could not be confirmed.');
      expect(item.explanation).toContain('may or may not have received');

      const wording = `${item.headline} ${item.explanation}`.toLowerCase();
      for (const overclaim of [
        'did not receive',
        'was not delivered',
        'never received',
        'failed to reach',
        'undelivered',
      ]) {
        expect(wording).not.toContain(overclaim);
      }
    });
  });

  describe('stop reasons that should never appear here', () => {
    /**
     * A completed Task, a dismissed Task, and a removed due date all stop a schedule without
     * needing anyone. None is written alongside the attention flag, so each maps to generic copy
     * rather than to a fabricated fourth attention reason.
     */
    it.each(['task_completed', 'task_dismissed', 'due_date_removed'] as const)(
      'falls back to truthful generic copy for %s',
      (stopReason) => {
        const item = toOwnerAttentionItem(row({ stopReason }));
        expect(item.headline).toBe('This Task’s reminders need your attention.');
        expect(item.explanation).toContain('not one this page can explain');
        expect(item.badge).toBe('Needs attention');
      },
    );

    it('falls back to the same copy when no stop reason is recorded at all', () => {
      const item = toOwnerAttentionItem(row({ status: 'active', stopReason: null }));
      expect(item.headline).toBe('This Task’s reminders need your attention.');
    });

    it('says nothing specific in the generic case, rather than guessing a cause', () => {
      const item = toOwnerAttentionItem(row({ stopReason: null }));
      const wording = `${item.headline} ${item.explanation}`.toLowerCase();
      for (const guess of ['failure', 'could not be confirmed', 'finished', 'maximum']) {
        expect(wording).not.toContain(guess);
      }
    });

    it('projects a suspended_waiting schedule without inventing a reason for it', () => {
      const item = toOwnerAttentionItem(row({ status: 'suspended_waiting', stopReason: null }));
      expect(item.badge).toBe('Needs attention');
      expect(item.taskId).toBe('task_1');
    });
  });

  describe('dates', () => {
    /**
     * The off-by-one this formatter exists to prevent.
     *
     * A due date is a calendar date in the organization's zone, not an instant. Rendering it
     * through the instant formatter would parse it as UTC midnight and display the previous day in
     * `America/Vancouver` — an Owner shown a deadline a day earlier than the one they set.
     */
    it('renders a due date as the day it names, not the day before', () => {
      const item = toOwnerAttentionItem(row({ taskDueLocalDate: '2026-08-10' }));
      expect(item.dueDateText).toBe('Aug 10, 2026');
    });

    it('renders correctly across a daylight-saving boundary and at year end', () => {
      expect(formatOwnerLocalDate('2026-03-08')).toBe('Mar 8, 2026');
      expect(formatOwnerLocalDate('2026-11-01')).toBe('Nov 1, 2026');
      expect(formatOwnerLocalDate('2026-01-01')).toBe('Jan 1, 2026');
      expect(formatOwnerLocalDate('2026-12-31')).toBe('Dec 31, 2026');
    });

    it('omits the due date entirely when the Task no longer has one', () => {
      expect(toOwnerAttentionItem(row({ taskDueLocalDate: null })).dueDateText).toBeNull();
    });

    it('refuses anything that is not a canonical local date rather than coercing it', () => {
      // An instant here means a caller confused the two date kinds; rendering its UTC day would
      // hide that behind a plausible answer.
      expect(formatOwnerLocalDate('2026-08-10T00:00:00.000Z')).toBe(UNKNOWN_DATE_TEXT);
      expect(formatOwnerLocalDate('2026-2-3')).toBe(UNKNOWN_DATE_TEXT);
      expect(formatOwnerLocalDate('2026-02-30')).toBe(UNKNOWN_DATE_TEXT);
      expect(formatOwnerLocalDate('')).toBe(UNKNOWN_DATE_TEXT);
      expect(formatOwnerLocalDate(null)).toBe(UNKNOWN_DATE_TEXT);
    });
  });

  describe('titles and links', () => {
    it('names the Task the way every other Owner surface names it', () => {
      expect(toOwnerAttentionItem(row()).taskTitle).toBe('Confirm the venue booking');
    });

    it('falls back to an identifier prefix when no summary point carries text', () => {
      const item = toOwnerAttentionItem(row({ taskId: 'task_abcdef123', taskSummaryPoints: [] }));
      expect(item.taskTitle).toBe('Task task_abc');
    });

    it('degrades to that fallback rather than throwing on a malformed summary column', () => {
      const item = toOwnerAttentionItem(row({ taskId: 'task_abcdef123', taskSummaryPoints: null }));
      expect(item.taskTitle).toBe('Task task_abc');
    });

    it('links only to the authenticated Owner Task route', () => {
      expect(toOwnerAttentionItem(row({ taskId: 'task_9' })).href).toBe('/tasks/task_9');
    });
  });

  describe('what the projection refuses to carry', () => {
    /**
     * Worker-coordination internals and database identifiers are absent from the output type, not
     * merely unrendered. A field that exists on a projection eventually reaches a template.
     */
    it('exposes no lease, claim, version, generation, or row identifier', () => {
      const item = toOwnerAttentionItem(row());
      const keys = Object.keys(item);
      for (const forbidden of [
        'claimedBy',
        'claimedAt',
        'claimExpiresAt',
        'reminderVersion',
        'generation',
        'id',
        'scheduleId',
        'establishedAt',
        'createdAt',
        'updatedAt',
        'overdueDeliveredCount',
      ]) {
        expect(keys).not.toContain(forbidden);
      }
    });

    it('leaks no internal vocabulary into the sentences an Owner reads', () => {
      for (const stopReason of [
        'overdue_ceiling_reached',
        'permanent_delivery_failure',
        'repeated_ambiguous_outcomes',
        null,
      ] as const) {
        const item = toOwnerAttentionItem(row({ stopReason }));
        const wording = `${item.badge} ${item.headline} ${item.explanation}`.toLowerCase();
        for (const jargon of [
          'generation',
          'claim',
          'lease',
          'occurrence',
          'intent',
          'etag',
          'schedule row',
          'worker',
        ]) {
          expect(wording).not.toContain(jargon);
        }
      }
    });
  });

  describe('the view', () => {
    it('preserves the repository order exactly, adding no sort of its own', () => {
      const view = toOwnerAttentionView(
        [row({ taskId: 'task_c' }), row({ taskId: 'task_a' }), row({ taskId: 'task_b' })],
        50,
      );
      expect(view.items.map((item) => item.taskId)).toEqual(['task_c', 'task_a', 'task_b']);
    });

    it('reports a filled batch so the page can disclose that more may exist', () => {
      expect(toOwnerAttentionView([row(), row()], 2).batchFilled).toBe(true);
      expect(toOwnerAttentionView([row()], 2).batchFilled).toBe(false);
      expect(toOwnerAttentionView([], 2).batchFilled).toBe(false);
    });
  });
});
