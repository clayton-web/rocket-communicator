import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  asAssignmentId,
  asCapabilityId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  asTaskSuggestionId,
  type Task,
  type TaskAssignment,
  type TaskCapability,
  type TaskNote,
  type TaskSuggestion,
  type Recipient,
} from '@aicaa/domain';
import {
  PersistenceError,
  appendTaskNote,
  clearAssignment,
  createActiveAssignment,
  createAuditEvent,
  createCapability,
  createPrismaClient,
  createTask,
  createTaskSuggestion,
  getCapabilityById,
  getTaskById,
  getTaskSuggestionById,
  listAuditEventsForTask,
  listTaskAssignments,
  listTasks,
  persistCapabilityAction,
  persistReturnToOwner,
  persistWorkRequest,
  updateTaskWithExpectedVersion,
  upsertRecipient,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const orgA = 'org_a';
const orgB = 'org_b';
const now = '2026-07-13T12:00:00.000Z';

function recipient(id = 'rcp_1'): Recipient {
  return {
    id: asRecipientId(id),
    displayName: 'Alex Recipient',
    email: 'recipient@example.com',
    active: true,
    relationshipLabel: 'assistant',
  };
}

function assignment(overrides: Partial<TaskAssignment> = {}): TaskAssignment {
  return {
    id: asAssignmentId('asg_1'),
    recipientId: asRecipientId('rcp_1'),
    intendedRecipientEmail: 'recipient@example.com',
    assignedAt: now,
    assignedByOwnerId: asOwnerId('owner_1'),
    allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
    capabilityStatus: 'active',
    activeCapabilityId: 'cap_1',
    ...overrides,
  };
}

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: asTaskId('task_1'),
    organizationId: asOrganizationId(orgA),
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
    assignment: assignment(),
    ...overrides,
  };
}

function capability(overrides: Partial<TaskCapability> = {}): TaskCapability {
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

describe('A4 persistence repositories (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('persists and retrieves Owner-scoped tasks with assignment and notes', async () => {
    await upsertRecipient(db.prisma, { organizationId: orgA, recipient: recipient() });
    const task = baseTask({
      notes: [
        {
          id: 'note_owner',
          body: 'Owner note',
          createdAt: now,
          attribution: {
            kind: 'owner',
            owner: { ownerId: 'owner_1', recordedAt: now, requestId: 'req_1' },
          },
        },
      ],
    });

    const created = await createTask(db.prisma, orgA, task, task.assignment);
    expect(created.status).toBe('open');
    expect(created.assignment?.id).toBe('asg_1');
    expect(created.notes[0]?.attribution.kind).toBe('owner');

    const loaded = await getTaskById(db.prisma, orgA, 'task_1');
    expect(loaded.version).toBe(1);
    expect(loaded.notes[0]?.body).toBe('Owner note');
  });

  it('enforces organization isolation on task reads', async () => {
    await expect(getTaskById(db.prisma, orgB, 'task_1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('increments task version with expected-version constraints', async () => {
    const current = await getTaskById(db.prisma, orgA, 'task_1');
    const next: Task = {
      ...current,
      status: 'in_progress',
      version: current.version + 1,
      updatedAt: '2026-07-13T12:01:00.000Z',
    };
    const updated = await updateTaskWithExpectedVersion(db.prisma, orgA, 1, next);
    expect(updated.status).toBe('in_progress');
    expect(updated.version).toBe(2);

    await expect(
      updateTaskWithExpectedVersion(db.prisma, orgA, 1, { ...next, version: 3 }),
    ).rejects.toBeInstanceOf(PersistenceError);
  });

  it('persists Recipient records without auth identity', async () => {
    const saved = await upsertRecipient(db.prisma, {
      organizationId: orgA,
      recipient: {
        ...recipient('rcp_2'),
        email: 'recipient2@example.com',
        displayName: 'Other Recipient',
      },
    });
    expect(saved.email).toBe('recipient2@example.com');
    expect(saved).not.toHaveProperty('passwordHash');
    expect(saved).not.toHaveProperty('sessionToken');
  });

  it('persists pending Task Suggestions', async () => {
    const suggestion: TaskSuggestion = {
      id: asTaskSuggestionId('sug_1'),
      organizationId: asOrganizationId(orgA),
      status: 'pending',
      summaryPoints: [
        { id: 'r1', kind: 'request', label: 'Work request', order: 0, value: 'Need help' },
      ],
      voiceOriginated: false,
      retention: {},
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const created = await createTaskSuggestion(db.prisma, orgA, suggestion, 'task_1');
    expect(created.status).toBe('pending');
    const loaded = await getTaskSuggestionById(db.prisma, orgA, 'sug_1');
    expect(loaded.summaryPoints[0]?.kind).toBe('request');
  });

  it('enforces unique capability token hashes and stores hash only', async () => {
    const hash = 'a'.repeat(64);
    const created = await createCapability(db.prisma, orgA, capability(), hash);
    expect(created.tokenHash).toBe(hash);
    expect(Object.keys(created)).not.toContain('token');
    expect(Object.keys(created)).not.toContain('rawToken');

    await expect(
      createCapability(db.prisma, orgA, capability({ id: asCapabilityId('cap_dup') }), hash),
    ).rejects.toMatchObject({ code: 'UNIQUE_VIOLATION' });

    await expect(
      createCapability(
        db.prisma,
        orgA,
        capability({ id: asCapabilityId('cap_used'), status: 'used' }),
        'b'.repeat(64),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('persists capability expiry and revocation fields', async () => {
    const cap = await createCapability(
      db.prisma,
      orgA,
      capability({
        id: asCapabilityId('cap_rev'),
        expiresAt: '2026-07-21T00:00:00.000Z',
      }),
      'c'.repeat(64),
    );
    expect(cap.expiresAt).toBe('2026-07-21T00:00:00.000Z');

    const revoked = await (
      await import('../src/repositories/capability-repository.js')
    ).revokeCapabilityRecord(db.prisma, orgA, 'cap_rev', now, 'manual_revoke');
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedAt).toBe(now);

    const loaded = await getCapabilityById(db.prisma, orgA, 'cap_rev');
    expect(loaded.status).toBe('revoked');
  });

  it('persists Owner and capability audit attribution without Recipient identity claims', async () => {
    await createAuditEvent(db.prisma, {
      id: 'audit_owner_1',
      organizationId: orgA,
      actorKind: 'owner',
      ownerId: 'owner_1',
      taskId: 'task_1',
      action: 'start_task',
      outcome: 'succeeded',
      resourceVersion: 2,
      taskStatus: 'in_progress',
      requestId: 'req_owner',
      recordedAt: now,
    });

    await createAuditEvent(db.prisma, {
      id: 'audit_cap_1',
      organizationId: orgA,
      actorKind: 'capability',
      capabilityId: 'cap_1',
      assignmentId: 'asg_1',
      taskId: 'task_1',
      intendedRecipientEmail: 'recipient@example.com',
      action: 'add_task_note',
      outcome: 'succeeded',
      attributionLabel:
        'Action submitted through link sent to recipient@example.com (add task note)',
      requestId: 'req_cap',
      recordedAt: now,
    });

    const events = await listAuditEventsForTask(db.prisma, orgA, 'task_1');
    expect(events.some((e) => e.actorKind === 'owner')).toBe(true);
    expect(events.some((e) => e.actorKind === 'capability')).toBe(true);
    expect(events.find((e) => e.actorKind === 'capability')?.attributionLabel).not.toMatch(
      /Sarah completed/i,
    );
  });

  it('keeps dismissed tasks persisted', async () => {
    const current = await getTaskById(db.prisma, orgA, 'task_1');
    const dismissed: Task = {
      ...current,
      status: 'dismissed',
      version: current.version + 1,
      updatedAt: '2026-07-13T12:05:00.000Z',
      retention: { excerptPurgeAt: '2026-07-20T12:05:00.000Z' },
      reminder: { paused: true, pausedReason: 'dismissed', nextReminderAt: null },
    };
    const saved = await updateTaskWithExpectedVersion(db.prisma, orgA, current.version, dismissed);
    expect(saved.status).toBe('dismissed');
    expect(await getTaskById(db.prisma, orgA, 'task_1')).toMatchObject({ status: 'dismissed' });
  });

  it('rolls back a multi-record transaction on failure', async () => {
    await upsertRecipient(db.prisma, {
      organizationId: orgA,
      recipient: { ...recipient('rcp_tx'), email: 'tx@example.com' },
    });
    const task = baseTask({
      id: asTaskId('task_tx'),
      status: 'open',
      version: 1,
      assignment: assignment({
        id: asAssignmentId('asg_tx'),
        recipientId: asRecipientId('rcp_tx'),
        activeCapabilityId: 'cap_tx',
      }),
    });
    await createTask(db.prisma, orgA, task, task.assignment);
    await createCapability(
      db.prisma,
      orgA,
      capability({
        id: asCapabilityId('cap_tx'),
        taskId: asTaskId('task_tx'),
        assignmentId: asAssignmentId('asg_tx'),
        recipientId: asRecipientId('rcp_tx'),
      }),
      'd'.repeat(64),
    );

    await expect(
      db.prisma.$transaction(async (tx) => {
        await appendTaskNote(tx, orgA, 'task_tx', {
          id: 'note_fail',
          body: 'should roll back',
          createdAt: now,
          attribution: {
            kind: 'capability',
            capability: {
              capabilityId: asCapabilityId('cap_tx'),
              assignmentId: asAssignmentId('asg_tx'),
              taskId: asTaskId('task_tx'),
              intendedRecipientEmail: 'tx@example.com',
              action: 'add_task_note',
              recordedAt: now,
              outcome: 'succeeded',
            },
          },
        });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow(/force rollback/);

    const reloaded = await getTaskById(db.prisma, orgA, 'task_tx');
    expect(reloaded.notes.find((n) => n.id === 'note_fail')).toBeUndefined();
  });

  it('atomically returns to Owner: task, note, capability revoke, audit', async () => {
    await upsertRecipient(db.prisma, {
      organizationId: orgA,
      recipient: { ...recipient('rcp_ret'), email: 'return@example.com' },
    });
    const task = baseTask({
      id: asTaskId('task_ret'),
      status: 'waiting',
      priorActionableStatus: 'open',
      version: 1,
      assignment: assignment({
        id: asAssignmentId('asg_ret'),
        recipientId: asRecipientId('rcp_ret'),
        intendedRecipientEmail: 'return@example.com',
        activeCapabilityId: 'cap_ret',
      }),
    });
    await createTask(db.prisma, orgA, task, task.assignment);
    await createCapability(
      db.prisma,
      orgA,
      capability({
        id: asCapabilityId('cap_ret'),
        taskId: asTaskId('task_ret'),
        assignmentId: asAssignmentId('asg_ret'),
        recipientId: asRecipientId('rcp_ret'),
        intendedRecipientEmail: 'return@example.com',
      }),
      'e'.repeat(64),
    );

    const note: TaskNote = {
      id: 'note_ret',
      body: 'Returning to Owner',
      createdAt: now,
      attribution: {
        kind: 'capability',
        capability: {
          capabilityId: asCapabilityId('cap_ret'),
          assignmentId: asAssignmentId('asg_ret'),
          taskId: asTaskId('task_ret'),
          intendedRecipientEmail: 'return@example.com',
          action: 'return_task_to_owner',
          recordedAt: now,
          outcome: 'succeeded',
        },
      },
    };

    const returnedTask: Task = {
      ...task,
      assignment: undefined,
      notes: [...task.notes, note],
      version: 2,
      updatedAt: '2026-07-13T12:10:00.000Z',
    };

    const result = await persistReturnToOwner({
      db: db.prisma,
      organizationId: orgA,
      expectedVersion: 1,
      task: returnedTask,
      note,
      capabilityId: 'cap_ret',
      revokedAt: now,
      audit: {
        id: 'audit_ret',
        organizationId: orgA,
        actorKind: 'capability',
        capabilityId: 'cap_ret',
        assignmentId: 'asg_ret',
        taskId: 'task_ret',
        intendedRecipientEmail: 'return@example.com',
        action: 'return_task_to_owner',
        outcome: 'succeeded',
        resourceVersion: 2,
        taskStatus: 'waiting',
        requestId: 'req_ret',
        recordedAt: now,
      },
    });

    expect(result.task.assignment).toBeUndefined();
    expect(result.task.status).toBe('waiting');
    expect(result.task.notes.some((n) => n.id === 'note_ret')).toBe(true);
    expect((await getCapabilityById(db.prisma, orgA, 'cap_ret')).status).toBe('revoked');
    expect(result.audit.action).toBe('return_task_to_owner');
  });

  it('atomically persists work requests as pending suggestions with note + audit', async () => {
    const current = await getTaskById(db.prisma, orgA, 'task_ret');
    // Re-assign for work-request path using a fresh assigned task
    await upsertRecipient(db.prisma, {
      organizationId: orgA,
      recipient: { ...recipient('rcp_wr'), email: 'work@example.com' },
    });
    const task = baseTask({
      id: asTaskId('task_wr'),
      version: 1,
      assignment: assignment({
        id: asAssignmentId('asg_wr'),
        recipientId: asRecipientId('rcp_wr'),
        intendedRecipientEmail: 'work@example.com',
        activeCapabilityId: 'cap_wr',
      }),
    });
    await createTask(db.prisma, orgA, task, task.assignment);

    const note: TaskNote = {
      id: 'note_wr',
      body: 'Please schedule a visit',
      createdAt: now,
      attribution: {
        kind: 'capability',
        capability: {
          capabilityId: asCapabilityId('cap_wr'),
          assignmentId: asAssignmentId('asg_wr'),
          taskId: asTaskId('task_wr'),
          intendedRecipientEmail: 'work@example.com',
          action: 'submit_work_request',
          recordedAt: now,
          outcome: 'succeeded',
        },
      },
    };
    const suggestion: TaskSuggestion = {
      id: asTaskSuggestionId('sug_wr'),
      organizationId: asOrganizationId(orgA),
      status: 'pending',
      summaryPoints: [
        {
          id: 'wr',
          kind: 'request',
          label: 'Work request',
          order: 0,
          value: 'Please schedule a visit',
        },
      ],
      voiceOriginated: false,
      retention: {},
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const bumped: Task = {
      ...task,
      notes: [note],
      version: 2,
      updatedAt: '2026-07-13T12:12:00.000Z',
    };

    const result = await persistWorkRequest({
      db: db.prisma,
      organizationId: orgA,
      expectedVersion: 1,
      task: bumped,
      note,
      suggestion,
      audit: {
        id: 'audit_wr',
        organizationId: orgA,
        actorKind: 'capability',
        capabilityId: 'cap_wr',
        assignmentId: 'asg_wr',
        taskId: 'task_wr',
        suggestionId: 'sug_wr',
        intendedRecipientEmail: 'work@example.com',
        action: 'submit_work_request',
        outcome: 'succeeded',
        resourceVersion: 2,
        requestId: 'req_wr',
        recordedAt: now,
      },
    });

    expect(result.suggestion.status).toBe('pending');
    expect(result.task.id).toBe('task_wr');
    expect(result.task.notes[0]?.body).toBe('Please schedule a visit');
    expect(result.audit.suggestionId).toBe('sug_wr');
    expect(current.id).toBe('task_ret');
  });

  it('atomically persists capability actions', async () => {
    const current = await getTaskById(db.prisma, orgA, 'task_wr');
    const note: TaskNote = {
      id: 'note_cap_action',
      body: 'Capability clarification',
      createdAt: now,
      attribution: {
        kind: 'capability',
        capability: {
          capabilityId: asCapabilityId('cap_wr'),
          assignmentId: asAssignmentId('asg_wr'),
          taskId: asTaskId('task_wr'),
          intendedRecipientEmail: 'work@example.com',
          action: 'request_clarification',
          recordedAt: now,
          outcome: 'succeeded',
        },
      },
    };
    const next: Task = {
      ...current,
      notes: [...current.notes, note],
      version: current.version + 1,
      updatedAt: '2026-07-13T12:15:00.000Z',
    };

    const result = await persistCapabilityAction({
      db: db.prisma,
      organizationId: orgA,
      expectedVersion: current.version,
      task: next,
      note,
      audit: {
        id: 'audit_clar',
        organizationId: orgA,
        actorKind: 'capability',
        capabilityId: 'cap_wr',
        assignmentId: 'asg_wr',
        taskId: 'task_wr',
        intendedRecipientEmail: 'work@example.com',
        action: 'request_clarification',
        outcome: 'succeeded',
        resourceVersion: next.version,
        taskStatus: next.status,
        recordedAt: now,
      },
    });

    expect(result.task.notes.some((n) => n.id === 'note_cap_action')).toBe(true);
    expect(result.audit.action).toBe('request_clarification');
  });

  it('keeps cleared assignment history and creates a new row on reassignment', async () => {
    await upsertRecipient(db.prisma, {
      organizationId: orgA,
      recipient: { ...recipient('rcp_hist_a'), email: 'hist-a@example.com' },
    });
    await upsertRecipient(db.prisma, {
      organizationId: orgA,
      recipient: { ...recipient('rcp_hist_b'), email: 'hist-b@example.com' },
    });

    const task = baseTask({
      id: asTaskId('task_hist'),
      version: 1,
      assignment: assignment({
        id: asAssignmentId('asg_hist_1'),
        recipientId: asRecipientId('rcp_hist_a'),
        intendedRecipientEmail: 'hist-a@example.com',
        activeCapabilityId: 'cap_hist_1',
      }),
    });
    await createTask(db.prisma, orgA, task, task.assignment);
    await createCapability(
      db.prisma,
      orgA,
      capability({
        id: asCapabilityId('cap_hist_1'),
        taskId: asTaskId('task_hist'),
        assignmentId: asAssignmentId('asg_hist_1'),
        recipientId: asRecipientId('rcp_hist_a'),
        intendedRecipientEmail: 'hist-a@example.com',
      }),
      'f'.repeat(64),
    );

    await persistReturnToOwner({
      db: db.prisma,
      organizationId: orgA,
      expectedVersion: 1,
      task: {
        ...task,
        assignment: undefined,
        version: 2,
        updatedAt: '2026-07-13T12:20:00.000Z',
      },
      capabilityId: 'cap_hist_1',
      revokedAt: '2026-07-13T12:20:00.000Z',
      audit: {
        id: 'audit_hist_ret',
        organizationId: orgA,
        actorKind: 'capability',
        capabilityId: 'cap_hist_1',
        assignmentId: 'asg_hist_1',
        taskId: 'task_hist',
        intendedRecipientEmail: 'hist-a@example.com',
        action: 'return_task_to_owner',
        outcome: 'succeeded',
        resourceVersion: 2,
        recordedAt: '2026-07-13T12:20:00.000Z',
      },
    });

    const afterReturn = await listTaskAssignments(db.prisma, orgA, 'task_hist');
    expect(afterReturn).toHaveLength(1);
    expect(afterReturn[0]).toMatchObject({
      id: 'asg_hist_1',
      intendedRecipientEmail: 'hist-a@example.com',
      clearedAt: '2026-07-13T12:20:00.000Z',
    });
    expect((await getTaskById(db.prisma, orgA, 'task_hist')).assignment).toBeUndefined();
    expect((await getCapabilityById(db.prisma, orgA, 'cap_hist_1')).assignmentId).toBe(
      'asg_hist_1',
    );
    expect((await getCapabilityById(db.prisma, orgA, 'cap_hist_1')).status).toBe('revoked');

    const reassigned = await createActiveAssignment(
      db.prisma,
      orgA,
      'task_hist',
      assignment({
        id: asAssignmentId('asg_hist_2'),
        recipientId: asRecipientId('rcp_hist_b'),
        intendedRecipientEmail: 'hist-b@example.com',
        assignedAt: '2026-07-13T12:21:00.000Z',
        activeCapabilityId: 'cap_hist_2',
      }),
    );
    expect(reassigned.id).toBe('asg_hist_2');

    await createCapability(
      db.prisma,
      orgA,
      capability({
        id: asCapabilityId('cap_hist_2'),
        taskId: asTaskId('task_hist'),
        assignmentId: asAssignmentId('asg_hist_2'),
        recipientId: asRecipientId('rcp_hist_b'),
        intendedRecipientEmail: 'hist-b@example.com',
      }),
      'g'.repeat(64),
    );

    const history = await listTaskAssignments(db.prisma, orgA, 'task_hist');
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      id: 'asg_hist_1',
      intendedRecipientEmail: 'hist-a@example.com',
      clearedAt: '2026-07-13T12:20:00.000Z',
    });
    expect(history[1]).toMatchObject({
      id: 'asg_hist_2',
      intendedRecipientEmail: 'hist-b@example.com',
      clearedAt: null,
    });

    const loaded = await getTaskById(db.prisma, orgA, 'task_hist');
    expect(loaded.assignment?.id).toBe('asg_hist_2');
    expect(loaded.assignment?.intendedRecipientEmail).toBe('hist-b@example.com');

    // Historical capability remains bound to original assignment; earlier recipient context untouched.
    expect((await getCapabilityById(db.prisma, orgA, 'cap_hist_1')).assignmentId).toBe(
      'asg_hist_1',
    );
    expect((await getCapabilityById(db.prisma, orgA, 'cap_hist_1')).intendedRecipientEmail).toBe(
      'hist-a@example.com',
    );
    expect((await getCapabilityById(db.prisma, orgA, 'cap_hist_2')).assignmentId).toBe(
      'asg_hist_2',
    );

    const audits = await listAuditEventsForTask(db.prisma, orgA, 'task_hist');
    const returnAudit = audits.find((e) => e.id === 'audit_hist_ret');
    expect(returnAudit?.assignmentId).toBe('asg_hist_1');
    expect(returnAudit?.intendedRecipientEmail).toBe('hist-a@example.com');
  });

  it('rejects a second active assignment for the same task', async () => {
    await upsertRecipient(db.prisma, {
      organizationId: orgA,
      recipient: { ...recipient('rcp_dup'), email: 'dup@example.com' },
    });
    const task = baseTask({
      id: asTaskId('task_dup'),
      version: 1,
      assignment: assignment({
        id: asAssignmentId('asg_dup_1'),
        recipientId: asRecipientId('rcp_dup'),
        intendedRecipientEmail: 'dup@example.com',
        activeCapabilityId: undefined,
      }),
    });
    await createTask(db.prisma, orgA, task, task.assignment);

    await expect(
      createActiveAssignment(
        db.prisma,
        orgA,
        'task_dup',
        assignment({
          id: asAssignmentId('asg_dup_2'),
          recipientId: asRecipientId('rcp_dup'),
          intendedRecipientEmail: 'dup@example.com',
          activeCapabilityId: undefined,
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNIQUE_VIOLATION' });

    const history = await listTaskAssignments(db.prisma, orgA, 'task_dup');
    expect(history).toHaveLength(1);
    expect(history[0]?.id).toBe('asg_dup_1');
    expect(history[0]?.clearedAt).toBeNull();
  });

  it('permits multiple cleared historical assignments', async () => {
    await upsertRecipient(db.prisma, {
      organizationId: orgA,
      recipient: { ...recipient('rcp_multi'), email: 'multi@example.com' },
    });
    const task = baseTask({
      id: asTaskId('task_multi'),
      version: 1,
      assignment: assignment({
        id: asAssignmentId('asg_multi_1'),
        recipientId: asRecipientId('rcp_multi'),
        intendedRecipientEmail: 'multi@example.com',
        activeCapabilityId: undefined,
      }),
    });
    await createTask(db.prisma, orgA, task, task.assignment);
    await clearAssignment(db.prisma, orgA, 'task_multi', '2026-07-13T12:30:00.000Z');
    await createActiveAssignment(
      db.prisma,
      orgA,
      'task_multi',
      assignment({
        id: asAssignmentId('asg_multi_2'),
        recipientId: asRecipientId('rcp_multi'),
        intendedRecipientEmail: 'multi@example.com',
        assignedAt: '2026-07-13T12:31:00.000Z',
        activeCapabilityId: undefined,
      }),
    );
    await clearAssignment(db.prisma, orgA, 'task_multi', '2026-07-13T12:32:00.000Z');
    await createActiveAssignment(
      db.prisma,
      orgA,
      'task_multi',
      assignment({
        id: asAssignmentId('asg_multi_3'),
        recipientId: asRecipientId('rcp_multi'),
        intendedRecipientEmail: 'multi@example.com',
        assignedAt: '2026-07-13T12:33:00.000Z',
        activeCapabilityId: undefined,
      }),
    );
    await clearAssignment(db.prisma, orgA, 'task_multi', '2026-07-13T12:34:00.000Z');

    const history = await listTaskAssignments(db.prisma, orgA, 'task_multi');
    expect(history).toHaveLength(3);
    expect(history.every((row) => row.clearedAt != null)).toBe(true);
    expect(history.map((row) => row.id)).toEqual(['asg_multi_1', 'asg_multi_2', 'asg_multi_3']);
    expect((await getTaskById(db.prisma, orgA, 'task_multi')).assignment).toBeUndefined();
  });

  it('rolls back failed reassignment and keeps the previous active assignment', async () => {
    await upsertRecipient(db.prisma, {
      organizationId: orgA,
      recipient: { ...recipient('rcp_rb_a'), email: 'rb-a@example.com' },
    });
    await upsertRecipient(db.prisma, {
      organizationId: orgA,
      recipient: { ...recipient('rcp_rb_b'), email: 'rb-b@example.com' },
    });
    const task = baseTask({
      id: asTaskId('task_rb'),
      version: 1,
      assignment: assignment({
        id: asAssignmentId('asg_rb_1'),
        recipientId: asRecipientId('rcp_rb_a'),
        intendedRecipientEmail: 'rb-a@example.com',
        activeCapabilityId: undefined,
      }),
    });
    await createTask(db.prisma, orgA, task, task.assignment);

    await expect(
      db.prisma.$transaction(async (tx) => {
        await clearAssignment(tx, orgA, 'task_rb', '2026-07-13T12:40:00.000Z');
        await createActiveAssignment(
          tx,
          orgA,
          'task_rb',
          assignment({
            id: asAssignmentId('asg_rb_2'),
            recipientId: asRecipientId('rcp_rb_b'),
            intendedRecipientEmail: 'rb-b@example.com',
            assignedAt: '2026-07-13T12:41:00.000Z',
            activeCapabilityId: undefined,
          }),
        );
        throw new Error('reassignment failed');
      }),
    ).rejects.toThrow(/reassignment failed/);

    const history = await listTaskAssignments(db.prisma, orgA, 'task_rb');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: 'asg_rb_1',
      intendedRecipientEmail: 'rb-a@example.com',
      clearedAt: null,
    });
    expect((await getTaskById(db.prisma, orgA, 'task_rb')).assignment?.id).toBe('asg_rb_1');
  });

  it('does not export a DATABASE_URL-bound factory that invents secrets', () => {
    expect(() => createPrismaClient(undefined)).toThrow(/DATABASE_URL/);
  });

  it('lists organization tasks with deterministic cursor pagination', async () => {
    const listOrg = 'org_list_only';
    await upsertRecipient(db.prisma, {
      organizationId: listOrg,
      recipient: recipient('rcp_list'),
    });
    const t1 = baseTask({
      id: asTaskId('task_list_1'),
      organizationId: asOrganizationId(listOrg),
      assignment: undefined,
      createdAt: '2026-07-13T10:00:00.000Z',
      updatedAt: '2026-07-13T10:00:00.000Z',
    });
    const t2 = baseTask({
      id: asTaskId('task_list_2'),
      organizationId: asOrganizationId(listOrg),
      assignment: undefined,
      createdAt: '2026-07-13T11:00:00.000Z',
      updatedAt: '2026-07-13T11:00:00.000Z',
    });
    const t3 = baseTask({
      id: asTaskId('task_list_3'),
      organizationId: asOrganizationId(listOrg),
      assignment: undefined,
      status: 'dismissed',
      createdAt: '2026-07-13T12:00:00.000Z',
      updatedAt: '2026-07-13T12:00:00.000Z',
    });
    await createTask(db.prisma, listOrg, t1);
    await createTask(db.prisma, listOrg, t2);
    await createTask(db.prisma, listOrg, t3);

    const page1 = await listTasks(db.prisma, { organizationId: listOrg, limit: 2 });
    expect(page1.items.map((t) => t.id)).toEqual(['task_list_3', 'task_list_2']);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await listTasks(db.prisma, {
      organizationId: listOrg,
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.items.map((t) => t.id)).toEqual(['task_list_1']);
    expect(page2.nextCursor).toBeNull();

    const foreign = await listTasks(db.prisma, { organizationId: orgB, limit: 10 });
    expect(foreign.items.every((t) => !t.id.startsWith('task_list_'))).toBe(true);
  });
});
