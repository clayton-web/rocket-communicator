// @vitest-environment node
/**
 * A7.5 handoff orchestration — the four process-crash windows.
 *
 * A "crash" is modelled as the invocation dying before the next DB transaction commits: we drive the
 * orchestrator up to the boundary (a transport throw / ambiguous result, or a thrown accept-persist)
 * and then assert the durable state and the behaviour of a subsequent same-key replay.
 *
 * Engine: PGlite (embedded Postgres) with the real A7.3 primitives; Gmail transport mocked.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { transportFailure } from '@/lib/gmail/transport/errors';
import type { HandoffStore } from '@/lib/handoff/types';
import {
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

describe('A7.5 crash windows', () => {
  it('28. Window A — begin committed, crash before the Gmail call: attempt stays pending, replay never resends', async () => {
    const seeded = await seedUnassignedTask(db);
    const command = initialCommand(seeded);
    // Simulate the crash by throwing inside transport (before any outcome is persisted).
    const transport = stubTransport(async () => {
      throw new Error('process died before send completed');
    });
    const { orchestrator } = buildOrchestrator(db, { transport });
    const crashed = await orchestrator.deliverInitialHandoff(command);
    expect(crashed.category).toBe('ambiguous');

    const attempt = await readAttempt(db, crashed.attemptId!);
    expect(attempt.status).toBe('pending');

    // A later same-key replay observes pending and never blindly resends.
    const replayTransport = stubTransport();
    const replay = buildOrchestrator(db, { transport: replayTransport });
    const replayed = await replay.orchestrator.deliverInitialHandoff(command);
    expect(replayed.category).toBe('in_progress');
    expect(replayed.reconciliationRequired).toBe(true);
    expect(replayTransport.send).not.toHaveBeenCalled();
  });

  it('29. Window B — Gmail rejects, crash before failed persistence: attempt stays pending, replay never resends', async () => {
    const seeded = await seedUnassignedTask(db);
    const command = initialCommand(seeded);
    // Real store, but recordFailed throws (persistence crash) after a KNOWN rejection.
    const base = realStore(db);
    const store: HandoffStore = {
      ...base,
      recordFailed: vi.fn(async () => {
        throw new Error('crash before failed outcome persisted');
      }),
    };
    const transport = stubTransport(async () => ({
      ok: false,
      failure: transportFailure('GMAIL_INVALID_MESSAGE', 400),
    }));
    const { orchestrator } = buildOrchestrator(db, { store, transport });

    // The invocation dies while trying to persist the failure.
    await expect(orchestrator.deliverInitialHandoff(command)).rejects.toThrow();

    // Attempt remains pending (the failure never durably recorded).
    const pending = await db.prisma.handoffAttempt.findFirst({
      where: { organizationId: 'org_a75', taskId: seeded.taskId },
    });
    expect(pending?.status).toBe('pending');

    // Replay observes pending and never resends.
    const replayTransport = stubTransport();
    const replay = buildOrchestrator(db, { transport: replayTransport });
    const replayed = await replay.orchestrator.deliverInitialHandoff(command);
    expect(replayed.category).toBe('in_progress');
    expect(replayTransport.send).not.toHaveBeenCalled();
  });

  it('30. Window C — Gmail accepts, crash before accepted persistence: pending, non-actionable, replay never resends', async () => {
    const seeded = await seedUnassignedTask(db);
    const command = initialCommand(seeded);
    const base = realStore(db);
    const store: HandoffStore = {
      ...base,
      recordAccepted: vi.fn(async () => {
        throw new Error('crash before accepted outcome persisted');
      }),
    };
    // Gmail ACCEPTS.
    const transport = stubTransport(async (input) => ({
      ok: true,
      acceptance: {
        providerMessageId: 'gmsg_window_c',
        acceptedAt: '2026-07-18T18:00:00.000Z',
        deliveryPath: input.message.deliveryPath,
      },
    }));
    const { orchestrator } = buildOrchestrator(db, { store, transport });

    // The orchestrator maps an accept-persist crash to ambiguous (delivery may have happened).
    const result = await orchestrator.deliverInitialHandoff(command);
    expect(result.category).toBe('ambiguous');
    expect(result.reconciliationRequired).toBe(true);

    const attempt = await db.prisma.handoffAttempt.findFirst({
      where: { organizationId: 'org_a75', taskId: seeded.taskId },
    });
    expect(attempt?.status).toBe('pending');
    const cap = await readCapability(db, attempt!.capabilityId);
    expect(cap.actionableAt).toBeNull(); // capability stays non-actionable

    // Replay never resends (still pending / uncertain).
    const replayTransport = stubTransport();
    const replay = buildOrchestrator(db, { transport: replayTransport });
    const replayed = await replay.orchestrator.deliverInitialHandoff(command);
    expect(replayed.category).toBe('in_progress');
    expect(replayTransport.send).not.toHaveBeenCalled();
  });

  it('31. Window D — accepted persisted, caller response lost: same-key replay returns sent, Gmail not called again', async () => {
    const seeded = await seedUnassignedTask(db);
    const command = initialCommand(seeded);

    const { orchestrator } = buildOrchestrator(db);
    const first = await orchestrator.deliverInitialHandoff(command);
    expect(first.category).toBe('delivered');
    // (Response is "lost" — the caller retries with the same key.)

    const replayTransport = stubTransport();
    const replay = buildOrchestrator(db, { transport: replayTransport });
    const replayed = await replay.orchestrator.deliverInitialHandoff(command);
    expect(replayed.category).toBe('delivered_replay');
    expect(replayed.providerMessageId).toBe(first.providerMessageId);
    expect(replayTransport.send).not.toHaveBeenCalled();
  });
});
