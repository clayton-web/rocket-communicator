// @vitest-environment node
/**
 * Phase 4E — Recipient capability HTTP routes
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
  createTestDatabase,
  getCapabilityById,
  getTaskById,
  listAuditEventsForTask,
  listTaskAssignments,
  upsertRecipient,
  type TestDatabase,
} from '@aicaa/db';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { issueCapabilityForTask, revokeCapabilityForOwner } from '@/lib/capability';
import { createOwnerTask, startOwnerTask } from '@/lib/tasks';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { GET as getCapabilityTaskRoute } from '@/app/api/v1/capabilities/[token]/tasks/[taskId]/route';
import { POST as markWaiting } from '@/app/api/v1/capabilities/[token]/tasks/[taskId]/waiting/route';
import { POST as resume } from '@/app/api/v1/capabilities/[token]/tasks/[taskId]/resume/route';
import { POST as complete } from '@/app/api/v1/capabilities/[token]/tasks/[taskId]/complete/route';
import { POST as addNote } from '@/app/api/v1/capabilities/[token]/tasks/[taskId]/notes/route';
import { POST as returnToOwner } from '@/app/api/v1/capabilities/[token]/tasks/[taskId]/return-to-owner/route';
import { POST as requestClarification } from '@/app/api/v1/capabilities/[token]/tasks/[taskId]/clarification-requests/route';
import { POST as submitWorkRequest } from '@/app/api/v1/capabilities/[token]/tasks/[taskId]/work-requests/route';

const org = 'org_rcp_http';
const pepper = 'capability-pepper-value-32chars!!';
const appUrl = 'http://localhost:3000';
const now = '2026-07-13T18:00:00.000Z';
const owner = ownerActor(asOwnerId('owner_rcp_http'), asOrganizationId(org));
const ORIGINAL_ENV = { ...process.env };

function setCapabilityEnv() {
  process.env.CAPABILITY_TOKEN_PEPPER = pepper;
  process.env.CAPABILITY_TTL_MS = String(DEFAULT_CAPABILITY_TTL_MS);
  process.env.NEXT_PUBLIC_APP_URL = appUrl;
}

function recipient(): Recipient {
  return {
    id: asRecipientId('rcp_http'),
    displayName: 'HTTP Recipient',
    email: 'http-recipient@example.com',
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

function params(token: string, taskId: string) {
  return { params: Promise.resolve({ token, taskId }) };
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

function etag(taskId: string, version: number) {
  return formatETag('task', taskId, version);
}

function expectNoSecrets(body: unknown, rawToken?: string) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/tokenHash|pepper|prisma/i);
  expect(text).not.toMatch(/CAPABILITY_EXPIRED|CAPABILITY_REVOKED/);
  if (rawToken) {
    expect(text).not.toContain(rawToken);
  }
}

function authOwner() {
  vi.mocked(getAuthenticatedOwner).mockResolvedValue({
    user: { id: owner.ownerId } as never,
    actor: owner,
    session: {
      ownerId: owner.ownerId,
      organizationId: owner.organizationId,
      role: 'owner',
      displayName: 'Owner',
    },
  });
}

describe('Recipient capability HTTP routes (Phase 4E)', () => {
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
    vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
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

  async function seedAssignedIssued(
    taskId = 'task_rcp_http',
    scope?: import('@aicaa/domain').CapabilityScope,
  ) {
    await upsertRecipient(db.prisma, { organizationId: org, recipient: recipient() });
    const created = await createOwnerTask({
      db: db.prisma,
      owner,
      now,
      summaryPoints,
      recipientId: 'rcp_http',
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
      scope,
    });
    return { created, issued, version: issued.task.version, token: issued.rawToken };
  }

  describe('authorization', () => {
    it('succeeds with a valid capability and no Owner session', async () => {
      const { created, token, version } = await seedAssignedIssued();
      const response = await getCapabilityTaskRoute(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${token}/tasks/${created.task.id}`,
          'GET',
        ),
        params(token, created.task.id),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe(created.task.id);
      expect(response.headers.get('etag')).toBe(body.etag);
      expect(body.etag).toBe(etag(created.task.id, version));
      expectNoSecrets(body, token);
      expect(response.headers.get('set-cookie')).toBeNull();
    });

    it('does not authorize with Owner session alone', async () => {
      const { created } = await seedAssignedIssued('task_owner_only');
      authOwner();
      const bogus = 'a'.repeat(32);
      const response = await getCapabilityTaskRoute(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${bogus}/tasks/${created.task.id}`,
          'GET',
          undefined,
          { cookie: 'sb-access-token=fake', authorization: 'Bearer owner' },
        ),
        params(bogus, created.task.id),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    });

    it('ignores X-Capability-Token and requires the path token', async () => {
      const { created, token } = await seedAssignedIssued('task_hdr');
      const response = await addNote(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${'b'.repeat(32)}/tasks/${created.task.id}/notes`,
          'POST',
          { body: 'ignored header', confirmation: 'confirmed' },
          {
            'if-match': etag(created.task.id, 1),
            'x-capability-token': token,
          },
        ),
        params('b'.repeat(32), created.task.id),
      );
      expect(response.status).toBe(401);
    });

    it('returns 401 for unknown, expired, and revoked tokens', async () => {
      const seeded = await seedAssignedIssued('task_authz');

      const unknown = await getCapabilityTaskRoute(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${'u'.repeat(40)}/tasks/${seeded.created.task.id}`,
          'GET',
        ),
        params('u'.repeat(40), seeded.created.task.id),
      );
      expect(unknown.status).toBe(401);
      expect(await unknown.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });

      await db.prisma.taskCapability.update({
        where: { id: seeded.issued.capability.id },
        data: { expiresAt: new Date('2000-01-01T00:00:00.000Z') },
      });
      const expired = await getCapabilityTaskRoute(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${seeded.token}/tasks/${seeded.created.task.id}`,
          'GET',
        ),
        params(seeded.token, seeded.created.task.id),
      );
      expect(expired.status).toBe(401);
      expectNoSecrets(await expired.json(), seeded.token);

      const active = await seedAssignedIssued('task_rev');
      await revokeCapabilityForOwner({
        db: db.prisma,
        owner,
        capabilityId: active.issued.capability.id,
        now: '2026-07-13T18:10:00.000Z',
      });
      const revoked = await getCapabilityTaskRoute(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${active.token}/tasks/${active.created.task.id}`,
          'GET',
        ),
        params(active.token, active.created.task.id),
      );
      expect(revoked.status).toBe(401);
      expect(await revoked.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    });

    it('returns 403 for insufficient scope and 404 for wrong task', async () => {
      const narrow = await seedAssignedIssued('task_scope', [
        'view_assigned_task',
        'complete_task',
      ]);
      const forbidden = await addNote(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${narrow.token}/tasks/${narrow.created.task.id}/notes`,
          'POST',
          { body: 'nope', confirmation: 'confirmed' },
          { 'if-match': etag(narrow.created.task.id, narrow.version) },
        ),
        params(narrow.token, narrow.created.task.id),
      );
      expect(forbidden.status).toBe(403);
      expect(await forbidden.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });

      const wrong = await getCapabilityTaskRoute(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${narrow.token}/tasks/task_other_id`,
          'GET',
        ),
        params(narrow.token, 'task_other_id'),
      );
      expect(wrong.status).toBe(404);
      expect(await wrong.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });
  });

  describe('GET /tasks/{taskId}', () => {
    it('returns Task + ETag without mutating state', async () => {
      const { created, token, version } = await seedAssignedIssued('task_get');
      const before = await getTaskById(db.prisma, org, created.task.id);
      const auditsBefore = await listAuditEventsForTask(db.prisma, org, created.task.id);

      const response = await getCapabilityTaskRoute(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${token}/tasks/${created.task.id}`,
          'GET',
        ),
        params(token, created.task.id),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(response.headers.get('etag')).toBe(body.etag);
      expect(body.version).toBe(version);
      expectNoSecrets(body, token);

      const after = await getTaskById(db.prisma, org, created.task.id);
      expect(after.version).toBe(before.version);
      expect(after.updatedAt).toBe(before.updatedAt);
      expect(await listAuditEventsForTask(db.prisma, org, created.task.id)).toHaveLength(
        auditsBefore.length,
      );
      const cap = await getCapabilityById(db.prisma, org, `cap_task_get`);
      expect(cap.status).toBe('active');
      expect(cap.lastUsedAt ?? null).toBeNull();
    });
  });

  describe('confirmation gate', () => {
    it('rejects missing and invalid confirmation without writing', async () => {
      const { created, token, version } = await seedAssignedIssued('task_confirm');
      const auditsBefore = await listAuditEventsForTask(db.prisma, org, created.task.id);

      const missing = await addNote(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${token}/tasks/${created.task.id}/notes`,
          'POST',
          { body: 'hello' },
          { 'if-match': etag(created.task.id, version) },
        ),
        params(token, created.task.id),
      );
      expect(missing.status).toBe(400);
      expect(await missing.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

      const invalid = await addNote(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${token}/tasks/${created.task.id}/notes`,
          'POST',
          { body: 'hello', confirmation: 'yes' },
          { 'if-match': etag(created.task.id, version) },
        ),
        params(token, created.task.id),
      );
      expect(invalid.status).toBe(400);

      const still = await getTaskById(db.prisma, org, created.task.id);
      expect(still.version).toBe(version);
      expect(still.notes).toHaveLength(0);
      expect(await listAuditEventsForTask(db.prisma, org, created.task.id)).toHaveLength(
        auditsBefore.length,
      );
    });
  });

  describe('If-Match', () => {
    it('enforces missing, malformed, mismatched, and stale ETags', async () => {
      const { created, token, version } = await seedAssignedIssued('task_etag');
      const url = `http://localhost/api/v1/capabilities/${token}/tasks/${created.task.id}/notes`;

      const missing = await addNote(
        jsonRequest(url, 'POST', { body: 'x', confirmation: 'confirmed' }),
        params(token, created.task.id),
      );
      expect(missing.status).toBe(428);

      const malformed = await addNote(
        jsonRequest(url, 'POST', { body: 'x', confirmation: 'confirmed' }, { 'if-match': 'bogus' }),
        params(token, created.task.id),
      );
      expect(malformed.status).toBe(412);

      const mismatch = await addNote(
        jsonRequest(
          url,
          'POST',
          { body: 'x', confirmation: 'confirmed' },
          { 'if-match': etag('task_other', version) },
        ),
        params(token, created.task.id),
      );
      expect(mismatch.status).toBe(412);

      const stale = await addNote(
        jsonRequest(
          url,
          'POST',
          { body: 'x', confirmation: 'confirmed' },
          { 'if-match': etag(created.task.id, 99) },
        ),
        params(token, created.task.id),
      );
      expect(stale.status).toBe(412);

      const ok = await addNote(
        jsonRequest(
          url,
          'POST',
          { body: 'ok note', confirmation: 'confirmed' },
          { 'if-match': etag(created.task.id, version) },
        ),
        params(token, created.task.id),
      );
      expect(ok.status).toBe(200);
      expect((await ok.json()).notes.some((n: { body: string }) => n.body === 'ok note')).toBe(
        true,
      );
    });
  });

  describe('mutations', () => {
    it('runs waiting, resume, note, clarification, and complete', async () => {
      const { created, token, version: issuedVersion } = await seedAssignedIssued('task_life');
      let version = issuedVersion;
      const started = await startOwnerTask({
        db: db.prisma,
        owner,
        taskId: created.task.id,
        now: '2026-07-13T18:01:00.000Z',
        expectedVersion: version,
      });
      version = started.task.version;

      const waiting = await markWaiting(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${token}/tasks/${created.task.id}/waiting`,
          'POST',
          {
            waitingUntil: '2026-07-20T00:00:00.000Z',
            reason: 'hold',
            confirmation: 'confirmed',
          },
          { 'if-match': etag(created.task.id, version) },
        ),
        params(token, created.task.id),
      );
      expect(waiting.status).toBe(200);
      expect((await waiting.json()).status).toBe('waiting');
      version += 1;

      const resumed = await resume(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${token}/tasks/${created.task.id}/resume`,
          'POST',
          { confirmation: 'confirmed' },
          { 'if-match': etag(created.task.id, version) },
        ),
        params(token, created.task.id),
      );
      expect(resumed.status).toBe(200);
      expect((await resumed.json()).status).toBe('in_progress');
      version += 1;

      const clarified = await requestClarification(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${token}/tasks/${created.task.id}/clarification-requests`,
          'POST',
          { message: 'Need details', confirmation: 'confirmed' },
          { 'if-match': etag(created.task.id, version) },
        ),
        params(token, created.task.id),
      );
      expect(clarified.status).toBe(200);
      version += 1;

      const done = await complete(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${token}/tasks/${created.task.id}/complete`,
          'POST',
          { outcomeType: 'completed', confirmation: 'confirmed' },
          { 'if-match': etag(created.task.id, version) },
        ),
        params(token, created.task.id),
      );
      expect(done.status).toBe(200);
      expect((await done.json()).status).toBe('completed');

      const conflict = await addNote(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${token}/tasks/${created.task.id}/notes`,
          'POST',
          { body: 'after complete', confirmation: 'confirmed' },
          { 'if-match': etag(created.task.id, version + 1) },
        ),
        params(token, created.task.id),
      );
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({ error: { code: 'DOMAIN_CONFLICT' } });
    });

    it('returns to Owner atomically and revokes the capability', async () => {
      const { created, token, version, issued } = await seedAssignedIssued('task_return');
      const response = await returnToOwner(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${token}/tasks/${created.task.id}/return-to-owner`,
          'POST',
          { note: 'Back to you', confirmation: 'confirmed' },
          { 'if-match': etag(created.task.id, version) },
        ),
        params(token, created.task.id),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.assignment).toBeUndefined();
      expect(body.notes.some((n: { body: string }) => n.body === 'Back to you')).toBe(true);
      expectNoSecrets(body, token);

      const cap = await getCapabilityById(db.prisma, org, issued.capability.id);
      expect(cap.status).toBe('revoked');
      const history = await listTaskAssignments(db.prisma, org, created.task.id);
      expect(history[0]?.clearedAt).toBeTruthy();

      const again = await getCapabilityTaskRoute(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${token}/tasks/${created.task.id}`,
          'GET',
        ),
        params(token, created.task.id),
      );
      expect(again.status).toBe(401);
    });

    it('submits a work request as 201 pending suggestion without creating a Task', async () => {
      const { created, token, version } = await seedAssignedIssued('task_wr');
      const beforeCount = await db.prisma.task.count({ where: { organizationId: org } });

      const response = await submitWorkRequest(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${token}/tasks/${created.task.id}/work-requests`,
          'POST',
          { message: 'Please schedule a visit', confirmation: 'confirmed' },
          { 'if-match': etag(created.task.id, version) },
        ),
        params(token, created.task.id),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.suggestion.status).toBe('pending');
      expect(body.task?.id).toBe(created.task.id);
      expectNoSecrets(body, token);
      expect(await db.prisma.task.count({ where: { organizationId: org } })).toBe(beforeCount);

      const still = await getCapabilityTaskRoute(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${token}/tasks/${created.task.id}`,
          'GET',
        ),
        params(token, created.task.id),
      );
      expect(still.status).toBe(200);
    });
  });

  describe('security envelope', () => {
    it('returns generic 500 without leaking internals', async () => {
      delete process.env.CAPABILITY_TOKEN_PEPPER;
      const response = await getCapabilityTaskRoute(
        jsonRequest(`http://localhost/api/v1/capabilities/${'z'.repeat(40)}/tasks/task_x`, 'GET'),
        params('z'.repeat(40), 'task_x'),
      );
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
      expectNoSecrets(body);
      expect(JSON.stringify(body)).not.toMatch(/CAPABILITY_TOKEN_PEPPER|stack|prisma/i);
    });

    it('does not log the raw capability token', async () => {
      const { created, token } = await seedAssignedIssued('task_log');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      await getCapabilityTaskRoute(
        jsonRequest(
          `http://localhost/api/v1/capabilities/${token}/tasks/${created.task.id}`,
          'GET',
        ),
        params(token, created.task.id),
      );

      for (const spy of [logSpy, errorSpy, infoSpy, warnSpy]) {
        for (const call of spy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain(token);
        }
        spy.mockRestore();
      }
    });
  });
});
