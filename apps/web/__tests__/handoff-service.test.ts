// @vitest-environment node
/**
 * A7.7 route-facing handoff service — idempotency-first classification.
 *
 * Engine: PGlite + real A7.3 primitives. Gmail access/transport/message preparer are mocked.
 * No real Gmail. Covers the approved replay/retry If-Match semantics and failure mapping.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HANDOFF_ACKNOWLEDGEMENT_V1,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  formatETag,
  ownerActor,
} from '@aicaa/domain';
import * as aicaaDb from '@aicaa/db/runtime';
import {
  createRecipient,
  deactivateRecipient,
  getCapabilityById,
  getHandoffAttemptById,
  getTaskById,
  updateRecipient,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { executeHandoff, type HandoffServiceParams } from '@/lib/handoff/service';
import { computeProductionHandoffRequestFingerprint } from '@/lib/handoff/fingerprint';
import { transportFailure } from '@/lib/gmail/transport/errors';
import {
  ORG,
  OWNER_ID,
  buildOrchestrator,
  nextId,
  realStore,
  seedUnassignedTask,
  stubAccess,
  stubTransport,
} from './handoff-orchestration.harness';

const owner = ownerActor(asOwnerId(OWNER_ID), asOrganizationId(ORG));

function serviceParams(
  seeded: { taskId: string; recipientId: string },
  over: Partial<HandoffServiceParams> & { expectedVersion: number; idempotencyKey: string },
): HandoffServiceParams {
  return {
    db: undefined as never, // filled by caller
    owner,
    requestId: 'req_a77',
    taskId: seeded.taskId,
    recipientId: seeded.recipientId,
    acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
    ...over,
  };
}

describe('A7.7 handoff service (idempotency-first)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.prisma.auditEvent.deleteMany();
    await db.prisma.handoffAttempt.deleteMany();
    await db.prisma.taskCapability.deleteMany();
    await db.prisma.taskNote.deleteMany();
    await db.prisma.taskAssignment.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.recipient.deleteMany();
  });

  function deps(over: Parameters<typeof buildOrchestrator>[1] = {}) {
    const built = buildOrchestrator(db, over);
    return {
      runtime: aicaaDb,
      orchestrator: built.orchestrator,
      access: built.access,
      transport: built.transport,
      messages: built.messages,
    };
  }

  async function run(
    seeded: { taskId: string; recipientId: string },
    expectedVersion: number,
    idempotencyKey: string,
    over: Parameters<typeof buildOrchestrator>[1] = {},
  ) {
    const d = deps(over);
    const result = await executeHandoff(d, {
      ...serviceParams(seeded, { expectedVersion, idempotencyKey }),
      db: db.prisma,
    });
    return { result, ...d };
  }

  it('1. successful handoff bumps Task version; replay with original If-Match returns 200', async () => {
    const seeded = await seedUnassignedTask(db);
    const key = nextId('idem');
    const { result: first, transport } = await run(seeded, 1, key);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.body.idempotentReplay).toBe(false);
    expect(first.body.deliveryStatus).toBe('sent');
    expect(first.body.requiresSendReconsent).toBe(false);
    expect(first.body).not.toHaveProperty('token');
    expect(JSON.stringify(first.body)).not.toMatch(/FAKE-TOKEN|rawToken|capabilityUrl/i);

    const taskAfter = await getTaskById(db.prisma, ORG, seeded.taskId);
    expect(taskAfter.version).toBeGreaterThan(1);
    expect(taskAfter.assignment).toBeDefined();

    transport.send.mockClear();
    const { result: replay, access, transport: t2 } = await run(seeded, 1, key); // original If-Match
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.body.idempotentReplay).toBe(true);
    expect(replay.body.capabilityId).toBe(first.body.capabilityId);
    expect(access.resolve).not.toHaveBeenCalled();
    expect(t2.send).not.toHaveBeenCalled();
  });

  it('2–5. successful replay works after Gmail disconnect, scope loss, Recipient deactivation; no Gmail', async () => {
    const seeded = await seedUnassignedTask(db);
    const key = nextId('idem');
    const { result: first } = await run(seeded, 1, key);
    expect(first.ok).toBe(true);

    await deactivateRecipient(db.prisma, ORG, seeded.recipientId);

    const access = stubAccess({ state: 'not_connected' });
    const transport = stubTransport();
    const { result: replay } = await run(seeded, 1, key, { access, transport });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.body.idempotentReplay).toBe(true);
    expect(access.resolve).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
    // Recipient DTO may show inactive; contracted field is still returned.
    expect(replay.body.recipient.active).toBe(false);
  });

  it('6–7. pending replay with original If-Match returns HANDOFF_IN_PROGRESS; no Gmail access', async () => {
    const seeded = await seedUnassignedTask(db);
    const key = nextId('idem');
    // Create a pending attempt via begin without completing send (simulate crash window).
    const store = realStore(db);
    const begin = await store.beginInitialHandoff({
      organizationId: ORG,
      ownerId: OWNER_ID,
      taskId: seeded.taskId,
      recipientId: seeded.recipientId,
      deliveryPath: 'assignment_email',
      idempotencyKey: key,
      requestFingerprint: computeProductionHandoffRequestFingerprint({
        organizationId: asOrganizationId(ORG),
        taskId: asTaskId(seeded.taskId),
        recipientId: asRecipientId(seeded.recipientId),
        acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
      }),
      acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
      expectedTaskVersion: 1,
    });
    expect(begin.kind).toBe('created');

    const access = stubAccess();
    const transport = stubTransport();
    const { result } = await run(seeded, 1, key, { access, transport });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.code).toBe('HANDOFF_IN_PROGRESS');
    expect(access.resolve).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('8–11. failed retry with original If-Match reuses attempt/capability and historical email', async () => {
    const seeded = await seedUnassignedTask(db);
    const key = nextId('idem');
    const transport = stubTransport(async () => ({
      ok: false,
      failure: transportFailure('GMAIL_RATE_LIMITED', 'rate'),
    }));
    const { result: first } = await run(seeded, 1, key, { transport });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.status).toBe(503);
    expect(first.code).toBe('HANDOFF_DELIVERY_FAILED');

    const attempts = await db.prisma.handoffAttempt.findMany({ where: { organizationId: ORG } });
    expect(attempts).toHaveLength(1);
    const failedAttempt = attempts[0];
    expect(failedAttempt.status).toBe('failed');
    const capabilityBefore = await getCapabilityById(db.prisma, ORG, failedAttempt.capabilityId);
    expect(capabilityBefore.actionableAt).toBeNull();
    const historicalEmail = capabilityBefore.intendedRecipientEmail;

    // Change Recipient email + deactivate — retry must still use the snapshot.
    await updateRecipient(db.prisma, {
      organizationId: ORG,
      recipientId: seeded.recipientId,
      email: 'changed@example.com',
      displayName: 'Changed',
    });
    await deactivateRecipient(db.prisma, ORG, seeded.recipientId);

    const retryTransport = stubTransport();
    const { result: retry } = await run(seeded, 1, key, { transport: retryTransport });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.body.idempotentReplay).toBe(false);
    expect(retryTransport.send).toHaveBeenCalledTimes(1);
    const sentMessage = retryTransport.send.mock.calls[0][0].message;
    expect(sentMessage.to.email).toBe(historicalEmail);

    const attemptAfter = await getHandoffAttemptById(db.prisma, ORG, failedAttempt.id);
    expect(attemptAfter.status).toBe('sent');
    expect(attemptAfter.id).toBe(failedAttempt.id);
    const capabilityAfter = await getCapabilityById(db.prisma, ORG, failedAttempt.capabilityId);
    expect(capabilityAfter.id).toBe(capabilityBefore.id);
    expect(capabilityAfter.tokenHash).not.toBe(capabilityBefore.tokenHash);
    expect(capabilityAfter.actionableAt).not.toBeNull();
  });

  it('12. same key with changed body returns IDEMPOTENCY_KEY_CONFLICT before Gmail', async () => {
    const seeded = await seedUnassignedTask(db);
    const key = nextId('idem');
    const { result: first } = await run(seeded, 1, key);
    expect(first.ok).toBe(true);

    const otherRecipientId = nextId('rcp');
    await createRecipient(db.prisma, {
      organizationId: ORG,
      recipient: {
        id: asRecipientId(otherRecipientId),
        displayName: 'Other',
        email: `${otherRecipientId}@example.com`,
        active: true,
      },
    });

    const access = stubAccess();
    const transport = stubTransport();
    const d = deps({ access, transport });
    const result = await executeHandoff(d, {
      db: db.prisma,
      owner,
      requestId: 'req_conflict',
      taskId: seeded.taskId,
      expectedVersion: 1,
      idempotencyKey: key,
      recipientId: otherRecipientId,
      acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(access.resolve).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('13. new key with stale If-Match returns PRECONDITION_FAILED', async () => {
    const seeded = await seedUnassignedTask(db);
    const { result } = await run(seeded, 99, nextId('idem'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(412);
    expect(result.code).toBe('PRECONDITION_FAILED');
  });

  it('14. same successful key with different Task-version ETag still replays', async () => {
    const seeded = await seedUnassignedTask(db);
    const key = nextId('idem');
    const { result: first } = await run(seeded, 1, key);
    expect(first.ok).toBe(true);
    const taskAfter = await getTaskById(db.prisma, ORG, seeded.taskId);
    // Use a syntactically valid but different version than both original and current.
    const weirdVersion = taskAfter.version + 5;
    const { result: replay, transport } = await run(seeded, weirdVersion, key);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.body.idempotentReplay).toBe(true);
    expect(transport.send).not.toHaveBeenCalled();
    expect(formatETag('task', seeded.taskId, weirdVersion)).toContain(`-v${weirdVersion}`);
  });

  it('18–19. permanent provider rejection → 400; retryable → 503', async () => {
    const seeded = await seedUnassignedTask(db);
    const permanent = stubTransport(async () => ({
      ok: false,
      failure: transportFailure('GMAIL_INVALID_MESSAGE', 'reject'),
    }));
    const { result: perm } = await run(seeded, 1, nextId('idem'), { transport: permanent });
    expect(perm.ok).toBe(false);
    if (perm.ok) return;
    expect(perm.status).toBe(400);
    expect(perm.code).toBe('HANDOFF_DELIVERY_FAILED');

    const seeded2 = await seedUnassignedTask(db);
    const retryable = stubTransport(async () => ({
      ok: false,
      failure: transportFailure('GMAIL_RATE_LIMITED', 'rate'),
    }));
    const { result: retry } = await run(seeded2, 1, nextId('idem'), { transport: retryable });
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.status).toBe(503);
    expect(retry.code).toBe('HANDOFF_DELIVERY_FAILED');
  });

  it('20. ambiguous result leaves attempt pending and capability non-actionable', async () => {
    const seeded = await seedUnassignedTask(db);
    const transport = stubTransport(async () => ({
      ok: false,
      failure: transportFailure('GMAIL_AMBIGUOUS_SEND', 'timeout'),
    }));
    const { result } = await run(seeded, 1, nextId('idem'), { transport });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(503);
    expect(result.code).toBe('DEPENDENCY_UNAVAILABLE');

    const attempts = await db.prisma.handoffAttempt.findMany({ where: { organizationId: ORG } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe('pending');
    const cap = await getCapabilityById(db.prisma, ORG, attempts[0].capabilityId);
    expect(cap.actionableAt).toBeNull();
  });

  it('21–23. no audit duplication on successful/pending replay; no raw email in audits', async () => {
    const seeded = await seedUnassignedTask(db);
    const key = nextId('idem');
    const { result: first } = await run(seeded, 1, key);
    expect(first.ok).toBe(true);

    const auditsAfterFirst = await db.prisma.auditEvent.findMany({
      where: { organizationId: ORG },
    });
    expect(auditsAfterFirst.length).toBeGreaterThan(0);
    for (const audit of auditsAfterFirst) {
      expect(audit.intendedRecipientEmail).toBeNull();
      expect(audit.note ?? '').not.toMatch(/@example\.com/);
      expect(JSON.stringify(audit)).not.toMatch(seeded.email.replace('.', '\\.'));
    }
    const countAfterFirst = auditsAfterFirst.length;

    await run(seeded, 1, key); // successful replay
    const afterReplay = await db.prisma.auditEvent.count({ where: { organizationId: ORG } });
    expect(afterReplay).toBe(countAfterFirst);

    // Pending path: seed a second task with a pending attempt and replay.
    const seeded2 = await seedUnassignedTask(db);
    const key2 = nextId('idem');
    const store = realStore(db);
    await store.beginInitialHandoff({
      organizationId: ORG,
      ownerId: OWNER_ID,
      taskId: seeded2.taskId,
      recipientId: seeded2.recipientId,
      deliveryPath: 'assignment_email',
      idempotencyKey: key2,
      requestFingerprint: computeProductionHandoffRequestFingerprint({
        organizationId: asOrganizationId(ORG),
        taskId: asTaskId(seeded2.taskId),
        recipientId: asRecipientId(seeded2.recipientId),
        acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
      }),
      acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
      expectedTaskVersion: 1,
      emitAudits: true,
      requestId: 'req_pending',
    });
    const countBeforePendingReplay = await db.prisma.auditEvent.count({
      where: { organizationId: ORG },
    });
    await run(seeded2, 1, key2);
    const countAfterPendingReplay = await db.prisma.auditEvent.count({
      where: { organizationId: ORG },
    });
    expect(countAfterPendingReplay).toBe(countBeforePendingReplay);
  });

  it('rejects inactive Recipient on new handoff; maps Gmail re-consent', async () => {
    const seeded = await seedUnassignedTask(db);
    await deactivateRecipient(db.prisma, ORG, seeded.recipientId);
    const { result } = await run(seeded, 1, nextId('idem'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.code).toBe('RECIPIENT_INACTIVE');

    const seeded2 = await seedUnassignedTask(db);
    const access = stubAccess({ state: 'send_scope_required' });
    const { result: reconsent } = await run(seeded2, 1, nextId('idem'), { access });
    expect(reconsent.ok).toBe(false);
    if (reconsent.ok) return;
    expect(reconsent.status).toBe(403);
    expect(reconsent.code).toBe('GMAIL_SEND_SCOPE_REQUIRED');
  });

  it('selects assignment_email for manual tasks and never returns raw capability secret', async () => {
    const seeded = await seedUnassignedTask(db);
    const { result, messages } = await run(seeded, 1, nextId('idem'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.deliveryPath).toBe('assignment_email');
    expect(messages.prepare).toHaveBeenCalled();
    expect(result.body.capabilityId).toMatch(/^cap_/);
    expect(result.etag).toBe(
      formatETag('task', seeded.taskId, (await getTaskById(db.prisma, ORG, seeded.taskId)).version),
    );
  });
});
