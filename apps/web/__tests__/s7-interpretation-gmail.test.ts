// @vitest-environment node
/**
 * S7 Gmail source through the shared interpretation service (D179).
 *
 * Proves `sourceKind = gmail` uses Gmail provenance rather than the manual-capture helper, keeps
 * 0..N cardinality, and does not claim A6 CommunicationEvent suggestion linkage.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MockInterpretationProvider,
  DEFAULT_INTERPRETATION_POLICY_VERSION,
  type InterpretationProvider,
  type InterpretationResult,
  type ProposedTask,
} from '@aicaa/ai';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import {
  asOrganizationId,
  asTaskId,
  findExactGmailMessageId,
  type TaskSummaryPoint,
} from '@aicaa/domain';
import type {
  GmailInterpretationProvenance,
  InterpretationRequest,
} from '@/lib/interpretation/service';
import { interpretCapture } from '@/lib/interpretation/service';
import { resolveTaskGmailForwardSource } from '@/lib/handoff/forward-source';
import { computeInterpretationRequestFingerprint } from '@/lib/interpretation/fingerprint';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { seedGmailAccount, seedGmailEventWithExcerpt } from './helpers/seed-review-excerpt';

const org = 'org_s7_service';
const now = '2026-08-13T18:00:00.000Z';
const capturedAt = '2026-08-13T17:00:00.000Z';
const ingestPurgeAt = '2026-08-20T17:00:00.000Z';
const rawInput = 'Please send the revised quote and book the survey.';
const accountId = 'acct_s7_service';

const gmailProvenance: GmailInterpretationProvenance = {
  communicationEventId: 'evt_s7_service',
  providerMessageId: 'msg_s7_service',
  providerThreadId: 'thread_s7_service',
  excerptId: 'ex_s7_service',
  excerptByteLength: rawInput.length,
  subject: 'Quote revision',
  fromAddress: 'sender@example.com',
  dedupeKey: 'gmail:msg_s7_service',
};

class CountingInterpretationProvider implements InterpretationProvider {
  readonly name = 'counting-interpretation';
  calls: unknown[] = [];

  constructor(private readonly result: InterpretationResult) {}

  async interpret(input: unknown): Promise<InterpretationResult> {
    this.calls.push(input);
    return this.result;
  }
}

function summaryPoint(overrides: Partial<TaskSummaryPoint> = {}): TaskSummaryPoint {
  return {
    id: 'sp_1',
    kind: 'request',
    label: 'Request',
    order: 0,
    value: 'Send the revised quote',
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

function gmailRequest(overrides: Partial<InterpretationRequest> = {}): InterpretationRequest {
  return {
    organizationId: org,
    sourceKind: 'gmail',
    rawInput,
    idempotencyKey: 'idem_s7_service',
    requestId: 'req_s7_service',
    capturedAt,
    timezone: null,
    gmailProvenance,
    ...overrides,
  };
}

let db: TestDatabase;

describe('S7 Gmail shared interpretation source', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
    await seedGmailAccount(db.prisma, {
      organizationId: org,
      accountId,
      emailAddress: 'owner@acme.example',
      connectedAt: capturedAt,
    });
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    installDbTestRuntime(db.prisma);
    await db.prisma.taskSuggestion.deleteMany();
    await db.prisma.interpretationRun.deleteMany();
    // The excerpt is a real row because `sourceExcerptId` is a real foreign key (D082): a Review
    // proposal cannot claim provenance for an excerpt that does not exist.
    await seedGmailEventWithExcerpt(db.prisma, {
      organizationId: org,
      accountId,
      eventId: gmailProvenance.communicationEventId,
      providerMessageId: gmailProvenance.providerMessageId,
      excerptId: gmailProvenance.excerptId,
      content: rawInput,
      purgeAt: ingestPurgeAt,
      internalDate: capturedAt,
      fromAddress: gmailProvenance.fromAddress,
      subject: gmailProvenance.subject ?? undefined,
    });
  });

  afterEach(() => {
    clearDbTestRuntime();
  });

  it('records gmail provenance and does not masquerade as a manual capture', async () => {
    const provider = new MockInterpretationProvider({
      result: interpretationResult([proposedTask(), proposedTask()]),
    });

    const result = await interpretCapture({
      db: db.prisma,
      request: gmailRequest(),
      now,
      deps: { provider },
    });

    expect(result.occurrence.sourceKind).toBe('gmail');
    expect(result.suggestions).toHaveLength(2);
    for (const suggestion of result.suggestions) {
      expect(suggestion.sourceCommunicationEventId).toBeNull();
      // The Review retention linkage, taken from server-resolved provenance rather than A6's column.
      expect(suggestion.sourceExcerptId).toBe(gmailProvenance.excerptId);
      expect(suggestion.sourceReference).toMatchObject({
        id: 'evt_s7_service',
        sourceType: 'gmail',
        dedupeKey: 'gmail:msg_s7_service',
        capturedAt,
        title: 'Quote revision',
        contactHint: 'sender@example.com',
        excerptRef: {
          excerptId: 'ex_s7_service',
          byteLength: rawInput.length,
          contentClassification: 'temporary_communication',
        },
      });
      expect(suggestion.sourceReference?.externalIds).toEqual([
        { provider: 'gmail', idType: 'message_id', id: 'msg_s7_service' },
        { provider: 'gmail', idType: 'thread', id: 'thread_s7_service' },
      ]);
      expect(findExactGmailMessageId(suggestion.sourceReference)).toBe('msg_s7_service');
      expect(
        resolveTaskGmailForwardSource({
          organizationId: org,
          accountId,
          attemptId: 'att_s7_service',
          task: {
            id: asTaskId('task_s7_service'),
            organizationId: asOrganizationId(org),
            status: 'open',
            summaryPoints: [],
            notes: [],
            reminder: { paused: false },
            retention: {},
            version: 1,
            createdAt: now,
            updatedAt: now,
            sourceReference: suggestion.sourceReference,
          },
        }),
      ).toEqual({
        providerMessageId: 'msg_s7_service',
        organizationId: org,
        accountId,
      });
    }

    const run = await db.prisma.interpretationRun.findFirstOrThrow();
    expect(run.sourceKind).toBe('gmail');
    expect(await db.prisma.task.count()).toBe(0);
  });

  it('records a valid zero-proposal Gmail interpretation as success', async () => {
    const provider = new MockInterpretationProvider({ result: interpretationResult([]) });

    const result = await interpretCapture({
      db: db.prisma,
      request: gmailRequest(),
      now,
      deps: { provider },
    });

    expect(result.outcome).toBe('created');
    expect(result.occurrence.outcome).toBe('no_proposals');
    expect(result.suggestions).toEqual([]);
    expect(await db.prisma.interpretationRun.count()).toBe(1);
    expect(await db.prisma.taskSuggestion.count()).toBe(0);
  });

  it('does not change the manual-capture fingerprint canonical form', () => {
    const manual = computeInterpretationRequestFingerprint({
      organizationId: org,
      sourceKind: 'owner_manual_capture',
      rawInput,
      capturedAt,
      timezone: null,
    });
    const manualWithUnusedGmailId = computeInterpretationRequestFingerprint({
      organizationId: org,
      sourceKind: 'owner_manual_capture',
      rawInput,
      capturedAt,
      timezone: null,
      gmailOccurrenceId: 'evt_must_not_participate',
    });
    expect(manualWithUnusedGmailId).toBe(manual);
  });

  it('fingerprints Gmail occurrence identity so two messages with the same excerpt conflict on one key', async () => {
    const provider = new CountingInterpretationProvider(interpretationResult([proposedTask()]));

    const first = await interpretCapture({
      db: db.prisma,
      request: gmailRequest(),
      now,
      deps: { provider },
    });
    expect(first.outcome).toBe('created');

    await expect(
      interpretCapture({
        db: db.prisma,
        request: gmailRequest({
          gmailProvenance: { ...gmailProvenance, communicationEventId: 'evt_other' },
        }),
        now,
        deps: { provider },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });

    expect(provider.calls).toHaveLength(1);
  });

  it('skips the new-interpretation gate on an exact Gmail replay', async () => {
    const provider = new CountingInterpretationProvider(interpretationResult([proposedTask()]));
    let gateCalls = 0;
    const gate = () => {
      gateCalls += 1;
    };

    const first = await interpretCapture({
      db: db.prisma,
      request: gmailRequest(),
      now,
      deps: { provider },
      beforeNewInterpretation: gate,
    });
    expect(first.outcome).toBe('created');
    expect(gateCalls).toBe(1);

    const replay = await interpretCapture({
      db: db.prisma,
      request: gmailRequest(),
      now,
      deps: { provider },
      beforeNewInterpretation: () => {
        gateCalls += 1;
        throw new Error('eligibility gate must not run on exact replay');
      },
    });
    expect(replay.outcome).toBe('replayed');
    expect(gateCalls).toBe(1);
    expect(provider.calls).toHaveLength(1);
  });

  it('rejects Gmail provenance on a manual capture request', async () => {
    const provider = new CountingInterpretationProvider(interpretationResult([proposedTask()]));

    await expect(
      interpretCapture({
        db: db.prisma,
        request: {
          organizationId: org,
          sourceKind: 'owner_manual_capture',
          rawInput,
          idempotencyKey: 'idem_s7_manual_guard',
          requestId: 'req_s7_manual_guard',
          capturedAt,
          gmailProvenance,
        },
        now,
        deps: { provider },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(provider.calls).toHaveLength(0);
  });
});
