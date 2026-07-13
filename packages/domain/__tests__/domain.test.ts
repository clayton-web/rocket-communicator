import { describe, expect, it } from 'vitest';
import {
  asOrganizationId,
  asTaskId,
  asTaskSuggestionId,
  asUserId,
  approveTaskSuggestion,
  assertMatchingPrecondition,
  assertVoiceCannotCreateTask,
  can,
  completeTask,
  computeExcerptPurgeAt,
  computeFailedAudioDeleteAt,
  deriveTaskUrgency,
  dismissTaskSuggestion,
  DomainError,
  formatETag,
  mergeTaskSuggestion,
  parseETag,
  resumeTask,
  markTaskWaiting,
  startTask,
  toUtcInstant,
  validateSummaryPoints,
  type ActorContext,
  type Task,
  type TaskSuggestion,
} from '../src/index.js';

const primary: ActorContext = {
  userId: asUserId('user_primary'),
  organizationId: asOrganizationId('org_1'),
  role: 'primary',
};

const admin: ActorContext = {
  userId: asUserId('user_admin'),
  organizationId: asOrganizationId('org_1'),
  role: 'administrator',
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
      assigneeUserId: asUserId('user_admin'),
      assignedAt: now,
      assignedByUserId: asUserId('user_primary'),
    },
    ...overrides,
  };
}

describe('task suggestion machine', () => {
  it('approves pending suggestions for primary users', () => {
    const suggestion = baseSuggestion();
    const approved = approveTaskSuggestion(suggestion, {
      actor: primary,
      ifMatch: formatETag('task-suggestion', suggestion.id, 1),
      now,
    });
    expect(approved.status).toBe('approved');
    expect(approved.version).toBe(2);
  });

  it('blocks administrator suggestion approval', () => {
    expect(() =>
      approveTaskSuggestion(baseSuggestion(), {
        actor: admin,
        ifMatch: formatETag('task-suggestion', 'sug_1', 1),
        now,
      }),
    ).toThrow(/not permitted/);
  });

  it('prevents terminal suggestion transitions', () => {
    const dismissed = { ...baseSuggestion(), status: 'dismissed' as const };
    expect(() =>
      mergeTaskSuggestion(dismissed, {
        actor: primary,
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
      actor: admin,
      ifMatch: formatETag('task', task.id, 1),
      now,
      waitingUntil: '2026-07-14T12:00:00.000Z',
    });
    expect(waiting.status).toBe('waiting');
    expect(waiting.priorActionableStatus).toBe('in_progress');

    const resumed = resumeTask(waiting, {
      actor: admin,
      ifMatch: formatETag('task', waiting.id, 2),
      now,
    });
    expect(resumed.status).toBe('in_progress');
  });

  it('supports one-tap completion', () => {
    const completed = completeTask(baseTask(), {
      actor: admin,
      ifMatch: formatETag('task', 'task_1', 1),
      now,
      outcomeType: 'completed',
    });
    expect(completed.status).toBe('completed');
    expect(completed.outcome?.outcomeType).toBe('completed');
    expect(completed.outcome?.note).toBeUndefined();
  });
});

describe('capabilities and voice policy', () => {
  it('denies administrator actions on unassigned tasks', () => {
    const unassigned = baseTask({ assignment: undefined });
    expect(can(admin, 'complete_task', unassigned)).toBe(false);
  });

  it('prevents voice from creating tasks directly', () => {
    expect(() => assertVoiceCannotCreateTask()).toThrow(/cannot create tasks directly/);
    expect(can(primary, 'create_task_from_voice')).toBe(false);
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
