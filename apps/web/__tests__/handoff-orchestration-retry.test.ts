// @vitest-environment node
/**
 * A7.5 handoff orchestration — explicit retry of a failed, retryable attempt.
 *
 * Engine: PGlite (embedded Postgres) with the real A7.3 primitives; Gmail transport mocked.
 *
 * Retry reuses the SAME attempt / assignment / capability / idempotency identity / request
 * fingerprint, with the capability token rotated in place (new hash) during retry preparation. The
 * message preparer is stubbed here; token rotation + old-link invalidation are covered end-to-end in
 * handoff-orchestration-retry-rotation.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { transportFailure } from '@/lib/gmail/transport/errors';
import type { RetryHandoffCommand } from '@/lib/handoff/types';
import {
  OWNER_ID,
  ORG,
  buildOrchestrator,
  initialCommand,
  readAttempt,
  readCapability,
  realStore,
  seedUnassignedTask,
  stubTransport,
} from './handoff-orchestration.harness';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

async function createFailedAttempt(retryable = true) {
  const seeded = await seedUnassignedTask(db);
  const command = initialCommand(seeded);
  const transport = stubTransport(async () => ({
    ok: false,
    failure: transportFailure(retryable ? 'GMAIL_RATE_LIMITED' : 'GMAIL_INVALID_MESSAGE', 1),
  }));
  const { orchestrator } = buildOrchestrator(db, { transport });
  const failed = await orchestrator.deliverInitialHandoff(command);
  expect(failed.status).toBe('failure');
  const attempt = await readAttempt(db, failed.attemptId!);
  expect(attempt.status).toBe('failed');
  return { seeded, command, attemptId: failed.attemptId! };
}

function retryCommand(attemptId: string, requestFingerprint: string): RetryHandoffCommand {
  return {
    organizationId: ORG,
    ownerId: OWNER_ID,
    attemptId,
    requestFingerprint,
    correlationId: 'retry_corr',
  };
}

describe('A7.5 explicit retry', () => {
  it('32/33/34/35. retryable failed attempt is retried in place, reuses the same attempt+capability, calls Gmail once, activates the capability on acceptance', async () => {
    const { command, attemptId } = await createFailedAttempt(true);
    const before = await readAttempt(db, attemptId);

    const { orchestrator, transport } = buildOrchestrator(db);
    const result = await orchestrator.retryHandoff(
      retryCommand(attemptId, command.requestFingerprint),
    );

    expect(result.category).toBe('delivered');
    expect(result.attemptId).toBe(attemptId); // same attempt reused
    expect(transport.send).toHaveBeenCalledTimes(1); // Gmail called once

    const after = await readAttempt(db, attemptId);
    expect(after.status).toBe('sent');
    expect(after.capabilityId).toBe(before.capabilityId); // same capability
    const cap = await readCapability(db, after.capabilityId);
    expect(cap.actionableAt).not.toBeNull(); // activated only after acceptance
  });

  it('36. a retry that is rejected returns the attempt to failed', async () => {
    const { command, attemptId } = await createFailedAttempt(true);
    const transport = stubTransport(async () => ({
      ok: false,
      failure: transportFailure('GMAIL_INVALID_MESSAGE', 400),
    }));
    const { orchestrator } = buildOrchestrator(db, { transport });
    const result = await orchestrator.retryHandoff(
      retryCommand(attemptId, command.requestFingerprint),
    );

    expect(result.category).toBe('known_provider_rejection');
    const after = await readAttempt(db, attemptId);
    expect(after.status).toBe('failed');
  });

  it('37. a non-retryable failed attempt cannot be retried and never calls Gmail', async () => {
    const { command, attemptId } = await createFailedAttempt(false);
    const attempt = await readAttempt(db, attemptId);
    expect(attempt.retryable).toBe(false);

    const { orchestrator, transport } = buildOrchestrator(db);
    const result = await orchestrator.retryHandoff(
      retryCommand(attemptId, command.requestFingerprint),
    );

    expect(result.status).toBe('failure');
    expect(result.category).toBe('persistence_conflict'); // INVALID_STATE (not retryable)
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('38. a retry with the wrong fingerprint is rejected and never calls Gmail', async () => {
    const { attemptId } = await createFailedAttempt(true);
    const { orchestrator, transport } = buildOrchestrator(db);
    const result = await orchestrator.retryHandoff(retryCommand(attemptId, 'wrong-fingerprint'));

    expect(result.category).toBe('idempotency_conflict');
    expect(transport.send).not.toHaveBeenCalled();
    const after = await readAttempt(db, attemptId);
    expect(after.status).toBe('failed'); // untouched
  });

  it('39. concurrent retries: at most one acceptance is recorded (no exactly-once send claim)', async () => {
    const { command, attemptId } = await createFailedAttempt(true);

    // Two independent invocations sharing the same persistence engine. Each has its own transport so
    // we can count sends across both; the A7.3 sent-transition + provider-id uniqueness guarantee at
    // most ONE recorded acceptance even if both happen to reach the provider.
    const a = buildOrchestrator(db, { store: realStore(db), transport: stubTransport() });
    const b = buildOrchestrator(db, { store: realStore(db), transport: stubTransport() });

    const [ra, rb] = await Promise.all([
      a.orchestrator.retryHandoff(retryCommand(attemptId, command.requestFingerprint)),
      b.orchestrator.retryHandoff(retryCommand(attemptId, command.requestFingerprint)),
    ]);

    const delivered = [ra, rb].filter((r) => r.category === 'delivered');
    expect(delivered).toHaveLength(1); // exactly one valid delivery recording
    const loser = [ra, rb].find((r) => r.category !== 'delivered');
    expect(loser).toBeDefined();
    expect(loser!.status).not.toBe('success');

    const after = await readAttempt(db, attemptId);
    expect(after.status).toBe('sent');
    expect(after.providerMessageId).toBe(delivered[0].providerMessageId);
  });
});
