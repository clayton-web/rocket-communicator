// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_CAPABILITY_TTL_MS,
  asAssignmentId,
  asCapabilityId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  capabilityAttributionLabel,
  ownerActor,
  type Task,
  type TaskAssignment,
  type Recipient,
} from '@aicaa/domain';
import { resetDbRuntimeForTests } from '@/lib/db/runtime-db';
import * as aicaaDb from '@aicaa/db/runtime';
import {
  createActiveAssignment,
  createTask,
  findCapabilityByTokenHash,
  getCapabilityById,
  getTaskById,
  listAuditEventsForTask,
  listTaskAssignments,
  persistReturnToOwner,
  updateTaskWithExpectedVersion,
  upsertRecipient,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { setDbRuntimeForTests } from '@/lib/db/runtime-db';
import {
  CapabilityTokenError,
  hashCapabilityToken,
  invalidateCapabilityOnAssignmentChangePersisted,
  issueCapabilityForTask,
  persistCapabilityExpiryIfNeeded,
  redactCapabilitySecrets,
  replaceCapabilityForTask,
  revokeCapabilityForOwner,
  validateCapabilityToken,
} from '@/lib/capability';

const org = 'org_cap';
const now = '2026-07-13T15:00:00.000Z';
const pepper = 'capability-pepper-value-32chars!!';
const appUrl = 'http://localhost:3000';
const owner = ownerActor(asOwnerId('owner_1'), asOrganizationId(org));

const DEFAULT_ALLOWED: TaskAssignment['allowedCapabilityActions'] = [
  'view_assigned_task',
  'complete_task',
  'add_task_note',
  'return_task_to_owner',
];

function recipient(id = 'rcp_1', email = 'recipient@example.com'): Recipient {
  return {
    id: asRecipientId(id),
    displayName: 'Alex Recipient',
    email,
    active: true,
  };
}

function assignment(overrides: Partial<TaskAssignment> = {}): TaskAssignment {
  return {
    id: asAssignmentId('asg_1'),
    recipientId: asRecipientId('rcp_1'),
    intendedRecipientEmail: 'recipient@example.com',
    assignedAt: now,
    assignedByOwnerId: asOwnerId('owner_1'),
    allowedCapabilityActions: [...DEFAULT_ALLOWED],
    ...overrides,
  };
}

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: asTaskId('task_cap'),
    organizationId: asOrganizationId(org),
    status: 'open',
    summaryPoints: [{ id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Do it' }],
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

function issueArgs(
  taskId: string,
  overrides: Partial<Parameters<typeof issueCapabilityForTask>[0]> = {},
) {
  return {
    db: db.prisma,
    owner,
    taskId,
    ttlMs: DEFAULT_CAPABILITY_TTL_MS,
    pepper,
    appUrl,
    now,
    ...overrides,
  };
}

let db: TestDatabase;

describe('capability issuance and validation (PGlite)', () => {
  beforeAll(async () => {
    setDbRuntimeForTests(aicaaDb);
    db = await createTestDatabase();
    await upsertRecipient(db.prisma, { organizationId: org, recipient: recipient() });
    await upsertRecipient(db.prisma, {
      organizationId: org,
      recipient: recipient('rcp_2', 'other@example.com'),
    });
    await createTask(db.prisma, org, baseTask(), assignment());
  });

  afterAll(async () => {
    await db.close();
    resetDbRuntimeForTests();
  });

  it('issues a capability scoped to assignment actions without rewriting the assignment', async () => {
    const before = await getTaskById(db.prisma, org, 'task_cap');
    const assignedActions = [...(before.assignment?.allowedCapabilityActions ?? [])];

    const issued = await issueCapabilityForTask(
      issueArgs('task_cap', {
        capabilityId: asCapabilityId('cap_issue_1'),
        auditId: 'audit_issue_1',
        requestId: 'req_issue_1',
      }),
    );

    expect(issued.rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(issued.capabilityUrl).toBe(`http://localhost:3000/c/${issued.rawToken}`);
    expect(issued.capability.id).toBe('cap_issue_1');
    expect(issued.capability.taskId).toBe('task_cap');
    expect(issued.capability.assignmentId).toBe('asg_1');
    expect(issued.capability.permittedActions).toEqual(assignedActions);
    expect(issued.capability.expiresAt).toBe('2026-07-20T15:00:00.000Z');
    expect(issued.capability.status).toBe('active');
    expect(issued.task.assignment?.activeCapabilityId).toBe('cap_issue_1');
    expect(issued.task.assignment?.allowedCapabilityActions).toEqual(assignedActions);
    expect(issued.task.assignment?.intendedRecipientEmail).toBe('recipient@example.com');
    expect(issued.audit.actorKind).toBe('owner');
    expect(issued.audit.action).toBe('issue_task_capability');

    expect(Object.keys(issued.capability)).not.toContain('tokenHash');
    expect(JSON.stringify(issued)).not.toContain('tokenHash');
    expect(JSON.stringify(issued)).not.toContain(pepper);
    expect(JSON.stringify(issued.audit)).not.toContain(issued.rawToken);

    const stored = await getCapabilityById(db.prisma, org, 'cap_issue_1');
    expect(stored.tokenHash).toBe(hashCapabilityToken(issued.rawToken, pepper));
    expect(JSON.stringify(stored)).not.toContain(issued.rawToken);
    expect(stored.scope).toEqual(assignedActions);

    const validated = await validateCapabilityToken({
      db: db.prisma,
      rawToken: issued.rawToken,
      pepper,
      now,
      mode: 'get',
      action: 'view_assigned_task',
      taskId: 'task_cap',
      assignmentId: 'asg_1',
    });
    expect(validated.actor.kind).toBe('capability');
    expect(validated.capability.id).toBe('cap_issue_1');

    await expect(
      validateCapabilityToken({
        db: db.prisma,
        rawToken: issued.rawToken,
        pepper,
        now,
        mode: 'mutation',
        action: 'request_clarification',
        taskId: 'task_cap',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SCOPE' });
  });

  it('rejects a second active issuance and requires atomic replacement', async () => {
    await expect(
      issueCapabilityForTask(
        issueArgs('task_cap', {
          now: '2026-07-13T15:10:00.000Z',
          capabilityId: asCapabilityId('cap_dup'),
        }),
      ),
    ).rejects.toMatchObject({ code: 'ISSUANCE_CONFLICT' });
  });

  it('rejects unknown tokens generically and does not mutate on validation', async () => {
    const before = await getCapabilityById(db.prisma, org, 'cap_issue_1');
    await expect(
      validateCapabilityToken({
        db: db.prisma,
        rawToken: 'unknown-token-value-with-enough-length________',
        pepper,
        now,
        mode: 'get',
        action: 'view_assigned_task',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CAPABILITY' });

    const after = await getCapabilityById(db.prisma, org, 'cap_issue_1');
    expect(after).toEqual(before);
  });

  it('atomically replaces a link without changing assignment details', async () => {
    const before = await getTaskById(db.prisma, org, 'task_cap');
    const assignedActions = [...(before.assignment?.allowedCapabilityActions ?? [])];
    const old = await getCapabilityById(db.prisma, org, 'cap_issue_1');
    const oldTokenHash = old.tokenHash;

    // Recover old raw token is impossible; issue a throwaway then replace uses current active.
    // Replace starting from cap_issue_1.
    // We need the raw token of the currently active link from the first test — store via re-hash lookup path only for old.
    // First test's raw token is not retained; perform replacement after issuing a known intermediate.
    // Revoke and re-issue cleanly for this focused case.
    await revokeCapabilityForOwner({
      db: db.prisma,
      owner,
      capabilityId: 'cap_issue_1',
      now: '2026-07-13T15:20:00.000Z',
      auditId: 'audit_rev_prep',
    });

    const first = await issueCapabilityForTask(
      issueArgs('task_cap', {
        now: '2026-07-13T15:21:00.000Z',
        capabilityId: asCapabilityId('cap_replace_old'),
        auditId: 'audit_replace_old',
      }),
    );

    const assignmentBeforeReplace = (await getTaskById(db.prisma, org, 'task_cap')).assignment!;

    const replaced = await replaceCapabilityForTask(
      issueArgs('task_cap', {
        now: '2026-07-13T15:22:00.000Z',
        capabilityId: asCapabilityId('cap_replace_new'),
        auditId: 'audit_replace_new',
      }),
    );

    expect(replaced.replacedCapabilityId).toBe('cap_replace_old');
    expect(replaced.capability.id).toBe('cap_replace_new');
    expect(replaced.audit.action).toBe('replace_task_capability');
    expect(JSON.stringify(replaced.audit)).not.toContain(first.rawToken);
    expect(JSON.stringify(replaced.audit)).not.toContain(replaced.rawToken);
    expect(JSON.stringify(replaced.audit)).not.toContain(oldTokenHash);
    expect(Object.keys(replaced.capability)).not.toContain('tokenHash');

    expect((await getCapabilityById(db.prisma, org, 'cap_replace_old')).status).toBe('revoked');
    expect((await getCapabilityById(db.prisma, org, 'cap_replace_new')).status).toBe('active');

    await expect(
      validateCapabilityToken({
        db: db.prisma,
        rawToken: first.rawToken,
        pepper,
        now: '2026-07-13T15:22:00.000Z',
        mode: 'get',
        action: 'view_assigned_task',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_REVOKED' });

    await expect(
      validateCapabilityToken({
        db: db.prisma,
        rawToken: replaced.rawToken,
        pepper,
        now: '2026-07-13T15:22:00.000Z',
        mode: 'get',
        action: 'view_assigned_task',
        taskId: 'task_cap',
        assignmentId: 'asg_1',
      }),
    ).resolves.toMatchObject({ capability: { id: 'cap_replace_new' } });

    const after = await getTaskById(db.prisma, org, 'task_cap');
    expect(after.assignment?.allowedCapabilityActions).toEqual(assignedActions);
    expect(after.assignment?.intendedRecipientEmail).toBe(
      assignmentBeforeReplace.intendedRecipientEmail,
    );
    expect(after.assignment?.recipientId).toBe(assignmentBeforeReplace.recipientId);
    expect(after.assignment?.id).toBe('asg_1');
  });

  it('rolls back replacement when persistence fails after revoke', async () => {
    const current = await getTaskById(db.prisma, org, 'task_cap');
    const activeId = current.assignment?.activeCapabilityId;
    expect(activeId).toBe('cap_replace_new');
    const beforeCap = await getCapabilityById(db.prisma, org, activeId!);

    await expect(
      replaceCapabilityForTask(
        issueArgs('task_cap', {
          now: '2026-07-13T15:30:00.000Z',
          capabilityId: asCapabilityId('cap_replace_new'), // duplicate id → unique failure
          auditId: 'audit_replace_fail',
        }),
      ),
    ).rejects.toBeTruthy();

    const afterCap = await getCapabilityById(db.prisma, org, activeId!);
    expect(afterCap.status).toBe('active');
    expect(afterCap.tokenHash).toBe(beforeCap.tokenHash);
    expect((await getTaskById(db.prisma, org, 'task_cap')).assignment?.activeCapabilityId).toBe(
      activeId,
    );
  });

  it('denies expired, revoked, wrong scope, wrong task, and wrong assignment', async () => {
    const issued = await replaceCapabilityForTask(
      issueArgs('task_cap', {
        now: '2026-07-13T16:00:00.000Z',
        capabilityId: asCapabilityId('cap_rules'),
        auditId: 'audit_rules',
      }),
    );

    await expect(
      validateCapabilityToken({
        db: db.prisma,
        rawToken: issued.rawToken,
        pepper,
        now: '2026-07-21T16:00:00.000Z',
        mode: 'get',
        action: 'view_assigned_task',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_EXPIRED' });

    await revokeCapabilityForOwner({
      db: db.prisma,
      owner,
      capabilityId: 'cap_rules',
      now: '2026-07-13T16:05:00.000Z',
      auditId: 'audit_rev_rules',
    });

    await expect(
      validateCapabilityToken({
        db: db.prisma,
        rawToken: issued.rawToken,
        pepper,
        now: '2026-07-13T16:06:00.000Z',
        mode: 'get',
        action: 'view_assigned_task',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_REVOKED' });

    const scoped = await issueCapabilityForTask(
      issueArgs('task_cap', {
        now: '2026-07-13T16:10:00.000Z',
        capabilityId: asCapabilityId('cap_scope'),
        auditId: 'audit_scope',
        scope: ['view_assigned_task'],
      }),
    );

    expect(scoped.capability.permittedActions).toEqual(['view_assigned_task']);
    expect(
      (await getTaskById(db.prisma, org, 'task_cap')).assignment?.allowedCapabilityActions,
    ).toEqual(DEFAULT_ALLOWED);

    await expect(
      validateCapabilityToken({
        db: db.prisma,
        rawToken: scoped.rawToken,
        pepper,
        now: '2026-07-13T16:10:00.000Z',
        mode: 'mutation',
        action: 'complete_task',
        taskId: 'task_cap',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SCOPE' });

    await expect(
      validateCapabilityToken({
        db: db.prisma,
        rawToken: scoped.rawToken,
        pepper,
        now: '2026-07-13T16:10:00.000Z',
        mode: 'get',
        action: 'view_assigned_task',
        taskId: 'task_other',
      }),
    ).rejects.toMatchObject({ code: 'WRONG_RESOURCE' });

    await expect(
      validateCapabilityToken({
        db: db.prisma,
        rawToken: scoped.rawToken,
        pepper,
        now: '2026-07-13T16:10:00.000Z',
        mode: 'get',
        action: 'view_assigned_task',
        taskId: 'task_cap',
        assignmentId: 'asg_missing',
      }),
    ).rejects.toMatchObject({ code: 'WRONG_RESOURCE' });

    await expect(
      issueCapabilityForTask(
        issueArgs('task_cap', {
          now: '2026-07-13T16:11:00.000Z',
          capabilityId: asCapabilityId('cap_bad_scope'),
          scope: ['view_assigned_task', 'submit_work_request'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'ISSUANCE_PRECONDITION' });
  });

  it('keeps multi-use capabilities valid and never transitions to used', async () => {
    const issued = await replaceCapabilityForTask(
      issueArgs('task_cap', {
        now: '2026-07-13T17:00:00.000Z',
        capabilityId: asCapabilityId('cap_multi'),
        auditId: 'audit_multi',
      }),
    );

    for (let i = 0; i < 3; i += 1) {
      const result = await validateCapabilityToken({
        db: db.prisma,
        rawToken: issued.rawToken,
        pepper,
        now: '2026-07-13T17:00:00.000Z',
        mode: 'mutation',
        action: 'add_task_note',
        taskId: 'task_cap',
      });
      expect(result.capability.status).toBe('active');
      expect(result.capability.status).not.toBe('used');
    }

    expect((await getCapabilityById(db.prisma, org, 'cap_multi')).status).toBe('active');
  });

  it('GET validation performs no database mutation', async () => {
    const issued = await replaceCapabilityForTask(
      issueArgs('task_cap', {
        now: '2026-07-13T17:30:00.000Z',
        capabilityId: asCapabilityId('cap_get'),
        auditId: 'audit_get',
      }),
    );
    const before = await getCapabilityById(db.prisma, org, 'cap_get');
    const taskBefore = await getTaskById(db.prisma, org, 'task_cap');

    await expect(
      validateCapabilityToken({
        db: db.prisma,
        rawToken: issued.rawToken,
        pepper,
        now: '2026-07-21T17:31:00.000Z',
        mode: 'get',
        action: 'view_assigned_task',
        taskId: 'task_cap',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_EXPIRED' });

    const after = await getCapabilityById(db.prisma, org, 'cap_get');
    expect(after.status).toBe('active');
    expect(after.expiresAt).toBe(before.expiresAt);
    expect(after.revokedAt ?? null).toBe(before.revokedAt ?? null);
    expect((await getTaskById(db.prisma, org, 'task_cap')).version).toBe(taskBefore.version);

    const normalized = await persistCapabilityExpiryIfNeeded({
      db: db.prisma,
      organizationId: org,
      capabilityId: 'cap_get',
      now: '2026-07-21T17:31:00.000Z',
    });
    expect(normalized?.status).toBe('expired');
  });

  it('denies mutation against terminal tasks', async () => {
    const task = await createTask(
      db.prisma,
      org,
      baseTask({
        id: asTaskId('task_done'),
        status: 'open',
        assignment: assignment({ id: asAssignmentId('asg_done') }),
      }),
      assignment({ id: asAssignmentId('asg_done') }),
    );
    const issued = await issueCapabilityForTask(
      issueArgs(task.id, {
        now: '2026-07-13T18:00:00.000Z',
        capabilityId: asCapabilityId('cap_done'),
        auditId: 'audit_done',
      }),
    );

    const current = await getTaskById(db.prisma, org, 'task_done');
    await updateTaskWithExpectedVersion(db.prisma, org, current.version, {
      ...current,
      status: 'completed',
      version: current.version + 1,
      updatedAt: '2026-07-13T18:01:00.000Z',
    });

    await expect(
      validateCapabilityToken({
        db: db.prisma,
        rawToken: issued.rawToken,
        pepper,
        now: '2026-07-13T18:02:00.000Z',
        mode: 'mutation',
        action: 'complete_task',
        taskId: 'task_done',
      }),
    ).rejects.toMatchObject({ code: 'TERMINAL_TASK' });
  });

  it('supports return-to-Owner invalidation and reassignment with a new capability', async () => {
    const task = await createTask(
      db.prisma,
      org,
      baseTask({
        id: asTaskId('task_ret'),
        assignment: assignment({
          id: asAssignmentId('asg_ret_1'),
          recipientId: asRecipientId('rcp_1'),
        }),
      }),
      assignment({ id: asAssignmentId('asg_ret_1') }),
    );

    const first = await issueCapabilityForTask(
      issueArgs(task.id, {
        now: '2026-07-13T19:00:00.000Z',
        capabilityId: asCapabilityId('cap_ret_1'),
        auditId: 'audit_ret_issue',
      }),
    );

    const loaded = await getTaskById(db.prisma, org, 'task_ret');
    await persistReturnToOwner({
      db: db.prisma,
      organizationId: org,
      expectedVersion: loaded.version,
      task: {
        ...loaded,
        assignment: undefined,
        version: loaded.version + 1,
        updatedAt: '2026-07-13T19:01:00.000Z',
      },
      capabilityId: 'cap_ret_1',
      revokedAt: '2026-07-13T19:01:00.000Z',
      audit: {
        id: 'audit_ret',
        organizationId: org,
        actorKind: 'capability',
        capabilityId: 'cap_ret_1',
        assignmentId: 'asg_ret_1',
        taskId: 'task_ret',
        intendedRecipientEmail: 'recipient@example.com',
        action: 'return_task_to_owner',
        outcome: 'succeeded',
        attributionLabel: capabilityAttributionLabel(
          'recipient@example.com',
          'return_task_to_owner',
        ),
        recordedAt: '2026-07-13T19:01:00.000Z',
      },
    });

    expect((await getCapabilityById(db.prisma, org, 'cap_ret_1')).status).toBe('revoked');
    await expect(
      validateCapabilityToken({
        db: db.prisma,
        rawToken: first.rawToken,
        pepper,
        now: '2026-07-13T19:02:00.000Z',
        mode: 'get',
        action: 'view_assigned_task',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_REVOKED' });

    await createActiveAssignment(
      db.prisma,
      org,
      'task_ret',
      assignment({
        id: asAssignmentId('asg_ret_2'),
        recipientId: asRecipientId('rcp_2'),
        intendedRecipientEmail: 'other@example.com',
        assignedAt: '2026-07-13T19:03:00.000Z',
      }),
    );

    const second = await issueCapabilityForTask(
      issueArgs('task_ret', {
        now: '2026-07-13T19:04:00.000Z',
        capabilityId: asCapabilityId('cap_ret_2'),
        auditId: 'audit_ret_issue_2',
      }),
    );

    const history = await listTaskAssignments(db.prisma, org, 'task_ret');
    expect(history.map((row) => row.id)).toEqual(['asg_ret_1', 'asg_ret_2']);
    expect((await getCapabilityById(db.prisma, org, 'cap_ret_1')).assignmentId).toBe('asg_ret_1');
    expect((await getCapabilityById(db.prisma, org, 'cap_ret_2')).assignmentId).toBe('asg_ret_2');

    const ok = await validateCapabilityToken({
      db: db.prisma,
      rawToken: second.rawToken,
      pepper,
      now: '2026-07-13T19:04:00.000Z',
      mode: 'get',
      action: 'view_assigned_task',
      taskId: 'task_ret',
    });
    expect(ok.capability.id).toBe('cap_ret_2');

    const audits = await listAuditEventsForTask(db.prisma, org, 'task_ret');
    const returnAudit = audits.find((e) => e.id === 'audit_ret');
    expect(returnAudit?.attributionLabel).toMatch(/capability link assigned to/i);
    expect(returnAudit?.attributionLabel).not.toMatch(/verified recipient|authenticated/i);
    expect(JSON.stringify(returnAudit)).not.toContain(first.rawToken);
  });

  it('invalidates prior capability on assignment change without rewriting history', async () => {
    const task = await createTask(
      db.prisma,
      org,
      baseTask({
        id: asTaskId('task_chg'),
        assignment: assignment({ id: asAssignmentId('asg_chg_1') }),
      }),
      assignment({ id: asAssignmentId('asg_chg_1') }),
    );
    const issued = await issueCapabilityForTask(
      issueArgs(task.id, {
        now: '2026-07-13T20:00:00.000Z',
        capabilityId: asCapabilityId('cap_chg_1'),
        auditId: 'audit_chg',
      }),
    );

    await invalidateCapabilityOnAssignmentChangePersisted({
      db: db.prisma,
      organizationId: org,
      capabilityId: 'cap_chg_1',
      now: '2026-07-13T20:01:00.000Z',
    });

    expect((await getCapabilityById(db.prisma, org, 'cap_chg_1')).status).toBe('revoked');
    expect(
      (await findCapabilityByTokenHash(db.prisma, hashCapabilityToken(issued.rawToken, pepper)))
        ?.status,
    ).toBe('revoked');
  });

  it('fails issuance without an active assignment and keeps secrets out of errors', async () => {
    await createTask(
      db.prisma,
      org,
      baseTask({
        id: asTaskId('task_no_asg'),
        assignment: undefined,
      }),
    );

    await expect(
      issueCapabilityForTask(
        issueArgs('task_no_asg', {
          capabilityId: asCapabilityId('cap_no_asg'),
        }),
      ),
    ).rejects.toBeInstanceOf(CapabilityTokenError);

    try {
      await issueCapabilityForTask(
        issueArgs('task_no_asg', {
          capabilityId: asCapabilityId('cap_no_asg_2'),
          random: () => Buffer.alloc(32, 7),
        }),
      );
    } catch (error) {
      const token = Buffer.alloc(32, 7).toString('base64url');
      const hash = hashCapabilityToken(token, pepper);
      expect(String(error)).not.toContain(token);
      expect(String(error)).not.toContain(hash);
      expect(redactCapabilitySecrets(`http://localhost:3000/c/${token}`)).not.toContain(token);
    }

    expect(await listAuditEventsForTask(db.prisma, org, 'task_no_asg')).toHaveLength(0);
  });

  it('uses truthful capability attribution wording', () => {
    const label = capabilityAttributionLabel('recipient@example.com', 'complete_task');
    expect(label).toBe(
      'Action performed through capability link assigned to recipient@example.com (complete task)',
    );
    expect(label).not.toMatch(/authenticated|verified recipient|Sarah completed/i);
  });
});
