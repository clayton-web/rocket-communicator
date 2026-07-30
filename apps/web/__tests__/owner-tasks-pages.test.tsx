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
import { TaskDetail } from '@/app/tasks/_components/task-detail';

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

  /**
   * The truthful empty state, asserted here rather than in the browser harness: the browser
   * harness shares one disposable database and one env-configured organization across both
   * viewport projects, so it cannot observe a globally empty Task list without depending on
   * execution order. See docs/P1_2_BROWSER_HARNESS.md ("Known gaps").
   */
  it('renders the empty Task list state distinctly from a failure or a populated list', async () => {
    vi.mocked(listOwnerTasks).mockResolvedValue({ items: [], nextCursor: null });

    render(await TasksPage());

    expect(screen.getByRole('status')).toHaveTextContent('No Tasks yet.');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByText('Tasks could not be loaded')).not.toBeInTheDocument();
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

  it('renders Recipient notes and completion outcome note for the Owner', () => {
    render(
      <TaskDetail
        task={{
          id: 'task_notes_1',
          organizationId: 'org_1',
          status: 'completed',
          priorActionableStatus: null,
          summaryPoints: [
            {
              id: 'sp1',
              kind: 'request',
              label: 'Request',
              order: 0,
              value: 'Controlled completion',
            },
          ],
          dueAt: null,
          waitingUntil: null,
          priority: 'normal',
          derivedUrgency: 'normal',
          notes: [
            {
              id: 'note_1',
              body: 'Recipient typed note before completion',
              createdAt: '2026-07-28T18:30:13.960Z',
              attribution: {
                kind: 'capability',
                capability: {
                  capabilityId: 'cap_1',
                  assignmentId: 'asg_1',
                  taskId: 'task_notes_1',
                  intendedRecipientEmail: 'recipient@example.com',
                  action: 'add_task_note',
                  recordedAt: '2026-07-28T18:30:13.960Z',
                  outcome: 'succeeded',
                  resourceVersion: 3,
                  taskStatus: 'open',
                  attributionLabel:
                    'Action performed through capability link assigned to recipient@example.com (add task note)',
                },
              },
            },
          ],
          outcome: {
            outcomeType: 'completed',
            completedAt: '2026-07-28T18:30:45.463Z',
            note: 'Done via capability complete note',
            attribution: {
              kind: 'capability',
              capability: {
                capabilityId: 'cap_1',
                assignmentId: 'asg_1',
                taskId: 'task_notes_1',
                intendedRecipientEmail: 'recipient@example.com',
                action: 'complete_task',
                recordedAt: '2026-07-28T18:30:45.463Z',
                outcome: 'succeeded',
                resourceVersion: 5,
                taskStatus: 'completed',
                attributionLabel:
                  'Action performed through capability link assigned to recipient@example.com (complete task)',
              },
            },
          },
          reminder: { nextReminderAt: null, reminderStage: 0, waitingPaused: false },
          retention: { deleteAfter: '2026-08-18T00:00:00.000Z', policy: 'active_task' },
          version: 5,
          etag: '"task-task_notes_1-v5"',
          createdAt: '2026-07-28T18:00:00.000Z',
          updatedAt: '2026-07-28T18:30:45.463Z',
        }}
        initialRecipients={[]}
        recipientsNextCursor={null}
        initialConnection={{
          status: 'connected',
          provider: 'gmail',
          historyState: 'valid',
          pollingIntervalMinutes: 5,
          inboxOnly: true,
          readonlyScope: true,
          canSend: true,
          requiresSendReconsent: false,
        }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByText('Recipient typed note before completion')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Completion' })).toBeInTheDocument();
    expect(screen.getByText('Done via capability complete note')).toBeInTheDocument();
    expect(screen.getByText(/Outcome: completed/)).toBeInTheDocument();

    const rendered = document.body.textContent ?? '';
    expect(rendered).not.toMatch(/cap_[A-Za-z0-9_-]{20,}/);
    expect(rendered).not.toContain('/c/');
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
