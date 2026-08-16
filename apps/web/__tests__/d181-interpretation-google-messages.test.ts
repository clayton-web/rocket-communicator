// @vitest-environment node
/**
 * D181 Google Messages source through the shared interpretation service.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MockInterpretationProvider,
  DEFAULT_INTERPRETATION_POLICY_VERSION,
  type InterpretationResult,
  type ProposedTask,
} from '@aicaa/ai';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import type {
  GoogleMessagesInterpretationProvenance,
  InterpretationRequest,
} from '@/lib/interpretation/service';
import { interpretCapture } from '@/lib/interpretation/service';
import { computeInterpretationRequestFingerprint } from '@/lib/interpretation/fingerprint';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { seedMessagesEventWithExcerpt } from './helpers/seed-review-excerpt';
import type { TaskSummaryPoint } from '@aicaa/domain';

const org = 'org_d181_service';
const now = '2026-08-13T18:00:00.000Z';
const capturedAt = '2026-08-13T17:00:00.000Z';
const reviewPurgeAt = '2026-08-20T18:00:00.000Z';
const rawInput = 'Can you pick up the package from the office tomorrow.';

const messagesProvenance: GoogleMessagesInterpretationProvenance = {
  communicationEventId: 'cmsg_d181_service',
  sourceOccurrenceId: '0|com.google.android.apps.messaging|1|null|0',
  excerptId: 'exm_d181_service',
  excerptByteLength: rawInput.length,
  dedupeKey: 'd'.repeat(64),
};

function summaryPoint(overrides: Partial<TaskSummaryPoint> = {}): TaskSummaryPoint {
  return {
    id: 'sp_1',
    kind: 'request',
    label: 'Request',
    order: 0,
    value: 'Pick up the package',
    ...overrides,
  } as TaskSummaryPoint;
}

function proposedTask(overrides: Partial<ProposedTask> = {}): ProposedTask {
  return {
    summaryPoints: [summaryPoint()],
    peopleHints: [],
    deadlineExpression: null,
    ...overrides,
  };
}

function interpretationResult(tasks: ProposedTask[]): InterpretationResult {
  return {
    tasks,
    policyVersion: DEFAULT_INTERPRETATION_POLICY_VERSION,
    modelVersion: 'mock-interpretation-model',
  };
}

function messagesRequest(overrides: Partial<InterpretationRequest> = {}): InterpretationRequest {
  return {
    organizationId: org,
    sourceKind: 'google_messages',
    rawInput,
    idempotencyKey: 'idem_d181_service',
    requestId: 'req_d181_service',
    capturedAt,
    timezone: null,
    messagesProvenance,
    ...overrides,
  };
}

let db: TestDatabase;

describe('D181 Google Messages shared interpretation source', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    installDbTestRuntime(db.prisma);
    await db.prisma.taskSuggestion.deleteMany();
    await db.prisma.interpretationRun.deleteMany();
    // The Review boundary persists these before interpreting; `sourceExcerptId` is a real foreign
    // key to the excerpt row (D082), so the test seeds what the route would have written.
    await seedMessagesEventWithExcerpt(db.prisma, {
      organizationId: org,
      eventId: messagesProvenance.communicationEventId,
      sourceOccurrenceId: messagesProvenance.sourceOccurrenceId,
      dedupeKey: messagesProvenance.dedupeKey,
      excerptId: messagesProvenance.excerptId,
      content: rawInput,
      purgeAt: reviewPurgeAt,
      observedAt: capturedAt,
    });
  });

  afterEach(() => {
    clearDbTestRuntime();
  });

  it('records google_messages provenance without Gmail or sender fields', async () => {
    const provider = new MockInterpretationProvider({
      result: interpretationResult([proposedTask(), proposedTask()]),
    });

    const result = await interpretCapture({
      db: db.prisma,
      request: messagesRequest(),
      now,
      deps: { provider },
    });

    expect(result.occurrence.sourceKind).toBe('google_messages');
    expect(result.suggestions).toHaveLength(2);
    for (const suggestion of result.suggestions) {
      expect(suggestion.sourceCommunicationEventId).toBeNull();
      // Same Review retention linkage Gmail Review uses. One repair, not a Messages-specific one.
      expect(suggestion.sourceExcerptId).toBe(messagesProvenance.excerptId);
      expect(suggestion.sourceReference).toMatchObject({
        id: 'cmsg_d181_service',
        sourceType: 'google_messages',
        dedupeKey: messagesProvenance.dedupeKey,
        capturedAt,
        excerptRef: {
          excerptId: 'exm_d181_service',
          byteLength: rawInput.length,
          contentClassification: 'temporary_communication',
        },
      });
      expect(suggestion.sourceReference?.title).toBeUndefined();
      expect(suggestion.sourceReference?.contactHint).toBeUndefined();
      expect(suggestion.sourceReference?.externalIds).toEqual([
        {
          provider: 'google_messages',
          idType: 'occurrence',
          id: messagesProvenance.sourceOccurrenceId,
        },
      ]);
    }

    const run = await db.prisma.interpretationRun.findFirstOrThrow();
    expect(run.sourceKind).toBe('google_messages');
    expect(await db.prisma.task.count()).toBe(0);
  });

  it('records a valid zero-proposal Google Messages interpretation as success', async () => {
    const provider = new MockInterpretationProvider({ result: interpretationResult([]) });

    const result = await interpretCapture({
      db: db.prisma,
      request: messagesRequest(),
      now,
      deps: { provider },
    });

    expect(result.outcome).toBe('created');
    expect(result.occurrence.outcome).toBe('no_proposals');
    expect(result.suggestions).toEqual([]);
    expect(await db.prisma.interpretationRun.count()).toBe(1);
    expect(await db.prisma.taskSuggestion.count()).toBe(0);
  });

  it('does not change the manual-capture fingerprint when a Messages occurrence id is unused', () => {
    const manual = computeInterpretationRequestFingerprint({
      organizationId: org,
      sourceKind: 'owner_manual_capture',
      rawInput,
      capturedAt,
      timezone: null,
    });
    const manualWithUnusedMessagesId = computeInterpretationRequestFingerprint({
      organizationId: org,
      sourceKind: 'owner_manual_capture',
      rawInput,
      capturedAt,
      timezone: null,
      messagesOccurrenceId: 'occ_must_not_participate',
    });
    expect(manualWithUnusedMessagesId).toBe(manual);
  });

  it('fingerprints Messages occurrence identity so two occurrences with the same text conflict on one key', async () => {
    const provider = new MockInterpretationProvider({
      result: interpretationResult([proposedTask()]),
    });

    const first = await interpretCapture({
      db: db.prisma,
      request: messagesRequest(),
      now,
      deps: { provider },
    });
    expect(first.outcome).toBe('created');

    await expect(
      interpretCapture({
        db: db.prisma,
        request: messagesRequest({
          messagesProvenance: {
            ...messagesProvenance,
            sourceOccurrenceId: 'other-occurrence',
            communicationEventId: 'cmsg_other',
          },
        }),
        now,
        deps: { provider },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
  });

  it('runs the new-interpretation gate only for a genuinely new Messages request', async () => {
    const provider = new MockInterpretationProvider({
      result: interpretationResult([proposedTask()]),
    });
    let gateCalls = 0;

    const first = await interpretCapture({
      db: db.prisma,
      request: messagesRequest(),
      now,
      deps: { provider },
      beforeNewInterpretation: () => {
        gateCalls += 1;
      },
    });
    expect(first.outcome).toBe('created');
    expect(gateCalls).toBe(1);

    const replay = await interpretCapture({
      db: db.prisma,
      request: messagesRequest(),
      now,
      deps: { provider },
      beforeNewInterpretation: () => {
        gateCalls += 1;
        throw new Error('Messages persistence gate must not run on exact replay');
      },
    });
    expect(replay.outcome).toBe('replayed');
    expect(gateCalls).toBe(1);

    await expect(
      interpretCapture({
        db: db.prisma,
        request: messagesRequest({
          messagesProvenance: {
            ...messagesProvenance,
            sourceOccurrenceId: 'other-occurrence',
            communicationEventId: 'cmsg_other',
          },
        }),
        now,
        deps: { provider },
        beforeNewInterpretation: () => {
          gateCalls += 1;
          throw new Error('Messages persistence gate must not run on idempotency conflict');
        },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
    expect(gateCalls).toBe(1);
  });
});
