// @vitest-environment node
/**
 * S7 Gmail Review-with-Rocket HTTP adapter: POST /api/v1/gmail/reviews (D179).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const providerState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

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
import {
  createOrUpdatePendingCommunicationAccount,
  persistConnectedCommunicationAccount,
  purgeTemporaryCommunicationExcerpt,
  upsertCommunicationEvent,
  upsertTemporaryCommunicationExcerpt,
} from '@aicaa/db';
import {
  asOrganizationId,
  asOwnerId,
  ownerActor,
  type ParsedGmailMessageFixture,
  type TaskSummaryPoint,
} from '@aicaa/domain';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { POST as createGmailReview } from '@/app/api/v1/gmail/reviews/route';
import { ENABLE_GMAIL_REVIEW_ENV } from '@/lib/gmail/review-release-config';

const ORG = 'org_s7_review';
const OTHER_ORG = 'org_s7_review_other';
const OWNER_ID = 'owner_s7_review';
const EXCERPT = 'Please send the revised quote tomorrow afternoon and book the survey.';
const now = new Date().toISOString();
const futurePurge = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const pastPurge = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const owner = ownerActor(asOwnerId(OWNER_ID), asOrganizationId(ORG));
const otherOwner = ownerActor(asOwnerId('owner_s7_review_other'), asOrganizationId(OTHER_ORG));

let db: TestDatabase;
let keySeq = 0;

function nextKey(prefix = 'idem-gmail'): string {
  keySeq += 1;
  return `${prefix}-${String(keySeq).padStart(4, '0')}`;
}

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

function reviewRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v1/gmail/reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    communicationEventId: 'evt_review_ok',
    ...overrides,
  };
}

async function post(
  body: unknown,
  headers: Record<string, string> = { 'idempotency-key': nextKey() },
): Promise<Response> {
  return createGmailReview(reviewRequest(body, headers));
}

async function expectError(response: Response, status: number, code: string): Promise<unknown> {
  expect(response.status).toBe(status);
  const json = await response.json();
  expect(json.error.code).toBe(code);
  return json;
}

function inboxMessage(
  overrides: Partial<ParsedGmailMessageFixture> &
    Pick<ParsedGmailMessageFixture, 'eventId' | 'providerMessageId'>,
): ParsedGmailMessageFixture {
  return {
    providerThreadId: 'thread_review',
    internalDate: now,
    receivedAt: now,
    fromAddress: 'sender@example.com',
    toAddresses: ['owner@acme.example'],
    subject: 'Quote revision',
    snippet: 'Please review',
    labelIds: ['INBOX'],
    hasAttachments: false,
    attachmentMetadata: [],
    ...overrides,
  };
}

async function seedAccount(organizationId: string, accountId: string): Promise<void> {
  await createOrUpdatePendingCommunicationAccount(db.prisma, {
    organizationId,
    accountId,
    emailAddress: `${organizationId}@acme.example`,
    externalAccountId: `google-${accountId}`,
  });
  await persistConnectedCommunicationAccount(db.prisma, {
    organizationId,
    accountId,
    emailAddress: `${organizationId}@acme.example`,
    externalAccountId: `google-${accountId}`,
    connectedAt: now,
    historyId: 'hist_review',
  });
}

async function seedEligible(input: {
  organizationId: string;
  accountId: string;
  eventId: string;
  providerMessageId: string;
  excerpt?: string;
  extras?: Partial<ParsedGmailMessageFixture>;
}): Promise<void> {
  await upsertCommunicationEvent(db.prisma, {
    organizationId: input.organizationId,
    accountId: input.accountId,
    message: inboxMessage({
      eventId: input.eventId,
      providerMessageId: input.providerMessageId,
      ...input.extras,
    }),
  });
  await upsertTemporaryCommunicationExcerpt(db.prisma, {
    organizationId: input.organizationId,
    communicationEventId: input.eventId,
    excerptId: `ex_${input.eventId}`,
    content: input.excerpt ?? EXCERPT,
    purgeAt: futurePurge,
  });
}

describe('S7 POST /api/v1/gmail/reviews', () => {
  const originalGmailReviewFlag = process.env[ENABLE_GMAIL_REVIEW_ENV];

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccount(ORG, 'acct_s7_review');
    await seedAccount(OTHER_ORG, 'acct_s7_review_other');
  });

  afterAll(async () => {
    clearDbTestRuntime();
    await db.close();
    if (originalGmailReviewFlag === undefined) {
      delete process.env[ENABLE_GMAIL_REVIEW_ENV];
    } else {
      process.env[ENABLE_GMAIL_REVIEW_ENV] = originalGmailReviewFlag;
    }
  });

  beforeEach(async () => {
    process.env[ENABLE_GMAIL_REVIEW_ENV] = 'true';
    installDbTestRuntime(db.prisma);
    vi.mocked(getAuthenticatedOwner).mockReset();
    authOwner();
    providerState.current = null;
    await db.prisma.taskSuggestion.deleteMany();
    await db.prisma.interpretationRun.deleteMany();
    await db.prisma.taskAssignment.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.temporaryCommunicationExcerpt.deleteMany();
    await db.prisma.communicationEvent.deleteMany();
  });

  afterEach(() => {
    providerState.current = null;
    clearDbTestRuntime();
  });

  it('requires Owner authentication', async () => {
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
  });

  it('interprets one eligible Gmail occurrence with server-fixed gmail provenance', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_review',
      eventId: 'evt_review_ok',
      providerMessageId: 'msg_review_ok',
    });
    useProvider(
      new CountingInterpretationProvider(
        interpretationResult([
          proposedTask(),
          proposedTask({
            summaryPoints: [
              summaryPoint({ id: 'sp_2', kind: 'next_action', value: 'Book survey' }),
            ],
          }),
        ]),
      ),
    );

    const res = await post(validBody());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.idempotentReplay).toBe(false);
    expect(body.taskSuggestions).toHaveLength(2);
    expect(body).not.toHaveProperty('sourceKind');
    expect(body).not.toHaveProperty('interpretationRunId');
    expect(JSON.stringify(body)).not.toContain(EXCERPT);

    const suggestion = body.taskSuggestions[0];
    expect(suggestion.organizationId).toBe(ORG);
    expect(suggestion.sourceReference.sourceType).toBe('gmail');
    expect(suggestion.sourceReference.id).toBe('evt_review_ok');
    expect(suggestion.sourceCommunicationEventId).toBeUndefined();

    const run = await db.prisma.interpretationRun.findFirstOrThrow();
    expect(run.sourceKind).toBe('gmail');
    expect(run.organizationId).toBe(ORG);
    expect(await db.prisma.task.count()).toBe(0);
    expect(await db.prisma.taskAssignment.count()).toBe(0);
  });

  it('replays an exact lost-response retry after the source leaves Inbox', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_review',
      eventId: 'evt_review_ok',
      providerMessageId: 'msg_review_ok',
    });
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const key = nextKey('idem-left-inbox');

    const first = await post(validBody(), { 'idempotency-key': key });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.idempotentReplay).toBe(false);
    expect(provider.calls).toHaveLength(1);
    const runCount = await db.prisma.interpretationRun.count();
    const suggestionCount = await db.prisma.taskSuggestion.count();
    expect(runCount).toBe(1);
    expect(suggestionCount).toBe(1);

    await db.prisma.communicationEvent.update({
      where: { id: 'evt_review_ok' },
      data: { labelIds: ['TRASH'] },
    });

    const replay = await post(validBody(), { 'idempotency-key': key });
    expect(replay.status).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody.idempotentReplay).toBe(true);
    expect(replayBody.taskSuggestions).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
    expect(await db.prisma.interpretationRun.count()).toBe(runCount);
    expect(await db.prisma.taskSuggestion.count()).toBe(suggestionCount);
  });

  it('replays an identical request without calling the provider again', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_review',
      eventId: 'evt_review_ok',
      providerMessageId: 'msg_review_ok',
    });
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const key = nextKey('idem-replay');

    const first = await post(validBody(), { 'idempotency-key': key });
    expect(first.status).toBe(200);
    const replay = await post(validBody(), { 'idempotency-key': key });
    expect(replay.status).toBe(200);
    const body = await replay.json();
    expect(body.idempotentReplay).toBe(true);
    expect(provider.calls).toHaveLength(1);
  });

  it('conflicts when the same key is reused for a different Gmail occurrence', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_review',
      eventId: 'evt_review_ok',
      providerMessageId: 'msg_review_ok',
    });
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_review',
      eventId: 'evt_review_other',
      providerMessageId: 'msg_review_other',
    });
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const key = nextKey('idem-conflict');

    const first = await post(validBody(), { 'idempotency-key': key });
    expect(first.status).toBe(200);
    const conflict = await post(validBody({ communicationEventId: 'evt_review_other' }), {
      'idempotency-key': key,
    });
    await expectError(conflict, 409, 'IDEMPOTENCY_KEY_CONFLICT');
    expect(provider.calls).toHaveLength(1);
  });

  it('returns truthful zero proposals without creating a Task', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_review',
      eventId: 'evt_review_ok',
      providerMessageId: 'msg_review_ok',
    });
    useProvider(new CountingInterpretationProvider(interpretationResult([])));

    const res = await post(validBody());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.taskSuggestions).toEqual([]);
    expect(await db.prisma.task.count()).toBe(0);
  });

  it("does not expose another organization's Gmail event", async () => {
    await seedEligible({
      organizationId: OTHER_ORG,
      accountId: 'acct_s7_review_other',
      eventId: 'evt_review_theirs',
      providerMessageId: 'msg_review_theirs',
    });
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );

    const res = await post(validBody({ communicationEventId: 'evt_review_theirs' }));
    await expectError(res, 404, 'NOT_FOUND');
    expect(provider.calls).toHaveLength(0);
  });

  it('rejects a first request against a currently ineligible Gmail occurrence', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_review',
      eventId: 'evt_review_ok',
      providerMessageId: 'msg_review_ok',
    });
    await db.prisma.communicationEvent.update({
      where: { id: 'evt_review_ok' },
      data: { labelIds: ['TRASH'] },
    });
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );

    const res = await post(validBody());
    await expectError(res, 409, 'DOMAIN_CONFLICT');
    expect(provider.calls).toHaveLength(0);
    expect(await db.prisma.interpretationRun.count()).toBe(0);
    expect(await db.prisma.taskSuggestion.count()).toBe(0);
  });

  it('rejects a missing or expired excerpt', async () => {
    await upsertCommunicationEvent(db.prisma, {
      organizationId: ORG,
      accountId: 'acct_s7_review',
      message: inboxMessage({ eventId: 'evt_review_ok', providerMessageId: 'msg_review_ok' }),
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: ORG,
      communicationEventId: 'evt_review_ok',
      excerptId: 'ex_evt_review_ok',
      content: EXCERPT,
      purgeAt: pastPurge,
    });
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );

    const res = await post(validBody());
    await expectError(res, 409, 'DOMAIN_CONFLICT');
    expect(provider.calls).toHaveLength(0);

    await purgeTemporaryCommunicationExcerpt(db.prisma, ORG, 'evt_review_ok', now);
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: ORG,
      communicationEventId: 'evt_review_ok',
      excerptId: 'ex_evt_review_ok',
      content: EXCERPT,
      purgeAt: futurePurge,
    });
    await purgeTemporaryCommunicationExcerpt(db.prisma, ORG, 'evt_review_ok', now);
    const purged = await post(validBody(), { 'idempotency-key': nextKey() });
    await expectError(purged, 409, 'DOMAIN_CONFLICT');
    expect(provider.calls).toHaveLength(0);
  });

  /**
   * D161 still requires a reconstructed fingerprint. After a successful review, a later retry
   * whose excerpt has been purged cannot be answered as an exact replay, and the same
   * fail-closed 409 is returned as for a brand-new request with no excerpt. Key-only recovery
   * is not authorized.
   */
  it('does not invent key-only replay when the excerpt is later purged', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_review',
      eventId: 'evt_review_ok',
      providerMessageId: 'msg_review_ok',
    });
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const key = nextKey('idem-excerpt-gone');

    const first = await post(validBody(), { 'idempotency-key': key });
    expect(first.status).toBe(200);
    expect(provider.calls).toHaveLength(1);

    await purgeTemporaryCommunicationExcerpt(db.prisma, ORG, 'evt_review_ok', now);
    const retry = await post(validBody(), { 'idempotency-key': key });
    await expectError(retry, 409, 'DOMAIN_CONFLICT');
    expect(provider.calls).toHaveLength(1);
    expect(await db.prisma.interpretationRun.count()).toBe(1);
  });

  it('refuses a body that tries to choose source kind or supply raw input', async () => {
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const res = await post(
      validBody({
        sourceKind: 'owner_manual_capture',
        rawInput: 'spoofed',
        organizationId: OTHER_ORG,
      }),
    );
    const json = (await expectError(res, 400, 'VALIDATION_ERROR')) as {
      error: { details?: Array<{ field: string }> };
    };
    expect(json.error.details?.map((detail) => detail.field)).toEqual(
      expect.arrayContaining(['sourceKind', 'rawInput', 'organizationId']),
    );
    expect(provider.calls).toHaveLength(0);
  });

  it('maps a retryable provider failure to 503 without persisting', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_review',
      eventId: 'evt_review_ok',
      providerMessageId: 'msg_review_ok',
    });
    useProvider(
      new FailingInterpretationProvider(
        new AiProviderError('AI_TIMEOUT', 'retryable', 'provider timed out'),
      ),
    );

    const res = await post(validBody());
    await expectError(res, 503, 'DEPENDENCY_UNAVAILABLE');
    expect(await db.prisma.interpretationRun.count()).toBe(0);
  });

  it('still reviews a Gmail event A6 already processed and does not call A6', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_review',
      eventId: 'evt_review_ok',
      providerMessageId: 'msg_review_ok',
    });
    await db.prisma.communicationEvent.update({
      where: { id: 'evt_review_ok' },
      data: { suggestionProcessingStatus: 'suggestion_created' },
    });
    useProvider(new CountingInterpretationProvider(interpretationResult([proposedTask()])));

    const res = await post(validBody());
    expect(res.status).toBe(200);
    const run = await db.prisma.interpretationRun.findFirstOrThrow();
    expect(run.sourceKind).toBe('gmail');
    const suggestion = await db.prisma.taskSuggestion.findFirstOrThrow();
    expect(suggestion.sourceCommunicationEventId).toBeNull();
  });

  it('does not import A6 suggestion extraction or process-service', () => {
    const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const files = [
      'lib/gmail/intake-service.ts',
      'lib/gmail/validate-review-body.ts',
      'app/api/v1/gmail/reviews/route.ts',
      'lib/interpretation/service.ts',
    ];
    for (const file of files) {
      const source = readFileSync(path.join(webRoot, file), 'utf8');
      expect(source).not.toMatch(/evaluateSuggestionRelevance/);
      expect(source).not.toMatch(/SuggestionExtractionResult/);
      expect(source).not.toMatch(/AI_EMPTY_OUTPUT/);
      expect(source).not.toMatch(/from '@\/lib\/suggestions/);
      expect(source).not.toMatch(/internal\/suggestions\/process/);
      expect(source).not.toMatch(/claimSuggestionProcessingBatch/);
    }
  });
});
