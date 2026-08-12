// @vitest-environment node
/**
 * S3.1 shared interpretation application service (D169).
 *
 * Backend only: these tests call the service directly because no HTTP route, Android surface, or
 * worker reaches it. They prove the interpretation → canonical persistence seam, its
 * organization-scoped idempotency, and the advisory-field and raw-input boundaries D169 fixed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AiProviderError,
  MockInterpretationProvider,
  DEFAULT_INTERPRETATION_POLICY_VERSION,
  type InterpretationInput,
  type InterpretationProvider,
  type InterpretationResult,
  type ProposedTask,
} from '@aicaa/ai';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import type { TaskSummaryPoint } from '@aicaa/domain';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { interpretCapture, type InterpretationRequest } from '@/lib/interpretation/service';
import { computeInterpretationRequestFingerprint } from '@/lib/interpretation/fingerprint';

const org = 'org_s3_service';
const otherOrg = 'org_s3_service_other';
const now = '2026-08-11T18:00:00.000Z';
const rawInput = 'Send Sharon the revised quote tomorrow afternoon and book the survey.';

let db: TestDatabase;

/** Counts interpretation calls so replay can be proven to skip the provider entirely. */
class CountingInterpretationProvider implements InterpretationProvider {
  readonly name = 'counting-interpretation';
  calls: InterpretationInput[] = [];

  constructor(private readonly result: InterpretationResult) {}

  async interpret(input: InterpretationInput): Promise<InterpretationResult> {
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

function request(overrides: Partial<InterpretationRequest> = {}): InterpretationRequest {
  return {
    organizationId: org,
    sourceKind: 'owner_manual_capture',
    rawInput,
    idempotencyKey: 'idem_service_1',
    requestId: 'req_service_1',
    capturedAt: now,
    timezone: 'America/Los_Angeles',
    ...overrides,
  };
}

describe('S3.1 shared interpretation service', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    installDbTestRuntime(db.prisma);
    // Proposals first: the ownership foreign key is RESTRICT.
    await db.prisma.taskSuggestion.deleteMany();
    await db.prisma.interpretationRun.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.recipient.deleteMany();
  });

  afterEach(() => {
    clearDbTestRuntime();
  });

  it('records a valid zero-proposal interpretation as success', async () => {
    const provider = new MockInterpretationProvider({ result: interpretationResult([]) });

    const result = await interpretCapture({
      db: db.prisma,
      request: request(),
      now,
      deps: { provider },
    });

    expect(result.outcome).toBe('created');
    expect(result.run.outcome).toBe('no_proposals');
    expect(result.suggestions).toEqual([]);
    expect(await db.prisma.interpretationRun.count()).toBe(1);
    expect(await db.prisma.taskSuggestion.count()).toBe(0);
  });

  it('persists N canonical pending proposals owned by one occurrence', async () => {
    const provider = new MockInterpretationProvider({
      result: interpretationResult([
        proposedTask(),
        proposedTask({
          summaryPoints: [
            summaryPoint({ id: 'sp_2', kind: 'next_action', value: 'Book the survey' }),
          ],
        }),
      ]),
    });

    const result = await interpretCapture({
      db: db.prisma,
      request: request(),
      now,
      deps: { provider },
    });

    expect(result.outcome).toBe('created');
    expect(result.run).toMatchObject({
      organizationId: org,
      sourceKind: 'owner_manual_capture',
      outcome: 'proposals_created',
      modelVersion: 'mock-interpretation-model',
      policyVersion: DEFAULT_INTERPRETATION_POLICY_VERSION,
      requestId: 'req_service_1',
    });
    expect(result.suggestions).toHaveLength(2);

    for (const suggestion of result.suggestions) {
      expect(suggestion.organizationId).toBe(org);
      expect(suggestion.status).toBe('pending');
      expect(suggestion.interpretationRunId).toBe(result.run.id);
      expect(suggestion.sourceCommunicationEventId).toBeNull();
      expect(suggestion.version).toBe(1);
      // Deterministic manual source reference: no Gmail identity, no excerpt, no run id.
      expect(suggestion.sourceReference).toEqual({
        id: 'src_idem_service_1',
        sourceType: 'manual',
        dedupeKey: 'owner_manual_capture:idem_service_1',
        capturedAt: now,
      });
    }

    // Canonical proposals carry no sibling ordering, so compare the mapped set rather than a
    // sequence: the repository reads an occurrence's proposals by creation time and id.
    expect(result.suggestions.map((item) => item.summaryPoints)).toEqual(
      expect.arrayContaining([
        [summaryPoint()],
        [summaryPoint({ id: 'sp_2', kind: 'next_action', value: 'Book the survey' })],
      ]),
    );

    // Interpretation proposes only. Acceptance, responsibility, and Task truth stay downstream.
    expect(await db.prisma.task.count()).toBe(0);
    expect(await db.prisma.taskAssignment.count()).toBe(0);
    expect(await db.prisma.taskSuggestionResponsibilitySelection.count()).toBe(0);
  });

  it('replays an identical request from canonical state without calling the provider again', async () => {
    const provider = new CountingInterpretationProvider(
      interpretationResult([proposedTask(), proposedTask()]),
    );

    const first = await interpretCapture({
      db: db.prisma,
      request: request(),
      now,
      deps: { provider },
    });
    const second = await interpretCapture({
      db: db.prisma,
      request: request(),
      now,
      deps: { provider },
    });

    expect(provider.calls).toHaveLength(1);
    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('replayed');
    expect(second.run.id).toBe(first.run.id);
    expect(second.suggestions.map((item) => item.id).sort()).toEqual(
      first.suggestions.map((item) => item.id).sort(),
    );
    expect(await db.prisma.interpretationRun.count()).toBe(1);
    expect(await db.prisma.taskSuggestion.count()).toBe(2);
  });

  it('conflicts when the same key is reused with different request content', async () => {
    const provider = new CountingInterpretationProvider(interpretationResult([proposedTask()]));

    await interpretCapture({ db: db.prisma, request: request(), now, deps: { provider } });

    await expect(
      interpretCapture({
        db: db.prisma,
        request: request({ rawInput: 'Different capture text entirely.' }),
        now,
        deps: { provider },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });

    // Conflict is decided before interpretation, and replaces nothing.
    expect(provider.calls).toHaveLength(1);
    expect(await db.prisma.interpretationRun.count()).toBe(1);
    expect(await db.prisma.taskSuggestion.count()).toBe(1);
  });

  it('persists nothing when the provider fails', async () => {
    const provider = new MockInterpretationProvider({
      error: new AiProviderError('AI_PROVIDER_5XX', 'retryable', 'upstream failed'),
    });

    await expect(
      interpretCapture({ db: db.prisma, request: request(), now, deps: { provider } }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_5XX' });

    expect(await db.prisma.interpretationRun.count()).toBe(0);
    expect(await db.prisma.taskSuggestion.count()).toBe(0);
  });

  it('is default closed without an injected provider', async () => {
    await expect(
      interpretCapture({ db: db.prisma, request: request(), now }),
    ).rejects.toMatchObject({ code: 'AI_DISABLED', kind: 'configuration' });

    expect(await db.prisma.interpretationRun.count()).toBe(0);
    expect(await db.prisma.taskSuggestion.count()).toBe(0);
  });

  it('keeps occurrences and idempotency keys inside one organization', async () => {
    const provider = new CountingInterpretationProvider(interpretationResult([proposedTask()]));

    const mine = await interpretCapture({
      db: db.prisma,
      request: request(),
      now,
      deps: { provider },
    });
    // Same key, same text, different organization: a distinct occurrence, not a replay.
    const theirs = await interpretCapture({
      db: db.prisma,
      request: request({ organizationId: otherOrg }),
      now,
      deps: { provider },
    });

    expect(provider.calls).toHaveLength(2);
    expect(theirs.outcome).toBe('created');
    expect(theirs.run.id).not.toBe(mine.run.id);
    expect(theirs.run.organizationId).toBe(otherOrg);
    expect(theirs.suggestions.map((item) => item.id)).not.toEqual(
      mine.suggestions.map((item) => item.id),
    );

    // The organization is part of the fingerprint, so one organization's key cannot even describe
    // another organization's request.
    const fingerprintInputs = {
      sourceKind: 'owner_manual_capture',
      rawInput,
      capturedAt: now,
      timezone: 'America/Los_Angeles',
    };
    expect(
      computeInterpretationRequestFingerprint({ ...fingerprintInputs, organizationId: org }),
    ).not.toBe(
      computeInterpretationRequestFingerprint({ ...fingerprintInputs, organizationId: otherOrg }),
    );

    const rows = await db.prisma.taskSuggestion.findMany({ where: { organizationId: org } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.interpretationRunId).toBe(mine.run.id);
  });

  it('treats peopleHints and deadlineExpression as advisory and stores neither', async () => {
    const deadlinePoint: TaskSummaryPoint = {
      id: 'sp_deadline',
      kind: 'deadline',
      label: 'Deadline',
      order: 1,
      localDate: '2026-08-12',
      timezone: 'America/Los_Angeles',
    };
    const provider = new MockInterpretationProvider({
      result: interpretationResult([
        proposedTask({
          summaryPoints: [summaryPoint(), deadlinePoint],
          peopleHints: ['Sharon Whitfield'],
          deadlineExpression: 'tomorrow afternoon',
        }),
      ]),
    });

    const result = await interpretCapture({
      db: db.prisma,
      request: request(),
      now,
      deps: { provider },
    });

    const [suggestion] = result.suggestions;
    // Grounded deadline content already inside summaryPoints is canonical and preserved.
    expect(suggestion!.summaryPoints).toEqual([summaryPoint(), deadlinePoint]);
    // Advisory interpretation-layer output is not promoted into canonical proposal fields.
    expect(suggestion!.proposedRecipientId).toBeUndefined();
    expect(suggestion!.proposedDueAt).toBeUndefined();
    expect(suggestion!.proposedPriority).toBeUndefined();

    const row = await db.prisma.taskSuggestion.findUniqueOrThrow({
      where: { id: suggestion!.id },
    });
    expect(row.proposedRecipientId).toBeNull();
    expect(row.proposedDueAt).toBeNull();
    expect(row.proposedPriority).toBeNull();
    // No column was added for either advisory field, and neither leaked into stored JSON.
    expect(Object.keys(row)).not.toContain('peopleHints');
    expect(Object.keys(row)).not.toContain('deadlineExpression');
    expect(JSON.stringify(row)).not.toContain('Sharon Whitfield');
    expect(JSON.stringify(row)).not.toContain('tomorrow afternoon');

    // A person named in the capture does not become a Recipient or an assignment.
    expect(await db.prisma.recipient.count()).toBe(0);
    expect(await db.prisma.taskAssignment.count()).toBe(0);
  });

  it('does not persist the raw capture text anywhere', async () => {
    const provider = new MockInterpretationProvider({
      result: interpretationResult([proposedTask()]),
    });

    await interpretCapture({ db: db.prisma, request: request(), now, deps: { provider } });

    const suggestions = await db.prisma.taskSuggestion.findMany();
    const runs = await db.prisma.interpretationRun.findMany();
    expect(JSON.stringify(suggestions)).not.toContain(rawInput);
    expect(JSON.stringify(runs)).not.toContain(rawInput);
    // Manual capture creates no communication event or excerpt, so there is nothing to retain.
    expect(await db.prisma.communicationEvent.count()).toBe(0);
    expect(await db.prisma.temporaryCommunicationExcerpt.count()).toBe(0);
  });
});
