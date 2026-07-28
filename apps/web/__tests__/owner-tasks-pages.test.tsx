// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
import TasksError from '@/app/tasks/error';

/** Shape of the production failure: Prisma could not reach the configured database host. */
function unreachableDatabaseError(): Error {
  const error = new Error(
    "Invalid `prisma.task.findMany()` invocation: Can't reach database server at `db.example-ref.supabase.co:6543`",
  );
  error.name = 'PrismaClientInitializationError';
  return error;
}

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

describe('Owner Task pages surface database failures', () => {
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
  });

  beforeEach(() => {
    cleanup();
  });

  it('propagates an unreachable database instead of rendering an empty Task list', async () => {
    vi.mocked(listOwnerTasks).mockRejectedValue(unreachableDatabaseError());

    await expect(TasksPage()).rejects.toThrow(/prisma\.task\.findMany/);
    expect(listOwnerTasks).toHaveBeenCalled();
    expect(screen.queryByText('No Tasks yet.')).not.toBeInTheDocument();
  });

  it('propagates an unreachable database from the Task detail page', async () => {
    vi.mocked(getOwnerTask).mockRejectedValue(unreachableDatabaseError());

    await expect(TaskDetailPage({ params: Promise.resolve({ taskId: 'task_1' }) })).rejects.toThrow(
      /prisma\.task\.findMany/,
    );
  });

  it('renders an actionable error state with a retry action', () => {
    const reset = vi.fn();
    render(<TasksError error={unreachableDatabaseError()} reset={reset} />);

    expect(screen.getByRole('heading', { name: 'Tasks could not be loaded' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('never leaks database connection details into the rendered error state', () => {
    const error = Object.assign(unreachableDatabaseError(), { digest: '3336928674' });
    render(<TasksError error={error} reset={vi.fn()} />);

    const rendered = document.body.textContent ?? '';
    expect(rendered).not.toContain('supabase.co');
    expect(rendered).not.toContain('6543');
    expect(rendered).not.toContain('prisma.task.findMany');
    expect(rendered).toContain('3336928674');
  });
});
