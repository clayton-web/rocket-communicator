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
import {
  createTestDatabase,
  getTaskById,
  listAuditEventsForTask,
  upsertRecipient,
  type TestDatabase,
} from '@aicaa/db';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { deriveAvailableRecipientActions, issueCapabilityForTask } from '@/lib/capability';
import { loadCapabilityPageView } from '@/lib/capability/page-load';
import { createOwnerTask } from '@/lib/tasks';

const org = 'org_rcp_page';
const pepper = 'capability-pepper-value-32chars!!';
const appUrl = 'http://localhost:3000';
const now = '2026-07-13T19:00:00.000Z';
const owner = ownerActor(asOwnerId('owner_rcp_page'), asOrganizationId(org));
const ORIGINAL_ENV = { ...process.env };

function setEnv() {
  process.env.CAPABILITY_TOKEN_PEPPER = pepper;
  process.env.CAPABILITY_TTL_MS = String(DEFAULT_CAPABILITY_TTL_MS);
  process.env.NEXT_PUBLIC_APP_URL = appUrl;
}

function recipient(): Recipient {
  return {
    id: asRecipientId('rcp_page'),
    displayName: 'Page Recipient',
    email: 'page-recipient@example.com',
    active: true,
  };
}

describe('Recipient capability page loader + available actions', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    installDbTestRuntime(db.prisma);
  });

  afterAll(async () => {
    clearDbTestRuntime();
    await db.close();
    process.env = { ...ORIGINAL_ENV };
  });

  beforeEach(async () => {
    setEnv();
    await db.prisma.auditEvent.deleteMany();
    await db.prisma.taskCapability.deleteMany();
    await db.prisma.taskNote.deleteMany();
    await db.prisma.taskAssignment.deleteMany();
    await db.prisma.taskSuggestion.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.recipient.deleteMany();
  });

  async function seed(taskId = 'task_page_1') {
    await upsertRecipient(db.prisma, { organizationId: org, recipient: recipient() });
    const created = await createOwnerTask({
      db: db.prisma,
      owner,
      now,
      summaryPoints: [
        {
          id: 'p1',
          kind: 'next_action',
          label: 'Act',
          order: 0,
          value: 'Call the customer',
        },
      ],
      recipientId: 'rcp_page',
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
    return { created, issued };
  }

  it('resolves the bound task from token alone without mutating state', async () => {
    const { created, issued } = await seed();
    const before = await getTaskById(db.prisma, org, created.task.id);
    const auditsBefore = await listAuditEventsForTask(db.prisma, org, created.task.id);

    const view = await loadCapabilityPageView(issued.rawToken, now);
    expect(view.ok).toBe(true);
    if (!view.ok) {
      return;
    }
    expect(view.task.id).toBe(created.task.id);
    expect(view.task.summaryPoints[0]).toMatchObject({ value: 'Call the customer' });
    expect(view.permittedActions).toContain('view_assigned_task');
    expect(JSON.stringify(view)).not.toContain(issued.rawToken);
    expect(JSON.stringify(view)).not.toMatch(/tokenHash|pepper/i);

    const after = await getTaskById(db.prisma, org, created.task.id);
    expect(after.version).toBe(before.version);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(await listAuditEventsForTask(db.prisma, org, created.task.id)).toHaveLength(
      auditsBefore.length,
    );
  });

  it('collapses unknown, expired, and revoked tokens to unavailable', async () => {
    expect(await loadCapabilityPageView('u'.repeat(40), now)).toEqual({
      ok: false,
      reason: 'unavailable',
    });

    const { issued } = await seed('task_page_exp');
    await db.prisma.taskCapability.update({
      where: { id: issued.capability.id },
      data: { expiresAt: new Date('2000-01-01T00:00:00.000Z') },
    });
    expect(await loadCapabilityPageView(issued.rawToken, now)).toEqual({
      ok: false,
      reason: 'unavailable',
    });

    const active = await seed('task_page_rev');
    const { revokeCapabilityForOwner } = await import('@/lib/capability');
    await revokeCapabilityForOwner({
      db: db.prisma,
      owner,
      capabilityId: active.issued.capability.id,
      now: '2026-07-13T19:10:00.000Z',
    });
    expect(await loadCapabilityPageView(active.issued.rawToken, now)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('derives scoped actions from capability scope and task status', () => {
    expect(
      deriveAvailableRecipientActions(['view_assigned_task', 'complete_task'], 'open'),
    ).toEqual(['complete_task']);

    expect(
      deriveAvailableRecipientActions(
        ['view_assigned_task', 'mark_task_waiting', 'add_task_note'],
        'waiting',
      ),
    ).toEqual(['resume_task', 'add_task_note']);

    expect(
      deriveAvailableRecipientActions(
        ['view_assigned_task', 'mark_task_waiting', 'complete_task', 'return_task_to_owner'],
        'in_progress',
      ),
    ).toEqual(['mark_task_waiting', 'complete_task', 'return_task_to_owner']);

    expect(
      deriveAvailableRecipientActions(
        [
          'view_assigned_task',
          'complete_task',
          'mark_task_waiting',
          'add_task_note',
          'return_task_to_owner',
          'request_clarification',
          'submit_work_request',
        ],
        'completed',
      ),
    ).toEqual([]);
  });
});
