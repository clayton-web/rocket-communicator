// @vitest-environment node
/**
 * Phase 4B Owner task route inventory
 * -----------------------------------
 * Each surface below is invoked and asserted in this file:
 *   GET  /api/v1/tasks                          → "route: GET list"
 *   POST /api/v1/tasks                          → "route: POST create"
 *   GET  /api/v1/tasks/{taskId}                 → "route: GET one"
 *   POST /api/v1/tasks/{taskId}/start           → "route: start"
 *   POST /api/v1/tasks/{taskId}/waiting         → "route: waiting"
 *   POST /api/v1/tasks/{taskId}/resume          → "route: resume"
 *   POST /api/v1/tasks/{taskId}/complete        → "route: complete"
 *   POST /api/v1/tasks/{taskId}/notes           → "route: notes"
 *   POST /api/v1/tasks/{taskId}/snooze          → "route: snooze"
 *   POST /api/v1/tasks/{taskId}/dismiss         → "route: dismiss"
 *   POST /api/v1/tasks/{taskId}/return-to-owner → "route: return-to-owner"
 *   POST /api/v1/tasks/{taskId}/clarification-requests → "route: clarification-requests"
 *
 * OpenAPI: only getTask 200 declares HTTP ETag. createTask / mutations declare
 * Task body (with body `etag`) but no HTTP ETag header.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asCapabilityId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  formatETag,
  ownerActor,
  type Recipient,
} from '@aicaa/domain';
import {
  createCapability,
  getCapabilityById,
  getTaskById,
  listAuditEventsForTask,
  listTaskAssignments,
  updateActiveAssignmentCapabilityBinding,
  upsertRecipient,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { GET as listOrCreateGet, POST as listOrCreatePost } from '@/app/api/v1/tasks/route';
import { GET as getTask } from '@/app/api/v1/tasks/[taskId]/route';
import { POST as startTask } from '@/app/api/v1/tasks/[taskId]/start/route';
import { POST as waitingTask } from '@/app/api/v1/tasks/[taskId]/waiting/route';
import { POST as resumeTask } from '@/app/api/v1/tasks/[taskId]/resume/route';
import { POST as completeTask } from '@/app/api/v1/tasks/[taskId]/complete/route';
import { POST as noteTask } from '@/app/api/v1/tasks/[taskId]/notes/route';
import { POST as snoozeTask } from '@/app/api/v1/tasks/[taskId]/snooze/route';
import { POST as dismissTask } from '@/app/api/v1/tasks/[taskId]/dismiss/route';
import { POST as clarifyTask } from '@/app/api/v1/tasks/[taskId]/clarification-requests/route';
import { POST as returnTask } from '@/app/api/v1/tasks/[taskId]/return-to-owner/route';

const org = 'org_http_tasks';
const otherOrg = 'org_http_other';
const owner = ownerActor(asOwnerId('owner_http'), asOrganizationId(org));
const otherOwner = ownerActor(asOwnerId('owner_http_other'), asOrganizationId(otherOrg));

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
    id: asRecipientId('rcp_http'),
    displayName: 'HTTP Recipient',
    email: 'http-recipient@example.com',
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

/** Contracted Task fields present on successful write/read responses. */
function expectTaskShape(body: Record<string, unknown>) {
  expect(body).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      status: expect.any(String),
      summaryPoints: expect.any(Array),
      etag: expect.stringMatching(/^"task-.+-v\d+"$/),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    }),
  );
}

function expectNoHttpEtag(response: Response) {
  expect(response.headers.get('etag')).toBeNull();
}

function expectNoSecrets(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/tokenHash|rawToken|capabilitySecret|prisma/i);
}

describe('Owner task HTTP routes (Phase 4B)', () => {
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
    await db.prisma.auditEvent.deleteMany();
    await db.prisma.taskCapability.deleteMany();
    await db.prisma.taskNote.deleteMany();
    await db.prisma.taskAssignment.deleteMany();
    await db.prisma.taskSuggestion.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.recipient.deleteMany();
  });

  describe('authentication', () => {
    it('rejects Owner routes with no Owner session', async () => {
      vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
      const list = await listOrCreateGet(new Request('http://localhost/api/v1/tasks'));
      expect(list.status).toBe(401);
      await expect(list.json()).resolves.toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    });

    it('accepts a valid Owner session (route: GET list)', async () => {
      authOwner();
      const list = await listOrCreateGet(new Request('http://localhost/api/v1/tasks'));
      expect(list.status).toBe(200);
      const page = await list.json();
      expect(page).toEqual(expect.objectContaining({ items: [], nextCursor: null }));
    });

    it('does not authorize Owner routes via capability token headers', async () => {
      vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
      const response = await listOrCreateGet(
        new Request('http://localhost/api/v1/tasks', {
          headers: { 'x-capability-token': 'not-a-session', authorization: 'Bearer cap_token' },
        }),
      );
      expect(response.status).toBe(401);
      expect(getAuthenticatedOwner).toHaveBeenCalled();
    });
  });

  describe('route: POST create — ETag contract boundary', () => {
    it('returns contracted Task body without an HTTP ETag header', async () => {
      authOwner();
      const created = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
        }),
      );
      expect(created.status).toBe(201);
      expectNoHttpEtag(created);
      const body = await created.json();
      expectTaskShape(body);
      expect(body.status).toBe('open');
      expectNoSecrets(body);
    });
  });

  describe('route: GET one — contracted HTTP ETag', () => {
    it('returns Task body and matching HTTP ETag header', async () => {
      authOwner();
      const created = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
        }),
      );
      const createdBody = await created.json();

      const got = await getTask(
        new Request(`http://localhost/api/v1/tasks/${createdBody.id}`),
        params(createdBody.id),
      );
      expect(got.status).toBe(200);
      const gotBody = await got.json();
      expectTaskShape(gotBody);
      expect(got.headers.get('etag')).toBe(gotBody.etag);
      expect(got.headers.get('etag')).toBe(createdBody.etag);
    });
  });

  describe('validation', () => {
    it('rejects invalid JSON create bodies', async () => {
      authOwner();
      const response = await listOrCreatePost(
        rawRequest('http://localhost/api/v1/tasks', 'POST', {
          headers: { 'content-type': 'application/json' },
          body: '{not-json',
        }),
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'VALIDATION_ERROR' },
      });
    });

    it('rejects invalid create request objects', async () => {
      authOwner();
      const invalid = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', { summaryPoints: [] }),
      );
      expect(invalid.status).toBe(400);
    });

    it('rejects invalid list cursors', async () => {
      authOwner();
      const badCursor = await listOrCreateGet(
        new Request('http://localhost/api/v1/tasks?cursor=!!!not-a-cursor'),
      );
      expect(badCursor.status).toBe(400);
    });

    it('rejects malformed If-Match as 412', async () => {
      authOwner();
      const created = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
        }),
      );
      const task = await created.json();
      const malformed = await startTask(
        jsonRequest(`http://localhost/api/v1/tasks/${task.id}/start`, 'POST', undefined, {
          'if-match': 'not-an-etag',
        }),
        params(task.id),
      );
      expect(malformed.status).toBe(412);
    });

    it('rejects If-Match task-id mismatch as 412', async () => {
      authOwner();
      const created = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
        }),
      );
      const task = await created.json();
      const wrongId = await startTask(
        jsonRequest(`http://localhost/api/v1/tasks/${task.id}/start`, 'POST', undefined, {
          'if-match': formatETag('task', 'task_other', 1),
        }),
        params(task.id),
      );
      expect(wrongId.status).toBe(412);
      const still = await getTaskById(db.prisma, org, task.id);
      expect(still.status).toBe('open');
      expect(still.version).toBe(1);
    });
  });

  describe('concurrency (If-Match)', () => {
    it('missing If-Match → 428; stale → 412; valid succeeds without HTTP ETag', async () => {
      authOwner();
      const created = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
        }),
      );
      const task = await created.json();

      const missing = await startTask(
        jsonRequest(`http://localhost/api/v1/tasks/${task.id}/start`, 'POST'),
        params(task.id),
      );
      expect(missing.status).toBe(428);

      const started = await startTask(
        jsonRequest(`http://localhost/api/v1/tasks/${task.id}/start`, 'POST', undefined, {
          'if-match': task.etag,
        }),
        params(task.id),
      );
      expect(started.status).toBe(200);
      expectNoHttpEtag(started);
      const startedBody = await started.json();
      expectTaskShape(startedBody);
      expect(startedBody.status).toBe('in_progress');
      expect(startedBody.etag).not.toBe(task.etag);

      const stale = await startTask(
        jsonRequest(`http://localhost/api/v1/tasks/${task.id}/start`, 'POST', undefined, {
          'if-match': task.etag,
        }),
        params(task.id),
      );
      expect(stale.status).toBe(412);
    });
  });

  describe('safety', () => {
    it('GET list and GET one make no writes', async () => {
      authOwner();
      const created = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
        }),
      );
      const task = await created.json();
      const before = await getTaskById(db.prisma, org, task.id);
      const auditBefore = await listAuditEventsForTask(db.prisma, org, task.id);

      await listOrCreateGet(new Request('http://localhost/api/v1/tasks?limit=50'));
      await getTask(new Request(`http://localhost/api/v1/tasks/${task.id}`), params(task.id));

      const after = await getTaskById(db.prisma, org, task.id);
      const auditAfter = await listAuditEventsForTask(db.prisma, org, task.id);
      expect(after.updatedAt).toBe(before.updatedAt);
      expect(after.version).toBe(before.version);
      expect(auditAfter).toHaveLength(auditBefore.length);
    });

    it('cross-organization access returns not found', async () => {
      authOwner();
      const created = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
        }),
      );
      const task = await created.json();

      authOwner(otherOwner);
      const foreign = await getTask(
        new Request(`http://localhost/api/v1/tasks/${task.id}`),
        params(task.id),
      );
      expect(foreign.status).toBe(404);
      expectNoSecrets(await foreign.json());
    });

    it('unexpected errors return generic 500 without internal details', async () => {
      vi.mocked(getAuthenticatedOwner).mockRejectedValue(
        new Error('prisma tokenHash stack leak xyz'),
      );
      const response = await listOrCreateGet(new Request('http://localhost/api/v1/tasks'));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toMatchObject({
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
      });
      expect(JSON.stringify(body)).not.toMatch(/prisma|tokenHash|stack leak/i);
    });

    it('responses omit Prisma-only and capability-secret fields', async () => {
      authOwner();
      await upsertRecipient(db.prisma, { organizationId: org, recipient: recipient() });
      const created = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
          recipientId: 'rcp_http',
        }),
      );
      const body = await created.json();
      expectNoSecrets(body);
      expect(body).not.toHaveProperty('tokenHash');
      expect(body).not.toHaveProperty('rawToken');
    });
  });

  describe('route matrix — each handler invoked', () => {
    it('lists, creates with assignment, and paginates including dismissed (route: GET list)', async () => {
      authOwner();
      await upsertRecipient(db.prisma, { organizationId: org, recipient: recipient() });

      for (let i = 0; i < 3; i += 1) {
        const res = await listOrCreatePost(
          jsonRequest('http://localhost/api/v1/tasks', 'POST', {
            summaryPoints: summaryPoints(),
          }),
        );
        expect(res.status).toBe(201);
        expectNoHttpEtag(res);
      }

      const page1 = await listOrCreateGet(new Request('http://localhost/api/v1/tasks?limit=2'));
      expect(page1.status).toBe(200);
      const body1 = await page1.json();
      expect(body1.items).toHaveLength(2);
      expect(body1.nextCursor).toBeTruthy();

      const page2 = await listOrCreateGet(
        new Request(
          `http://localhost/api/v1/tasks?limit=2&cursor=${encodeURIComponent(body1.nextCursor)}`,
        ),
      );
      const body2 = await page2.json();
      expect(body2.items.length).toBeGreaterThanOrEqual(1);

      const firstId = body1.items[0].id as string;
      const etag = body1.items[0].etag as string;
      const dismissed = await dismissTask(
        jsonRequest(
          `http://localhost/api/v1/tasks/${firstId}/dismiss`,
          'POST',
          {},
          {
            'if-match': etag,
          },
        ),
        params(firstId),
      );
      expect(dismissed.status).toBe(200);

      const listed = await listOrCreateGet(new Request('http://localhost/api/v1/tasks?limit=50'));
      const all = await listed.json();
      expect(all.items.some((t: { status: string }) => t.status === 'dismissed')).toBe(true);
    });

    it('exercises lifecycle mutation routes with contracted body etag only', async () => {
      authOwner();
      const created = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
        }),
      );
      const task = await created.json();

      // route: start
      const started = await startTask(
        jsonRequest(`http://localhost/api/v1/tasks/${task.id}/start`, 'POST', undefined, {
          'if-match': task.etag,
        }),
        params(task.id),
      );
      expect(started.status).toBe(200);
      expectNoHttpEtag(started);
      const startedBody = await started.json();
      expect(startedBody.status).toBe('in_progress');

      // route: waiting
      const waiting = await waitingTask(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/waiting`,
          'POST',
          { waitingUntil: '2026-07-20T00:00:00.000Z' },
          { 'if-match': startedBody.etag },
        ),
        params(task.id),
      );
      expect(waiting.status).toBe(200);
      expectNoHttpEtag(waiting);
      const waitingBody = await waiting.json();
      expect(waitingBody.status).toBe('waiting');

      // route: resume
      const resumed = await resumeTask(
        jsonRequest(`http://localhost/api/v1/tasks/${task.id}/resume`, 'POST', undefined, {
          'if-match': waitingBody.etag,
        }),
        params(task.id),
      );
      expect(resumed.status).toBe(200);
      expectNoHttpEtag(resumed);
      const resumedBody = await resumed.json();

      // route: notes
      const noted = await noteTask(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/notes`,
          'POST',
          { body: 'Note from Owner' },
          { 'if-match': resumedBody.etag },
        ),
        params(task.id),
      );
      expect(noted.status).toBe(200);
      expectNoHttpEtag(noted);
      const notedBody = await noted.json();

      // route: snooze
      const snoozed = await snoozeTask(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/snooze`,
          'POST',
          { nextReminderAt: '2026-07-21T09:00:00.000Z' },
          { 'if-match': notedBody.etag },
        ),
        params(task.id),
      );
      expect(snoozed.status).toBe(200);
      expectNoHttpEtag(snoozed);
      const snoozedBody = await snoozed.json();

      // route: clarification-requests
      const clarified = await clarifyTask(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/clarification-requests`,
          'POST',
          { message: 'Need info' },
          { 'if-match': snoozedBody.etag },
        ),
        params(task.id),
      );
      expect(clarified.status).toBe(200);
      expectNoHttpEtag(clarified);
      const clarifiedBody = await clarified.json();
      expectTaskShape(clarifiedBody);

      // route: complete
      const completed = await completeTask(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/complete`,
          'POST',
          { outcomeType: 'completed' },
          { 'if-match': clarifiedBody.etag },
        ),
        params(task.id),
      );
      expect(completed.status).toBe(200);
      expectNoHttpEtag(completed);
      const completedBody = await completed.json();
      expect(completedBody.status).toBe('completed');

      const terminal = await startTask(
        jsonRequest(`http://localhost/api/v1/tasks/${task.id}/start`, 'POST', undefined, {
          'if-match': completedBody.etag,
        }),
        params(task.id),
      );
      expect(terminal.status).toBe(409);
    });

    it('exercises return-to-owner atomically (route: return-to-owner)', async () => {
      authOwner();
      await upsertRecipient(db.prisma, { organizationId: org, recipient: recipient() });
      const created = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
          recipientId: 'rcp_http',
        }),
      );
      const task = await created.json();

      await createCapability(
        db.prisma,
        org,
        {
          id: asCapabilityId('cap_http'),
          taskId: task.id as never,
          assignmentId: task.assignment.id as never,
          recipientId: asRecipientId('rcp_http'),
          intendedRecipientEmail: 'http-recipient@example.com',
          scope: ['view_assigned_task', 'complete_task'],
          status: 'active',
          issuedAt: '2026-07-13T18:00:00.000Z',
          expiresAt: '2026-07-20T18:00:00.000Z',
          revokedAt: null,
        },
        'hash_http_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      );
      await updateActiveAssignmentCapabilityBinding(db.prisma, org, task.id, {
        activeCapabilityId: 'cap_http',
        capabilityStatus: 'active',
      });

      const returned = await returnTask(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/return-to-owner`,
          'POST',
          { note: 'Back to me' },
          { 'if-match': task.etag },
        ),
        params(task.id),
      );
      expect(returned.status).toBe(200);
      expectNoHttpEtag(returned);
      const returnedBody = await returned.json();
      expect(returnedBody.assignment).toBeUndefined();
      expect(returnedBody.notes?.some((n: { body: string }) => n.body === 'Back to me')).toBe(true);
      expectNoSecrets(returnedBody);

      const history = await listTaskAssignments(db.prisma, org, task.id);
      expect(history[0]?.clearedAt).toBeTruthy();
      expect((await getCapabilityById(db.prisma, org, 'cap_http')).status).toBe('revoked');
      expect(
        (await listAuditEventsForTask(db.prisma, org, task.id)).some(
          (a) => a.action === 'return_task_to_owner',
        ),
      ).toBe(true);
    });
  });

  describe('optional bodies — dismiss & return-to-owner', () => {
    async function createOpenTask() {
      const created = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
        }),
      );
      return created.json() as Promise<{ id: string; etag: string }>;
    }

    it('dismiss: accepts no body and no Content-Type', async () => {
      authOwner();
      const task = await createOpenTask();
      const response = await dismissTask(
        rawRequest(`http://localhost/api/v1/tasks/${task.id}/dismiss`, 'POST', {
          headers: { 'if-match': task.etag },
        }),
        params(task.id),
      );
      expect(response.status).toBe(200);
      expectNoHttpEtag(response);
      const body = await response.json();
      expect(body.status).toBe('dismissed');
    });

    it('dismiss: accepts valid JSON body when supplied', async () => {
      authOwner();
      const task = await createOpenTask();
      const response = await dismissTask(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/dismiss`,
          'POST',
          { reason: 'Not needed' },
          { 'if-match': task.etag },
        ),
        params(task.id),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('dismissed');
    });

    it('dismiss: malformed JSON with Content-Type application/json → 400', async () => {
      authOwner();
      const task = await createOpenTask();
      const response = await dismissTask(
        rawRequest(`http://localhost/api/v1/tasks/${task.id}/dismiss`, 'POST', {
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

    it('return-to-owner: accepts no body and no Content-Type', async () => {
      authOwner();
      await upsertRecipient(db.prisma, { organizationId: org, recipient: recipient() });
      const created = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
          recipientId: 'rcp_http',
        }),
      );
      const task = await created.json();
      const response = await returnTask(
        rawRequest(`http://localhost/api/v1/tasks/${task.id}/return-to-owner`, 'POST', {
          headers: { 'if-match': task.etag },
        }),
        params(task.id),
      );
      expect(response.status).toBe(200);
      expectNoHttpEtag(response);
      const body = await response.json();
      expect(body.assignment).toBeUndefined();
    });

    it('return-to-owner: accepts valid JSON body when supplied', async () => {
      authOwner();
      await upsertRecipient(db.prisma, { organizationId: org, recipient: recipient() });
      const created = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
          recipientId: 'rcp_http',
        }),
      );
      const task = await created.json();
      const response = await returnTask(
        jsonRequest(
          `http://localhost/api/v1/tasks/${task.id}/return-to-owner`,
          'POST',
          { note: 'Optional note' },
          { 'if-match': task.etag },
        ),
        params(task.id),
      );
      expect(response.status).toBe(200);
    });

    it('return-to-owner: malformed JSON with Content-Type application/json → 400', async () => {
      authOwner();
      await upsertRecipient(db.prisma, { organizationId: org, recipient: recipient() });
      const created = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
          recipientId: 'rcp_http',
        }),
      );
      const task = await created.json();
      const response = await returnTask(
        rawRequest(`http://localhost/api/v1/tasks/${task.id}/return-to-owner`, 'POST', {
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
  });

  describe('extra safety — foreign recipient and stale leaves state', () => {
    it('rejects foreign recipient on create', async () => {
      authOwner();
      const missingRecipient = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
          recipientId: 'missing',
        }),
      );
      expect(missingRecipient.status).toBe(404);
    });

    it('stale If-Match leaves prior task state unchanged', async () => {
      authOwner();
      const open = await listOrCreatePost(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: summaryPoints(),
        }),
      );
      const openTask = await open.json();
      await expect(
        startTask(
          jsonRequest(`http://localhost/api/v1/tasks/${openTask.id}/start`, 'POST', undefined, {
            'if-match': formatETag('task', openTask.id, 99),
          }),
          params(openTask.id),
        ),
      ).resolves.toMatchObject({ status: 412 });
      const stillOpen = await getTaskById(db.prisma, org, openTask.id);
      expect(stillOpen.status).toBe('open');
      expect(stillOpen.version).toBe(1);
    });
  });
});
