// @vitest-environment node
/**
 * Phase 4C — POST /api/v1/tasks/{taskId}/capabilities
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CAPABILITY_TTL_MS,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  formatETag,
  ownerActor,
  type Recipient,
} from '@aicaa/domain';
import {
  findActiveCapabilitiesForAssignment,
  findCapabilityByTokenHash,
  getCapabilityById,
  getTaskById,
  listAuditEventsForTask,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { hashCapabilityToken } from '@/lib/capability';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { POST as createTask } from '@/app/api/v1/tasks/route';
import { POST as issueCapability } from '@/app/api/v1/tasks/[taskId]/capabilities/route';

const org = 'org_http_cap';
const otherOrg = 'org_http_cap_other';
const owner = ownerActor(asOwnerId('owner_http_cap'), asOrganizationId(org));
const otherOwner = ownerActor(asOwnerId('owner_http_cap_other'), asOrganizationId(otherOrg));
const pepper = 'capability-pepper-value-32chars!!';

const ORIGINAL_ENV = { ...process.env };

function setCapabilityEnv(overrides: Record<string, string | undefined> = {}) {
  process.env.CAPABILITY_TOKEN_PEPPER = pepper;
  process.env.CAPABILITY_TTL_MS = String(DEFAULT_CAPABILITY_TTL_MS);
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function authOwner(actor = owner) {
  vi.mocked(getAuthenticatedOwner).mockResolvedValue({
    user: { id: actor.ownerId } as never,
    actor,
    session: {
      ownerId: actor.ownerId,
      organizationId: actor.organizationId,
      role: 'owner',
      displayName: 'Owner',
    },
  });
}

function summaryPoints() {
  return [
    {
      id: 'p1',
      kind: 'next_action',
      label: 'Act',
      order: 0,
      value: 'Do work',
    },
  ];
}

function recipient(): Recipient {
  return {
    id: asRecipientId('rcp_http_cap'),
    displayName: 'Capability Recipient',
    email: 'cap-recipient@example.com',
    active: true,
  };
}

function params(taskId: string) {
  return { params: Promise.resolve({ taskId }) };
}

function jsonRequest(url: string, method: string, body?: unknown, headers?: HeadersInit) {
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function rawRequest(url: string, method: string, init?: RequestInit) {
  return new Request(url, { method, ...init });
}

function expectNoSecrets(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/tokenHash|pepper|prisma/i);
}

describe('POST /api/v1/tasks/{taskId}/capabilities (Phase 4C)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    installDbTestRuntime(db.prisma);
  });

  afterAll(async () => {
    clearDbTestRuntime();
    await db.close();
  });

  beforeEach(async () => {
    vi.mocked(getAuthenticatedOwner).mockReset();
    setCapabilityEnv();
    await db.prisma.auditEvent.deleteMany();
    await db.prisma.taskCapability.deleteMany();
    await db.prisma.taskNote.deleteMany();
    await db.prisma.taskAssignment.deleteMany();
    await db.prisma.taskSuggestion.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.recipient.deleteMany();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  async function seedAssignedTask() {
    authOwner();
    const { upsertRecipient } = await import('@aicaa/db');
    await upsertRecipient(db.prisma, { organizationId: org, recipient: recipient() });
    const created = await createTask(
      jsonRequest('http://localhost/api/v1/tasks', 'POST', {
        summaryPoints: summaryPoints(),
        recipientId: 'rcp_http_cap',
      }),
    );
    expect(created.status).toBe(201);
    return (await created.json()) as {
      id: string;
      etag: string;
      assignment: { id: string; allowedCapabilityActions: string[] };
    };
  }

  describe('authentication', () => {
    it('rejects with no Owner session', async () => {
      vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
      const response = await issueCapability(
        jsonRequest(
          'http://localhost/api/v1/tasks/task_x/capabilities',
          'POST',
          {},
          {
            'if-match': formatETag('task', 'task_x', 1),
          },
        ),
        params('task_x'),
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'UNAUTHORIZED' },
      });
    });

    it('does not authorize via capability token headers', async () => {
      vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
      const response = await issueCapability(
        jsonRequest(
          'http://localhost/api/v1/tasks/task_x/capabilities',
          'POST',
          {},
          {
            'if-match': formatETag('task', 'task_x', 1),
            'x-capability-token': 'not-a-session',
            authorization: 'Bearer cap_token',
          },
        ),
        params('task_x'),
      );
      expect(response.status).toBe(401);
    });

    it('returns 404 for cross-organization tasks', async () => {
      const task = await seedAssignedTask();
      authOwner(otherOwner);
      const response = await issueCapability(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/capabilities`,
          'POST',
          {},
          { 'if-match': task.etag },
        ),
        params(task.id),
      );
      expect(response.status).toBe(404);
      expectNoSecrets(await response.json());
    });
  });

  describe('validation and concurrency', () => {
    it('rejects invalid JSON body', async () => {
      const task = await seedAssignedTask();
      const response = await issueCapability(
        rawRequest(`http://localhost/api/v1/tasks/${task.id}/capabilities`, 'POST', {
          headers: {
            'content-type': 'application/json',
            'if-match': task.etag,
          },
          body: '{bad',
        }),
        params(task.id),
      );
      expect(response.status).toBe(400);
    });

    it('rejects invalid scope values', async () => {
      const task = await seedAssignedTask();
      const response = await issueCapability(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/capabilities`,
          'POST',
          { scope: ['owner_only_action'] },
          { 'if-match': task.etag },
        ),
        params(task.id),
      );
      expect(response.status).toBe(400);
    });

    it('rejects missing If-Match with 428', async () => {
      const task = await seedAssignedTask();
      const response = await issueCapability(
        jsonRequest(`http://localhost/api/v1/tasks/${task.id}/capabilities`, 'POST', {}),
        params(task.id),
      );
      expect(response.status).toBe(428);
    });

    it('rejects malformed If-Match with 412', async () => {
      const task = await seedAssignedTask();
      const response = await issueCapability(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/capabilities`,
          'POST',
          {},
          { 'if-match': 'not-an-etag' },
        ),
        params(task.id),
      );
      expect(response.status).toBe(412);
    });

    it('rejects If-Match task-id mismatch with 412', async () => {
      const task = await seedAssignedTask();
      const response = await issueCapability(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/capabilities`,
          'POST',
          {},
          { 'if-match': formatETag('task', 'task_other', 1) },
        ),
        params(task.id),
      );
      expect(response.status).toBe(412);
    });

    it('rejects stale If-Match with 412 and creates no capability', async () => {
      const task = await seedAssignedTask();
      const before = await getTaskById(db.prisma, org, task.id);
      const response = await issueCapability(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/capabilities`,
          'POST',
          {},
          { 'if-match': formatETag('task', task.id, 99) },
        ),
        params(task.id),
      );
      expect(response.status).toBe(412);

      const actives = await findActiveCapabilitiesForAssignment(db.prisma, org, task.assignment.id);
      expect(actives).toHaveLength(0);
      const audits = await listAuditEventsForTask(db.prisma, org, task.id);
      expect(audits.some((a) => a.action === 'issue_task_capability')).toBe(false);

      const after = await getTaskById(db.prisma, org, task.id);
      expect(after.version).toBe(before.version);
      expect(after.updatedAt).toBe(before.updatedAt);
      expect(after.assignment?.activeCapabilityId ?? null).toBe(
        before.assignment?.activeCapabilityId ?? null,
      );
      expect(after.assignment?.capabilityStatus ?? null).toBe(
        before.assignment?.capabilityStatus ?? null,
      );
      expect(after.assignment?.allowedCapabilityActions).toEqual(
        before.assignment?.allowedCapabilityActions,
      );
    });
  });

  describe('issuance', () => {
    it('issues capability for assigned task and returns contracted DTO once', async () => {
      const task = await seedAssignedTask();
      const allowedBefore = [...task.assignment.allowedCapabilityActions];
      const before = await getTaskById(db.prisma, org, task.id);

      const response = await issueCapability(
        rawRequest(`http://localhost/api/v1/tasks/${task.id}/capabilities`, 'POST', {
          headers: { 'if-match': task.etag },
        }),
        params(task.id),
      );
      expect(response.status).toBe(201);
      expect(response.headers.get('etag')).toBeNull();

      const body = await response.json();
      expect(Object.keys(body).sort()).toEqual(
        ['assignmentId', 'capabilityId', 'capabilityPath', 'expiresAt', 'taskId', 'token'].sort(),
      );
      expect(body).toEqual({
        capabilityId: expect.any(String),
        taskId: task.id,
        assignmentId: task.assignment.id,
        expiresAt: expect.any(String),
        token: expect.stringMatching(/^[A-Za-z0-9_-]{32,}$/),
        capabilityPath: expect.stringMatching(/^\/c\/[A-Za-z0-9_-]+$/),
      });
      expect(body.capabilityPath).toBe(`/c/${body.token}`);
      expect(body.capabilityPath).not.toMatch(/^https?:\/\//);
      expectNoSecrets(body);
      expect(body).not.toHaveProperty('tokenHash');
      expect(body).not.toHaveProperty('pepper');
      expect(body).not.toHaveProperty('status');
      expect(body).not.toHaveProperty('permittedActions');
      expect(body).not.toHaveProperty('issuedAt');
      expect(body).not.toHaveProperty('intendedRecipientEmail');
      expect(body).not.toHaveProperty('capabilityUrl');

      const tokenHash = hashCapabilityToken(body.token, pepper);
      const persisted = await findCapabilityByTokenHash(db.prisma, tokenHash);
      expect(persisted).not.toBeNull();
      expect(persisted?.id).toBe(body.capabilityId);
      expect(persisted?.organizationId).toBe(org);
      expect(JSON.stringify(persisted)).not.toContain(body.token);
      expect(persisted?.expiresAt).toBe(body.expiresAt);

      const byId = await getCapabilityById(db.prisma, org, body.capabilityId);
      expect(byId.status).toBe('active');
      expect(byId.taskId).toBe(task.id);
      expect(byId.assignmentId).toBe(task.assignment.id);

      const reloaded = await getTaskById(db.prisma, org, task.id);
      expect(reloaded.version).toBe(before.version + 1);
      expect(reloaded.assignment?.allowedCapabilityActions).toEqual(allowedBefore);
      expect(reloaded.assignment?.activeCapabilityId).toBe(body.capabilityId);
      expect(reloaded.assignment?.id).toBe(body.assignmentId);
      expect(reloaded.id).toBe(body.taskId);

      const audits = await listAuditEventsForTask(db.prisma, org, task.id);
      const issueAudit = audits.find((a) => a.action === 'issue_task_capability');
      expect(issueAudit).toMatchObject({
        actorKind: 'owner',
        ownerId: owner.ownerId,
        capabilityId: body.capabilityId,
        assignmentId: task.assignment.id,
        taskId: task.id,
        outcome: 'succeeded',
        resourceVersion: before.version + 1,
      });
      expect(JSON.stringify(issueAudit)).not.toContain(body.token);
      expect(JSON.stringify(issueAudit)).not.toContain(tokenHash);
    });

    it('accepts a valid subset scope override', async () => {
      const task = await seedAssignedTask();
      const response = await issueCapability(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/capabilities`,
          'POST',
          { scope: ['view_assigned_task', 'complete_task'] },
          { 'if-match': task.etag },
        ),
        params(task.id),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      const persisted = await getCapabilityById(db.prisma, org, body.capabilityId);
      expect(persisted.scope).toEqual(['view_assigned_task', 'complete_task']);
    });
  });

  describe('conflict', () => {
    it('returns 409 when an active capability already exists and does not replace', async () => {
      const task = await seedAssignedTask();
      const first = await issueCapability(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/capabilities`,
          'POST',
          {},
          { 'if-match': task.etag },
        ),
        params(task.id),
      );
      expect(first.status).toBe(201);
      const firstBody = await first.json();

      const afterFirst = await getTaskById(db.prisma, org, task.id);
      const auditsAfterFirst = await listAuditEventsForTask(db.prisma, org, task.id);
      const capabilityCountAfterFirst = await db.prisma.taskCapability.count({
        where: { organizationId: org, taskId: task.id },
      });

      const second = await issueCapability(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/capabilities`,
          'POST',
          {},
          { 'if-match': formatETag('task', task.id, afterFirst.version) },
        ),
        params(task.id),
      );
      expect(second.status).toBe(409);
      const err = await second.json();
      expect(err).toMatchObject({ error: { code: 'DOMAIN_CONFLICT' } });
      expectNoSecrets(err);
      expect(JSON.stringify(err)).not.toContain(firstBody.token);

      const still = await getCapabilityById(db.prisma, org, firstBody.capabilityId);
      expect(still.status).toBe('active');
      const actives = await findActiveCapabilitiesForAssignment(db.prisma, org, task.assignment.id);
      expect(actives).toHaveLength(1);
      expect(actives[0]?.id).toBe(firstBody.capabilityId);

      const afterConflict = await getTaskById(db.prisma, org, task.id);
      expect(afterConflict.version).toBe(afterFirst.version);
      expect(afterConflict.assignment?.activeCapabilityId).toBe(firstBody.capabilityId);
      expect(afterConflict.assignment?.allowedCapabilityActions).toEqual(
        afterFirst.assignment?.allowedCapabilityActions,
      );

      const audits = await listAuditEventsForTask(db.prisma, org, task.id);
      expect(audits.filter((a) => a.action === 'issue_task_capability')).toHaveLength(1);
      expect(audits).toHaveLength(auditsAfterFirst.length);
      expect(
        await db.prisma.taskCapability.count({
          where: { organizationId: org, taskId: task.id },
        }),
      ).toBe(capabilityCountAfterFirst);
    });
  });

  describe('safety', () => {
    it('returns generic 500 when capability config is missing', async () => {
      const task = await seedAssignedTask();
      const before = await getTaskById(db.prisma, org, task.id);
      setCapabilityEnv({ CAPABILITY_TOKEN_PEPPER: undefined });
      const response = await issueCapability(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/capabilities`,
          'POST',
          {},
          { 'if-match': task.etag },
        ),
        params(task.id),
      );
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toMatchObject({
        error: { code: 'INTERNAL_ERROR', message: 'Capability issuance is not configured.' },
      });
      expect(JSON.stringify(body)).not.toMatch(/pepper|CAPABILITY_TOKEN|stack|Error:/i);

      const after = await getTaskById(db.prisma, org, task.id);
      expect(after.version).toBe(before.version);
      expect(after.assignment?.activeCapabilityId ?? null).toBe(
        before.assignment?.activeCapabilityId ?? null,
      );
      expect(
        await findActiveCapabilitiesForAssignment(db.prisma, org, task.assignment.id),
      ).toHaveLength(0);
      expect(
        (await listAuditEventsForTask(db.prisma, org, task.id)).some(
          (a) => a.action === 'issue_task_capability',
        ),
      ).toBe(false);
    });

    it('returns generic 500 for invalid TTL without exposing config values', async () => {
      const task = await seedAssignedTask();
      const before = await getTaskById(db.prisma, org, task.id);
      setCapabilityEnv({ CAPABILITY_TTL_MS: 'not-a-number' });
      const response = await issueCapability(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/capabilities`,
          'POST',
          {},
          { 'if-match': task.etag },
        ),
        params(task.id),
      );
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toMatchObject({
        error: { code: 'INTERNAL_ERROR', message: 'Capability issuance is not configured.' },
      });
      expect(JSON.stringify(body)).not.toMatch(/not-a-number|CAPABILITY_TTL|TTL/i);

      const after = await getTaskById(db.prisma, org, task.id);
      expect(after.version).toBe(before.version);
      expect(
        await findActiveCapabilitiesForAssignment(db.prisma, org, task.assignment.id),
      ).toHaveLength(0);
    });

    it('rejects scope broader than the assignment with 409', async () => {
      const task = await seedAssignedTask();
      // submit_work_request may not be on create-assignment default; pick an action beyond assignment
      const allowed = new Set(task.assignment.allowedCapabilityActions);
      const disallowed = [
        'view_assigned_task',
        'complete_task',
        'mark_task_waiting',
        'add_task_note',
        'record_completion_outcome',
        'return_task_to_owner',
        'request_clarification',
        'submit_work_request',
      ].find((a) => !allowed.has(a));
      expect(disallowed).toBeTruthy();

      const response = await issueCapability(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/capabilities`,
          'POST',
          { scope: ['view_assigned_task', disallowed] },
          { 'if-match': task.etag },
        ),
        params(task.id),
      );
      expect(response.status).toBe(409);
      expectNoSecrets(await response.json());
      const actives = await findActiveCapabilitiesForAssignment(db.prisma, org, task.assignment.id);
      expect(actives).toHaveLength(0);
    });

    it('does not create a Recipient session', async () => {
      const task = await seedAssignedTask();
      await issueCapability(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/capabilities`,
          'POST',
          {},
          { 'if-match': task.etag },
        ),
        params(task.id),
      );
      expect(getAuthenticatedOwner).toHaveBeenCalled();
      // No recipient auth surface is invoked by this route.
      expect(vi.mocked(getAuthenticatedOwner).mock.calls.length).toBeGreaterThan(0);
    });
  });
});
