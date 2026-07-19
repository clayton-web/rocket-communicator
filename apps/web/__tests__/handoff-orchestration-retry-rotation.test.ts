// @vitest-environment node
/**
 * A7.5 corrective pass — retry capability-token rotation, exclusive retry execution ownership,
 * send-generation stale-result rejection, and initial-send ownership.
 *
 * Engine: in-process PGlite (embedded Postgres) with the REAL A7.3 primitives; Gmail transport is
 * mocked (no real send). PGlite runs on a single connection, so concurrency tests prove the
 * database winner/loser lease and at-most-one send at the persistence layer rather than true
 * multi-connection timing; the ownership guarantees rest on A7.3's conditional CAS transitions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as aicaaDb from '@aicaa/db/runtime';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import {
  findCapabilityByTokenHash,
  getCapabilityById,
  getHandoffAttemptById,
  isPersistedCapabilityActionable,
} from '@aicaa/db';
import { asOrganizationId, asOwnerId, ownerActor, DEFAULT_CAPABILITY_TTL_MS } from '@aicaa/domain';
import { resetDbRuntimeForTests, setDbRuntimeForTests } from '@/lib/db/runtime-db';
import { issueCapabilityForTask } from '@/lib/capability';
import { hashCapabilityToken } from '@/lib/capability/token';
import { transportFailure } from '@/lib/gmail/transport/errors';
import { createOutboundMessagePreparer } from '@/lib/handoff/runtime-adapters';
import type { HandoffStore, RetryHandoffCommand } from '@/lib/handoff/types';
import {
  CAPABILITY_CONFIG,
  NOW,
  ORG,
  OWNER_ID,
  buildOrchestrator,
  initialCommand,
  readAttempt,
  realStore,
  recordingLogger,
  seedUnassignedTask,
  stubAccess,
  stubTransport,
  type SeededTask,
} from './handoff-orchestration.harness';

let db: TestDatabase;

beforeAll(async () => {
  setDbRuntimeForTests(aicaaDb);
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
  resetDbRuntimeForTests();
});

/** Extract the ephemeral raw token embedded in a `/c/{token}` capability URL. */
function tokenFromUrl(url: string): string {
  const marker = '/c/';
  const i = url.indexOf(marker);
  if (i < 0) throw new Error('capability URL missing /c/ segment');
  return url.slice(i + marker.length);
}

function tokenHash(rawToken: string): string {
  return hashCapabilityToken(rawToken, CAPABILITY_CONFIG.pepper);
}

function retryCommand(attemptId: string, requestFingerprint: string): RetryHandoffCommand {
  return {
    organizationId: ORG,
    ownerId: OWNER_ID,
    attemptId,
    requestFingerprint,
    correlationId: 'rot_corr',
  };
}

/** Seed a failed, retryable attempt via the store, capturing the initial one-time capability URL. */
async function seedFailedViaStore(store: HandoffStore, seeded: SeededTask) {
  const command = initialCommand(seeded);
  const begin = await store.beginInitialHandoff(command);
  expect(begin.kind).toBe('created');
  expect(begin.capabilityUrl).toBeDefined();
  await store.recordFailed({
    organizationId: ORG,
    attemptId: begin.attempt.id,
    failure: transportFailure('GMAIL_RATE_LIMITED', 1),
    expectedSendGeneration: begin.sendGeneration,
  });
  return { command, begin, retryCmd: retryCommand(begin.attempt.id, command.requestFingerprint) };
}

describe('A7.5 retry token rotation', () => {
  it('1/2/3/4/6/7. rotation mints a new token, stores only its hash, invalidates the old link, stays non-actionable, reuses identity', async () => {
    const store = realStore(db);
    const seeded = await seedUnassignedTask(db);
    const { begin, retryCmd } = await seedFailedViaStore(store, seeded);
    const rawToken1 = tokenFromUrl(begin.capabilityUrl!);

    const prep = await store.prepareRetry(retryCmd);
    expect(prep.won).toBe(true);
    expect(prep.capabilityUrl).toBeDefined();
    const rawToken2 = tokenFromUrl(prep.capabilityUrl!);

    // 1. a new raw token (different from the initial one).
    expect(rawToken2).not.toBe(rawToken1);

    // 6/7. same Capability row + same HandoffAttempt + same Assignment identity.
    expect(prep.capability.id).toBe(begin.capability.id);
    expect(prep.attempt.id).toBe(begin.attempt.id);
    expect(prep.attempt.assignmentId).toBe(begin.attempt.assignmentId);

    const cap = await getCapabilityById(db.prisma, ORG, prep.capability.id);
    // 2. only the hash of the NEW token is persisted.
    expect(cap.tokenHash).toBe(tokenHash(rawToken2));
    expect(cap.tokenHash).not.toBe(tokenHash(rawToken1));

    // 3. old token no longer resolves; new token resolves to the same row.
    expect(await findCapabilityByTokenHash(db.prisma, tokenHash(rawToken1))).toBeNull();
    const byNew = await findCapabilityByTokenHash(db.prisma, tokenHash(rawToken2));
    expect(byNew?.id).toBe(prep.capability.id);

    // 4. new token is non-actionable before Gmail acceptance.
    expect(cap.actionableAt).toBeNull();
    expect(isPersistedCapabilityActionable(cap, NOW)).toBe(false);
  });

  it('5. the rotated token becomes actionable only after acceptance is durably recorded', async () => {
    const store = realStore(db);
    const seeded = await seedUnassignedTask(db);
    const { retryCmd } = await seedFailedViaStore(store, seeded);
    const prep = await store.prepareRetry(retryCmd);
    const rawToken2 = tokenFromUrl(prep.capabilityUrl!);

    // Before acceptance: non-actionable.
    expect(
      isPersistedCapabilityActionable(
        await getCapabilityById(db.prisma, ORG, prep.capability.id),
        NOW,
      ),
    ).toBe(false);

    const accepted = await store.recordAccepted({
      organizationId: ORG,
      attemptId: prep.attempt.id,
      providerMessageId: 'gmsg_rot_5',
      providerAcceptedAt: NOW,
      expectedSendGeneration: prep.sendGeneration,
    });
    expect(accepted.ok).toBe(true);

    const byNew = await findCapabilityByTokenHash(db.prisma, tokenHash(rawToken2));
    expect(byNew).not.toBeNull();
    expect(isPersistedCapabilityActionable(byNew!, NOW)).toBe(true);
  });

  it('8. a known retry failure leaves the rotated token non-actionable for a later retry', async () => {
    const store = realStore(db);
    const seeded = await seedUnassignedTask(db);
    const { retryCmd } = await seedFailedViaStore(store, seeded);
    const prep = await store.prepareRetry(retryCmd);
    const rawToken2 = tokenFromUrl(prep.capabilityUrl!);

    await store.recordFailed({
      organizationId: ORG,
      attemptId: prep.attempt.id,
      failure: transportFailure('GMAIL_RATE_LIMITED', 1),
      expectedSendGeneration: prep.sendGeneration,
    });

    const byNew = await findCapabilityByTokenHash(db.prisma, tokenHash(rawToken2));
    expect(byNew).not.toBeNull();
    expect(byNew!.status).toBe('active');
    expect(isPersistedCapabilityActionable(byNew!, NOW)).toBe(false);
  });

  it('9. a second retry rotates the token again and invalidates the previous retry token', async () => {
    const store = realStore(db);
    const seeded = await seedUnassignedTask(db);
    const { retryCmd } = await seedFailedViaStore(store, seeded);

    const prep1 = await store.prepareRetry(retryCmd);
    const rawToken2 = tokenFromUrl(prep1.capabilityUrl!);
    await store.recordFailed({
      organizationId: ORG,
      attemptId: prep1.attempt.id,
      failure: transportFailure('GMAIL_RATE_LIMITED', 1),
      expectedSendGeneration: prep1.sendGeneration,
    });

    const prep2 = await store.prepareRetry(retryCmd);
    const rawToken3 = tokenFromUrl(prep2.capabilityUrl!);

    expect(rawToken3).not.toBe(rawToken2);
    expect(prep2.sendGeneration).toBeGreaterThan(prep1.sendGeneration);
    // previous retry token invalidated; newest resolves.
    expect(await findCapabilityByTokenHash(db.prisma, tokenHash(rawToken2))).toBeNull();
    expect((await findCapabilityByTokenHash(db.prisma, tokenHash(rawToken3)))?.id).toBe(
      prep2.capability.id,
    );
  });

  it('10. the raw token never appears in any handoff/capability database field', async () => {
    const store = realStore(db);
    const seeded = await seedUnassignedTask(db);
    const { retryCmd } = await seedFailedViaStore(store, seeded);
    const prep = await store.prepareRetry(retryCmd);
    const rawToken2 = tokenFromUrl(prep.capabilityUrl!);

    const cap = await getCapabilityById(db.prisma, ORG, prep.capability.id);
    const attempt = await getHandoffAttemptById(db.prisma, ORG, prep.attempt.id);
    expect(JSON.stringify(cap)).not.toContain(rawToken2);
    expect(JSON.stringify(attempt)).not.toContain(rawToken2);
    // Raw capability rows via the client must not hold the plaintext token either.
    const rawRow = await db.prisma.taskCapability.findUnique({ where: { id: prep.capability.id } });
    expect(JSON.stringify(rawRow)).not.toContain(rawToken2);
  });

  it('11. the raw token and full capability URL never appear in orchestration logs', async () => {
    const store = realStore(db);
    const seeded = await seedUnassignedTask(db);
    const { retryCmd } = await seedFailedViaStore(store, seeded);
    const logger = recordingLogger();
    const { orchestrator, transport } = buildOrchestrator(db, { store, logger });

    const result = await orchestrator.retryHandoff(retryCmd);
    expect(result.category).toBe('delivered');
    expect(transport.send).toHaveBeenCalledTimes(1);

    const serialized = JSON.stringify(logger.records);
    expect(serialized).not.toContain('/c/'); // no capability path/URL
    expect(serialized).not.toContain(CAPABILITY_CONFIG.appUrl);
  });
});

describe('A7.5 exclusive retry execution ownership', () => {
  it('12/13/14. concurrent retries: exactly one wins the token+send; the loser gets no token and a typed in-progress result', async () => {
    const seeded = await seedUnassignedTask(db);
    const seedStore = realStore(db);
    const { retryCmd } = await seedFailedViaStore(seedStore, seeded);

    const a = buildOrchestrator(db, { store: realStore(db), transport: stubTransport() });
    const b = buildOrchestrator(db, { store: realStore(db), transport: stubTransport() });

    const [ra, rb] = await Promise.all([
      a.orchestrator.retryHandoff(retryCmd),
      b.orchestrator.retryHandoff(retryCmd),
    ]);

    // 13. Gmail called exactly once across both invocations.
    const totalSends = a.transport.send.mock.calls.length + b.transport.send.mock.calls.length;
    expect(totalSends).toBe(1);

    const delivered = [ra, rb].filter((r) => r.category === 'delivered');
    const losers = [ra, rb].filter((r) => r.category !== 'delivered');
    expect(delivered).toHaveLength(1);
    expect(losers).toHaveLength(1);
    // 14. loser is a stable, typed, non-success result.
    expect(losers[0]!.status).not.toBe('success');
    expect(losers[0]!.category).toBe('handoff_in_progress');
  });

  it('12b. the losing prepareRetry invocation receives no capability URL', async () => {
    const seeded = await seedUnassignedTask(db);
    const { retryCmd } = await seedFailedViaStore(realStore(db), seeded);

    const [p1, p2] = await Promise.all([
      realStore(db).prepareRetry(retryCmd),
      realStore(db).prepareRetry(retryCmd),
    ]);
    const winners = [p1, p2].filter((p) => p.won);
    const losers = [p1, p2].filter((p) => !p.won);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(winners[0]!.capabilityUrl).toBeDefined();
    expect(losers[0]!.capabilityUrl).toBeUndefined();
  });
});

describe('A7.5 retry vs concurrent operations', () => {
  it('15. retry vs admin issuance: admin is blocked and the retry lineage is intact', async () => {
    const seeded = await seedUnassignedTask(db);
    const store = realStore(db);
    const { retryCmd, begin } = await seedFailedViaStore(store, seeded);

    const owner = ownerActor(asOwnerId(OWNER_ID), asOrganizationId(ORG));
    const [prep, issuance] = await Promise.all([
      store.prepareRetry(retryCmd),
      issueCapabilityForTask({
        db: db.prisma,
        owner,
        taskId: seeded.taskId,
        ttlMs: DEFAULT_CAPABILITY_TTL_MS,
        pepper: CAPABILITY_CONFIG.pepper,
        appUrl: CAPABILITY_CONFIG.appUrl,
        now: NOW,
      }).then(
        () => ({ ok: true }) as const,
        () => ({ ok: false }) as const,
      ),
    ]);

    expect(issuance.ok).toBe(false); // unresolved-handoff issuance gate blocks admin
    expect(prep.won).toBe(true);
    // lineage intact: same attempt + same capability row reused.
    expect(prep.attempt.id).toBe(begin.attempt.id);
    expect(prep.capability.id).toBe(begin.capability.id);
    const attempt = await readAttempt(db, begin.attempt.id);
    expect(attempt.status).toBe('pending');
    expect(attempt.capabilityId).toBe(begin.capability.id);
  });

  it('16. retry vs failure recording: exactly one coherent state, capability never actionable', async () => {
    const seeded = await seedUnassignedTask(db);
    const store = realStore(db);
    const { retryCmd, begin } = await seedFailedViaStore(store, seeded);

    const results = await Promise.allSettled([
      store.prepareRetry(retryCmd),
      store.recordFailed({
        organizationId: ORG,
        attemptId: begin.attempt.id,
        failure: transportFailure('GMAIL_RATE_LIMITED', 1),
        expectedSendGeneration: begin.sendGeneration,
      }),
    ]);
    void results;

    const attempt = await readAttempt(db, begin.attempt.id);
    expect(['pending', 'failed']).toContain(attempt.status);
    const cap = await getCapabilityById(db.prisma, ORG, begin.capability.id);
    expect(cap.actionableAt).toBeNull();
  });

  it('17/18. a delayed prior-send acceptance cannot activate the newly rotated retry capability', async () => {
    const store = realStore(db);
    const seeded = await seedUnassignedTask(db);
    const { retryCmd } = await seedFailedViaStore(store, seeded);

    const prep = await store.prepareRetry(retryCmd); // gen 2, token rotated
    const rawToken2 = tokenFromUrl(prep.capabilityUrl!);

    // Delayed acceptance from the PRIOR send (generation 1) arrives now.
    const stale = await store.recordAccepted({
      organizationId: ORG,
      attemptId: prep.attempt.id,
      providerMessageId: 'gmsg_prior_gen1',
      providerAcceptedAt: NOW,
      expectedSendGeneration: 1,
    });
    expect(stale.ok).toBe(false); // typed conflict, no state change

    const attempt = await readAttempt(db, prep.attempt.id);
    expect(attempt.status).toBe('pending'); // still the pending retry generation
    expect(attempt.providerMessageId).toBeNull();
    const byNew = await findCapabilityByTokenHash(db.prisma, tokenHash(rawToken2));
    expect(isPersistedCapabilityActionable(byNew!, NOW)).toBe(false); // not activated by the stale result
  });

  it('19. a delayed prior-send failure cannot mark the newer retry generation failed', async () => {
    const store = realStore(db);
    const seeded = await seedUnassignedTask(db);
    const { retryCmd } = await seedFailedViaStore(store, seeded);

    const prep = await store.prepareRetry(retryCmd); // gen 2

    await expect(
      store.recordFailed({
        organizationId: ORG,
        attemptId: prep.attempt.id,
        failure: transportFailure('GMAIL_INVALID_MESSAGE', 400),
        expectedSendGeneration: 1, // stale generation
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const attempt = await readAttempt(db, prep.attempt.id);
    expect(attempt.status).toBe('pending'); // newer generation unaffected
  });
});

describe('A7.5 known-failure-after-rotation sequence', () => {
  it('S1. fail → retry rotates+advances → known rejection persists new gen → non-actionable latest hash → later retry rotates again → delayed prior-gen results rejected', async () => {
    const store = realStore(db);
    const seeded = await seedUnassignedTask(db);
    // (1) initial send generation failed retryably (gen 1).
    const { begin, retryCmd } = await seedFailedViaStore(store, seeded);
    const capId = begin.capability.id;

    // (2)+(3)+(4) retry rotates the token and advances the generation; Gmail returns a KNOWN
    // rejection; the failure is persisted for the NEW generation via the real orchestrator pipeline.
    const rejecting = buildOrchestrator(db, {
      store,
      transport: stubTransport(async () => ({
        ok: false,
        failure: transportFailure('GMAIL_RATE_LIMITED', 'gen2'),
      })),
    });
    const retryResult = await rejecting.orchestrator.retryHandoff(retryCmd);
    expect(rejecting.transport.send).toHaveBeenCalledTimes(1);
    expect(retryResult.status).toBe('failure');
    expect(retryResult.category).toBe('retryable_provider_failure');

    const afterFail = await readAttempt(db, begin.attempt.id);
    expect(afterFail.status).toBe('failed');
    expect(afterFail.retryable).toBe(true);
    expect(afterFail.attemptCount).toBe(2); // advanced send generation

    // (5) capability remains the SAME active row, non-actionable, holding the latest rotated hash.
    const capAfter = await getCapabilityById(db.prisma, ORG, capId);
    expect(capAfter.id).toBe(capId);
    expect(capAfter.status).toBe('active');
    expect(isPersistedCapabilityActionable(capAfter, NOW)).toBe(false);

    // (6) a later explicit retry rotates the token again and advances the generation to 3.
    const prep3 = await store.prepareRetry(retryCmd);
    expect(prep3.won).toBe(true);
    expect(prep3.sendGeneration).toBe(3);
    const rawToken3 = tokenFromUrl(prep3.capabilityUrl!);
    expect((await findCapabilityByTokenHash(db.prisma, tokenHash(rawToken3)))?.id).toBe(capId);

    // (7) a delayed acceptance AND a delayed failure from the PRIOR generation (2) are both rejected
    // without mutating the pending gen-3 attempt or activating the rotated capability.
    const staleAccept = await store.recordAccepted({
      organizationId: ORG,
      attemptId: begin.attempt.id,
      providerMessageId: 'gmsg_prior_gen2',
      providerAcceptedAt: NOW,
      expectedSendGeneration: 2,
    });
    expect(staleAccept.ok).toBe(false);

    await expect(
      store.recordFailed({
        organizationId: ORG,
        attemptId: begin.attempt.id,
        failure: transportFailure('GMAIL_INVALID_MESSAGE', 400),
        expectedSendGeneration: 2,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const finalAttempt = await readAttempt(db, begin.attempt.id);
    expect(finalAttempt.status).toBe('pending'); // gen-3 retry unaffected by stale prior-gen results
    expect(finalAttempt.attemptCount).toBe(3);
    expect(finalAttempt.providerMessageId).toBeNull();
    expect(
      isPersistedCapabilityActionable(await getCapabilityById(db.prisma, ORG, capId), NOW),
    ).toBe(false);
  });
});

describe('A7.5 initial-send ownership', () => {
  it('20/21. only the creator receives a capability URL; pending/sent/failed replays receive none', async () => {
    const store = realStore(db);
    const seeded = await seedUnassignedTask(db);
    const command = initialCommand(seeded);

    // creator
    const created = await store.beginInitialHandoff(command);
    expect(created.kind).toBe('created');
    expect(created.capabilityUrl).toBeDefined();

    // replay while pending
    const replayPending = await store.beginInitialHandoff(command);
    expect(replayPending.kind).toBe('replay_pending');
    expect(replayPending.capabilityUrl).toBeUndefined();

    // replay after sent
    await store.recordAccepted({
      organizationId: ORG,
      attemptId: created.attempt.id,
      providerMessageId: 'gmsg_init_own',
      providerAcceptedAt: NOW,
      expectedSendGeneration: created.sendGeneration,
    });
    const replaySent = await store.beginInitialHandoff(command);
    expect(replaySent.kind).toBe('replay_sent');
    expect(replaySent.capabilityUrl).toBeUndefined();
  });

  it('21b. a same-key replay of a failed attempt yields retry_failed with no capability URL', async () => {
    const store = realStore(db);
    const seeded = await seedUnassignedTask(db);
    const command = initialCommand(seeded);
    const created = await store.beginInitialHandoff(command);
    await store.recordFailed({
      organizationId: ORG,
      attemptId: created.attempt.id,
      failure: transportFailure('GMAIL_RATE_LIMITED', 1),
      expectedSendGeneration: created.sendGeneration,
    });

    const replayFailed = await store.beginInitialHandoff(command);
    expect(replayFailed.kind).toBe('retry_failed');
    expect(replayFailed.capabilityUrl).toBeUndefined();
  });
});

describe('A7.5 production preparer needs no injected prior URL', () => {
  it('22/25. the production message preparer retries using the store-rotated URL and leaks no raw error', async () => {
    const store = realStore(db);
    const seeded = await seedUnassignedTask(db);
    const { retryCmd } = await seedFailedViaStore(store, seeded);

    // Real production preparer (assignment_email builds from the store-provided rotated URL only).
    const messages = createOutboundMessagePreparer({});
    const { orchestrator, transport } = buildOrchestrator(db, {
      store,
      messages,
      access: stubAccess(),
      transport: stubTransport(),
    });

    const result = await orchestrator.retryHandoff(retryCmd);
    expect(result.category).toBe('delivered');
    expect(transport.send).toHaveBeenCalledTimes(1);
    // 25. privacy-safe outcome — never a raw DB/provider error string.
    expect(result.message).not.toMatch(/prisma|postgres|error:/i);
  });
});
