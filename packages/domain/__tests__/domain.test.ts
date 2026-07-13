import { describe, expect, it } from 'vitest';
import {
  asAssignmentId,
  asCapabilityId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  asTaskSuggestionId,
  approveTaskSuggestion,
  assertGetDoesNotMutate,
  assertMatchingPrecondition,
  assertVoiceCannotCreateTask,
  can,
  canCapability,
  capabilityAttributionLabel,
  completeTask,
  computeExcerptPurgeAt,
  computeFailedAudioDeleteAt,
  deriveTaskUrgency,
  dismissTaskSuggestion,
  DomainError,
  formatETag,
  markTaskWaiting,
  mergeTaskSuggestion,
  ownerActor,
  parseETag,
  resumeTask,
  startTask,
  toUtcInstant,
  validateSummaryPoints,
  type CapabilityActor,
  type Task,
  type TaskSuggestion,
} from '../src/index.js';

const owner = ownerActor(asOwnerId('owner_1'), asOrganizationId('org_1'));

const capabilityActor: CapabilityActor = {
  kind: 'capability',
  capabilityId: asCapabilityId('cap_1'),
  taskId: asTaskId('task_1'),
  assignmentId: asAssignmentId('asg_1'),
  intendedRecipientEmail: 'recipient@example.com',
  allowedActions: [
    'view_assigned_task',
    'complete_task',
    'mark_task_waiting',
    'add_task_note',
    'return_task_to_owner',
    'request_clarification',
  ],
  status: 'active',
  expiresAt: '2026-07-20T12:00:00.000Z',
};

const now = '2026-07-13T12:00:00.000Z';

function baseSuggestion(overrides: Partial<TaskSuggestion> = {}): TaskSuggestion {
  return {
    id: asTaskSuggestionId('sug_1'),
    organizationId: asOrganizationId('org_1'),
    status: 'pending',
    summaryPoints: [
      { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Do the thing' },
    ],
    voiceOriginated: false,
    retention: {},
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: asTaskId('task_1'),
    organizationId: asOrganizationId('org_1'),
    status: 'open',
    summaryPoints: [
      { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Do the thing' },
    ],
    notes: [],
    reminder: { paused: false },
    retention: {},
    version: 1,
    createdAt: now,
    updatedAt: now,
    assignment: {
      id: asAssignmentId('asg_1'),
      recipientId: asRecipientId('rcp_1'),
      intendedRecipientEmail: 'recipient@example.com',
      assignedAt: now,
      assignedByOwnerId: asOwnerId('owner_1'),
      allowedCapabilityActions: ['complete_task', 'mark_task_waiting', 'add_task_note'],
      capabilityStatus: 'active',
    },
    ...overrides,
  };
}

describe('task suggestion machine', () => {
  it('approves pending suggestions for the Owner', () => {
    const suggestion = baseSuggestion();
    const approved = approveTaskSuggestion(suggestion, {
      actor: owner,
      ifMatch: formatETag('task-suggestion', suggestion.id, 1),
      now,
    });
    expect(approved.status).toBe('approved');
    expect(approved.version).toBe(2);
  });

  it('blocks capability actors from suggestion approval', () => {
    expect(() =>
      approveTaskSuggestion(baseSuggestion(), {
        actor: capabilityActor,
        ifMatch: formatETag('task-suggestion', 'sug_1', 1),
        now,
      }),
    ).toThrow(/not permitted|Capability links cannot/);
  });

  it('preserves terminal suggestion transitions', () => {
    const dismissed = { ...baseSuggestion(), status: 'dismissed' as const };
    expect(() =>
      mergeTaskSuggestion(dismissed, {
        actor: owner,
        ifMatch: formatETag('task-suggestion', dismissed.id, 1),
        now,
        targetTaskId: asTaskId('task_2'),
      }),
    ).toThrow(/cannot transition/);
  });
});

describe('task machine', () => {
  it('preserves prior actionable status through waiting and resume', () => {
    const task = baseTask({ status: 'in_progress' });
    const waiting = markTaskWaiting(task, {
      actor: capabilityActor,
      ifMatch: formatETag('task', task.id, 1),
      now,
      waitingUntil: '2026-07-14T12:00:00.000Z',
    });
    expect(waiting.status).toBe('waiting');
    expect(waiting.priorActionableStatus).toBe('in_progress');

    const resumed = resumeTask(waiting, {
      actor: capabilityActor,
      ifMatch: formatETag('task', waiting.id, 2),
      now,
    });
    expect(resumed.status).toBe('in_progress');
  });

  it('supports one-tap completion with capability attribution', () => {
    const completed = completeTask(baseTask(), {
      actor: capabilityActor,
      ifMatch: formatETag('task', 'task_1', 1),
      now,
      outcomeType: 'completed',
    });
    expect(completed.status).toBe('completed');
    expect(completed.outcome?.attribution.kind).toBe('capability');
    expect(completed.outcome?.attribution.capability?.intendedRecipientEmail).toBe(
      'recipient@example.com',
    );
    expect(completed.outcome?.note).toBeUndefined();
  });
});

describe('owner and capability authorization', () => {
  it('allows only the Owner as authenticated application actor for owner-only actions', () => {
    expect(can(owner, 'approve_task_suggestion', undefined, now)).toBe(true);
    expect(can(capabilityActor, 'approve_task_suggestion', baseTask(), now)).toBe(false);
    expect(can(capabilityActor, 'manage_workflow_rules', baseTask(), now)).toBe(false);
  });

  it('permits only scoped capability actions', () => {
    expect(canCapability(capabilityActor, 'complete_task', baseTask(), now)).toBe(true);
    expect(canCapability(capabilityActor, 'return_task_to_owner', baseTask(), now)).toBe(true);
    expect(
      canCapability(
        {
          ...capabilityActor,
          allowedActions: ['view_assigned_task'],
        },
        'complete_task',
        baseTask(),
        now,
      ),
    ).toBe(false);
  });

  it('denies expired capabilities', () => {
    expect(
      canCapability(
        { ...capabilityActor, expiresAt: '2026-07-12T00:00:00.000Z' },
        'complete_task',
        baseTask(),
        now,
      ),
    ).toBe(false);
  });

  it('denies revoked capabilities', () => {
    expect(
      canCapability({ ...capabilityActor, status: 'revoked' }, 'complete_task', baseTask(), now),
    ).toBe(false);
  });

  it('denies wrong-task capabilities', () => {
    expect(
      canCapability(
        { ...capabilityActor, taskId: asTaskId('task_other') },
        'complete_task',
        baseTask(),
        now,
      ),
    ).toBe(false);
  });

  it('denies terminal task capability mutation', () => {
    expect(
      canCapability(capabilityActor, 'complete_task', baseTask({ status: 'completed' }), now),
    ).toBe(false);
  });

  it('uses capability audit language without verified identity', () => {
    const label = capabilityAttributionLabel('recipient@example.com', 'complete_task');
    expect(label).toContain('recipient@example.com');
    expect(label).not.toMatch(/Sarah completed/);
  });

  it('treats GET as non-mutating for capability links', () => {
    expect(() => assertGetDoesNotMutate('GET')).not.toThrow();
    expect(() => assertGetDoesNotMutate('POST')).not.toThrow();
  });

  it('denies capability actions on unassigned tasks', () => {
    expect(can(capabilityActor, 'complete_task', baseTask({ assignment: undefined }), now)).toBe(
      false,
    );
  });

  it('prevents voice from creating tasks directly', () => {
    expect(() => assertVoiceCannotCreateTask()).toThrow(/cannot create tasks directly/);
    expect(can(owner, 'create_task_from_voice', undefined, now)).toBe(false);
  });
});

describe('retention and urgency', () => {
  it('calculates excerpt purge and failed audio expiry', () => {
    expect(computeExcerptPurgeAt(now)).toBe('2026-07-20T12:00:00.000Z');
    expect(computeFailedAudioDeleteAt(now)).toBe('2026-07-15T12:00:00.000Z');
  });

  it('derives overdue and due soon without persisting', () => {
    expect(deriveTaskUrgency('open', '2026-07-12T12:00:00.000Z', now)).toBe('overdue');
    expect(deriveTaskUrgency('open', '2026-07-13T20:00:00.000Z', now)).toBe('due_soon');
    expect(deriveTaskUrgency('waiting', '2026-07-12T12:00:00.000Z', now)).toBeNull();
  });
});

describe('summary points', () => {
  it('allows multiple amounts and deadlines', () => {
    expect(() =>
      validateSummaryPoints([
        { id: 'a1', kind: 'amount', label: 'A', order: 0, amount: 100, currency: 'USD' },
        { id: 'a2', kind: 'amount', label: 'B', order: 1, amount: 50, currency: 'CAD' },
        {
          id: 'd1',
          kind: 'deadline',
          label: 'Due',
          order: 2,
          dueAt: '2026-07-20T12:00:00.000Z',
        },
        {
          id: 'd2',
          kind: 'deadline',
          label: 'Local',
          order: 3,
          localDate: '2026-07-21',
          timezone: 'America/Vancouver',
        },
      ]),
    ).not.toThrow();
  });
});

describe('etag preconditions', () => {
  it('creates and parses strong etags', () => {
    const etag = formatETag('task', 'task_1', 3);
    expect(etag).toBe('"task-task_1-v3"');
    expect(parseETag(etag)?.version).toBe(3);
  });

  it('requires and validates If-Match', () => {
    expect(() =>
      assertMatchingPrecondition(undefined, {
        kind: 'task',
        resourceId: 'task_1',
        version: 1,
      }),
    ).toThrow(DomainError);

    try {
      assertMatchingPrecondition(undefined, {
        kind: 'task',
        resourceId: 'task_1',
        version: 1,
      });
    } catch (error) {
      expect((error as DomainError).code).toBe('PRECONDITION_REQUIRED');
    }

    try {
      assertMatchingPrecondition('"task-task_1-v2"', {
        kind: 'task',
        resourceId: 'task_1',
        version: 1,
      });
    } catch (error) {
      expect((error as DomainError).code).toBe('PRECONDITION_FAILED');
    }
  });
});

describe('enum parity', () => {
  it('maps API statuses to domain literals', () => {
    expect(startTask).toBeDefined();
    expect(toUtcInstant(new Date(now))).toBe(now);
  });
});
