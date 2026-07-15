// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asCapabilityId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  ownerActor,
  type Recipient,
} from '@aicaa/domain';
import * as aicaaDb from '@aicaa/db';
import {
  createCapability,
  createTestDatabase,
  getCapabilityById,
  getTaskById,
  listAuditEventsForTask,
  listTaskAssignments,
  updateActiveAssignmentCapabilityBinding,
  upsertRecipient,
  type TestDatabase,
} from '@aicaa/db';
import { resetDbRuntimeForTests, setDbRuntimeForTests } from '@/lib/db/runtime-db';
import {
  TaskServiceError,
  addOwnerTaskNote,
  completeOwnerTask,
  createOwnerTask,
  dismissOwnerTask,
  getOwnerTask,
  listOwnerTasks,
  markOwnerTaskWaiting,
  requestOwnerClarification,
  resumeOwnerTask,
  returnOwnerTaskToOwner,
  snoozeOwnerTask,
  startOwnerTask,
} from '@/lib/tasks';

const org = 'org_tasks';
const orgOther = 'org_other';
const now = '2026-07-13T16:00:00.000Z';
const owner = ownerActor(asOwnerId('owner_tasks'), asOrganizationId(org));
const otherOwner = ownerActor(asOwnerId('owner_other'), asOrganizationId(orgOther));

function recipient(id = 'rcp_tasks', email = 'tasks-recipient@example.com'): Recipient {
  return {
    id: asRecipientId(id),
    displayName: 'Tasks Recipient',
    email,
    active: true,
  };
}

const summaryPoints = [
  {
    id: 'p1',
    kind: 'next_action' as const,
    label: 'Act',
    order: 0,
    value: 'Ship Phase 4A',
  },
];

describe('Owner task application services (Phase 4A)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    setDbRuntimeForTests(aicaaDb);
  });

  afterAll(async () => {
    await db.close();
    resetDbRuntimeForTests();
  });

  beforeEach(async () => {
    await db.prisma.auditEvent.deleteMany();
    await db.prisma.taskCapability.deleteMany();
    await db.prisma.taskNote.deleteMany();
    await db.prisma.taskAssignment.deleteMany();
    await db.prisma.taskSuggestion.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.recipient.deleteMany();
  });

  it('creates a standalone task with Owner audit and DTO etag', async () => {
    const result = await createOwnerTask({
      db: db.prisma,
      owner,
      now,
      summaryPoints,
      taskId: 'task_create_1',
      auditId: 'audit_create_1',
    });

    expect(result.task.id).toBe('task_create_1');
    expect(result.task.status).toBe('open');
    expect(result.task.etag).toBe('"task-task_create_1-v1"');
    expect(result.task.assignment).toBeUndefined();
    expect(JSON.stringify(result.task)).not.toMatch(/tokenHash|token_hash/);
    expect(result.audit.actorKind).toBe('owner');
    expect(result.audit.action).toBe('create_task');
  });

  it('creates with recipient assignment when recipient exists in org', async () => {
    await upsertRecipient(db.prisma, { organizationId: org, recipient: recipient() });
    const result = await createOwnerTask({
      db: db.prisma,
      owner,
      now,
      summaryPoints,
      recipientId: 'rcp_tasks',
      taskId: 'task_asg_1',
      assignmentId: 'asg_tasks_1',
    });

    expect(result.task.assignment?.recipientId).toBe('rcp_tasks');
    expect(result.task.assignment?.intendedRecipientEmail).toBe('tasks-recipient@example.com');
    expect(result.task.assignment?.allowedCapabilityActions).toContain('view_assigned_task');
  });

  it('rejects create with foreign or missing recipient', async () => {
    await expect(
      createOwnerTask({
        db: db.prisma,
        owner,
        now,
        summaryPoints,
        recipientId: 'missing',
        taskId: 'task_bad_rcp',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists and gets tasks with org isolation; GET causes no writes', async () => {
    await createOwnerTask({
      db: db.prisma,
      owner,
      now: '2026-07-13T16:01:00.000Z',
      summaryPoints,
      taskId: 'task_a',
    });
    await createOwnerTask({
      db: db.prisma,
      owner,
      now: '2026-07-13T16:02:00.000Z',
      summaryPoints,
      taskId: 'task_b',
    });
    await createOwnerTask({
      db: db.prisma,
      owner: otherOwner,
      now: '2026-07-13T16:03:00.000Z',
      summaryPoints,
      taskId: 'task_other',
    });

    const listed = await listOwnerTasks({ db: db.prisma, owner, now, limit: 10 });
    expect(listed.items.map((t) => t.id).sort()).toEqual(['task_a', 'task_b']);

    const page1 = await listOwnerTasks({ db: db.prisma, owner, now, limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await listOwnerTasks({
      db: db.prisma,
      owner,
      now,
      limit: 1,
      cursor: page1.nextCursor,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);

    await expect(
      getOwnerTask({ db: db.prisma, owner, taskId: 'task_other', now }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const before = await getTaskById(db.prisma, org, 'task_a');
    const got = await getOwnerTask({ db: db.prisma, owner, taskId: 'task_a', now });
    const after = await getTaskById(db.prisma, org, 'task_a');
    expect(got.version).toBe(before.version);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it('runs lifecycle mutations with concurrency and dismiss without delete', async () => {
    await createOwnerTask({
      db: db.prisma,
      owner,
      now,
      summaryPoints,
      taskId: 'task_life',
    });

    const started = await startOwnerTask({
      db: db.prisma,
      owner,
      taskId: 'task_life',
      now: '2026-07-13T16:10:00.000Z',
      expectedVersion: 1,
    });
    expect(started.task.status).toBe('in_progress');
    expect(started.task.version).toBe(2);

    await expect(
      startOwnerTask({
        db: db.prisma,
        owner,
        taskId: 'task_life',
        now: '2026-07-13T16:11:00.000Z',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    await expect(
      markOwnerTaskWaiting({
        db: db.prisma,
        owner,
        taskId: 'task_life',
        now: '2026-07-13T16:12:00.000Z',
        waitingUntil: '2026-07-14T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED' });

    const waiting = await markOwnerTaskWaiting({
      db: db.prisma,
      owner,
      taskId: 'task_life',
      now: '2026-07-13T16:12:00.000Z',
      expectedVersion: 2,
      waitingUntil: '2026-07-14T00:00:00.000Z',
    });
    expect(waiting.task.status).toBe('waiting');

    const resumed = await resumeOwnerTask({
      db: db.prisma,
      owner,
      taskId: 'task_life',
      now: '2026-07-13T16:13:00.000Z',
      expectedVersion: waiting.task.version,
    });
    expect(resumed.task.status).toBe('in_progress');

    const noted = await addOwnerTaskNote({
      db: db.prisma,
      owner,
      taskId: 'task_life',
      now: '2026-07-13T16:14:00.000Z',
      expectedVersion: resumed.task.version,
      body: 'Owner progress note',
      noteId: 'note_life_1',
    });
    expect(noted.task.notes?.some((n) => n.body === 'Owner progress note')).toBe(true);
    expect(noted.task.notes?.[noted.task.notes.length - 1]?.attribution.kind).toBe('owner');

    const snoozed = await snoozeOwnerTask({
      db: db.prisma,
      owner,
      taskId: 'task_life',
      now: '2026-07-13T16:15:00.000Z',
      expectedVersion: noted.task.version,
      nextReminderAt: '2026-07-15T09:00:00.000Z',
    });
    expect(snoozed.task.status).toBe('in_progress');
    expect(snoozed.task.reminder?.nextReminderAt).toBe('2026-07-15T09:00:00.000Z');

    const clarified = await requestOwnerClarification({
      db: db.prisma,
      owner,
      taskId: 'task_life',
      now: '2026-07-13T16:16:00.000Z',
      expectedVersion: snoozed.task.version,
      message: 'Need the vendor quote',
      noteId: 'note_clarify_1',
    });
    expect(clarified.task.status).toBe('in_progress');
    expect(clarified.task.notes?.some((n) => n.body === 'Need the vendor quote')).toBe(true);

    await createOwnerTask({
      db: db.prisma,
      owner,
      now,
      summaryPoints,
      taskId: 'task_dismiss',
    });
    const dismissed = await dismissOwnerTask({
      db: db.prisma,
      owner,
      taskId: 'task_dismiss',
      now: '2026-07-13T16:17:00.000Z',
      expectedVersion: 1,
      reason: 'duplicate',
    });
    expect(dismissed.task.status).toBe('dismissed');
    const stillThere = await getOwnerTask({
      db: db.prisma,
      owner,
      taskId: 'task_dismiss',
      now,
    });
    expect(stillThere.status).toBe('dismissed');

    const completed = await completeOwnerTask({
      db: db.prisma,
      owner,
      taskId: 'task_life',
      now: '2026-07-13T16:18:00.000Z',
      expectedVersion: clarified.task.version,
      outcomeType: 'completed',
      note: 'Done',
    });
    expect(completed.task.status).toBe('completed');
    expect(completed.task.outcome?.attribution.kind).toBe('owner');
  });

  it('returns to Owner atomically clearing assignment and revoking capability', async () => {
    await upsertRecipient(db.prisma, { organizationId: org, recipient: recipient() });
    const created = await createOwnerTask({
      db: db.prisma,
      owner,
      now,
      summaryPoints,
      recipientId: 'rcp_tasks',
      taskId: 'task_return',
      assignmentId: 'asg_return',
    });

    await createCapability(
      db.prisma,
      org,
      {
        id: asCapabilityId('cap_return'),
        taskId: created.task.id as never,
        assignmentId: 'asg_return' as never,
        recipientId: asRecipientId('rcp_tasks'),
        intendedRecipientEmail: 'tasks-recipient@example.com',
        scope: ['view_assigned_task', 'complete_task'],
        status: 'active',
        issuedAt: now,
        expiresAt: '2026-07-20T16:00:00.000Z',
        revokedAt: null,
      },
      'hash_return_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );

    await updateActiveAssignmentCapabilityBinding(db.prisma, org, 'task_return', {
      activeCapabilityId: 'cap_return',
      capabilityStatus: 'active',
    });

    const returned = await returnOwnerTaskToOwner({
      db: db.prisma,
      owner,
      taskId: 'task_return',
      now: '2026-07-13T16:30:00.000Z',
      expectedVersion: 1,
      note: 'Taking this back',
      noteId: 'note_return_1',
    });

    expect(returned.task.assignment).toBeUndefined();
    expect(returned.task.notes?.some((n) => n.body === 'Taking this back')).toBe(true);
    expect(returned.task.version).toBe(2);

    const history = await listTaskAssignments(db.prisma, org, 'task_return');
    expect(history).toHaveLength(1);
    expect(history[0]?.clearedAt).toBeTruthy();

    const cap = await getCapabilityById(db.prisma, org, 'cap_return');
    expect(cap.status).toBe('revoked');

    const audits = await listAuditEventsForTask(db.prisma, org, 'task_return');
    expect(audits.some((a) => a.action === 'return_task_to_owner')).toBe(true);
  });

  it('rejects capability actors and cross-organization mutation', async () => {
    await expect(
      createOwnerTask({
        db: db.prisma,
        owner: {
          kind: 'capability',
          capabilityId: 'cap_x',
          taskId: 't',
          assignmentId: 'a',
          intendedRecipientEmail: 'x@example.com',
          allowedActions: ['view_assigned_task'],
          status: 'active',
          expiresAt: now,
        } as never,
        now,
        summaryPoints,
        taskId: 'task_cap_actor',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await createOwnerTask({
      db: db.prisma,
      owner,
      now,
      summaryPoints,
      taskId: 'task_rb',
    });

    const current = await getOwnerTask({ db: db.prisma, owner, taskId: 'task_rb', now });
    await expect(
      dismissOwnerTask({
        db: db.prisma,
        owner: otherOwner,
        taskId: 'task_rb',
        now: '2026-07-13T17:01:00.000Z',
        expectedVersion: current.version,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Stale version failure leaves the task unchanged for a subsequent valid mutation.
    await expect(
      startOwnerTask({
        db: db.prisma,
        owner,
        taskId: 'task_rb',
        now: '2026-07-13T17:02:00.000Z',
        expectedVersion: 99,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    const unchanged = await getOwnerTask({ db: db.prisma, owner, taskId: 'task_rb', now });
    expect(unchanged.status).toBe('open');
    expect(unchanged.version).toBe(1);
  });

  it('maps domain invalid transitions and never exposes Prisma objects', async () => {
    await createOwnerTask({
      db: db.prisma,
      owner,
      now,
      summaryPoints,
      taskId: 'task_term',
    });
    await dismissOwnerTask({
      db: db.prisma,
      owner,
      taskId: 'task_term',
      now: '2026-07-13T17:02:00.000Z',
      expectedVersion: 1,
    });

    await expect(
      startOwnerTask({
        db: db.prisma,
        owner,
        taskId: 'task_term',
        now: '2026-07-13T17:03:00.000Z',
        expectedVersion: 2,
      }),
    ).rejects.toBeInstanceOf(TaskServiceError);

    const dto = await getOwnerTask({ db: db.prisma, owner, taskId: 'task_term', now });
    expect(dto).not.toHaveProperty('_count');
    expect(dto).not.toHaveProperty('assignments');
    expect(Object.keys(dto).sort()).toEqual(
      expect.arrayContaining([
        'id',
        'organizationId',
        'status',
        'summaryPoints',
        'version',
        'etag',
        'createdAt',
        'updatedAt',
      ]),
    );
  });
});
