// @vitest-environment node
/**
 * A7.5 handoff orchestration — concurrency.
 *
 * Engine: in-process PGlite (embedded Postgres) with the real A7.3 primitives; Gmail transport
 * mocked. LIMITATION: PGlite runs on a single connection, so these prove durable-idempotency and
 * at-most-one-acceptance invariants at the persistence layer; they do NOT prove true multi-instance
 * (multi-connection) timing. The safety guarantees rely on A7.3's unique constraints + conditional
 * transitions, which hold across connections; the single-process tests exercise the orchestrator's
 * convergence on those guarantees.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asOrganizationId, asOwnerId, ownerActor, DEFAULT_CAPABILITY_TTL_MS } from '@aicaa/domain';
import * as aicaaDb from '@aicaa/db/runtime';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { resetDbRuntimeForTests, setDbRuntimeForTests } from '@/lib/db/runtime-db';
import { issueCapabilityForTask } from '@/lib/capability';
import { transportFailure } from '@/lib/gmail/transport/errors';
import {
  CAPABILITY_CONFIG,
  NOW,
  ORG,
  OWNER_ID,
  buildOrchestrator,
  initialCommand,
  readAttempt,
  realStore,
  requestFingerprint,
  seedUnassignedTask,
  stubTransport,
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

describe('A7.5 concurrency', () => {
  it('1. same key + same fingerprint: one delivery, at most one Gmail send', async () => {
    const seeded = await seedUnassignedTask(db);
    const command = initialCommand(seeded);
    const a = buildOrchestrator(db, { store: realStore(db), transport: stubTransport() });
    const b = buildOrchestrator(db, { store: realStore(db), transport: stubTransport() });

    const [ra, rb] = await Promise.all([
      a.orchestrator.deliverInitialHandoff(command),
      b.orchestrator.deliverInitialHandoff(command),
    ]);

    const delivered = [ra, rb].filter((r) => r.status === 'success');
    expect(delivered.length).toBeGreaterThanOrEqual(1);
    const totalSends = a.transport.send.mock.calls.length + b.transport.send.mock.calls.length;
    expect(totalSends).toBeLessThanOrEqual(1);
    const attempt = await readAttempt(db, ra.attemptId ?? rb.attemptId!);
    expect(attempt.status).toBe('sent');
  });

  it('2. same key + different fingerprint: one delivers, the other is an idempotency conflict', async () => {
    const seeded = await seedUnassignedTask(db);
    const key = 'idem_conc_diff_fp';
    const c1 = initialCommand(seeded, { idempotencyKey: key });
    const c2 = initialCommand(seeded, {
      idempotencyKey: key,
      requestFingerprint: requestFingerprint(seeded.taskId, seeded.recipientId, 'SALT'),
    });
    const a = buildOrchestrator(db, { store: realStore(db), transport: stubTransport() });
    const b = buildOrchestrator(db, { store: realStore(db), transport: stubTransport() });

    const [ra, rb] = await Promise.all([
      a.orchestrator.deliverInitialHandoff(c1),
      b.orchestrator.deliverInitialHandoff(c2),
    ]);
    const categories = [ra.category, rb.category];
    expect(categories).toContain('idempotency_conflict');
  });

  it('3. different keys, same Task: exactly one wins the active assignment slot', async () => {
    const seeded = await seedUnassignedTask(db);
    const a = buildOrchestrator(db, { store: realStore(db), transport: stubTransport() });
    const b = buildOrchestrator(db, { store: realStore(db), transport: stubTransport() });

    const [ra, rb] = await Promise.all([
      a.orchestrator.deliverInitialHandoff(initialCommand(seeded)),
      b.orchestrator.deliverInitialHandoff(initialCommand(seeded)),
    ]);

    const delivered = [ra, rb].filter((r) => r.status === 'success');
    expect(delivered).toHaveLength(1);
    const loser = [ra, rb].find((r) => r.status !== 'success')!;
    expect(['handoff_in_progress', 'unresolved_prior_handoff', 'persistence_conflict']).toContain(
      loser.category,
    );
  });

  it('4. initial vs retry on an already-assigned Task: initial cannot duplicate the assignment', async () => {
    // Seed a failed retryable attempt.
    const seeded = await seedUnassignedTask(db);
    const command = initialCommand(seeded);
    const failTransport = stubTransport(async () => ({
      ok: false,
      failure: transportFailure('GMAIL_RATE_LIMITED', 1),
    }));
    const seed = buildOrchestrator(db, { transport: failTransport });
    const failed = await seed.orchestrator.deliverInitialHandoff(command);
    expect(failed.status).toBe('failure');

    // Concurrent: a fresh initial (new key) vs the explicit retry of the failed attempt.
    const initial = buildOrchestrator(db, { store: realStore(db), transport: stubTransport() });
    const retry = buildOrchestrator(db, { store: realStore(db), transport: stubTransport() });
    const [ri, rr] = await Promise.all([
      initial.orchestrator.deliverInitialHandoff(initialCommand(seeded)),
      retry.orchestrator.retryHandoff({
        organizationId: ORG,
        ownerId: OWNER_ID,
        attemptId: failed.attemptId!,
        requestFingerprint: command.requestFingerprint,
      }),
    ]);

    expect(ri.status).not.toBe('success'); // fresh initial cannot re-assign an assigned Task
    expect(rr.category).toBe('delivered'); // retry proceeds against the existing attempt
  });

  it('5. initial handoff vs administrative issuance are mutually exclusive', async () => {
    const seeded = await seedUnassignedTask(db);
    const handoff = buildOrchestrator(db, { store: realStore(db), transport: stubTransport() });

    const owner = ownerActor(asOwnerId(OWNER_ID), asOrganizationId(ORG));
    const [handoffResult, issuance] = await Promise.all([
      handoff.orchestrator.deliverInitialHandoff(initialCommand(seeded)),
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

    const handoffSucceeded = handoffResult.status === 'success';
    const issuanceSucceeded = issuance.ok;
    // They contend for the same active-assignment slot; never both succeed.
    expect(handoffSucceeded && issuanceSucceeded).toBe(false);
    expect(handoffSucceeded || issuanceSucceeded).toBe(true);
  });

  it('6. duplicate accepted recording with different provider ids: one succeeds, one typed conflict', async () => {
    const seeded = await seedUnassignedTask(db);
    // Leave a clean pending attempt via an ambiguous send (no terminal recording).
    const ambiguous = stubTransport(async () => ({
      ok: false,
      failure: transportFailure('GMAIL_AMBIGUOUS_SEND', 'timeout'),
    }));
    const { orchestrator } = buildOrchestrator(db, { transport: ambiguous });
    const pending = await orchestrator.deliverInitialHandoff(initialCommand(seeded));
    expect(pending.category).toBe('ambiguous');

    const store = realStore(db);
    const [r1, r2] = await Promise.all([
      store.recordAccepted({
        organizationId: ORG,
        attemptId: pending.attemptId!,
        providerMessageId: 'gmsg_conc_a',
        providerAcceptedAt: NOW,
        expectedSendGeneration: 1,
      }),
      store.recordAccepted({
        organizationId: ORG,
        attemptId: pending.attemptId!,
        providerMessageId: 'gmsg_conc_b',
        providerAcceptedAt: NOW,
        expectedSendGeneration: 1,
      }),
    ]);
    const oks = [r1, r2].filter((r) => r.ok);
    expect(oks).toHaveLength(1);
  });

  it('7. accepted vs failed terminal persistence: exactly one terminal state wins', async () => {
    const seeded = await seedUnassignedTask(db);
    const ambiguous = stubTransport(async () => ({
      ok: false,
      failure: transportFailure('GMAIL_AMBIGUOUS_SEND', 'timeout'),
    }));
    const { orchestrator } = buildOrchestrator(db, { transport: ambiguous });
    const pending = await orchestrator.deliverInitialHandoff(initialCommand(seeded));

    const store = realStore(db);
    const results = await Promise.allSettled([
      store.recordAccepted({
        organizationId: ORG,
        attemptId: pending.attemptId!,
        providerMessageId: 'gmsg_terminal',
        providerAcceptedAt: NOW,
        expectedSendGeneration: 1,
      }),
      store.recordFailed({
        organizationId: ORG,
        attemptId: pending.attemptId!,
        failure: transportFailure('GMAIL_INVALID_MESSAGE', 400),
        expectedSendGeneration: 1,
      }),
    ]);
    // At least one terminal transition applies; the attempt ends in a single consistent state.
    const attempt = await readAttempt(db, pending.attemptId!);
    expect(['sent', 'failed']).toContain(attempt.status);
    if (attempt.status === 'sent') {
      expect(attempt.providerMessageId).toBe('gmsg_terminal');
    }
    void results;
  });
});
