// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CAPABILITY_TTL_MS,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  ownerActor,
  type Recipient,
} from '@aicaa/domain';
import * as aicaaDb from '@aicaa/db/runtime';
import {
  getCapabilityById,
  getTaskById,
  listAuditEventsForTask,
  listTaskAssignments,
  upsertRecipient,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { resetDbRuntimeForTests, setDbRuntimeForTests } from '@/lib/db/runtime-db';
import {
  RecipientCapabilityServiceError,
  addCapabilityTaskNote,
  completeCapabilityTask,
  getCapabilityTask,
  issueCapabilityForTask,
  markCapabilityTaskWaiting,
  requestCapabilityClarification,
  resumeCapabilityTask,
  returnCapabilityTaskToOwner,
  submitCapabilityWorkRequest,
} from '@/lib/capability';
import { createOwnerTask, startOwnerTask } from '@/lib/tasks';

const org = 'org_rcp_svc';
const now = '2026-07-13T17:00:00.000Z';
const pepper = 'capability-pepper-value-32chars!!';
const appUrl = 'http://localhost:3000';
const owner = ownerActor(asOwnerId('owner_rcp_svc'), asOrganizationId(org));

function recipient(): Recipient {
  return {
    id: asRecipientId('rcp_svc'),
    displayName: 'Service Recipient',
    email: 'svc-recipient@example.com',
    active: true,
  };
}

const summaryPoints = [
  {
    id: 'p1',
    kind: 'next_action' as const,
    label: 'Act',
    order: 0,
    value: 'Do the work',
  },
];

describe('Recipient capability application services (Phase 4D)', () => {
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

  async function seedAssignedIssued(taskId = 'task_rcp_1') {
    await upsertRecipient(db.prisma, { organizationId: org, recipient: recipient() });
    const created = await createOwnerTask({
      db: db.prisma,
      owner,
      now,
      summaryPoints,
      recipientId: 'rcp_svc',
      taskId,
      assignmentId: `asg_${taskId}`,
    });
    const issued = await issueCapabilityForTask({
      db: db.prisma,
      owner,
      taskId: created.task.id,
      ttlMs: DEFAULT_CAPABILITY_TTL_MS,
      pepper,
      appUrl,
      now,
      expectedVersion: created.task.version,
      capabilityId: `cap_${taskId}` as never,
    });
    return { created, issued, version: issued.task.version };
  }

  function baseCmd(taskId: string, rawToken: string, expectedVersion: number) {
    return {
      db: db.prisma,
      rawToken,
      pepper,
      taskId,
      now,
      expectedVersion,
    };
  }

  it('gets the assigned task without mutating state', async () => {
    const { created, issued, version } = await seedAssignedIssued();
    const before = await getTaskById(db.prisma, org, created.task.id);
    const auditsBefore = await listAuditEventsForTask(db.prisma, org, created.task.id);

    const dto = await getCapabilityTask({
      db: db.prisma,
      rawToken: issued.rawToken,
      pepper,
      taskId: created.task.id,
      now,
    });

    expect(dto.id).toBe(created.task.id);
    expect(dto.version).toBe(version);
    expect(JSON.stringify(dto)).not.toMatch(/tokenHash|pepper|rawToken/i);

    const after = await getTaskById(db.prisma, org, created.task.id);
    expect(after.version).toBe(before.version);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(await listAuditEventsForTask(db.prisma, org, created.task.id)).toHaveLength(
      auditsBefore.length,
    );
  });

  it('rejects wrong scope, wrong task, expired, and revoked with public-aligned codes', async () => {
    await upsertRecipient(db.prisma, { organizationId: org, recipient: recipient() });
    const created = await createOwnerTask({
      db: db.prisma,
      owner,
      now,
      summaryPoints,
      recipientId: 'rcp_svc',
      taskId: 'task_authz',
      assignmentId: 'asg_authz',
    });
    const issued = await issueCapabilityForTask({
      db: db.prisma,
      owner,
      taskId: created.task.id,
      ttlMs: DEFAULT_CAPABILITY_TTL_MS,
      pepper,
      appUrl,
      now,
      expectedVersion: created.task.version,
      scope: ['view_assigned_task', 'complete_task'],
      capabilityId: 'cap_authz' as never,
    });

    await expect(
      addCapabilityTaskNote({
        ...baseCmd(created.task.id, issued.rawToken, issued.task.version),
        body: 'Should fail scope',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      getCapabilityTask({
        db: db.prisma,
        rawToken: issued.rawToken,
        pepper,
        taskId: 'task_other_id',
        now,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      getCapabilityTask({
        db: db.prisma,
        rawToken: issued.rawToken,
        pepper,
        taskId: created.task.id,
        now: '2099-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Capability token is invalid.',
    });

    const active = await seedAssignedIssued('task_rev');
    const { revokeCapabilityForOwner } = await import('@/lib/capability');
    await revokeCapabilityForOwner({
      db: db.prisma,
      owner,
      capabilityId: active.issued.capability.id,
      now: '2026-07-13T17:10:00.000Z',
    });
    await expect(
      getCapabilityTask({
        db: db.prisma,
        rawToken: active.issued.rawToken,
        pepper,
        taskId: active.created.task.id,
        now: '2026-07-13T17:10:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('runs waiting, resume, note, clarification, and complete with version bumps and audit', async () => {
    const { created, issued, version: issuedVersion } = await seedAssignedIssued('task_life');
    let version = issuedVersion;
    const token = issued.rawToken;

    const started = await startOwnerTask({
      db: db.prisma,
      owner,
      taskId: created.task.id,
      now: '2026-07-13T17:01:00.000Z',
      expectedVersion: version,
    });
    version = started.task.version;

    const waiting = await markCapabilityTaskWaiting({
      ...baseCmd(created.task.id, token, version),
      waitingUntil: '2026-07-20T00:00:00.000Z',
    });
    expect(waiting.task.status).toBe('waiting');
    expect(waiting.task.version).toBe(version + 1);
    expect(waiting.audit.actorKind).toBe('capability');
    version = waiting.task.version;

    const resumed = await resumeCapabilityTask(baseCmd(created.task.id, token, version));
    expect(resumed.task.status).toBe('in_progress');
    version = resumed.task.version;

    const noted = await addCapabilityTaskNote({
      ...baseCmd(created.task.id, token, version),
      body: 'Recipient note',
    });
    expect(noted.task.notes.some((n) => n.body === 'Recipient note')).toBe(true);
    version = noted.task.version;

    const clarified = await requestCapabilityClarification({
      ...baseCmd(created.task.id, token, version),
      message: 'Need more info',
    });
    expect(clarified.task.notes.some((n) => n.body === 'Need more info')).toBe(true);
    version = clarified.task.version;

    const completed = await completeCapabilityTask({
      ...baseCmd(created.task.id, token, version),
      outcomeType: 'completed',
    });
    expect(completed.task.status).toBe('completed');
    expect(completed.task.version).toBe(version + 1);

    await expect(
      addCapabilityTaskNote({
        ...baseCmd(created.task.id, token, completed.task.version),
        body: 'after complete',
      }),
    ).rejects.toMatchObject({ code: 'DOMAIN_CONFLICT' });

    const audits = await listAuditEventsForTask(db.prisma, org, created.task.id);
    expect(
      audits.some((a) => a.action === 'mark_task_waiting' && a.actorKind === 'capability'),
    ).toBe(true);
    expect(audits.some((a) => a.action === 'complete_task')).toBe(true);
    expect(JSON.stringify(audits)).not.toContain(token);
  });

  it('returns to Owner atomically and keeps history', async () => {
    const { created, issued, version } = await seedAssignedIssued('task_ret');
    const result = await returnCapabilityTaskToOwner({
      ...baseCmd(created.task.id, issued.rawToken, version),
      note: 'Done on my side',
    });

    expect(result.task.assignment).toBeUndefined();
    expect(result.task.notes.some((n) => n.body === 'Done on my side')).toBe(true);
    expect(result.audit.action).toBe('return_task_to_owner');

    const cap = await getCapabilityById(db.prisma, org, issued.capability.id);
    expect(cap.status).toBe('revoked');
    const history = await listTaskAssignments(db.prisma, org, created.task.id);
    expect(history[0]?.clearedAt).toBeTruthy();

    await expect(
      getCapabilityTask({
        db: db.prisma,
        rawToken: issued.rawToken,
        pepper,
        taskId: created.task.id,
        now: '2026-07-13T17:30:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('submits a work request as a pending suggestion without creating a task', async () => {
    const { created, issued, version } = await seedAssignedIssued('task_wr');
    const beforeCount = await db.prisma.task.count({ where: { organizationId: org } });

    const result = await submitCapabilityWorkRequest({
      ...baseCmd(created.task.id, issued.rawToken, version),
      message: 'Please schedule a visit next week',
      suggestionId: 'sug_wr_1',
    });

    expect(result.response.suggestion.status).toBe('pending');
    expect(result.response.suggestion.id).toBe('sug_wr_1');
    expect(result.response.task?.id).toBe(created.task.id);
    expect(result.response.task?.version).toBe(version + 1);
    expect(result.audit.action).toBe('submit_work_request');
    expect(result.audit.suggestionId).toBe('sug_wr_1');

    expect(await db.prisma.task.count({ where: { organizationId: org } })).toBe(beforeCount);
    expect(JSON.stringify(result.response)).not.toMatch(/tokenHash|pepper/i);

    // Multi-use: capability still works for view.
    await expect(
      getCapabilityTask({
        db: db.prisma,
        rawToken: issued.rawToken,
        pepper,
        taskId: created.task.id,
        now: '2026-07-13T17:40:00.000Z',
      }),
    ).resolves.toMatchObject({ id: created.task.id });
  });

  it('requires expectedVersion and rolls back on stale concurrency', async () => {
    const { created, issued, version } = await seedAssignedIssued('task_conc');

    await expect(
      addCapabilityTaskNote({
        db: db.prisma,
        rawToken: issued.rawToken,
        pepper,
        taskId: created.task.id,
        now,
        body: 'missing version',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED' });

    await expect(
      addCapabilityTaskNote({
        ...baseCmd(created.task.id, issued.rawToken, 99),
        body: 'stale',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    const still = await getTaskById(db.prisma, org, created.task.id);
    expect(still.version).toBe(version);
    expect(still.notes).toHaveLength(0);
    expect(
      (await listAuditEventsForTask(db.prisma, org, created.task.id)).some(
        (a) => a.action === 'add_task_note',
      ),
    ).toBe(false);
  });

  it('does not expose secrets or Prisma fields on success or error', async () => {
    const { created, issued, version } = await seedAssignedIssued('task_safe');
    const ok = await addCapabilityTaskNote({
      ...baseCmd(created.task.id, issued.rawToken, version),
      body: 'safe',
    });
    expect(JSON.stringify(ok)).not.toMatch(/tokenHash|pepper|prisma/i);

    let err: unknown;
    try {
      await getCapabilityTask({
        db: db.prisma,
        rawToken: 'bogus-token-value-not-real-xxxxxx',
        pepper,
        taskId: created.task.id,
        now,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RecipientCapabilityServiceError);
    expect(JSON.stringify(err)).not.toMatch(/tokenHash|pepper|bogus-token/i);
  });
});
