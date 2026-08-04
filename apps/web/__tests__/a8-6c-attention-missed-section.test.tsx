// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/owner/require-owner-page', () => ({
  requireOwnerPage: vi.fn(),
}));
vi.mock('@/lib/db/server', () => ({
  getDb: vi.fn(),
}));
vi.mock('@/lib/reminders/attention-service', () => ({
  loadOwnerAttentionView: vi.fn(),
  ATTENTION_LIST_LIMIT: 50,
}));
vi.mock('@/lib/notifications/missed-notifications-service', () => ({
  loadOwnerMissedNotificationsView: vi.fn(),
  MISSED_NOTIFICATION_LIMIT: 50,
  MISSED_NOTIFICATION_WINDOW_DAYS: 30,
}));

import { requireOwnerPage } from '@/lib/owner/require-owner-page';
import { getDb } from '@/lib/db/server';
import { loadOwnerAttentionView } from '@/lib/reminders/attention-service';
import { loadOwnerMissedNotificationsView } from '@/lib/notifications/missed-notifications-service';
import AttentionPage from '@/app/(owner)/attention/page';
import { MissedNotificationList } from '@/app/(owner)/attention/_components/missed-notification-list';
import type {
  OwnerMissedNotificationItem,
  OwnerMissedNotificationsView,
} from '@/lib/notifications/missed-notifications';

/**
 * A8.6c — `/attention` section two.
 *
 * The section exists to say one thing the product has no other way to say: something happened, and
 * Rocket never reached you about it. These tests hold the parts of that sentence that could
 * quietly become untrue — that the section is distinguishable from the reminder list above it,
 * that it offers nothing that implies Rocket will try again, that an item with no Task still
 * appears, and that the page as a whole still refuses to claim it is watching anything.
 */

function item(overrides: Partial<OwnerMissedNotificationItem> = {}): OwnerMissedNotificationItem {
  return {
    headline: 'This Task was marked complete.',
    taskTitle: 'Confirm the venue booking',
    href: '/tasks/task_1',
    occurredAtText: 'Aug 20, 2026, 9:30 a.m. PDT',
    actorLabel: 'The Recipient',
    outcomeBadge: 'Not sent',
    outcomeTone: 'caution',
    outcomeExplanation: 'Rocket tried to email you about this, and the message could not be sent.',
    settledAtText: 'Aug 20, 2026, 9:35 a.m. PDT',
    nextStep: 'Open the Task to see where it stands:',
    ...overrides,
  };
}

function view(overrides: Partial<OwnerMissedNotificationsView> = {}): OwnerMissedNotificationsView {
  return { items: [], batchFilled: false, windowDays: 30, ...overrides };
}

describe('A8.6c Attention section two', () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(requireOwnerPage).mockResolvedValue({
      user: { id: 'owner_1' } as never,
      actor: { kind: 'owner', ownerId: 'owner_1', organizationId: 'org_1' } as never,
      session: {
        ownerId: 'owner_1',
        organizationId: 'org_1',
        role: 'owner',
        displayName: 'Owner',
      } as never,
    });
    vi.mocked(getDb).mockResolvedValue({} as never);
    vi.mocked(loadOwnerAttentionView).mockResolvedValue({ items: [], batchFilled: false });
    vi.mocked(loadOwnerMissedNotificationsView).mockResolvedValue(view());
  });

  describe('page composition', () => {
    it('keeps one page heading and gives each section its own', async () => {
      render(await AttentionPage());
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', { level: 2, name: 'Reminder schedules that stopped' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { level: 2, name: 'Things Rocket could not tell you about' }),
      ).toBeInTheDocument();
    });

    it('scopes both reads to the authenticated session’s organization', async () => {
      await AttentionPage();
      expect(loadOwnerMissedNotificationsView).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org_1' }),
      );
    });

    /** One instant for the render, so both sections describe the same moment. */
    it('passes a single instant rather than letting the read take its own', async () => {
      await AttentionPage();
      const call = vi.mocked(loadOwnerMissedNotificationsView).mock.calls[0]![0];
      expect(call.now).toBeInstanceOf(Date);
    });

    it('authenticates before reading', async () => {
      await AttentionPage();
      expect(requireOwnerPage).toHaveBeenCalledWith('/attention');
      expect(loadOwnerMissedNotificationsView).toHaveBeenCalled();
    });

    /**
     * The page depends on the A8.5 notification tables, which are unapplied in production. A
     * deployment reaching it without them must break visibly: rendering the empty state instead
     * would report "nothing went undelivered" on the strength of a missing table.
     */
    it('lets a database failure reach the boundary instead of degrading to empty', async () => {
      vi.mocked(loadOwnerMissedNotificationsView).mockRejectedValue(
        new Error('Invalid `prisma.ownerNotificationIntent.findMany()` invocation'),
      );
      await expect(AttentionPage()).rejects.toThrow(/ownerNotificationIntent/);
    });
  });

  describe('empty state', () => {
    it('says nothing went undelivered, naming the window it can see', async () => {
      render(await AttentionPage());
      const statuses = screen.getAllByRole('status');
      const missed = statuses[statuses.length - 1]!;
      expect(missed).toHaveTextContent('no undelivered notifications from the last 30 days');
    });

    /**
     * Items leave only by ageing out. Saying so in the empty state pre-empts the reading that an
     * item which vanished on its thirty-first day had been dealt with.
     */
    it('states that items age out and that there is nothing to mark as read', async () => {
      render(await AttentionPage());
      const statuses = screen.getAllByRole('status');
      expect(statuses[statuses.length - 1]!).toHaveTextContent(/nothing to mark as read/i);
    });
  });

  describe('populated state', () => {
    it('states what happened, what became of the email, and when', () => {
      render(<MissedNotificationList view={view({ items: [item()] })} />);
      expect(screen.getByText('This Task was marked complete.')).toBeInTheDocument();
      expect(screen.getByText('Not sent')).toBeInTheDocument();
      expect(
        screen.getByText(/Rocket tried to email you about this, and the message could not be sent/),
      ).toBeInTheDocument();
      expect(screen.getByText(/Happened: Aug 20, 2026/)).toBeInTheDocument();
      expect(screen.getByText(/Rocket stopped trying: Aug 20, 2026/)).toBeInTheDocument();
      expect(screen.getByText(/Caused by: The Recipient/)).toBeInTheDocument();
    });

    it('links to the authenticated Owner Task route, titled by the Task', () => {
      render(<MissedNotificationList view={view({ items: [item()] })} />);
      const link = screen.getByRole('link', { name: 'Confirm the venue booking' });
      expect(link).toHaveAttribute('href', '/tasks/task_1');
    });

    /**
     * A purged subject, or one belonging to another organization, resolves to no Task. The item is
     * still shown: the event happened and the Owner was never told, and hiding it would be the
     * failure this section exists to prevent.
     */
    it('renders an item with no Task, and offers no link for it', () => {
      render(
        <MissedNotificationList
          view={view({
            items: [
              item({
                taskTitle: null,
                href: null,
                nextStep: 'This notification is not linked to a Task you can open.',
              }),
            ],
          })}
        />,
      );
      expect(screen.getByText('This Task was marked complete.')).toBeInTheDocument();
      expect(screen.getByText(/not linked to a Task you can open/)).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('renders one list item per undelivered notification', () => {
      render(
        <MissedNotificationList
          view={view({ items: [item(), item({ headline: 'Rocket lost access to Gmail.' })] })}
        />,
      );
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });

    it('omits the settlement line when there is none', () => {
      render(<MissedNotificationList view={view({ items: [item({ settledAtText: null })] })} />);
      expect(screen.queryByText(/Rocket stopped trying/)).not.toBeInTheDocument();
    });

    it('discloses a capped list rather than truncating in silence', () => {
      render(<MissedNotificationList view={view({ items: [item()], batchFilled: true })} />);
      expect(screen.getByText(/list is capped/i)).toBeInTheDocument();
    });

    it('says nothing about a cap when the batch was not full', () => {
      render(<MissedNotificationList view={view({ items: [item()] })} />);
      expect(screen.queryByText(/list is capped/i)).not.toBeInTheDocument();
    });
  });

  describe('what the section must never offer', () => {
    /**
     * Rocket will not try again, and there is no ratified policy under which it could. A control
     * suggesting otherwise would be a promise the system cannot keep.
     */
    it('offers no resend, dismissal, acknowledgement, or refresh control', () => {
      const { container } = render(
        <MissedNotificationList view={view({ items: [item(), item()] })} />,
      );
      expect(container.querySelector('button')).toBeNull();
      expect(container.querySelector('form')).toBeNull();
      expect(container.querySelector('input')).toBeNull();
      const text = container.textContent?.toLowerCase() ?? '';
      for (const promise of [
        'resend',
        'send again',
        'try again',
        'retry',
        'mark as read',
        'dismiss',
        'acknowledge',
        'refresh',
      ]) {
        expect(text).not.toContain(promise);
      }
    });

    /** The whole page, including section two, still claims no machinery it does not have. */
    it('claims no monitoring, queue, alerting, or automatic updating', async () => {
      vi.mocked(loadOwnerMissedNotificationsView).mockResolvedValue(view({ items: [item()] }));
      const { container } = render(await AttentionPage());
      const text = container.textContent?.toLowerCase() ?? '';
      for (const claim of [
        'monitoring',
        'is monitored',
        'we watch',
        'watching',
        'alerts you',
        'we will alert',
        'notifies you',
        'we will notify',
        'we will let you know',
        'in the queue',
        'queued',
        'updates automatically',
        'automatically updates',
        'refreshes',
        'up to date',
        'checking',
        'syncing',
      ]) {
        expect(text).not.toContain(claim);
      }
    });

    /**
     * No Recipient identity reaches this surface. The actor is a closed category, and the
     * projection has no field an address or a display name could arrive in.
     */
    it('shows an actor category rather than a person', () => {
      render(<MissedNotificationList view={view({ items: [item()] })} />);
      const listItem = screen.getByRole('listitem');
      expect(within(listItem).getByText(/Caused by: The Recipient/)).toBeInTheDocument();
      expect(listItem.textContent).not.toMatch(/@/);
    });
  });
});
