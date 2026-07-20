// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/owner/require-owner-page', () => ({
  requireOwnerPage: vi.fn(),
}));
vi.mock('@/lib/db/server', () => ({
  getDb: vi.fn(),
}));
vi.mock('@/lib/tasks', () => ({
  listOwnerTasks: vi.fn(),
  getOwnerTask: vi.fn(),
}));
vi.mock('@/lib/recipients', () => ({
  listOwnerRecipients: vi.fn(),
}));
vi.mock('@/lib/gmail/service', () => ({
  getGmailConnection: vi.fn(),
}));
vi.mock('@/app/tasks/_components/handoff-panel', () => ({
  HandoffPanel: () => <div data-testid="handoff-panel-stub" />,
}));

import { requireOwnerPage } from '@/lib/owner/require-owner-page';
import { getDb } from '@/lib/db/server';
import { getOwnerTask, listOwnerTasks } from '@/lib/tasks';
import { listOwnerRecipients } from '@/lib/recipients';
import { getGmailConnection } from '@/lib/gmail/service';
import TasksPage from '@/app/tasks/page';
import TaskDetailPage from '@/app/tasks/[taskId]/page';

describe('A7.8 Owner Task pages auth gate', () => {
  beforeEach(() => {
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
    vi.mocked(listOwnerRecipients).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(getGmailConnection).mockResolvedValue({
      status: 'not_connected',
      provider: 'gmail',
      historyState: 'unset',
      pollingIntervalMinutes: 5,
      inboxOnly: true,
      readonlyScope: true,
      canSend: false,
      requiresSendReconsent: false,
    });
  });

  it('loads Task list only after Owner gate', async () => {
    vi.mocked(listOwnerTasks).mockResolvedValue({ items: [], nextCursor: null });
    render(await TasksPage());
    expect(requireOwnerPage).toHaveBeenCalledWith('/tasks');
    expect(listOwnerTasks).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
  });

  it('loads Task detail only after Owner gate with return path', async () => {
    vi.mocked(getOwnerTask).mockResolvedValue({
      id: 'task_1',
      organizationId: 'org_1',
      status: 'open',
      priorActionableStatus: null,
      summaryPoints: [],
      dueAt: null,
      waitingUntil: null,
      priority: 'normal',
      derivedUrgency: 'normal',
      notes: [],
      reminder: { nextReminderAt: null, reminderStage: 0, waitingPaused: false },
      retention: { deleteAfter: '2026-08-18T00:00:00.000Z', policy: 'active_task' },
      version: 1,
      etag: '"task-task_1-v1"',
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
    });
    render(await TaskDetailPage({ params: Promise.resolve({ taskId: 'task_1' }) }));
    expect(requireOwnerPage).toHaveBeenCalledWith('/tasks/task_1');
    expect(listOwnerRecipients).toHaveBeenCalled();
    expect(getGmailConnection).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Task' })).toBeInTheDocument();
    expect(screen.getByTestId('handoff-panel-stub')).toBeInTheDocument();
  });
});
