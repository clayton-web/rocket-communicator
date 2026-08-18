import { describe, expect, it } from 'vitest';
import type { components } from '@aicaa/contracts/schema';
import { canReturnFailedAssignmentToOwner } from '@/lib/handoff/client/return-failed-assignment';

type TaskDto = components['schemas']['Task'];

const base: TaskDto = {
  id: 'task_return_elig',
  organizationId: 'org_ui',
  status: 'in_progress',
  priorActionableStatus: null,
  summaryPoints: [],
  sourceReference: { sourceType: 'gmail' },
  dueAt: null,
  waitingUntil: null,
  priority: 'normal',
  derivedUrgency: null,
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
  version: 3,
  etag: '"task-task_return_elig-v3"',
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

const failedAssignment: NonNullable<TaskDto['assignment']> = {
  id: 'asg_failed',
  recipientId: 'rcpt_1',
  intendedRecipientEmail: 'alex@example.com',
  assignedAt: '2026-07-18T01:00:00.000Z',
  assignedByOwnerId: 'owner_1',
  allowedCapabilityActions: ['complete_task'],
  deliveryStatus: 'failed',
};

describe('canReturnFailedAssignmentToOwner', () => {
  it('is true only for a non-terminal Task with a current failed assignment', () => {
    expect(
      canReturnFailedAssignmentToOwner({ ...base, assignment: failedAssignment }),
    ).toBe(true);
  });

  it('is false for sent, pending, unassigned, and terminal Tasks', () => {
    expect(
      canReturnFailedAssignmentToOwner({
        ...base,
        assignment: { ...failedAssignment, deliveryStatus: 'sent' },
      }),
    ).toBe(false);
    expect(
      canReturnFailedAssignmentToOwner({
        ...base,
        assignment: { ...failedAssignment, deliveryStatus: 'pending' },
      }),
    ).toBe(false);
    expect(canReturnFailedAssignmentToOwner(base)).toBe(false);
    expect(
      canReturnFailedAssignmentToOwner({
        ...base,
        status: 'completed',
        assignment: failedAssignment,
      }),
    ).toBe(false);
    expect(
      canReturnFailedAssignmentToOwner({
        ...base,
        status: 'dismissed',
        assignment: failedAssignment,
      }),
    ).toBe(false);
  });
});
