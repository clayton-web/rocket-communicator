import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@aicaa/contracts/schema';
import {
  CapabilityUnavailableView,
  RecipientCapabilityPanel,
} from '@/app/c/[token]/recipient-capability-panel';
import CapabilityTokenPage, { metadata as pageMetadata } from '@/app/c/[token]/page';

type TaskDto = components['schemas']['Task'];

vi.mock('@/lib/capability/page-load', () => ({
  loadCapabilityPageView: vi.fn(),
}));

import { loadCapabilityPageView } from '@/lib/capability/page-load';

const token = 'capability-token-value-32chars-min!!';

function baseTask(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'task_ui_1',
    organizationId: 'org_ui',
    status: 'open',
    priorActionableStatus: null,
    summaryPoints: [
      {
        id: 'p1',
        kind: 'next_action',
        label: 'Next',
        order: 0,
        value: 'Follow up with the customer',
      },
    ],
    assignment: {
      id: 'asg_ui_1',
      recipientId: 'rcp_ui',
      intendedRecipientEmail: 'recipient@example.com',
      assignedAt: '2026-07-13T19:00:00.000Z',
      assignedByOwnerId: 'owner_ui',
      allowedCapabilityActions: [
        'view_assigned_task',
        'mark_task_waiting',
        'complete_task',
        'add_task_note',
        'return_task_to_owner',
        'request_clarification',
        'submit_work_request',
      ],
      activeCapabilityId: 'cap_ui_1',
    },
    dueAt: null,
    waitingUntil: null,
    priority: 'normal',
    derivedUrgency: 'normal',
    notes: [],
    reminder: {
      nextReminderAt: null,
      reminderStage: 0,
      waitingPaused: false,
    },
    retention: {
      deleteAfter: '2026-08-12T19:00:00.000Z',
      policy: 'active_task',
    },
    version: 2,
    etag: '"task-task_ui_1-v2"',
    createdAt: '2026-07-13T19:00:00.000Z',
    updatedAt: '2026-07-13T19:00:00.000Z',
    ...overrides,
  };
}

describe('Recipient capability page UI', () => {
  beforeEach(() => {
    vi.mocked(loadCapabilityPageView).mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => baseTask({ version: 3, etag: '"task-task_ui_1-v3"', status: 'waiting' }),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('exports noindex metadata and robots protections', () => {
    expect(pageMetadata.robots).toMatchObject({ index: false, follow: false });
    expect(pageMetadata.referrer).toBe('no-referrer');
  });

  it('renders unavailable for invalid capability without Owner session', async () => {
    vi.mocked(loadCapabilityPageView).mockResolvedValue({ ok: false, reason: 'unavailable' });
    render(await CapabilityTokenPage({ params: Promise.resolve({ token }) }));
    expect(screen.getByRole('heading', { name: 'Link unavailable' })).toBeInTheDocument();
    expect(screen.queryByText(token)).not.toBeInTheDocument();
  });

  it('renders assigned task and scoped actions for a valid capability', async () => {
    const task = baseTask();
    vi.mocked(loadCapabilityPageView).mockResolvedValue({
      ok: true,
      task,
      permittedActions: [
        'view_assigned_task',
        'add_task_note',
        'return_task_to_owner',
        'complete_task',
      ],
      expiresAt: '2026-07-20T19:00:00.000Z',
    });
    render(await CapabilityTokenPage({ params: Promise.resolve({ token }) }));

    expect(screen.getByRole('heading', { name: 'Assigned task' })).toBeInTheDocument();
    expect(screen.getByText('Follow up with the customer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return to owner' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark waiting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Snooze' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(screen.queryByText(token)).not.toBeInTheDocument();
  });

  it('requires confirmation before POSTing and cancels without requesting', async () => {
    render(
      <RecipientCapabilityPanel
        token={token}
        initialTask={baseTask()}
        permittedActions={['view_assigned_task', 'add_task_note']}
        expiresAt="2026-07-20T19:00:00.000Z"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends confirmation, If-Match, and refreshes task state on success', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        baseTask({
          version: 3,
          etag: '"task-task_ui_1-v3"',
          notes: [
            {
              id: 'note_1',
              body: 'Typed note from recipient',
              createdAt: '2026-07-13T19:05:00.000Z',
              attribution: {
                kind: 'capability',
                capability: {
                  capabilityId: 'cap_ui_1',
                  assignmentId: 'asg_ui_1',
                  taskId: 'task_ui_1',
                  intendedRecipientEmail: 'recipient@example.com',
                  action: 'add_task_note',
                  recordedAt: '2026-07-13T19:05:00.000Z',
                  outcome: 'succeeded',
                },
              },
            },
          ],
        }),
    } as Response);

    render(
      <RecipientCapabilityPanel
        token={token}
        initialTask={baseTask()}
        permittedActions={['view_assigned_task', 'add_task_note']}
        expiresAt="2026-07-20T19:00:00.000Z"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    fireEvent.change(screen.getByLabelText('Note'), {
      target: { value: 'Typed note from recipient' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(`/api/v1/capabilities/${encodeURIComponent(token)}/tasks/`);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['if-match']).toBe('"task-task_ui_1-v2"');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      body: 'Typed note from recipient',
      confirmation: 'confirmed',
    });
    expect(init?.referrerPolicy).toBe('no-referrer');

    await waitFor(() => {
      expect(screen.getByText('Typed note from recipient')).toBeInTheDocument();
    });
  });

  it('reloads on 412 without retrying the mutation', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 412,
        json: async () => ({ error: { code: 'PRECONDITION_FAILED', message: 'stale' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () =>
          baseTask({
            version: 4,
            etag: '"task-task_ui_1-v4"',
            status: 'in_progress',
            summaryPoints: [
              {
                id: 'p1',
                kind: 'next_action',
                label: 'Next',
                order: 0,
                value: 'Updated instructions',
              },
            ],
          }),
      } as Response);

    render(
      <RecipientCapabilityPanel
        token={token}
        initialTask={baseTask()}
        permittedActions={['view_assigned_task', 'add_task_note']}
        expiresAt="2026-07-20T19:00:00.000Z"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'stale attempt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/tasks/task_ui_1');
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('GET');
    await waitFor(() => {
      expect(screen.getByText('Updated instructions')).toBeInTheDocument();
      expect(
        screen.getByText('The task was updated. Please review the latest details and try again.'),
      ).toBeInTheDocument();
    });
  });

  it('shows return success and disables further actions', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        baseTask({
          assignment: undefined,
          version: 3,
          etag: '"task-task_ui_1-v3"',
        }),
    } as Response);

    render(
      <RecipientCapabilityPanel
        token={token}
        initialTask={baseTask()}
        permittedActions={['view_assigned_task', 'return_task_to_owner']}
        expiresAt="2026-07-20T19:00:00.000Z"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Return to owner' }));
    expect(screen.getByText(/Returning this assignment ends your access/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Returned to owner' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Return to owner' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('explains work request does not create a task', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        suggestion: {
          id: 'sug_1',
          organizationId: 'org_ui',
          status: 'pending',
          summaryPoints: baseTask().summaryPoints,
          sourceReference: undefined,
          proposedRecipientId: null,
          proposedDueAt: null,
          proposedPriority: 'normal',
          voiceOriginated: false,
          mergedIntoTaskId: null,
          retention: baseTask().retention,
          version: 1,
          etag: '"task-suggestion-sug_1-v1"',
          createdAt: '2026-07-13T19:10:00.000Z',
          updatedAt: '2026-07-13T19:10:00.000Z',
        },
        task: baseTask({ version: 3, etag: '"task-task_ui_1-v3"' }),
      }),
    } as Response);

    render(
      <RecipientCapabilityPanel
        token={token}
        initialTask={baseTask()}
        permittedActions={['view_assigned_task', 'submit_work_request']}
        expiresAt="2026-07-20T19:00:00.000Z"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Submit work request' }));
    expect(screen.getByText(/pending suggestion, not a new assigned task/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Please schedule a visit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(
        screen.getByText('Work request submitted for owner review. No new task was created.'),
      ).toBeInTheDocument();
    });
  });

  it('shows the same unavailable copy for CapabilityUnavailableView', () => {
    render(<CapabilityUnavailableView />);
    expect(screen.getByRole('heading', { name: 'Link unavailable' })).toBeInTheDocument();
  });
});
