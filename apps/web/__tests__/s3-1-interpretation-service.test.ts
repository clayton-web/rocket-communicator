// @vitest-environment node
/**
 * S3.1 shared interpretation application service (D169).
 *
 * Backend only: these tests call the service directly because no HTTP route, Android surface, or
 * worker reaches it. They prove the interpretation → canonical persistence seam, its
 * organization-scoped idempotency, the retry stability of that idempotency, the provenance boundary
 * above persistence, and the advisory-field and raw-input boundaries D169 fixed.
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
import * as dbRuntime from '@aicaa/db/runtime';
import type { PersistInterpretationOccurrenceInput } from '@aicaa/db';
import {
  asOrganizationId,
  asTaskSuggestionId,
  type TaskSummaryPoint,
  type TaskSuggestion,
} from '@aicaa/domain';
import { setDbRuntimeForTests } from '@/lib/db/runtime-db';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { interpretCapture, type InterpretationRequest } from '@/lib/interpretation/service';
import {
  computeInterpretationRequestFingerprint,
  computeManualCaptureSourceDedupeDigest,
} from '@/lib/interpretation/fingerprint';

const org = 'org_s3_service';
const otherOrg = 'org_s3_service_other';
const now = '2026-08-11T18:00:00.000Z';
const capturedAt = '2026-08-11T17:45:00.000Z';
const rawInput = 'Send Sharon the revised quote tomorrow afternoon and book the survey.';

/** Published `SourceReference` contract bounds (`source-reference.yaml`). */
const MAX_SOURCE_REFERENCE_ID = 64;
const MAX_SOURCE_DEDUPE_KEY = 128;

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
    capturedAt,
    timezone: 'America/Los_Angeles',
    ...overrides,
  };
}

/** The dedupe digest the repaired source-identity rule must produce for a given request. */
function expectedDedupeKey(
  overrides: { organizationId?: string; idempotencyKey?: string } = {},
): string {
  return `owner_manual_capture:${computeManualCaptureSourceDedupeDigest({
    organizationId: overrides.organizationId ?? org,
    sourceKind: 'owner_manual_capture',
    idempotencyKey: overrides.idempotencyKey ?? 'idem_service_1',
  })}`;
}

function winningProposal(id: string, organizationId = org): TaskSuggestion {
  return {
    id: asTaskSuggestionId(id),
    organizationId: asOrganizationId(organizationId),
    status: 'pending',
    summaryPoints: [summaryPoint({ id: 'sp_winner', value: 'Committed by the concurrent writer' })],
    voiceOriginated: false,
    sourceCommunicationEventId: null,
    retention: {},
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Deterministic interleaving of a concurrent writer.
 *
 * The service's preflight idempotency read has already answered `new_request` by the time
 * `persistInterpretationOccurrence` is called, which is exactly the window a real race occupies. The
 * seam commits the rival occurrence inside that window using the real persistence path, then lets
 * our attempt run into the real `(organization_id, idempotency_key)` unique index. Nothing about the
 * production code path is stubbed: the uniqueness failure, the rollback, and the recovery are the
 * database's and the service's own.
 */
function installConcurrentWinner(options: {
  fingerprint: (ours: string) => string;
  suggestions: TaskSuggestion[];
}): void {
  let alreadyRaced = false;
  setDbRuntimeForTests({
    ...dbRuntime,
    persistInterpretationOccurrence: async (input: PersistInterpretationOccurrenceInput) => {
      if (!alreadyRaced) {
        alreadyRaced = true;
        await dbRuntime.persistInterpretationOccurrence({
          db: input.db,
          run: {
            ...input.run,
            id: 'irun_concurrent_winner',
            requestId: 'req_concurrent_winner',
            requestFingerprint: options.fingerprint(input.run.requestFingerprint),
          },
          suggestions: options.suggestions,
        });
      }
      return dbRuntime.persistInterpretationOccurrence(input);
    },
  });
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
    expect(result.occurrence.outcome).toBe('no_proposals');
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
    expect(result.occurrence).toEqual({
      sourceKind: 'owner_manual_capture',
      outcome: 'proposals_created',
      interpretedAt: expect.any(String),
    });
    expect(result.suggestions).toHaveLength(2);

    const run = await db.prisma.interpretationRun.findFirstOrThrow();
    expect(run).toMatchObject({
      organizationId: org,
      sourceKind: 'owner_manual_capture',
      outcome: 'proposals_created',
      modelVersion: 'mock-interpretation-model',
      policyVersion: DEFAULT_INTERPRETATION_POLICY_VERSION,
      requestId: 'req_service_1',
    });

    for (const suggestion of result.suggestions) {
      expect(suggestion.organizationId).toBe(org);
      expect(suggestion.status).toBe('pending');
      expect(suggestion.sourceCommunicationEventId).toBeNull();
      expect(suggestion.version).toBe(1);
    }

    // Every sibling proposal of one capture shares one source reference.
    const sourceReferences = result.suggestions.map((item) => item.sourceReference);
    expect(sourceReferences[0]).toEqual(sourceReferences[1]);

    // Canonical proposals carry no sibling ordering, so compare the mapped set rather than a
    // sequence: the repository reads an occurrence's proposals by creation time and id.
    expect(result.suggestions.map((item) => item.summaryPoints)).toEqual(
      expect.arrayContaining([
        [summaryPoint()],
        [summaryPoint({ id: 'sp_2', kind: 'next_action', value: 'Book the survey' })],
      ]),
    );

    // The occurrence link is still recorded in persistence, where it belongs.
    const rows = await db.prisma.taskSuggestion.findMany();
    expect(rows.map((row) => row.interpretationRunId)).toEqual([run.id, run.id]);

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
    expect(second.occurrence).toEqual(first.occurrence);
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
    ).rejects.toMatchObject({
      name: 'InterpretationServiceError',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    });

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
    expect(theirs.suggestions.map((item) => item.id)).not.toEqual(
      mine.suggestions.map((item) => item.id),
    );
    // One key, two organizations, two unrelated source identities.
    expect(theirs.suggestions[0]!.sourceReference!.dedupeKey).toBe(
      expectedDedupeKey({ organizationId: otherOrg }),
    );
    expect(theirs.suggestions[0]!.sourceReference!.dedupeKey).not.toBe(
      mine.suggestions[0]!.sourceReference!.dedupeKey,
    );

    // The organization is part of the fingerprint, so one organization's key cannot even describe
    // another organization's request.
    const fingerprintInputs = {
      sourceKind: 'owner_manual_capture',
      rawInput,
      capturedAt,
      timezone: 'America/Los_Angeles',
    };
    expect(
      computeInterpretationRequestFingerprint({ ...fingerprintInputs, organizationId: org }),
    ).not.toBe(
      computeInterpretationRequestFingerprint({ ...fingerprintInputs, organizationId: otherOrg }),
    );

    const runs = await db.prisma.interpretationRun.findMany({ where: { organizationId: org } });
    expect(runs).toHaveLength(1);
    const rows = await db.prisma.taskSuggestion.findMany({ where: { organizationId: org } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.interpretationRunId).toBe(runs[0]!.id);
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

  describe('capturedAt is caller-supplied occurrence semantics', () => {
    it('rejects a request that omits capturedAt instead of inventing one', async () => {
      const provider = new CountingInterpretationProvider(interpretationResult([proposedTask()]));
      const { capturedAt: _omitted, ...withoutCapturedAt } = request();

      await expect(
        interpretCapture({
          db: db.prisma,
          request: withoutCapturedAt as InterpretationRequest,
          now,
          deps: { provider },
        }),
      ).rejects.toMatchObject({ name: 'InterpretationServiceError', code: 'VALIDATION_ERROR' });

      // Nothing was interpreted and nothing reached persistence.
      expect(provider.calls).toHaveLength(0);
      expect(await db.prisma.interpretationRun.count()).toBe(0);
    });

    it('rejects a capturedAt whose instant depends on the host timezone', async () => {
      const provider = new CountingInterpretationProvider(interpretationResult([proposedTask()]));

      await expect(
        interpretCapture({
          db: db.prisma,
          request: request({ capturedAt: '2026-08-11T17:45:00' }),
          now,
          deps: { provider },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

      expect(provider.calls).toHaveLength(0);
      expect(await db.prisma.interpretationRun.count()).toBe(0);
    });

    it('replays an exact retry even though the service clock moved on', async () => {
      const provider = new CountingInterpretationProvider(interpretationResult([proposedTask()]));

      const first = await interpretCapture({
        db: db.prisma,
        request: request(),
        now: '2026-08-11T18:00:00.000Z',
        deps: { provider },
      });
      // The identical capture, retried much later. Only the service clock differs.
      const retry = await interpretCapture({
        db: db.prisma,
        request: request(),
        now: '2026-08-11T23:30:00.000Z',
        deps: { provider },
      });

      expect(first.outcome).toBe('created');
      expect(retry.outcome).toBe('replayed');
      expect(provider.calls).toHaveLength(1);
      expect(await db.prisma.interpretationRun.count()).toBe(1);
    });

    it('replays a retry that encodes the same instant differently', async () => {
      const provider = new CountingInterpretationProvider(interpretationResult([proposedTask()]));

      await interpretCapture({
        db: db.prisma,
        request: request({ capturedAt: '2026-08-11T17:45:00.000Z' }),
        now,
        deps: { provider },
      });
      const retry = await interpretCapture({
        db: db.prisma,
        request: request({ capturedAt: '2026-08-11T10:45:00-07:00' }),
        now,
        deps: { provider },
      });

      expect(retry.outcome).toBe('replayed');
      expect(provider.calls).toHaveLength(1);
      expect(await db.prisma.interpretationRun.count()).toBe(1);
    });

    it('still conflicts when the same key describes a genuinely different capture time', async () => {
      const provider = new CountingInterpretationProvider(interpretationResult([proposedTask()]));

      await interpretCapture({ db: db.prisma, request: request(), now, deps: { provider } });

      await expect(
        interpretCapture({
          db: db.prisma,
          request: request({ capturedAt: '2026-08-12T09:00:00.000Z' }),
          now,
          deps: { provider },
        }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });

      expect(provider.calls).toHaveLength(1);
      expect(await db.prisma.interpretationRun.count()).toBe(1);
    });
  });

  describe('idempotency key validation', () => {
    const provider = () =>
      new CountingInterpretationProvider(interpretationResult([proposedTask()]));

    it.each([
      ['empty', ''],
      ['too short', 'short7c'],
      ['whitespace padded', ' idem_service_1 '],
      ['illegal characters', 'idem service/1!'],
      ['over the 128-character storage ceiling', 'k'.repeat(129)],
    ])('rejects an idempotency key that is %s before any database work', async (_label, key) => {
      const injected = provider();

      await expect(
        interpretCapture({
          db: db.prisma,
          request: request({ idempotencyKey: key }),
          now,
          deps: { provider: injected },
        }),
      ).rejects.toMatchObject({ name: 'InterpretationServiceError', code: 'VALIDATION_ERROR' });

      expect(injected.calls).toHaveLength(0);
      expect(await db.prisma.interpretationRun.count()).toBe(0);
      expect(await db.prisma.taskSuggestion.count()).toBe(0);
    });

    it('accepts a key at exactly the storage ceiling', async () => {
      const injected = provider();
      const key = 'k'.repeat(128);

      const result = await interpretCapture({
        db: db.prisma,
        request: request({ idempotencyKey: key }),
        now,
        deps: { provider: injected },
      });

      expect(result.outcome).toBe('created');
      const run = await db.prisma.interpretationRun.findFirstOrThrow();
      expect(run.idempotencyKey).toBe(key);
      // The 128-character key still leaves both source identities inside their contract bounds.
      const reference = result.suggestions[0]!.sourceReference!;
      expect(reference.id.length).toBeLessThanOrEqual(MAX_SOURCE_REFERENCE_ID);
      expect(reference.dedupeKey.length).toBeLessThanOrEqual(MAX_SOURCE_DEDUPE_KEY);
    });

    it('rejects caller identifiers that exceed their own storage ceilings', async () => {
      const injected = provider();

      await expect(
        interpretCapture({
          db: db.prisma,
          request: request({ requestId: 'r'.repeat(65) }),
          now,
          deps: { provider: injected },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

      await expect(
        interpretCapture({
          db: db.prisma,
          request: request({ organizationId: 'o'.repeat(65) }),
          now,
          deps: { provider: injected },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

      expect(injected.calls).toHaveLength(0);
      expect(await db.prisma.interpretationRun.count()).toBe(0);
    });
  });

  describe('provenance boundary', () => {
    it('returns domain proposals without the occurrence link that persistence records', async () => {
      const provider = new MockInterpretationProvider({
        result: interpretationResult([proposedTask(), proposedTask()]),
      });

      const result = await interpretCapture({
        db: db.prisma,
        request: request(),
        now,
        deps: { provider },
      });

      const run = await db.prisma.interpretationRun.findFirstOrThrow();

      for (const suggestion of result.suggestions) {
        expect(Object.prototype.hasOwnProperty.call(suggestion, 'interpretationRunId')).toBe(false);
      }
      // Nothing in the returned shape carries the occurrence's row identity, so an adapter that
      // spreads this result cannot publish it.
      expect(JSON.stringify(result)).not.toContain(run.id);
      expect(result).not.toHaveProperty('run');
      expect(Object.keys(result).sort()).toEqual(['occurrence', 'outcome', 'suggestions']);
      expect(Object.keys(result.occurrence).sort()).toEqual([
        'interpretedAt',
        'outcome',
        'sourceKind',
      ]);

      // The link is not lost — it stays where it belongs, in persistence.
      const rows = await db.prisma.taskSuggestion.findMany();
      expect(rows.every((row) => row.interpretationRunId === run.id)).toBe(true);
    });

    it('keeps the occurrence link off replayed proposals too', async () => {
      const provider = new CountingInterpretationProvider(interpretationResult([proposedTask()]));

      await interpretCapture({ db: db.prisma, request: request(), now, deps: { provider } });
      const replay = await interpretCapture({
        db: db.prisma,
        request: request(),
        now,
        deps: { provider },
      });

      const run = await db.prisma.interpretationRun.findFirstOrThrow();
      expect(replay.outcome).toBe('replayed');
      expect(
        Object.prototype.hasOwnProperty.call(replay.suggestions[0]!, 'interpretationRunId'),
      ).toBe(false);
      expect(JSON.stringify(replay)).not.toContain(run.id);
    });
  });

  describe('manual source reference identity', () => {
    it('derives the source id from the occurrence and never from the caller key', async () => {
      const provider = new MockInterpretationProvider({
        result: interpretationResult([proposedTask(), proposedTask()]),
      });

      const result = await interpretCapture({
        db: db.prisma,
        request: request(),
        now,
        deps: { provider },
      });

      const reference = result.suggestions[0]!.sourceReference!;
      expect(reference.sourceType).toBe('manual');
      expect(reference.capturedAt).toBe(capturedAt);
      expect(reference.id).toMatch(/^src_[A-Za-z0-9_-]{16}$/);
      expect(reference.id.length).toBeLessThanOrEqual(MAX_SOURCE_REFERENCE_ID);

      // The transport idempotency key appears in neither durable identity.
      expect(reference.id).not.toContain('idem_service_1');
      expect(reference.dedupeKey).not.toContain('idem_service_1');

      // The dedupe identity is the deterministic digest of the request identity.
      expect(reference.dedupeKey).toBe(expectedDedupeKey());
      expect(reference.dedupeKey.length).toBeLessThanOrEqual(MAX_SOURCE_DEDUPE_KEY);

      // Gmail identity semantics stay absent, and no raw capture text is carried.
      expect(reference.externalIds).toBeUndefined();
      expect(reference.excerptRef).toBeUndefined();
      expect(reference.contactHint).toBeUndefined();
      expect(JSON.stringify(reference)).not.toContain(rawInput);
    });

    it('gives sibling proposals one source and separate captures separate sources', async () => {
      const provider = new MockInterpretationProvider({
        result: interpretationResult([proposedTask(), proposedTask()]),
      });

      const first = await interpretCapture({
        db: db.prisma,
        request: request(),
        now,
        deps: { provider },
      });
      const second = await interpretCapture({
        db: db.prisma,
        request: request({ idempotencyKey: 'idem_service_2', requestId: 'req_service_2' }),
        now,
        deps: { provider },
      });

      const [firstA, firstB] = first.suggestions;
      expect(firstA!.sourceReference!.id).toBe(firstB!.sourceReference!.id);
      expect(second.suggestions[0]!.sourceReference!.id).not.toBe(firstA!.sourceReference!.id);
      expect(second.suggestions[0]!.sourceReference!.dedupeKey).toBe(
        expectedDedupeKey({ idempotencyKey: 'idem_service_2' }),
      );
    });
  });

  describe('concurrent writers', () => {
    it('answers an exact race with the winning occurrence and duplicates nothing', async () => {
      const provider = new CountingInterpretationProvider(
        interpretationResult([proposedTask(), proposedTask()]),
      );
      installConcurrentWinner({
        fingerprint: (ours) => ours,
        suggestions: [winningProposal('sug_concurrent_winner')],
      });

      const result = await interpretCapture({
        db: db.prisma,
        request: request(),
        now,
        deps: { provider },
      });

      expect(result.outcome).toBe('replayed');
      expect(result.suggestions.map((item) => item.id)).toEqual(['sug_concurrent_winner']);
      expect(result.occurrence.outcome).toBe('proposals_created');

      // One occurrence, one proposal set: the losing attempt rolled back whole.
      const runs = await db.prisma.interpretationRun.findMany();
      expect(runs.map((row) => row.id)).toEqual(['irun_concurrent_winner']);
      const rows = await db.prisma.taskSuggestion.findMany();
      expect(rows.map((row) => row.id)).toEqual(['sug_concurrent_winner']);
    });

    it('reports a conflicting race as an idempotency conflict and replaces nothing', async () => {
      const provider = new CountingInterpretationProvider(interpretationResult([proposedTask()]));
      installConcurrentWinner({
        fingerprint: () => 'fp_a_different_request_entirely',
        suggestions: [winningProposal('sug_conflicting_winner')],
      });

      await expect(
        interpretCapture({ db: db.prisma, request: request(), now, deps: { provider } }),
      ).rejects.toMatchObject({
        name: 'InterpretationServiceError',
        code: 'IDEMPOTENCY_KEY_CONFLICT',
      });

      const runs = await db.prisma.interpretationRun.findMany();
      expect(runs.map((row) => row.id)).toEqual(['irun_concurrent_winner']);
      expect(runs[0]!.requestFingerprint).toBe('fp_a_different_request_entirely');
      const rows = await db.prisma.taskSuggestion.findMany();
      expect(rows.map((row) => row.id)).toEqual(['sug_conflicting_winner']);
    });

    it('does not read an unrelated uniqueness failure as replay or conflict', async () => {
      const provider = new CountingInterpretationProvider(interpretationResult([proposedTask()]));
      // A proposal id collision inside the occurrence transaction: a real unique violation that has
      // nothing to do with this key's idempotency.
      setDbRuntimeForTests({
        ...dbRuntime,
        persistInterpretationOccurrence: async (input: PersistInterpretationOccurrenceInput) =>
          dbRuntime.persistInterpretationOccurrence({
            ...input,
            suggestions: [winningProposal('sug_colliding_id'), winningProposal('sug_colliding_id')],
          }),
      });

      await expect(
        interpretCapture({ db: db.prisma, request: request(), now, deps: { provider } }),
      ).rejects.toMatchObject({
        name: 'InterpretationServiceError',
        code: 'PERSISTENCE_CONFLICT',
      });

      // The whole occurrence rolled back: no run, no partial proposal set.
      expect(await db.prisma.interpretationRun.count()).toBe(0);
      expect(await db.prisma.taskSuggestion.count()).toBe(0);
    });
  });
});
