// @vitest-environment node
/**
 * A7.7 HTTP route: POST /api/v1/tasks/{taskId}/handoff
 *
 * Thin-route validation + end-to-end wiring through runHandoffService with PGlite and mocked
 * Gmail access/transport. No real Gmail.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HANDOFF_ACKNOWLEDGEMENT_V1,
  asOrganizationId,
  asOwnerId,
  formatETag,
  ownerActor,
} from '@aicaa/domain';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import {
  ORG,
  OWNER_ID,
  buildOrchestrator,
  nextId,
  seedUnassignedTask,
  stubAccess,
  stubTransport,
} from './handoff-orchestration.harness';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

vi.mock('@/lib/capability/config', () => ({
  getCapabilityTokenConfig: () => ({
    pepper: 'a77-capability-pepper-value-32chars!!',
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    appUrl: 'http://localhost:3000',
  }),
}));

// Intercept the production orchestrator composition so route tests never call real Gmail.
const orchestratorState: {
  build: ReturnType<typeof buildOrchestrator> | null;
} = { build: null };

vi.mock('@/lib/handoff/create-orchestrator', () => ({
  createRuntimeHandoffOrchestrator: vi.fn(async () => {
    if (!orchestratorState.build) {
      throw new Error('orchestratorState.build not initialized');
    }
    return orchestratorState.build.orchestrator;
  }),
}));

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { POST as handoffRoute } from '@/app/api/v1/tasks/[taskId]/handoff/route';

const owner = ownerActor(asOwnerId(OWNER_ID), asOrganizationId(ORG));

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

function taskParams(taskId: string) {
  return { params: Promise.resolve({ taskId }) };
}

function handoffRequest(taskId: string, body: unknown, headers: Record<string, string>) {
  return new Request(`http://localhost/api/v1/tasks/${taskId}/handoff`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('A7.7 POST /api/v1/tasks/{taskId}/handoff', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    clearDbTestRuntime();
    await db.close();
  });

  beforeEach(async () => {
    installDbTestRuntime(db.prisma);
    vi.mocked(getAuthenticatedOwner).mockReset();
    authOwner();
    orchestratorState.build = buildOrchestrator(db);
    await db.prisma.auditEvent.deleteMany();
    await db.prisma.handoffAttempt.deleteMany();
    await db.prisma.taskCapability.deleteMany();
    await db.prisma.taskNote.deleteMany();
    await db.prisma.taskAssignment.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.recipient.deleteMany();
  });

  it('rejects unauthenticated and capability-link callers', async () => {
    vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
    const seeded = await seedUnassignedTask(db);
    const res = await handoffRoute(
      handoffRequest(
        seeded.taskId,
        { recipientId: seeded.recipientId, acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1 },
        {
          'if-match': formatETag('task', seeded.taskId, 1),
          'idempotency-key': nextId('idem'),
          'x-capability-token': 'cap',
        },
      ),
      taskParams(seeded.taskId),
    );
    expect(res.status).toBe(401);
    expect(getAuthenticatedOwner).toHaveBeenCalled();
  });

  it('requires Content-Type application/json (415)', async () => {
    const seeded = await seedUnassignedTask(db);
    const res = await handoffRoute(
      new Request(`http://localhost/api/v1/tasks/${seeded.taskId}/handoff`, {
        method: 'POST',
        headers: {
          'if-match': formatETag('task', seeded.taskId, 1),
          'idempotency-key': nextId('idem'),
        },
        body: JSON.stringify({
          recipientId: seeded.recipientId,
          acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
        }),
      }),
      taskParams(seeded.taskId),
    );
    expect(res.status).toBe(415);
  });

  it('missing If-Match → 428; malformed → 412; wrong Task id → 412', async () => {
    const seeded = await seedUnassignedTask(db);
    const body = {
      recipientId: seeded.recipientId,
      acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
    };
    const missing = await handoffRoute(
      handoffRequest(seeded.taskId, body, { 'idempotency-key': nextId('idem') }),
      taskParams(seeded.taskId),
    );
    expect(missing.status).toBe(428);
    expect((await missing.json()).error.code).toBe('PRECONDITION_REQUIRED');

    const malformed = await handoffRoute(
      handoffRequest(seeded.taskId, body, {
        'if-match': 'W/"task-x-v1"',
        'idempotency-key': nextId('idem'),
      }),
      taskParams(seeded.taskId),
    );
    expect(malformed.status).toBe(412);

    const wrongId = await handoffRoute(
      handoffRequest(seeded.taskId, body, {
        'if-match': formatETag('task', 'other_task', 1),
        'idempotency-key': nextId('idem'),
      }),
      taskParams(seeded.taskId),
    );
    expect(wrongId.status).toBe(412);
  });

  it('missing Idempotency-Key → 428; malformed → 400', async () => {
    const seeded = await seedUnassignedTask(db);
    const body = {
      recipientId: seeded.recipientId,
      acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
    };
    const missing = await handoffRoute(
      handoffRequest(seeded.taskId, body, {
        'if-match': formatETag('task', seeded.taskId, 1),
      }),
      taskParams(seeded.taskId),
    );
    expect(missing.status).toBe(428);

    const malformed = await handoffRoute(
      handoffRequest(seeded.taskId, body, {
        'if-match': formatETag('task', seeded.taskId, 1),
        'idempotency-key': 'bad key!',
      }),
      taskParams(seeded.taskId),
    );
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects proposedRecipientHint / unknown fields as VALIDATION_ERROR', async () => {
    const seeded = await seedUnassignedTask(db);
    const res = await handoffRoute(
      handoffRequest(
        seeded.taskId,
        {
          recipientId: seeded.recipientId,
          acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
          proposedRecipientHint: 'alice@example.com',
        },
        {
          'if-match': formatETag('task', seeded.taskId, 1),
          'idempotency-key': nextId('idem'),
        },
      ),
      taskParams(seeded.taskId),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('authenticated Owner success returns HandoffTaskResponse with no-store and ETag', async () => {
    const seeded = await seedUnassignedTask(db);
    const key = nextId('idem');
    const res = await handoffRoute(
      handoffRequest(
        seeded.taskId,
        { recipientId: seeded.recipientId, acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1 },
        {
          'if-match': formatETag('task', seeded.taskId, 1),
          'idempotency-key': key,
        },
      ),
      taskParams(seeded.taskId),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('etag')).toMatch(/^"task-/);
    const body = await res.json();
    expect(body.deliveryStatus).toBe('sent');
    expect(body.deliveryPath).toBe('assignment_email');
    expect(body.idempotentReplay).toBe(false);
    expect(body.requiresSendReconsent).toBe(false);
    expect(body.capabilityId).toBeTruthy();
    expect(body.task.id).toBe(seeded.taskId);
    expect(body).not.toHaveProperty('token');
    expect(JSON.stringify(body)).not.toMatch(/capabilityUrl|rawToken/);

    // Replay with original If-Match after version bump.
    orchestratorState.build = buildOrchestrator(db, {
      access: stubAccess({ state: 'not_connected' }),
      transport: stubTransport(),
    });
    const replay = await handoffRoute(
      handoffRequest(
        seeded.taskId,
        { recipientId: seeded.recipientId, acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1 },
        {
          'if-match': formatETag('task', seeded.taskId, 1),
          'idempotency-key': key,
        },
      ),
      taskParams(seeded.taskId),
    );
    expect(replay.status).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody.idempotentReplay).toBe(true);
    expect(orchestratorState.build.access.resolve).not.toHaveBeenCalled();
    expect(orchestratorState.build.transport.send).not.toHaveBeenCalled();
  });

  it('does not log the full idempotency key in structured handoff logs', async () => {
    const seeded = await seedUnassignedTask(db);
    const key = `secret-idem-key-${nextId('x')}`;
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    try {
      await handoffRoute(
        handoffRequest(
          seeded.taskId,
          { recipientId: seeded.recipientId, acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1 },
          {
            'if-match': formatETag('task', seeded.taskId, 1),
            'idempotency-key': key,
          },
        ),
        taskParams(seeded.taskId),
      );
    } finally {
      console.log = originalLog;
    }
    expect(logs.join('\n')).not.toContain(key);
  });
});
