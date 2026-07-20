// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@aicaa/contracts/schema';
import { HandoffPanel } from '@/app/tasks/_components/handoff-panel';
import { HandoffConfirmationDialog } from '@/app/tasks/_components/handoff-confirmation-dialog';

type TaskDto = components['schemas']['Task'];

const task: TaskDto = {
  id: 'task_handoff_ui_1',
  organizationId: 'org_ui',
  status: 'open',
  priorActionableStatus: null,
  summaryPoints: [
    {
      id: 'p1',
      kind: 'next_action',
      label: 'Call back',
      order: 0,
      value: 'Call the vendor',
    },
  ],
  sourceReference: { sourceType: 'manual' },
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
    deleteAfter: '2026-08-18T00:00:00.000Z',
    policy: 'active_task',
  },
  version: 1,
  etag: '"task-task_handoff_ui_1-v1"',
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

const gmailTask: TaskDto = {
  ...task,
  id: 'task_handoff_ui_gmail',
  etag: '"task-task_handoff_ui_gmail-v1"',
  sourceReference: { sourceType: 'gmail' },
};

const recipient = {
  id: 'rcpt_1',
  displayName: 'Alex Recipient',
  email: 'alex@example.com',
  active: true,
  assignmentCategories: [],
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

vi.mock('@/lib/owner/api-client', () => ({
  fetchActiveRecipients: vi.fn(),
  fetchGmailConnection: vi.fn(),
  fetchOwnerTask: vi.fn(),
  postTaskHandoff: vi.fn(),
  startGmailOAuthNavigation: vi.fn(),
}));

import {
  fetchActiveRecipients,
  fetchGmailConnection,
  fetchOwnerTask,
  postTaskHandoff,
  startGmailOAuthNavigation,
} from '@/lib/owner/api-client';

describe('A7.8 Owner handoff panel', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.mocked(fetchActiveRecipients).mockResolvedValue({
      ok: true,
      data: { items: [recipient], nextCursor: null },
    });
    vi.mocked(fetchGmailConnection).mockResolvedValue({
      ok: true,
      data: {
        status: 'connected',
        provider: 'gmail',
        historyState: 'valid',
        pollingIntervalMinutes: 5,
        inboxOnly: true,
        readonlyScope: true,
        canSend: true,
        requiresSendReconsent: false,
      },
    });
    vi.mocked(fetchOwnerTask).mockResolvedValue({ ok: true, data: task });
    vi.mocked(postTaskHandoff).mockReset();
    vi.mocked(startGmailOAuthNavigation).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  const connectionOk = {
    status: 'connected' as const,
    provider: 'gmail' as const,
    historyState: 'valid' as const,
    pollingIntervalMinutes: 5,
    inboxOnly: true,
    readonlyScope: true,
    canSend: true,
    requiresSendReconsent: false,
  };

  function renderPanel(initialTask = task, connection = connectionOk) {
    return render(
      <HandoffPanel
        initialTask={initialTask}
        initialRecipients={[recipient]}
        recipientsNextCursor={null}
        initialConnection={connection}
      />,
    );
  }

  it('shows handoff for eligible unassigned Task and requires checkbox before confirm', async () => {
    renderPanel();
    await screen.findByLabelText('Recipient');
    fireEvent.change(screen.getByLabelText('Recipient'), { target: { value: 'rcpt_1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand off…' }));
    expect(screen.getByRole('dialog', { name: 'Confirm handoff' })).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm handoff' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByLabelText('I confirm I want to hand off this Task'));
    expect(confirm).toBeEnabled();
  });

  it('submits exact body with If-Match and stable Idempotency-Key; no deliveryPath', async () => {
    vi.mocked(postTaskHandoff).mockResolvedValue({
      ok: true,
      data: {
        task: { ...task, assignment: undefined, version: 2, etag: '"task-task_handoff_ui_1-v2"' },
        deliveryPath: 'assignment_email',
        deliveryStatus: 'sent',
        recipient,
        capabilityId: 'cap_opaque',
        requiresSendReconsent: false,
        idempotentReplay: false,
      },
    });
    vi.mocked(fetchOwnerTask).mockResolvedValue({
      ok: true,
      data: {
        ...task,
        version: 2,
        etag: '"task-task_handoff_ui_1-v2"',
        assignment: {
          id: 'asg_1',
          recipientId: 'rcpt_1',
          intendedRecipientEmail: 'alex@example.com',
          assignedAt: '2026-07-18T01:00:00.000Z',
          assignedByOwnerId: 'owner_1',
          allowedCapabilityActions: ['complete_task'],
          deliveryStatus: 'sent',
        },
      },
    });

    renderPanel();
    fireEvent.change(screen.getByLabelText('Recipient'), { target: { value: 'rcpt_1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand off…' }));
    fireEvent.click(screen.getByLabelText('I confirm I want to hand off this Task'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm handoff' }));

    await waitFor(() => expect(postTaskHandoff).toHaveBeenCalledTimes(1));
    const arg = vi.mocked(postTaskHandoff).mock.calls[0]![0]!;
    expect(arg.ifMatch).toBe('"task-task_handoff_ui_1-v1"');
    expect(arg.recipientId).toBe('rcpt_1');
    expect(arg.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.stringify(arg)).not.toContain('deliveryPath');
    expect(window.sessionStorage.getItem('aicaa.handoff.pending.v1:task_handoff_ui_1')).toBeNull();
    expect(await screen.findByText(/Assignment sent to Alex Recipient/i)).toBeInTheDocument();
  });

  it('uses Gmail explanatory copy for gmail source without submitting delivery fields', async () => {
    renderPanel(gmailTask);
    expect(
      screen.getByText(/original Gmail message and its available attachments/i),
    ).toBeInTheDocument();
  });

  it('Escape closes confirmation without mutation', async () => {
    render(
      <HandoffConfirmationDialog
        open
        recipientLabel="Alex"
        deliveryExplanation="Assignment email copy"
        submitting={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const onCancel = vi.fn();
    cleanup();
    const cancel = vi.fn();
    const confirm = vi.fn();
    render(
      <HandoffConfirmationDialog
        open
        recipientLabel="Alex"
        deliveryExplanation="Assignment email copy"
        submitting={false}
        onCancel={cancel}
        onConfirm={confirm}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(cancel).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    void onCancel;
  });

  it('starts OAuth via navigation helper with Task returnPath only', async () => {
    renderPanel(task, {
      ...connectionOk,
      canSend: false,
      requiresSendReconsent: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Grant Gmail send access' }));
    expect(startGmailOAuthNavigation).toHaveBeenCalledWith('/tasks/task_handoff_ui_1');
    const path = vi.mocked(startGmailOAuthNavigation).mock.calls[0]![0]!;
    expect(path).not.toContain('Idempotency');
    expect(path).not.toContain('rcpt_');
  });

  it('does not auto-send after OAuth return; requires Retry handoff', async () => {
    window.sessionStorage.setItem(
      'aicaa.handoff.pending.v1:task_handoff_ui_1',
      JSON.stringify({
        version: 1,
        taskId: 'task_handoff_ui_1',
        recipientId: 'rcpt_1',
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
        originalIfMatch: '"task-task_handoff_ui_1-v1"',
        acknowledgement: 'handoff_confirmed_v1',
        createdAt: new Date().toISOString(),
        reconsentPending: true,
        lastOutcomeCategory: 'reconsent_required',
      }),
    );
    const url = new URL('http://localhost/tasks/task_handoff_ui_1?gmail=connected');
    window.history.pushState({}, '', url.pathname + url.search);

    renderPanel();
    expect(await screen.findByText(/Gmail permissions updated/i)).toBeInTheDocument();
    expect(postTaskHandoff).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry handoff' })).toBeInTheDocument();
    expect(window.location.search).not.toContain('gmail=');
  });

  it('keeps same key and original ETag on retryable failure', async () => {
    vi.mocked(postTaskHandoff)
      .mockResolvedValueOnce({
        ok: false,
        error: {
          status: 503,
          code: 'HANDOFF_DELIVERY_FAILED',
          message: 'Temporary Gmail problem.',
          outcomeCategory: 'retryable_failure',
          allowSameKeyRetry: true,
          allowNewOperation: false,
          refetchTask: false,
          refetchRecipients: false,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          task,
          deliveryPath: 'assignment_email',
          deliveryStatus: 'sent',
          recipient,
          capabilityId: 'cap_1',
          requiresSendReconsent: false,
          idempotentReplay: false,
        },
      });
    vi.mocked(fetchOwnerTask).mockResolvedValue({
      ok: true,
      data: {
        ...task,
        assignment: {
          id: 'asg_1',
          recipientId: 'rcpt_1',
          intendedRecipientEmail: 'alex@example.com',
          assignedAt: '2026-07-18T01:00:00.000Z',
          assignedByOwnerId: 'owner_1',
          allowedCapabilityActions: ['complete_task'],
          deliveryStatus: 'sent',
        },
      },
    });

    renderPanel();
    fireEvent.change(screen.getByLabelText('Recipient'), { target: { value: 'rcpt_1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand off…' }));
    fireEvent.click(screen.getByLabelText('I confirm I want to hand off this Task'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm handoff' }));
    await screen.findByRole('button', { name: 'Retry handoff' });
    const firstKey = vi.mocked(postTaskHandoff).mock.calls[0]![0]!.idempotencyKey;
    const firstEtag = vi.mocked(postTaskHandoff).mock.calls[0]![0]!.ifMatch;
    fireEvent.click(screen.getByRole('button', { name: 'Retry handoff' }));
    await waitFor(() => expect(postTaskHandoff).toHaveBeenCalledTimes(2));
    expect(vi.mocked(postTaskHandoff).mock.calls[1]![0]!.idempotencyKey).toBe(firstKey);
    expect(vi.mocked(postTaskHandoff).mock.calls[1]![0]!.ifMatch).toBe(firstEtag);
  });

  it('shows unresolved wording for in-progress and does not offer new-key restart', async () => {
    vi.mocked(postTaskHandoff).mockResolvedValue({
      ok: false,
      error: {
        status: 409,
        code: 'HANDOFF_IN_PROGRESS',
        message: 'This handoff is still unresolved. We will not start another delivery.',
        outcomeCategory: 'in_progress',
        allowSameKeyRetry: true,
        allowNewOperation: false,
        refetchTask: false,
        refetchRecipients: false,
      },
    });
    renderPanel();
    fireEvent.change(screen.getByLabelText('Recipient'), { target: { value: 'rcpt_1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand off…' }));
    fireEvent.click(screen.getByLabelText('I confirm I want to hand off this Task'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm handoff' }));
    expect(await screen.findByText(/still unresolved/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check handoff status' })).toBeInTheDocument();
    expect(screen.queryByText(/start over/i)).not.toBeInTheDocument();
  });

  it('hides initial handoff when Task is already assigned', async () => {
    const assigned: TaskDto = {
      ...task,
      assignment: {
        id: 'asg_1',
        recipientId: 'rcpt_1',
        intendedRecipientEmail: 'alex@example.com',
        assignedAt: '2026-07-18T01:00:00.000Z',
        assignedByOwnerId: 'owner_1',
        allowedCapabilityActions: ['complete_task'],
        deliveryStatus: 'sent',
      },
    };
    renderPanel(assigned);
    expect(screen.queryByRole('button', { name: 'Hand off…' })).not.toBeInTheDocument();
    expect(screen.getByText(/Assigned to alex@example.com/i)).toBeInTheDocument();
  });

  it('does not write Recipient email or summary into sessionStorage', async () => {
    vi.mocked(postTaskHandoff).mockResolvedValue({
      ok: false,
      error: {
        status: 503,
        code: 'HANDOFF_DELIVERY_FAILED',
        message: 'Temporary',
        outcomeCategory: 'retryable_failure',
        allowSameKeyRetry: true,
        allowNewOperation: false,
        refetchTask: false,
        refetchRecipients: false,
      },
    });
    renderPanel();
    fireEvent.change(screen.getByLabelText('Recipient'), { target: { value: 'rcpt_1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand off…' }));
    fireEvent.click(screen.getByLabelText('I confirm I want to hand off this Task'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm handoff' }));
    await waitFor(() =>
      expect(
        window.sessionStorage.getItem('aicaa.handoff.pending.v1:task_handoff_ui_1'),
      ).toBeTruthy(),
    );
    const raw = window.sessionStorage.getItem('aicaa.handoff.pending.v1:task_handoff_ui_1')!;
    expect(raw).not.toContain('alex@example.com');
    expect(raw).not.toContain('Call the vendor');
  });
});
