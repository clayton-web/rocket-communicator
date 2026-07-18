import { describe, expect, it } from 'vitest';
import {
  asAssignmentId,
  asCapabilityId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  asTaskSuggestionId,
  addTaskNote,
  approveTaskSuggestion,
  assertGetDoesNotMutate,
  assertMatchingPrecondition,
  assertVoiceCannotCreateTask,
  buildActionAttribution,
  can,
  canCapability,
  capabilityAttributionLabel,
  completeTask,
  computeExcerptPurgeAt,
  computeFailedAudioDeleteAt,
  createStandaloneTask,
  DEFAULT_CAPABILITY_TTL_MS,
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  deriveTaskUrgency,
  dismissTask,
  dismissTaskSuggestion,
  DomainError,
  formatETag,
  invalidateCapabilityOnAssignmentChange,
  issueTaskCapability,
  markCapabilityExpired,
  markTaskWaiting,
  mergeTaskSuggestion,
  ownerActor,
  parseETag,
  requestClarification,
  resumeTask,
  returnTaskToOwner,
  revokeCapability,
  snoozeTask,
  startTask,
  submitWorkRequest,
  toUtcInstant,
  validateSummaryPoints,
  type CapabilityActor,
  type Task,
  type TaskCapability,
  type TaskSuggestion,
} from '../src/index.js';

const owner = ownerActor(asOwnerId('owner_1'), asOrganizationId('org_1'));

const capabilityActor: CapabilityActor = {
  kind: 'capability',
  capabilityId: asCapabilityId('cap_1'),
  taskId: asTaskId('task_1'),
  assignmentId: asAssignmentId('asg_1'),
  intendedRecipientEmail: 'recipient@example.com',
  allowedActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
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
      allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
      capabilityStatus: 'active',
      activeCapabilityId: 'cap_1',
    },
    ...overrides,
  };
}

function baseCapability(overrides: Partial<TaskCapability> = {}): TaskCapability {
  return {
    id: asCapabilityId('cap_1'),
    taskId: asTaskId('task_1'),
    assignmentId: asAssignmentId('asg_1'),
    recipientId: asRecipientId('rcp_1'),
    intendedRecipientEmail: 'recipient@example.com',
    scope: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
    status: 'active',
    issuedAt: now,
    expiresAt: '2026-07-20T12:00:00.000Z',
    revokedAt: null,
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
    const targetTask = createStandaloneTask({
      actor: owner,
      now,
      id: asTaskId('task_2'),
      organizationId: asOrganizationId('org_1'),
      summaryPoints: [{ id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Existing' }],
    });
    expect(() =>
      mergeTaskSuggestion(dismissed, targetTask, {
        actor: owner,
        ifMatch: formatETag('task-suggestion', dismissed.id, 1),
        now,
        targetTaskId: asTaskId('task_2'),
        targetTaskIfMatch: formatETag('task', targetTask.id, targetTask.version),
      }),
    ).toThrow(/cannot transition/);
  });
});

describe('Owner task lifecycle', () => {
  it('creates a standalone open task', () => {
    const task = createStandaloneTask({
      actor: owner,
      now,
      id: asTaskId('task_new'),
      organizationId: asOrganizationId('org_1'),
      summaryPoints: [
        { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Owner typed work' },
      ],
      dueAt: '2026-07-20T12:00:00.000Z',
      priority: 'high',
    });
    expect(task.status).toBe('open');
    expect(task.version).toBe(1);
    expect(task.assignment).toBeUndefined();
    expect(task.summaryPoints[0]?.value).toBe('Owner typed work');
  });

  it('blocks capability actors from creating standalone tasks', () => {
    expect(() =>
      createStandaloneTask({
        actor: capabilityActor,
        now,
        id: asTaskId('task_x'),
        organizationId: asOrganizationId('org_1'),
        summaryPoints: [{ id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Nope' }],
      }),
    ).toThrow(/Owner required|not permitted|cannot authorize/i);
  });

  it('starts an open task', () => {
    const started = startTask(baseTask(), {
      actor: owner,
      ifMatch: formatETag('task', 'task_1', 1),
      now,
    });
    expect(started.status).toBe('in_progress');
    expect(started.version).toBe(2);
  });

  it('waits and resumes from Owner session', () => {
    const waiting = markTaskWaiting(baseTask({ status: 'open' }), {
      actor: owner,
      ifMatch: formatETag('task', 'task_1', 1),
      now,
      waitingUntil: '2026-07-14T12:00:00.000Z',
    });
    expect(waiting.status).toBe('waiting');
    expect(waiting.priorActionableStatus).toBe('open');

    const resumed = resumeTask(waiting, {
      actor: owner,
      ifMatch: formatETag('task', waiting.id, 2),
      now,
    });
    expect(resumed.status).toBe('open');
  });

  it('snoozes without changing status', () => {
    const task = baseTask({ status: 'in_progress' });
    const snoozed = snoozeTask(
      task,
      { actor: owner, ifMatch: formatETag('task', task.id, 1), now },
      '2026-07-15T09:00:00.000Z',
    );
    expect(snoozed.status).toBe('in_progress');
    expect(snoozed.reminder.nextReminderAt).toBe('2026-07-15T09:00:00.000Z');
  });

  it('rejects snooze while waiting', () => {
    expect(() =>
      snoozeTask(
        baseTask({ status: 'waiting', priorActionableStatus: 'open' }),
        { actor: owner, ifMatch: formatETag('task', 'task_1', 1), now },
        '2026-07-15T09:00:00.000Z',
      ),
    ).toThrow(/cannot be snoozed/);
  });

  it('dismisses a task (no physical delete)', () => {
    const dismissed = dismissTask(baseTask(), {
      actor: owner,
      ifMatch: formatETag('task', 'task_1', 1),
      now,
    });
    expect(dismissed.status).toBe('dismissed');
    expect(dismissed.retention.excerptPurgeAt).toBeDefined();
  });

  it('completes with Owner attribution', () => {
    const completed = completeTask(baseTask(), {
      actor: owner,
      ifMatch: formatETag('task', 'task_1', 1),
      now,
      requestId: 'req_owner_complete',
      outcomeType: 'completed',
    });
    expect(completed.status).toBe('completed');
    expect(completed.outcome?.attribution.kind).toBe('owner');
    expect(completed.outcome?.attribution.owner?.ownerId).toBe('owner_1');
    expect(completed.outcome?.attribution.owner?.requestId).toBe('req_owner_complete');
  });

  it('adds typed notes with Owner attribution', () => {
    const noted = addTaskNote(baseTask(), {
      actor: owner,
      ifMatch: formatETag('task', 'task_1', 1),
      now,
      noteId: 'note_1',
      body: 'Owner note',
      requestId: 'req_note',
    });
    expect(noted.notes).toHaveLength(1);
    expect(noted.notes[0]?.attribution.kind).toBe('owner');
    expect(noted.notes[0]?.body).toBe('Owner note');
  });
});

describe('capability task lifecycle', () => {
  it('preserves prior actionable status through waiting and resume', () => {
    const waiting = markTaskWaiting(baseTask({ status: 'in_progress' }), {
      actor: capabilityActor,
      ifMatch: formatETag('task', 'task_1', 1),
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
      requestId: 'req_cap_complete',
      outcomeType: 'completed',
    });
    expect(completed.status).toBe('completed');
    expect(completed.outcome?.attribution.kind).toBe('capability');
    const audit = completed.outcome?.attribution.capability;
    expect(audit?.intendedRecipientEmail).toBe('recipient@example.com');
    expect(audit?.action).toBe('complete_task');
    expect(audit?.outcome).toBe('succeeded');
    expect(audit?.requestId).toBe('req_cap_complete');
    expect(audit?.resourceVersion).toBe(2);
    expect(audit?.taskStatus).toBe('completed');
    expect(audit?.attributionLabel).not.toMatch(/Sarah completed/);
  });

  it('adds typed notes with capability attribution', () => {
    const noted = addTaskNote(baseTask(), {
      actor: capabilityActor,
      ifMatch: formatETag('task', 'task_1', 1),
      now,
      noteId: 'note_cap',
      body: 'Recipient typed note',
    });
    expect(noted.notes[0]?.attribution.kind).toBe('capability');
    expect(noted.notes[0]?.attribution.capability?.action).toBe('add_task_note');
  });

  it('records typed clarification without changing status', () => {
    const clarified = requestClarification(baseTask({ status: 'in_progress' }), {
      actor: capabilityActor,
      ifMatch: formatETag('task', 'task_1', 1),
      now,
      noteId: 'clar_1',
      message: 'What address should I use?',
      requestId: 'req_clar',
    });
    expect(clarified.status).toBe('in_progress');
    expect(clarified.notes[0]?.body).toBe('What address should I use?');
    expect(clarified.notes[0]?.attribution.capability?.action).toBe('request_clarification');
    expect(clarified.notes[0]?.attribution.capability?.requestId).toBe('req_clar');
  });

  it('returns to Owner without changing status and exposes capability invalidation hint', () => {
    const result = returnTaskToOwner(
      baseTask({ status: 'waiting', priorActionableStatus: 'open' }),
      {
        actor: capabilityActor,
        ifMatch: formatETag('task', 'task_1', 1),
        now,
        noteId: 'ret_1',
        note: 'Need Owner to finish',
      },
    );
    expect(result.task.status).toBe('waiting');
    expect(result.task.assignment).toBeUndefined();
    expect(result.task.notes[0]?.attribution.capability?.action).toBe('return_task_to_owner');
    expect(result.capabilityInvalidation).toEqual({
      taskId: asTaskId('task_1'),
      assignmentId: asAssignmentId('asg_1'),
      capabilityId: 'cap_1',
    });
    expect(result.attribution.kind).toBe('capability');

    const revoked = invalidateCapabilityOnAssignmentChange(baseCapability(), now);
    expect(revoked.status).toBe('revoked');
  });

  it('submits a work request as a pending Task Suggestion', () => {
    const result = submitWorkRequest(baseTask(), {
      actor: capabilityActor,
      ifMatch: formatETag('task', 'task_1', 1),
      now,
      suggestionId: asTaskSuggestionId('sug_work'),
      noteId: 'wr_1',
      message: 'Please schedule a handyman visit',
      requestId: 'req_wr',
    });
    expect(result.suggestion.status).toBe('pending');
    expect(result.suggestion.voiceOriginated).toBe(false);
    expect(result.suggestion.summaryPoints[0]?.kind).toBe('request');
    expect(result.task.status).toBe('open');
    expect(result.task.notes[0]?.body).toBe('Please schedule a handyman visit');
    expect(result.attribution.kind).toBe('capability');
    expect(result.attribution.capability?.action).toBe('submit_work_request');
  });

  it('does not treat work-request as creating a Task', () => {
    const result = submitWorkRequest(baseTask(), {
      actor: capabilityActor,
      ifMatch: formatETag('task', 'task_1', 1),
      now,
      suggestionId: asTaskSuggestionId('sug_work_2'),
      noteId: 'wr_2',
      message: 'New work',
    });
    expect(result.suggestion.id).not.toBe(result.task.id);
    expect(result.suggestion.status).toBe('pending');
  });
});

describe('capability lifecycle', () => {
  it('issues an active capability with injected TTL (documented seven-day default)', () => {
    const { task, capability } = issueTaskCapability(baseTask(), {
      actor: owner,
      now,
      capabilityId: asCapabilityId('cap_new'),
      ttlMs: DEFAULT_CAPABILITY_TTL_MS,
    });
    expect(capability.status).toBe('active');
    expect(capability.expiresAt).toBe(
      new Date(Date.parse(now) + DEFAULT_CAPABILITY_TTL_MS).toISOString(),
    );
    expect(capability.scope).toContain('view_assigned_task');
    expect(task.assignment?.activeCapabilityId).toBe('cap_new');
    expect(task.assignment?.capabilityStatus).toBe('active');
  });

  it('accepts a non-default injected TTL', () => {
    const oneDayMs = 24 * 60 * 60 * 1000;
    const { capability } = issueTaskCapability(baseTask(), {
      actor: owner,
      now,
      capabilityId: asCapabilityId('cap_short'),
      ttlMs: oneDayMs,
    });
    expect(capability.expiresAt).toBe(new Date(Date.parse(now) + oneDayMs).toISOString());
  });

  it('blocks capability actors from issuing capabilities', () => {
    expect(() =>
      issueTaskCapability(baseTask(), {
        actor: capabilityActor,
        now,
        capabilityId: asCapabilityId('cap_bad'),
        ttlMs: DEFAULT_CAPABILITY_TTL_MS,
      }),
    ).toThrow(/Owner required|cannot authorize/i);
  });

  it('revokes a capability and marks expiry without using used', () => {
    const active = baseCapability();
    const revoked = revokeCapability(active, now);
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedAt).toBe(now);

    const expired = markCapabilityExpired(
      baseCapability({ expiresAt: '2026-07-12T00:00:00.000Z' }),
      now,
    );
    expect(expired.status).toBe('expired');

    const invalidated = invalidateCapabilityOnAssignmentChange(active, now);
    expect(invalidated.status).toBe('revoked');
    expect(invalidated.status).not.toBe('used');
  });
});

describe('owner and capability authorization', () => {
  it('allows only the Owner as authenticated application actor for owner-only actions', () => {
    expect(can(owner, 'approve_task_suggestion', undefined, now)).toBe(true);
    expect(can(owner, 'issue_task_capability', baseTask(), now)).toBe(true);
    expect(can(capabilityActor, 'approve_task_suggestion', baseTask(), now)).toBe(false);
    expect(can(capabilityActor, 'dismiss_task', baseTask(), now)).toBe(false);
    expect(can(capabilityActor, 'snooze_task', baseTask(), now)).toBe(false);
    expect(can(capabilityActor, 'create_standalone_task', baseTask(), now)).toBe(false);
    expect(can(capabilityActor, 'manage_workflow_rules', baseTask(), now)).toBe(false);
    expect(can(owner, 'submit_work_request', baseTask(), now)).toBe(false);
  });

  it('permits only scoped capability actions', () => {
    expect(canCapability(capabilityActor, 'complete_task', baseTask(), now)).toBe(true);
    expect(canCapability(capabilityActor, 'return_task_to_owner', baseTask(), now)).toBe(true);
    expect(canCapability(capabilityActor, 'submit_work_request', baseTask(), now)).toBe(true);
    expect(
      canCapability(
        { ...capabilityActor, allowedActions: ['view_assigned_task'] },
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
    expect(() =>
      addTaskNote(baseTask({ status: 'dismissed' }), {
        actor: capabilityActor,
        ifMatch: formatETag('task', 'task_1', 1),
        now,
        noteId: 'n',
        body: 'x',
      }),
    ).toThrow(/not permitted|cannot be mutated|cannot transition|status dismissed/i);
  });

  it('denies insufficient scope for clarification and work request', () => {
    const limited: CapabilityActor = {
      ...capabilityActor,
      allowedActions: ['view_assigned_task', 'complete_task'],
    };
    expect(canCapability(limited, 'request_clarification', baseTask(), now)).toBe(false);
    expect(canCapability(limited, 'submit_work_request', baseTask(), now)).toBe(false);
  });

  it('blocks capability actors from snoozing and dismissing', () => {
    expect(() =>
      snoozeTask(
        baseTask({ status: 'open' }),
        { actor: capabilityActor, ifMatch: formatETag('task', 'task_1', 1), now },
        '2026-07-15T09:00:00.000Z',
      ),
    ).toThrow(/Capability links cannot authorize snooze_task/i);

    expect(() =>
      dismissTask(baseTask(), {
        actor: capabilityActor,
        ifMatch: formatETag('task', 'task_1', 1),
        now,
      }),
    ).toThrow(/Capability links cannot authorize dismiss_task/i);
  });

  it('uses capability audit language without verified identity', () => {
    const label = capabilityAttributionLabel('recipient@example.com', 'complete_task');
    expect(label).toContain('recipient@example.com');
    expect(label).not.toMatch(/Sarah completed/);

    const attribution = buildActionAttribution(capabilityActor, now, {
      capabilityAction: 'mark_task_waiting',
      resourceVersion: 3,
      taskStatus: 'waiting',
      requestId: 'req_wait',
    });
    expect(attribution.kind).toBe('capability');
    expect(attribution.capability?.resourceVersion).toBe(3);
    expect(attribution.capability?.taskStatus).toBe('waiting');
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
    expect(dismissTaskSuggestion).toBeDefined();
  });
});
