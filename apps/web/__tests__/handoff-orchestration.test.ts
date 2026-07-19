// @vitest-environment node
/**
 * A7.5 handoff orchestration — initial lifecycle, replay/idempotency, known failures, ambiguous
 * outcomes, privacy, and the distributed transaction boundary.
 *
 * Engine: in-process PGlite (embedded Postgres) with the real A7.3 primitives; Gmail transport/
 * access/message-preparer mocked (no real Gmail send).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { transportFailure } from '@/lib/gmail/transport/errors';
import {
  buildOrchestrator,
  initialCommand,
  readAttempt,
  readCapability,
  readTask,
  recordingLogger,
  requestFingerprint,
  seedUnassignedTask,
  stubMessages,
  stubTransport,
  stubAccess,
} from './handoff-orchestration.harness';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

describe('A7.5 initial handoff — success', () => {
  it('1/8. runs prerequisites and returns a normalized success for a new send', async () => {
    const seeded = await seedUnassignedTask(db);
    const { orchestrator, access } = buildOrchestrator(db);
    const result = await orchestrator.deliverInitialHandoff(initialCommand(seeded));

    expect(access.resolve).toHaveBeenCalledWith(expect.stringContaining('org_a75'));
    expect(result.status).toBe('success');
    expect(result.category).toBe('delivered');
    expect(result.providerMessageId).toBeTruthy();
    expect(result.attemptId).toBeTruthy();
  });

  it('2/4/5/7. creates a pending attempt with the persisted delivery path, records provider id, sets Assignment sent', async () => {
    const seeded = await seedUnassignedTask(db);
    const { orchestrator, transport } = buildOrchestrator(db);
    const result = await orchestrator.deliverInitialHandoff(
      initialCommand(seeded, { deliveryPath: 'assignment_email' }),
    );

    const attempt = await readAttempt(db, result.attemptId!);
    expect(attempt.status).toBe('sent');
    expect(attempt.deliveryPath).toBe('assignment_email');
    expect(attempt.providerMessageId).toBe(result.providerMessageId);
    // Transport received the same server-selected delivery path.
    expect(transport.send.mock.calls[0][0].message.deliveryPath).toBe('assignment_email');

    const task = await readTask(db, seeded.taskId);
    expect(task.assignment?.deliveryStatus).toBe('sent');
  });

  it('3/45. calls Gmail OUTSIDE any DB transaction (attempt already committed pending during send)', async () => {
    const seeded = await seedUnassignedTask(db);
    let attemptStatusDuringSend: string | undefined;
    const transport = stubTransport(async (input) => {
      // The begin transaction has committed before the provider call: an independent read sees the
      // pending row, proving no DB transaction is held open across the Gmail send.
      const pending = await db.prisma.handoffAttempt.findFirst({
        where: { organizationId: 'org_a75', taskId: seeded.taskId },
      });
      attemptStatusDuringSend = pending?.status;
      return {
        ok: true,
        acceptance: {
          providerMessageId: 'gmsg_boundary',
          acceptedAt: '2026-07-18T18:00:00.000Z',
          deliveryPath: input.message.deliveryPath,
        },
      };
    });
    const { orchestrator } = buildOrchestrator(db, { transport });
    await orchestrator.deliverInitialHandoff(initialCommand(seeded));
    expect(attemptStatusDuringSend).toBe('pending');
  });

  it('6. capability becomes actionable only AFTER acceptance', async () => {
    const seeded = await seedUnassignedTask(db);
    let actionableDuringSend: string | null | undefined = 'unset';
    const transport = stubTransport(async (input) => {
      const attempt = await db.prisma.handoffAttempt.findFirst({
        where: { organizationId: 'org_a75', taskId: seeded.taskId },
      });
      const cap = await readCapability(db, attempt!.capabilityId);
      actionableDuringSend = cap.actionableAt;
      return {
        ok: true,
        acceptance: {
          providerMessageId: 'gmsg_actionable',
          acceptedAt: '2026-07-18T18:00:00.000Z',
          deliveryPath: input.message.deliveryPath,
        },
      };
    });
    const { orchestrator } = buildOrchestrator(db, { transport });
    const result = await orchestrator.deliverInitialHandoff(initialCommand(seeded));

    expect(actionableDuringSend).toBeNull(); // non-actionable before acceptance
    const attempt = await readAttempt(db, result.attemptId!);
    const cap = await readCapability(db, attempt.capabilityId);
    expect(cap.actionableAt).not.toBeNull(); // actionable after acceptance
  });
});

describe('A7.5 initial handoff — replay & idempotency', () => {
  it('9/14. sent same-key replay returns delivered_replay and does not call Gmail again', async () => {
    const seeded = await seedUnassignedTask(db);
    const command = initialCommand(seeded);
    const { orchestrator, transport } = buildOrchestrator(db);

    const first = await orchestrator.deliverInitialHandoff(command);
    expect(first.category).toBe('delivered');
    const replay = await orchestrator.deliverInitialHandoff(command);

    expect(replay.category).toBe('delivered_replay');
    expect(replay.providerMessageId).toBe(first.providerMessageId);
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it('10/26. pending same-key replay returns in_progress and does not call Gmail again', async () => {
    const seeded = await seedUnassignedTask(db);
    const command = initialCommand(seeded);
    const transport = stubTransport(async () => ({
      ok: false,
      failure: transportFailure('GMAIL_AMBIGUOUS_SEND', 'timeout'),
    }));
    const { orchestrator } = buildOrchestrator(db, { transport });

    const first = await orchestrator.deliverInitialHandoff(command);
    expect(first.category).toBe('ambiguous');

    const replay = await orchestrator.deliverInitialHandoff(command);
    expect(replay.category).toBe('in_progress');
    expect(replay.reconciliationRequired).toBe(true);
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it('11. failed same-key initial replay requires explicit retry and does not call Gmail again', async () => {
    const seeded = await seedUnassignedTask(db);
    const command = initialCommand(seeded);
    const transport = stubTransport(async () => ({
      ok: false,
      failure: transportFailure('GMAIL_RATE_LIMITED', 429),
    }));
    const { orchestrator } = buildOrchestrator(db, { transport });

    const first = await orchestrator.deliverInitialHandoff(command);
    expect(first.category).toBe('retryable_provider_failure');

    const replay = await orchestrator.deliverInitialHandoff(command);
    expect(replay.category).toBe('previous_attempt_failed');
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it('12. same key with a different fingerprint returns an idempotency conflict', async () => {
    const seeded = await seedUnassignedTask(db);
    const idempotencyKey = 'idem_conflict_a75';
    const { orchestrator, transport } = buildOrchestrator(db);

    await orchestrator.deliverInitialHandoff(initialCommand(seeded, { idempotencyKey }));
    const conflict = await orchestrator.deliverInitialHandoff(
      initialCommand(seeded, {
        idempotencyKey,
        requestFingerprint: requestFingerprint(seeded.taskId, seeded.recipientId, 'DIFFERENT'),
      }),
    );

    expect(conflict.category).toBe('idempotency_conflict');
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it('13. different key against an already-assigned Task is normalized (no duplicate)', async () => {
    const seeded = await seedUnassignedTask(db);
    const { orchestrator, transport } = buildOrchestrator(db);

    await orchestrator.deliverInitialHandoff(initialCommand(seeded));
    const second = await orchestrator.deliverInitialHandoff(initialCommand(seeded));

    expect(['unresolved_prior_handoff', 'handoff_in_progress', 'persistence_conflict']).toContain(
      second.category,
    );
    expect(transport.send).toHaveBeenCalledTimes(1);
  });
});

describe('A7.5 initial handoff — known failures', () => {
  it('15. missing send scope fails before persistence and before the provider call', async () => {
    const seeded = await seedUnassignedTask(db);
    const access = stubAccess({ state: 'send_scope_required' });
    const { orchestrator, transport } = buildOrchestrator(db, { access });

    const result = await orchestrator.deliverInitialHandoff(initialCommand(seeded));

    expect(result.category).toBe('send_reconsent_required');
    expect(transport.send).not.toHaveBeenCalled();
    const task = await readTask(db, seeded.taskId);
    expect(task.assignment).toBeUndefined(); // no durable pending state created
  });

  it('15b. not connected fails before persistence', async () => {
    const seeded = await seedUnassignedTask(db);
    const access = stubAccess({ state: 'not_connected' });
    const { orchestrator, transport } = buildOrchestrator(db, { access });
    const result = await orchestrator.deliverInitialHandoff(initialCommand(seeded));
    expect(result.category).toBe('gmail_not_connected');
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('16/17. unsupported forward / missing attachment blocks the provider call and records failed', async () => {
    for (const [failCode, expected] of [
      ['GMAIL_UNSUPPORTED_SOURCE_SHAPE', 'unsupported_source_shape'],
      ['GMAIL_ATTACHMENT_UNAVAILABLE', 'attachment_unavailable'],
    ] as const) {
      const seeded = await seedUnassignedTask(db);
      const messages = stubMessages(() => ({
        ok: false,
        failure: transportFailure(failCode),
      }));
      const { orchestrator, transport } = buildOrchestrator(db, { messages });
      const result = await orchestrator.deliverInitialHandoff(
        initialCommand(seeded, { deliveryPath: 'gmail_forward' }),
      );
      expect(result.category).toBe(expected);
      expect(transport.send).not.toHaveBeenCalled();
      const attempt = await readAttempt(db, result.attemptId!);
      expect(attempt.status).toBe('failed');
    }
  });

  it('18/20/21/22. known provider rejection records failed, keeps capability non-actionable, aligns Assignment, no raw error', async () => {
    const seeded = await seedUnassignedTask(db);
    const transport = stubTransport(async () => ({
      ok: false,
      failure: transportFailure('GMAIL_INVALID_MESSAGE', 400),
    }));
    const { orchestrator } = buildOrchestrator(db, { transport });
    const result = await orchestrator.deliverInitialHandoff(initialCommand(seeded));

    expect(result.category).toBe('known_provider_rejection');
    expect(result.message).not.toMatch(/400|google|prisma/i);
    const attempt = await readAttempt(db, result.attemptId!);
    expect(attempt.status).toBe('failed');
    expect(attempt.failureCode).toBe('GMAIL_INVALID_MESSAGE');
    const cap = await readCapability(db, attempt.capabilityId);
    expect(cap.actionableAt).toBeNull();
    const task = await readTask(db, seeded.taskId);
    expect(task.assignment?.deliveryStatus).toBe('failed');
  });

  it('19. retryable failure preserves the retryable flag and a privacy-safe fingerprint', async () => {
    const seeded = await seedUnassignedTask(db);
    const transport = stubTransport(async () => ({
      ok: false,
      failure: transportFailure('GMAIL_RATE_LIMITED', 429),
    }));
    const { orchestrator } = buildOrchestrator(db, { transport });
    const result = await orchestrator.deliverInitialHandoff(initialCommand(seeded));

    expect(result.category).toBe('retryable_provider_failure');
    expect(result.retryable).toBe(true);
    const attempt = await readAttempt(db, result.attemptId!);
    expect(attempt.retryable).toBe(true);
    // Non-reversible 16-char hex fingerprint (never the raw status / provider body).
    expect(attempt.failureFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('A7.5 initial handoff — ambiguous outcomes', () => {
  it('23/24/25/27. ambiguous send is not a rejection: leaves pending, non-actionable, no resend, reconciliation required', async () => {
    const seeded = await seedUnassignedTask(db);
    const transport = stubTransport(async () => ({
      ok: false,
      failure: transportFailure('GMAIL_AMBIGUOUS_SEND', 'timeout'),
    }));
    const { orchestrator } = buildOrchestrator(db, { transport });
    const result = await orchestrator.deliverInitialHandoff(initialCommand(seeded));

    expect(result.category).toBe('ambiguous');
    expect(result.status).toBe('in_progress');
    expect(result.ambiguous).toBe(true);
    expect(result.reconciliationRequired).toBe(true);
    expect(transport.send).toHaveBeenCalledTimes(1);

    const attempt = await readAttempt(db, result.attemptId!);
    expect(attempt.status).toBe('pending'); // NOT failed, NOT sent
    const cap = await readCapability(db, attempt.capabilityId);
    expect(cap.actionableAt).toBeNull();
  });

  it('23b. a thrown transport error is treated as ambiguous (cannot prove non-delivery), leaves pending', async () => {
    const seeded = await seedUnassignedTask(db);
    const transport = stubTransport(async () => {
      throw new Error('socket hang up');
    });
    const { orchestrator } = buildOrchestrator(db, { transport });
    const result = await orchestrator.deliverInitialHandoff(initialCommand(seeded));

    expect(result.category).toBe('ambiguous');
    const attempt = await readAttempt(db, result.attemptId!);
    expect(attempt.status).toBe('pending');
  });
});

describe('A7.5 — privacy-safe observability', () => {
  it('40/41/42/43. logs never contain capability URL/token, MIME/body, access token, or recipient email', async () => {
    const seeded = await seedUnassignedTask(db);
    let capturedUrl = '';
    const messages = stubMessages((input) => {
      capturedUrl = input.capabilityUrl ?? '';
      return {
        ok: true,
        message: {
          from: input.access.from,
          to: { email: input.capability.intendedRecipientEmail },
          subject: 'SENSITIVE-SUBJECT',
          textBody: 'SENSITIVE-BODY',
          deliveryPath: input.deliveryPath,
        },
      };
    });
    const logger = recordingLogger();
    const { orchestrator } = buildOrchestrator(db, { messages, logger });
    await orchestrator.deliverInitialHandoff(initialCommand(seeded));

    const serialized = JSON.stringify(logger.records);
    expect(capturedUrl).toContain('/c/'); // sanity: a real URL was built
    expect(serialized).not.toContain(capturedUrl);
    expect(serialized).not.toContain('/c/');
    expect(serialized).not.toContain('SENSITIVE-BODY');
    expect(serialized).not.toContain('SENSITIVE-SUBJECT');
    expect(serialized).not.toContain('fake-access-token');
    expect(serialized).not.toContain(seeded.email);
    // But phases/categories ARE present.
    expect(serialized).toContain('provider_send');
    expect(serialized).toContain('handoff_orchestration');
  });

  it('44. the command type surface accepts no arbitrary Gmail/provider ids from the caller', async () => {
    const seeded = await seedUnassignedTask(db);
    const command = initialCommand(seeded);
    const keys = Object.keys(command);
    expect(keys).not.toContain('providerMessageId');
    expect(keys).not.toContain('gmailMessageId');
    expect(keys).not.toContain('accessToken');
    expect(keys).not.toContain('capabilityToken');
    expect(keys).not.toContain('mimeHeaders');
  });
});

describe('A7.5 — accepted-outcome idempotency & provider-id conflict', () => {
  it('6b/duplicate accept: same provider id replays ok, different provider id is a typed conflict', async () => {
    const seeded = await seedUnassignedTask(db);
    const { orchestrator, store } = buildOrchestrator(db);
    const result = await orchestrator.deliverInitialHandoff(initialCommand(seeded));
    const attempt = await readAttempt(db, result.attemptId!);

    // Same provider id → idempotent success.
    const same = await store.recordAccepted({
      organizationId: 'org_a75',
      attemptId: attempt.id,
      providerMessageId: attempt.providerMessageId!,
      providerAcceptedAt: '2026-07-18T18:00:00.000Z',
      expectedSendGeneration: attempt.attemptCount,
    });
    expect(same.ok).toBe(true);

    // Different provider id → typed conflict, never a raw DB error.
    const conflict = await store.recordAccepted({
      organizationId: 'org_a75',
      attemptId: attempt.id,
      providerMessageId: 'gmsg_different',
      providerAcceptedAt: '2026-07-18T18:00:00.000Z',
      expectedSendGeneration: attempt.attemptCount,
    });
    expect(conflict.ok).toBe(false);
  });
});
