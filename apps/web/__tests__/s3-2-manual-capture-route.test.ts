// @vitest-environment node
/**
 * S3.2 HTTP route: POST /api/v1/manual-captures (D170).
 *
 * Thin-route validation plus end-to-end wiring through the real S3.1 interpretation service, real
 * PGlite persistence, and an injected interpretation provider. Only the provider composition is
 * substituted, so idempotency, replay, conflict classification, and the provenance boundary are the
 * service's own behaviour observed through HTTP rather than a route-local re-implementation.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const providerState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

// Substitute only the provider composition. Everything else in `@aicaa/ai` — notably the real
// AiProviderError used for classification — stays actual.
vi.mock('@aicaa/ai', async () => {
  const actual = await vi.importActual<typeof import('@aicaa/ai')>('@aicaa/ai');
  return {
    ...actual,
    createInterpretationProvider: () =>
      providerState.current ?? actual.createInterpretationProvider(),
  };
});

import {
  AiProviderError,
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
  asOwnerId,
  asTaskSuggestionId,
  ownerActor,
  type TaskSuggestion,
  type TaskSummaryPoint,
} from '@aicaa/domain';
import { setDbRuntimeForTests } from '@/lib/db/runtime-db';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { POST as manualCaptureRoute } from '@/app/api/v1/manual-captures/route';

const ORG = 'org_s3_2_route';
const OTHER_ORG = 'org_s3_2_route_other';
const OWNER_ID = 'owner_s3_2_route';
const CAPTURED_AT = '2026-08-11T17:45:00.000Z';
const RAW_INPUT = 'Send Sharon the revised quote tomorrow afternoon and book the survey.';

const owner = ownerActor(asOwnerId(OWNER_ID), asOrganizationId(ORG));
const otherOwner = ownerActor(asOwnerId('owner_s3_2_other'), asOrganizationId(OTHER_ORG));

let db: TestDatabase;
let keySeq = 0;

function nextKey(prefix = 'idem-manual'): string {
  keySeq += 1;
  return `${prefix}-${String(keySeq).padStart(4, '0')}`;
}

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

class FailingInterpretationProvider implements InterpretationProvider {
  readonly name = 'failing-interpretation';
  calls = 0;

  constructor(private readonly error: AiProviderError) {}

  async interpret(): Promise<InterpretationResult> {
    this.calls += 1;
    throw this.error;
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

function useProvider<T>(provider: T): T {
  providerState.current = provider;
  return provider;
}

function authOwner(actor = owner) {
  vi.mocked(getAuthenticatedOwner).mockResolvedValue({
    user: { id: actor.ownerId } as never,
    actor,
    session: {
      ownerId: actor.ownerId,
      organizationId: actor.organizationId,
      role: 'owner',
      displayName: 'Owner',
    },
  });
}

function captureRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v1/manual-captures', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    rawInput: RAW_INPUT,
    capturedAt: CAPTURED_AT,
    timezone: 'America/Los_Angeles',
    ...overrides,
  };
}

async function post(
  body: unknown,
  headers: Record<string, string> = { 'idempotency-key': nextKey() },
): Promise<Response> {
  return manualCaptureRoute(captureRequest(body, headers));
}

/** Collect everything the route writes to the console so diagnostics can be asserted on. */
async function withCapturedConsole<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; logged: string }> {
  const lines: string[] = [];
  const original = { log: console.log, info: console.info, error: console.error };
  const record = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  console.log = record;
  console.info = record;
  console.error = record;
  try {
    const result = await fn();
    return { result, logged: lines.join('\n') };
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.error = original.error;
  }
}

async function expectError(response: Response, status: number, code: string): Promise<unknown> {
  expect(response.status).toBe(status);
  const json = await response.json();
  expect(json.error.code).toBe(code);
  return json;
}

describe('S3.2 POST /api/v1/manual-captures', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    clearDbTestRuntime();
    await db.close();
  });

  beforeEach(async () => {
    installDbTestRuntime(db.prisma);
    vi.mocked(getAuthenticatedOwner).mockReset();
    authOwner();
    providerState.current = null;
    // Proposals first: the ownership foreign key is RESTRICT.
    await db.prisma.taskSuggestion.deleteMany();
    await db.prisma.interpretationRun.deleteMany();
    await db.prisma.taskAssignment.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.recipient.deleteMany();
  });

  afterEach(() => {
    providerState.current = null;
    clearDbTestRuntime();
  });

  describe('authentication and organization scope', () => {
    it('rejects an unauthenticated caller, and a capability token is not an Owner surface', async () => {
      vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
      const provider = useProvider(
        new CountingInterpretationProvider(interpretationResult([proposedTask()])),
      );

      const res = await post(validBody(), {
        'idempotency-key': nextKey(),
        'x-capability-token': 'cap_pretending_to_be_owner',
      });

      await expectError(res, 401, 'UNAUTHORIZED');
      expect(provider.calls).toHaveLength(0);
      expect(await db.prisma.interpretationRun.count()).toBe(0);
    });

    it('scopes the capture to the authenticated Owner organization', async () => {
      useProvider(new CountingInterpretationProvider(interpretationResult([proposedTask()])));

      const res = await post(validBody());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.taskSuggestions[0].organizationId).toBe(ORG);
      const run = await db.prisma.interpretationRun.findFirstOrThrow();
      expect(run.organizationId).toBe(ORG);
    });

    it('cannot reach another organization by reusing its key from a different session', async () => {
      useProvider(new CountingInterpretationProvider(interpretationResult([proposedTask()])));
      const sharedKey = nextKey('idem-cross-org');

      const mine = await post(validBody(), { 'idempotency-key': sharedKey });
      expect(mine.status).toBe(200);

      // Same key, same payload, different authenticated organization: a separate occurrence, never
      // a replay of — or a conflict with — the first organization's committed capture.
      authOwner(otherOwner);
      const theirs = await post(validBody(), { 'idempotency-key': sharedKey });

      expect(theirs.status).toBe(200);
      const theirsBody = await theirs.json();
      expect(theirsBody.idempotentReplay).toBe(false);
      expect(theirsBody.taskSuggestions[0].organizationId).toBe(OTHER_ORG);

      const runs = await db.prisma.interpretationRun.findMany();
      expect(runs.map((row) => row.organizationId).sort()).toEqual([ORG, OTHER_ORG].sort());
      const mineRows = await db.prisma.taskSuggestion.findMany({ where: { organizationId: ORG } });
      expect(mineRows).toHaveLength(1);
    });

    it('refuses a body that tries to choose its own organization', async () => {
      const provider = useProvider(
        new CountingInterpretationProvider(interpretationResult([proposedTask()])),
      );

      const res = await post(validBody({ organizationId: OTHER_ORG }));

      const json = (await expectError(res, 400, 'VALIDATION_ERROR')) as {
        error: { details?: Array<{ field: string }> };
      };
      expect(json.error.details?.map((detail) => detail.field)).toContain('organizationId');
      expect(provider.calls).toHaveLength(0);
      expect(await db.prisma.interpretationRun.count()).toBe(0);
    });

    it('refuses a body that tries to choose its own source kind', async () => {
      const provider = useProvider(
        new CountingInterpretationProvider(interpretationResult([proposedTask()])),
      );

      const res = await post(validBody({ sourceKind: 'gmail' }));

      const json = (await expectError(res, 400, 'VALIDATION_ERROR')) as {
        error: { details?: Array<{ field: string }> };
      };
      expect(json.error.details?.map((detail) => detail.field)).toContain('sourceKind');
      expect(provider.calls).toHaveLength(0);
      expect(await db.prisma.interpretationRun.count()).toBe(0);
    });

    it('records the server-fixed source kind rather than anything the caller could say', async () => {
      useProvider(new CountingInterpretationProvider(interpretationResult([proposedTask()])));

      const res = await post(validBody());

      expect(res.status).toBe(200);
      const run = await db.prisma.interpretationRun.findFirstOrThrow();
      expect(run.sourceKind).toBe('owner_manual_capture');
      const body = await res.json();
      expect(body.taskSuggestions[0].sourceReference.sourceType).toBe('manual');
    });
  });

  describe('request validation', () => {
    beforeEach(() => {
      useProvider(new CountingInterpretationProvider(interpretationResult([proposedTask()])));
    });

    it('requires Content-Type application/json (415)', async () => {
      const res = await manualCaptureRoute(
        new Request('http://localhost/api/v1/manual-captures', {
          method: 'POST',
          headers: { 'content-type': 'text/plain', 'idempotency-key': nextKey() },
          body: JSON.stringify(validBody()),
        }),
      );

      await expectError(res, 415, 'VALIDATION_ERROR');
      expect(await db.prisma.interpretationRun.count()).toBe(0);
    });

    it('rejects malformed JSON (400)', async () => {
      const res = await post('{ "rawInput": ', { 'idempotency-key': nextKey() });
      await expectError(res, 400, 'VALIDATION_ERROR');
    });

    it('requires the Idempotency-Key header (428)', async () => {
      const res = await manualCaptureRoute(captureRequest(validBody()));
      await expectError(res, 428, 'PRECONDITION_REQUIRED');
      expect(await db.prisma.interpretationRun.count()).toBe(0);
    });

    it.each([
      ['malformed', 'bad key!'],
      ['too short', 'short7c'],
      ['oversized', 'k'.repeat(129)],
    ])('rejects an idempotency key that is %s (400)', async (_label, key) => {
      const res = await post(validBody(), { 'idempotency-key': key });
      await expectError(res, 400, 'VALIDATION_ERROR');
      expect(await db.prisma.interpretationRun.count()).toBe(0);
    });

    it.each([
      ['missing rawInput', { capturedAt: CAPTURED_AT }],
      ['empty rawInput', { rawInput: '', capturedAt: CAPTURED_AT }],
      ['whitespace-only rawInput', { rawInput: '   \n\t ', capturedAt: CAPTURED_AT }],
      ['non-string rawInput', { rawInput: 42, capturedAt: CAPTURED_AT }],
      ['oversized rawInput', { rawInput: 'a'.repeat(4001), capturedAt: CAPTURED_AT }],
      ['missing capturedAt', { rawInput: RAW_INPUT }],
      ['non-string capturedAt', { rawInput: RAW_INPUT, capturedAt: 1_760_000_000 }],
      ['zone-less capturedAt', { rawInput: RAW_INPUT, capturedAt: '2026-08-11T17:45:00' }],
      ['unparseable capturedAt', { rawInput: RAW_INPUT, capturedAt: 'yesterday' }],
      [
        'invalid timezone',
        { rawInput: RAW_INPUT, capturedAt: CAPTURED_AT, timezone: 'z'.repeat(65) },
      ],
      [
        'unsupported field',
        { rawInput: RAW_INPUT, capturedAt: CAPTURED_AT, interpretationRunId: 'irun_x' },
      ],
    ])('rejects a body with %s (400)', async (_label, body) => {
      const res = await post(body);
      await expectError(res, 400, 'VALIDATION_ERROR');
      expect(await db.prisma.interpretationRun.count()).toBe(0);
      expect(await db.prisma.taskSuggestion.count()).toBe(0);
    });

    it('accepts rawInput at exactly the 4000-character ceiling', async () => {
      const res = await post(validBody({ rawInput: 'a'.repeat(4000) }));
      expect(res.status).toBe(200);
    });

    it('accepts an omitted and an explicitly null timezone', async () => {
      const omitted = await post({ rawInput: RAW_INPUT, capturedAt: CAPTURED_AT });
      expect(omitted.status).toBe(200);

      const explicitNull = await post({
        rawInput: 'A second distinct capture.',
        capturedAt: CAPTURED_AT,
        timezone: null,
      });
      expect(explicitNull.status).toBe(200);
    });
  });

  describe('success', () => {
    it('returns 200 with the canonical TaskSuggestion DTO array on first interpretation', async () => {
      const provider = useProvider(
        new CountingInterpretationProvider(
          interpretationResult([
            proposedTask(),
            proposedTask({
              summaryPoints: [
                summaryPoint({ id: 'sp_2', kind: 'next_action', value: 'Book the survey' }),
              ],
            }),
          ]),
        ),
      );

      const res = await post(validBody());

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = await res.json();
      expect(provider.calls).toHaveLength(1);
      expect(body.idempotentReplay).toBe(false);
      expect(body.interpretedAt).toEqual(expect.any(String));
      expect(Number.isNaN(Date.parse(body.interpretedAt))).toBe(false);
      expect(Object.keys(body).sort()).toEqual([
        'idempotentReplay',
        'interpretedAt',
        'taskSuggestions',
      ]);

      expect(body.taskSuggestions).toHaveLength(2);
      for (const suggestion of body.taskSuggestions) {
        expect(suggestion.organizationId).toBe(ORG);
        expect(suggestion.status).toBe('pending');
        expect(suggestion.version).toBe(1);
        expect(suggestion.etag).toMatch(/^"task-suggestion-/);
        expect(suggestion.approvedTaskId).toBeNull();
        expect(suggestion.sourceReference.sourceType).toBe('manual');
      }
    });

    it('returns 200 with an empty array when the interpretation proposes nothing', async () => {
      useProvider(new CountingInterpretationProvider(interpretationResult([])));

      const res = await post(validBody());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.taskSuggestions).toEqual([]);
      expect(body.idempotentReplay).toBe(false);
      // Truthful zero-proposal success: an occurrence exists, with no manufactured proposal.
      const run = await db.prisma.interpretationRun.findFirstOrThrow();
      expect(run.outcome).toBe('no_proposals');
      expect(await db.prisma.taskSuggestion.count()).toBe(0);
    });
  });

  describe('replay and recovery', () => {
    it('replays an exact retry with the same proposals and one provider call', async () => {
      const provider = useProvider(
        new CountingInterpretationProvider(interpretationResult([proposedTask(), proposedTask()])),
      );
      const key = nextKey('idem-replay');

      const first = await post(validBody(), { 'idempotency-key': key });
      const replay = await post(validBody(), { 'idempotency-key': key });

      expect(first.status).toBe(200);
      expect(replay.status).toBe(200);
      const firstBody = await first.json();
      const replayBody = await replay.json();

      expect(firstBody.idempotentReplay).toBe(false);
      expect(replayBody.idempotentReplay).toBe(true);

      // A lost first response is recoverable: the retry answers from committed canonical state with
      // the identical proposal set and the original interpretation time.
      expect(replayBody.taskSuggestions.map((item: { id: string }) => item.id).sort()).toEqual(
        firstBody.taskSuggestions.map((item: { id: string }) => item.id).sort(),
      );
      expect(replayBody.interpretedAt).toBe(firstBody.interpretedAt);

      expect(provider.calls).toHaveLength(1);
      expect(await db.prisma.interpretationRun.count()).toBe(1);
      expect(await db.prisma.taskSuggestion.count()).toBe(2);
    });

    it('replays a retry that encodes the same capture instant differently', async () => {
      const provider = useProvider(
        new CountingInterpretationProvider(interpretationResult([proposedTask()])),
      );
      const key = nextKey('idem-instant');

      await post(validBody({ capturedAt: '2026-08-11T17:45:00.000Z' }), { 'idempotency-key': key });
      const retry = await post(validBody({ capturedAt: '2026-08-11T10:45:00-07:00' }), {
        'idempotency-key': key,
      });

      expect(retry.status).toBe(200);
      expect((await retry.json()).idempotentReplay).toBe(true);
      expect(provider.calls).toHaveLength(1);
    });
  });

  describe('conflict', () => {
    it('rejects the same key reused for a different capture (409)', async () => {
      const provider = useProvider(
        new CountingInterpretationProvider(interpretationResult([proposedTask()])),
      );
      const key = nextKey('idem-conflict');

      const first = await post(validBody(), { 'idempotency-key': key });
      expect(first.status).toBe(200);

      const { result: conflict, logged } = await withCapturedConsole(() =>
        post(validBody({ rawInput: 'A completely different capture.' }), {
          'idempotency-key': key,
        }),
      );

      const json = (await expectError(conflict, 409, 'IDEMPOTENCY_KEY_CONFLICT')) as {
        error: { message: string };
      };
      // The conflict must not describe the committed capture it collided with.
      expect(json.error.message).not.toContain(RAW_INPUT);
      expect(json.error.message).not.toContain(key);
      // A caller's own retry colliding with its committed request is an expected client outcome,
      // so it stays out of operational failure diagnostics.
      expect(logged).not.toContain('operational_failure');

      // Conflict is decided before interpretation and replaces nothing.
      expect(provider.calls).toHaveLength(1);
      expect(await db.prisma.interpretationRun.count()).toBe(1);
      expect(await db.prisma.taskSuggestion.count()).toBe(1);
    });

    it('rejects the same key reused for a different capture time (409)', async () => {
      useProvider(new CountingInterpretationProvider(interpretationResult([proposedTask()])));
      const key = nextKey('idem-conflict-time');

      await post(validBody(), { 'idempotency-key': key });
      const conflict = await post(validBody({ capturedAt: '2026-08-12T09:00:00.000Z' }), {
        'idempotency-key': key,
      });

      await expectError(conflict, 409, 'IDEMPOTENCY_KEY_CONFLICT');
    });

    it('maps an unrelated persistence uniqueness failure to 409 DOMAIN_CONFLICT', async () => {
      useProvider(new CountingInterpretationProvider(interpretationResult([proposedTask()])));
      // A proposal id collision inside the occurrence transaction: a real unique violation with
      // nothing to do with this key's idempotency, which S3.1 classifies as PERSISTENCE_CONFLICT.
      const colliding = (id: string): TaskSuggestion => ({
        id: asTaskSuggestionId(id),
        organizationId: asOrganizationId(ORG),
        status: 'pending',
        summaryPoints: [summaryPoint()],
        voiceOriginated: false,
        sourceCommunicationEventId: null,
        retention: {},
        version: 1,
        createdAt: CAPTURED_AT,
        updatedAt: CAPTURED_AT,
      });
      setDbRuntimeForTests({
        ...dbRuntime,
        persistInterpretationOccurrence: async (input: PersistInterpretationOccurrenceInput) =>
          dbRuntime.persistInterpretationOccurrence({
            ...input,
            suggestions: [colliding('sug_collide'), colliding('sug_collide')],
          }),
      });

      const res = await post(validBody());

      await expectError(res, 409, 'DOMAIN_CONFLICT');
      // The whole occurrence rolled back: no run, no partial proposal set.
      expect(await db.prisma.interpretationRun.count()).toBe(0);
      expect(await db.prisma.taskSuggestion.count()).toBe(0);
    });
  });

  describe('provider and error mapping', () => {
    it('maps a disabled/unconfigured provider to 503 without naming the configuration', async () => {
      // No injected provider: the real default-closed composition decides (D169).
      providerState.current = null;

      const res = await post(validBody());

      const json = (await expectError(res, 503, 'DEPENDENCY_UNAVAILABLE')) as {
        error: { message: string };
      };
      expect(json.error.message).not.toMatch(/INTERPRETATION_AI_ENABLED|API_KEY|env|AI_DISABLED/i);
      expect(await db.prisma.interpretationRun.count()).toBe(0);
    });

    it.each([
      ['network/timeout', new AiProviderError('AI_TIMEOUT', 'retryable', 'upstream timed out')],
      ['provider 5xx', new AiProviderError('AI_PROVIDER_5XX', 'retryable', 'bad gateway body')],
      ['quota', new AiProviderError('AI_INSUFFICIENT_QUOTA', 'retryable', 'quota exhausted')],
      ['invalid output', new AiProviderError('AI_SCHEMA_INVALID', 'retryable', 'schema mismatch')],
      [
        'missing credentials',
        new AiProviderError('AI_MISSING_CREDENTIALS', 'configuration', 'no key configured'),
      ],
    ])('maps a retryable/configuration provider failure (%s) to 503', async (_label, error) => {
      const provider = useProvider(new FailingInterpretationProvider(error));

      const res = await post(validBody());

      const json = (await expectError(res, 503, 'DEPENDENCY_UNAVAILABLE')) as {
        error: { message: string };
      };
      expect(provider.calls).toBe(1);
      expect(json.error.message).not.toContain(error.message);
      expect(json.error.message).not.toContain(error.code);
      // Nothing persisted, so the identical request may be retried under the same key.
      expect(await db.prisma.interpretationRun.count()).toBe(0);
      expect(await db.prisma.taskSuggestion.count()).toBe(0);
    });

    it('maps a permanent provider failure to 500 without provider detail', async () => {
      useProvider(
        new FailingInterpretationProvider(
          new AiProviderError(
            'AI_POLICY_REFUSAL',
            'permanent',
            'model refused: policy text about the capture',
            'diag_fingerprint_abc123',
          ),
        ),
      );

      const res = await post(validBody());

      const json = (await expectError(res, 500, 'INTERNAL_ERROR')) as {
        error: { message: string };
      };
      expect(json.error.message).toBe('An unexpected error occurred.');
      expect(JSON.stringify(json)).not.toContain('diag_fingerprint_abc123');
      expect(JSON.stringify(json)).not.toContain('policy text about the capture');
      expect(await db.prisma.interpretationRun.count()).toBe(0);
    });
  });

  describe('provenance and raw-input boundary', () => {
    it('publishes no interpretation provenance in a successful response', async () => {
      useProvider(new CountingInterpretationProvider(interpretationResult([proposedTask()])));
      const key = nextKey('idem-provenance');

      const res = await post(validBody(), { 'idempotency-key': key });
      expect(res.status).toBe(200);
      const body = await res.json();
      const serialized = JSON.stringify(body);

      const run = await db.prisma.interpretationRun.findFirstOrThrow();
      expect(serialized).not.toContain(run.id);
      expect(serialized).not.toContain(run.requestFingerprint);
      expect(serialized).not.toContain(run.idempotencyKey);
      expect(serialized).not.toContain(key);
      expect(serialized).not.toContain(run.modelVersion);
      expect(serialized).not.toContain(run.policyVersion);
      expect(serialized).not.toContain(run.requestId);
      expect(serialized).not.toContain(RAW_INPUT);
      expect(serialized).not.toMatch(/interpretationRunId|requestFingerprint|idempotencyKey/);

      for (const suggestion of body.taskSuggestions) {
        expect(Object.prototype.hasOwnProperty.call(suggestion, 'interpretationRunId')).toBe(false);
      }
      // The link is not lost — it stays where it belongs, in persistence.
      const rows = await db.prisma.taskSuggestion.findMany();
      expect(rows.every((row) => row.interpretationRunId === run.id)).toBe(true);
    });

    it('publishes no interpretation provenance on a replayed response either', async () => {
      useProvider(new CountingInterpretationProvider(interpretationResult([proposedTask()])));
      const key = nextKey('idem-provenance-replay');

      await post(validBody(), { 'idempotency-key': key });
      const replay = await post(validBody(), { 'idempotency-key': key });

      const body = await replay.json();
      expect(body.idempotentReplay).toBe(true);
      const run = await db.prisma.interpretationRun.findFirstOrThrow();
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(run.id);
      expect(serialized).not.toContain(run.requestFingerprint);
      expect(serialized).not.toContain(key);
      expect(serialized).not.toContain(RAW_INPUT);
    });

    it('never persists the raw capture text and creates no communication record', async () => {
      useProvider(new CountingInterpretationProvider(interpretationResult([proposedTask()])));

      await post(validBody());

      const suggestions = await db.prisma.taskSuggestion.findMany();
      const runs = await db.prisma.interpretationRun.findMany();
      expect(JSON.stringify(suggestions)).not.toContain(RAW_INPUT);
      expect(JSON.stringify(runs)).not.toContain(RAW_INPUT);
      expect(await db.prisma.communicationEvent.count()).toBe(0);
      expect(await db.prisma.temporaryCommunicationExcerpt.count()).toBe(0);
    });

    it('keeps the capture text and idempotency key out of route diagnostics', async () => {
      useProvider(new CountingInterpretationProvider(interpretationResult([proposedTask()])));
      const key = nextKey('secret-idem-key');
      const secretCapture = 'Confidential capture about the Whitfield settlement figure.';

      const { logged } = await withCapturedConsole(() =>
        post(validBody({ rawInput: secretCapture }), { 'idempotency-key': key }),
      );

      expect(logged).not.toContain(secretCapture);
      expect(logged).not.toContain(key);
    });

    it('reports a validation failure without echoing the rejected capture text', async () => {
      useProvider(new CountingInterpretationProvider(interpretationResult([proposedTask()])));
      const oversized = `${RAW_INPUT} ${'a'.repeat(4001)}`;

      const res = await post(validBody({ rawInput: oversized }));

      expect(res.status).toBe(400);
      const serialized = JSON.stringify(await res.json());
      expect(serialized).not.toContain(RAW_INPUT);
      expect(serialized).not.toContain('aaaaaaaaaa');
    });
  });

  describe('canonical behaviour', () => {
    it('creates no Task, approval, responsibility, or assignment', async () => {
      useProvider(
        new CountingInterpretationProvider(interpretationResult([proposedTask(), proposedTask()])),
      );

      const res = await post(validBody());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.taskSuggestions).toHaveLength(2);
      for (const suggestion of body.taskSuggestions) {
        expect(suggestion.status).toBe('pending');
        expect(suggestion.approvedTaskId).toBeNull();
        expect(suggestion.mergedIntoTaskId).toBeNull();
        expect(suggestion.proposedRecipientId).toBeNull();
      }

      expect(await db.prisma.task.count()).toBe(0);
      expect(await db.prisma.taskAssignment.count()).toBe(0);
      expect(await db.prisma.taskSuggestionResponsibilitySelection.count()).toBe(0);
      expect(await db.prisma.recipient.count()).toBe(0);
      expect(await db.prisma.taskCapability.count()).toBe(0);
    });
  });
});
