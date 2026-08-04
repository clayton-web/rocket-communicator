// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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
// A8.6c added a second section to this page. These tests are about the first one, so the second
// is stubbed empty; its own behaviour is covered in `a8-6c-attention-missed-section.test.tsx`.
vi.mock('@/lib/notifications/missed-notifications-service', () => ({
  loadOwnerMissedNotificationsView: vi.fn(),
  MISSED_NOTIFICATION_LIMIT: 50,
  MISSED_NOTIFICATION_WINDOW_DAYS: 30,
}));

import { requireOwnerPage } from '@/lib/owner/require-owner-page';
import { getDb } from '@/lib/db/server';
import { loadOwnerMissedNotificationsView } from '@/lib/notifications/missed-notifications-service';
import { loadOwnerAttentionView } from '@/lib/reminders/attention-service';
import AttentionPage from '@/app/(owner)/attention/page';
import AttentionLoading from '@/app/(owner)/attention/loading';
import AttentionError from '@/app/(owner)/attention/error';
import { AttentionList } from '@/app/(owner)/attention/_components/attention-list';
import type { OwnerAttentionItem, OwnerAttentionView } from '@/lib/reminders/attention';

/**
 * A8.6a — the `/attention` surface.
 *
 * The P1.4 page was a placeholder that read nothing and said so. These tests hold the two things
 * that survived that replacement: the page is still authenticated before it reads, and it still
 * refuses to imply machinery it does not have. What changed is that it now answers a question, and
 * the empty and error states have to be distinguishable — "nothing needs you" and "I could not find
 * out" are opposite messages, and a page about stopped automation must never confuse them.
 */

function item(overrides: Partial<OwnerAttentionItem> = {}): OwnerAttentionItem {
  return {
    taskId: 'task_1',
    taskTitle: 'Confirm the venue booking',
    href: '/tasks/task_1',
    badge: 'Reminders stopped',
    badgeTone: 'critical',
    headline: 'Reminders stopped after a delivery failure.',
    explanation: 'A reminder could not be delivered, so Rocket stopped rather than continuing.',
    dueDateText: 'Aug 10, 2026',
    ...overrides,
  };
}

function view(overrides: Partial<OwnerAttentionView> = {}): OwnerAttentionView {
  return { items: [], batchFilled: false, ...overrides };
}

describe('A8.6a Attention page', () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(requireOwnerPage).mockResolvedValue({
      user: { id: 'owner_1' } as never,
      actor: { kind: 'owner', ownerId: 'owner_1', organizationId: 'org_1' },
      session: {
        ownerId: 'owner_1',
        organizationId: 'org_1',
        role: 'owner',
        displayName: 'Owner',
      },
    });
    vi.mocked(getDb).mockResolvedValue({} as never);
    vi.mocked(loadOwnerAttentionView).mockResolvedValue(view());
    vi.mocked(loadOwnerMissedNotificationsView).mockResolvedValue({
      items: [],
      batchFilled: false,
      windowDays: 30,
    });
  });

  describe('authentication and scoping', () => {
    it('gates on the Owner session before reading anything', async () => {
      render(await AttentionPage());
      expect(requireOwnerPage).toHaveBeenCalledWith('/attention');
      expect(loadOwnerAttentionView).toHaveBeenCalled();
    });

    /** The organization comes from the session. Nothing on this route accepts one as input. */
    it('scopes the read to the authenticated session’s organization', async () => {
      await AttentionPage();
      expect(loadOwnerAttentionView).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org_1' }),
      );
    });
  });

  describe('populated state', () => {
    it('names the Task, says why it needs attention, and shows the due date', async () => {
      vi.mocked(loadOwnerAttentionView).mockResolvedValue(view({ items: [item()] }));
      render(await AttentionPage());

      expect(screen.getByText('Confirm the venue booking')).toBeInTheDocument();
      expect(screen.getByText('Reminders stopped after a delivery failure.')).toBeInTheDocument();
      expect(screen.getByText(/Aug 10, 2026/)).toBeInTheDocument();
      expect(screen.getByText('Reminders stopped')).toBeInTheDocument();
    });

    it('links each item to the authenticated Owner Task route', async () => {
      vi.mocked(loadOwnerAttentionView).mockResolvedValue(
        view({ items: [item({ taskId: 'task_42', href: '/tasks/task_42' })] }),
      );
      render(await AttentionPage());

      const links = screen.getAllByRole('link');
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute('href', '/tasks/task_42');
    });

    it('renders one list item per attention row', async () => {
      vi.mocked(loadOwnerAttentionView).mockResolvedValue(
        view({
          items: [item({ taskId: 'task_1' }), item({ taskId: 'task_2' })],
        }),
      );
      render(await AttentionPage());
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });

    it('discloses a capped list rather than truncating in silence', () => {
      render(<AttentionList view={view({ items: [item()], batchFilled: true })} />);
      expect(screen.getByText(/list is capped/i)).toBeInTheDocument();
    });

    it('says nothing about a cap when the batch was not full', () => {
      render(<AttentionList view={view({ items: [item()], batchFilled: false })} />);
      expect(screen.queryByText(/list is capped/i)).not.toBeInTheDocument();
    });

    it('omits the due date line for a Task that no longer has one', () => {
      render(<AttentionList view={view({ items: [item({ dueDateText: null })] })} />);
      expect(screen.queryByText(/Due date:/)).not.toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('states plainly that nothing needs attention, and announces it', async () => {
      render(await AttentionPage());
      // `role="status"` so the emptiness is announced after a navigation, rather than leaving a
      // screen-reader user with silence they cannot tell apart from a still-loading page. The page
      // carries one per section since A8.6c; this is the reminder one.
      expect(screen.getAllByRole('status')[0]).toHaveTextContent(
        'No reminder schedule needs your attention.',
      );
    });

    /**
     * The P1.4 constraint, kept.
     *
     * The page reads now, but it still does not watch, queue, count, or refresh, so it still must
     * not imply any of those. An Owner who believes this page is a monitor will stop checking it.
     */
    it('claims no monitoring, queue, alerting, or automatic updating', async () => {
      const { container } = render(await AttentionPage());
      const text = container.textContent?.toLowerCase() ?? '';

      /*
       * Affirmative claims only. A bare "monitor" would flag the page's own denial — "this page
       * does not monitor anything" is the sentence that makes it honest — so the assertion has to
       * distinguish the claim from its negation rather than ban the vocabulary.
       */
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

    it('tells the Owner the page does not update by itself', async () => {
      render(await AttentionPage());
      expect(screen.getAllByRole('status')[0]).toHaveTextContent(/does not monitor anything/i);
    });

    it('replaces the P1.4 placeholder copy entirely', async () => {
      const { container } = render(await AttentionPage());
      const text = container.textContent ?? '';
      expect(text).not.toContain('There is nothing to show here.');
      expect(text).not.toContain('Neither is built yet');
    });
  });

  describe('scope honesty', () => {
    /**
     * The list has to name what it can see, or its silence becomes a claim (D112).
     *
     * Until A8.6c this list owned the page heading and qualified it in the description — "this
     * page covers reminder automation only" — because "Attention" over a reminder-only list
     * implied the absence of everything else. It is now one section of two, so the same
     * requirement is met by its own heading: an empty list under "Reminder schedules that stopped"
     * claims nothing about anything else on the page.
     */
    it('names its own scope in its heading rather than claiming the page', () => {
      render(<AttentionList view={view()} />);
      expect(
        screen.getByRole('heading', { level: 2, name: 'Reminder schedules that stopped' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('says only that it is loading, pre-empting neither answer', () => {
      render(<AttentionLoading />);
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('Loading Attention…');
      const text = status.textContent?.toLowerCase() ?? '';
      expect(text).not.toContain('nothing');
      expect(text).not.toContain('checking');
    });
  });

  describe('error state', () => {
    /**
     * The distinction the whole boundary exists for. A failed attention read is not an all-clear,
     * and an Owner who reads it as one stops looking for the problem it could not tell them about.
     */
    it('refuses to be read as an all-clear', () => {
      render(<AttentionError error={new Error('boom')} reset={() => {}} />);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/cannot tell you whether/i);
      expect(alert).toHaveTextContent(/not read this as an all-clear/i);
    });

    it('states that nothing was changed, since the page only reads', () => {
      render(<AttentionError error={new Error('boom')} reset={() => {}} />);
      expect(screen.getByText(/Nothing was changed/i)).toBeInTheDocument();
    });

    it('offers an explicit retry rather than retrying on its own', () => {
      const reset = vi.fn();
      render(<AttentionError error={new Error('boom')} reset={reset} />);
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('never shows the raw error, but offers the digest for support', () => {
      const error = Object.assign(new Error('Can’t reach database server at db.internal:5432'), {
        digest: 'abc123',
      });
      const { container } = render(<AttentionError error={error} reset={() => {}} />);
      expect(container.textContent).not.toContain('db.internal');
      expect(screen.getByText('abc123')).toBeInTheDocument();
    });

    /**
     * `/attention` depends on the A8.3a migration chain, which is unapplied in production. A
     * deployment reaching this page without it must break visibly rather than render the empty
     * state, which would report "nothing needs your attention" on the strength of a missing table.
     */
    it('lets a database failure reach the boundary instead of degrading to empty', async () => {
      const failure = new Error(
        'Invalid `prisma.taskReminderSchedule.findMany()` invocation: table does not exist',
      );
      failure.name = 'PrismaClientKnownRequestError';
      vi.mocked(loadOwnerAttentionView).mockRejectedValue(failure);

      await expect(AttentionPage()).rejects.toThrow(/taskReminderSchedule/);
    });
  });
});
