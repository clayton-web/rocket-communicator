import { describe, expect, it } from 'vitest';
import type { OwnerMissedNotificationRow } from '@aicaa/db';
import { OWNER_FACING_ACTOR_LABELS, ownerFacingActorLabel } from '@/lib/presentation/actor-label';
import {
  toOwnerMissedNotificationItem,
  toOwnerMissedNotificationsView,
} from '@/lib/notifications/missed-notifications';

/**
 * A8.6c — the undelivered notification projection.
 *
 * What these hold is the difference between a truthful sentence and a plausible one. The Owner is
 * being told that Rocket failed to reach them, and every wrong word in that message costs
 * something specific: a suppression described as a failure sends them looking for a broken
 * mailbox, an ambiguous outcome described as "not sent" tells them to expect no email when one may
 * already have arrived, and a missing Task link presented as a working one sends them nowhere.
 */

const OCCURRED_AT = '2026-08-20T16:30:00.000Z';

function row(overrides: Partial<OwnerMissedNotificationRow> = {}): OwnerMissedNotificationRow {
  return {
    id: 'onint_1',
    eventType: 'task_completed_by_recipient',
    state: 'failed_permanent',
    suppressionReason: null,
    actorKind: 'capability',
    occurredAt: OCCURRED_AT,
    settledAt: '2026-08-20T16:35:00.000Z',
    taskId: 'task_1',
    taskSummaryPoints: [
      { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Confirm the venue booking' },
    ],
    ...overrides,
  };
}

/** Every ratified event type, including the three the repository filters out. */
const ALL_EVENT_TYPES = [
  'task_completed_by_recipient',
  'task_clarification_requested',
  'task_returned_to_owner',
  'handoff_delivery_failed',
  'gmail_disconnected',
  'capability_expired',
  'reminder_schedule_stopped_ceiling_reached',
  'reminder_schedule_stopped_permanent_failure',
  'reminder_schedule_stopped_repeated_ambiguous',
  'reminder_no_active_assignment',
] as const satisfies ReadonlyArray<OwnerMissedNotificationRow['eventType']>;

describe('A8.6c undelivered notification projection', () => {
  describe('event copy', () => {
    /**
     * Exhaustive over the enum rather than over the six events this surface can currently show.
     * The filter is the part most likely to change; the taxonomy is ratified.
     */
    it('gives every ratified event type its own sentence', () => {
      const headlines = ALL_EVENT_TYPES.map(
        (eventType) => toOwnerMissedNotificationItem(row({ eventType })).headline,
      );
      expect(new Set(headlines).size).toBe(ALL_EVENT_TYPES.length);
      for (const headline of headlines) {
        expect(headline.length).toBeGreaterThan(0);
        expect(headline.endsWith('.')).toBe(true);
      }
    });

    /** Fixed copy. Nothing about the event is interpolated from a Task, a note, or a person. */
    it('never interpolates the subject into the headline', () => {
      const item = toOwnerMissedNotificationItem(
        row({
          taskSummaryPoints: [
            { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'SENSITIVE-TEXT' },
          ],
        }),
      );
      expect(item.headline).not.toContain('SENSITIVE-TEXT');
      expect(item.outcomeExplanation).not.toContain('SENSITIVE-TEXT');
    });
  });

  describe('outcome collapse', () => {
    it('describes a stale suppression as a decision not to send, not as a failure', () => {
      const item = toOwnerMissedNotificationItem(
        row({ state: 'suppressed', suppressionReason: 'stale' }),
      );
      expect(item.outcomeBadge).toBe('Not sent');
      expect(item.outcomeExplanation).toMatch(/did not send/i);
      expect(item.outcomeExplanation).toMatch(/time had passed/i);
    });

    it('names a missing mailbox as the reason when there was nowhere to send', () => {
      const item = toOwnerMissedNotificationItem(
        row({ state: 'suppressed', suppressionReason: 'channel_unavailable' }),
      );
      expect(item.outcomeBadge).toBe('Not sent');
      expect(item.outcomeExplanation).toMatch(/no connected Gmail account/i);
    });

    it('says an attempt was made and failed for a permanent failure', () => {
      const item = toOwnerMissedNotificationItem(row({ state: 'failed_permanent' }));
      expect(item.outcomeBadge).toBe('Not sent');
      expect(item.outcomeExplanation).toMatch(/tried to email you/i);
    });

    it('says Rocket gave up after repeated attempts when the retry budget was exhausted', () => {
      const item = toOwnerMissedNotificationItem(row({ state: 'requires_owner_attention' }));
      expect(item.outcomeBadge).toBe('Not sent');
      expect(item.outcomeExplanation).toMatch(/several times/i);
      expect(item.outcomeExplanation).toMatch(/stopped trying/i);
    });

    /**
     * The distinction worth keeping. `ambiguous` means the provider may already have accepted the
     * message, so telling the Owner it was not sent could contradict an email sitting in their
     * inbox.
     */
    it('refuses to claim an ambiguous outcome was or was not delivered', () => {
      const item = toOwnerMissedNotificationItem(row({ state: 'ambiguous' }));
      expect(item.outcomeBadge).toBe('Delivery unknown');
      expect(item.outcomeExplanation).toMatch(/could not confirm/i);
      expect(item.outcomeExplanation).toMatch(/may have received it/i);
    });

    /**
     * Unreachable through the repository, which filters these out. Held anyway, because the honest
     * answer for a state this surface cannot account for is to say so rather than to guess.
     */
    it('claims nothing about a state the surface does not show', () => {
      for (const state of ['sent', 'pending', 'claimed', 'failed_retryable'] as const) {
        const item = toOwnerMissedNotificationItem(row({ state }));
        expect(item.outcomeBadge).toBe('Status unclear');
        expect(item.outcomeExplanation).toMatch(/cannot say what happened/i);
      }
    });

    it('reports a suppression with no recorded reason without inventing one', () => {
      const item = toOwnerMissedNotificationItem(
        row({ state: 'suppressed', suppressionReason: null }),
      );
      expect(item.outcomeExplanation).toMatch(/reason was not recorded/i);
    });
  });

  describe('actor mapping', () => {
    it('uses the ratified three-way mapping and nothing else', () => {
      expect(OWNER_FACING_ACTOR_LABELS).toEqual({
        owner: 'You',
        capability: 'The Recipient',
        system: 'Rocket',
      });
      expect(ownerFacingActorLabel('capability')).toBe('The Recipient');
    });

    it('labels each actor category on the projected item', () => {
      expect(toOwnerMissedNotificationItem(row({ actorKind: 'owner' })).actorLabel).toBe('You');
      expect(toOwnerMissedNotificationItem(row({ actorKind: 'capability' })).actorLabel).toBe(
        'The Recipient',
      );
      expect(toOwnerMissedNotificationItem(row({ actorKind: 'system' })).actorLabel).toBe('Rocket');
    });

    /**
     * "Rocket" rather than the email renderer's "your assistant". The divergence is deliberate:
     * inside the product every other Owner surface calls the assistant Rocket, and a second name
     * would read as a second actor.
     */
    it('does not use the email renderer’s wording for the system actor', () => {
      expect(toOwnerMissedNotificationItem(row({ actorKind: 'system' })).actorLabel).not.toMatch(
        /assistant/i,
      );
    });
  });

  describe('the Task link', () => {
    it('titles the Task the way every other Owner surface does, and links to it', () => {
      const item = toOwnerMissedNotificationItem(row());
      expect(item.taskTitle).toBe('Confirm the venue booking');
      expect(item.href).toBe('/tasks/task_1');
      expect(item.nextStep).toMatch(/Open the Task/i);
    });

    /**
     * A subject that was purged, never existed, or belongs to another organization all arrive as
     * a null Task. The item is still rendered — the event happened and the Owner was never told —
     * and it says plainly that there is nowhere to go.
     */
    it('renders an item with no Task rather than dropping it', () => {
      const item = toOwnerMissedNotificationItem(row({ taskId: null, taskSummaryPoints: null }));
      expect(item.href).toBeNull();
      expect(item.taskTitle).toBeNull();
      expect(item.nextStep).toMatch(/not linked to a Task/i);
      expect(item.headline.length).toBeGreaterThan(0);
    });

    /** `summaryPoints` is a `Json` column, so a malformed value must degrade rather than throw. */
    it('falls back to an identifier-derived title for unusable summary points', () => {
      const item = toOwnerMissedNotificationItem(
        row({ taskSummaryPoints: { not: 'an array' } as unknown }),
      );
      expect(item.taskTitle).toBeTruthy();
      expect(item.href).toBe('/tasks/task_1');
    });
  });

  describe('timestamps', () => {
    it('renders the event instant and the settlement instant in the Owner timezone', () => {
      const item = toOwnerMissedNotificationItem(row());
      expect(item.occurredAtText).toMatch(/Aug 20, 2026/);
      expect(item.occurredAtText).toMatch(/P[DS]T/);
      expect(item.settledAtText).toMatch(/Aug 20, 2026/);
    });

    it('omits the settlement line when the intent has none', () => {
      expect(toOwnerMissedNotificationItem(row({ settledAt: null })).settledAtText).toBeNull();
    });
  });

  describe('the view', () => {
    it('preserves the repository’s order without re-sorting or filtering', () => {
      const rows = [
        row({ id: 'a', occurredAt: '2026-08-10T00:00:00.000Z', eventType: 'gmail_disconnected' }),
        row({ id: 'b', occurredAt: '2026-08-28T00:00:00.000Z' }),
      ];
      const view = toOwnerMissedNotificationsView(rows, 50, 30);
      expect(view.items).toHaveLength(2);
      expect(view.items[0]!.headline).toMatch(/Gmail/);
    });

    it('discloses a filled batch rather than truncating in silence', () => {
      expect(toOwnerMissedNotificationsView([row(), row()], 2, 30).batchFilled).toBe(true);
      expect(toOwnerMissedNotificationsView([row()], 2, 30).batchFilled).toBe(false);
    });

    it('carries the window length so the page states one number', () => {
      expect(toOwnerMissedNotificationsView([], 50, 30).windowDays).toBe(30);
    });
  });

  describe('the vocabulary boundary', () => {
    /**
     * The projected item is the last place internal vocabulary could leak into a template, so the
     * shape is asserted exactly rather than by absence of a chosen list of names.
     */
    it('exposes only the fields the surface renders', () => {
      expect(Object.keys(toOwnerMissedNotificationItem(row())).sort()).toEqual([
        'actorLabel',
        'headline',
        'href',
        'nextStep',
        'occurredAtText',
        'outcomeBadge',
        'outcomeExplanation',
        'outcomeTone',
        'settledAtText',
        'taskTitle',
      ]);
    });

    it('never renders a raw state, reason, event, or actor enum value', () => {
      for (const eventType of ALL_EVENT_TYPES) {
        for (const state of ['suppressed', 'failed_permanent', 'ambiguous'] as const) {
          const item = toOwnerMissedNotificationItem(row({ eventType, state }));
          const text = Object.values(item).filter(Boolean).join(' ');
          for (const raw of [
            eventType,
            state,
            'channel_unavailable',
            'requires_owner_attention',
            'onint_',
            'capability',
            'occurrenceKey',
          ]) {
            expect(text).not.toContain(raw);
          }
        }
      }
    });
  });
});
