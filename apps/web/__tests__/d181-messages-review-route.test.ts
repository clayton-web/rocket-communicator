// @vitest-environment node
/**
 * D181 Google Messages Review-with-Rocket HTTP adapter: POST /api/v1/messages/reviews.
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
  buildGoogleMessagesProviderMessageId,
  createOrUpdatePendingCommunicationAccount,
  persistConnectedCommunicationAccount,
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
import { POST as createMessagesReview } from '@/app/api/v1/messages/reviews/route';

const ORG = 'org_d181_review';
const OTHER_ORG = 'org_d181_review_other';
const OWNER_ID = 'owner_d181_review';
const SELECTED = 'Please confirm the driveway appointment for Friday morning.';
const OBSERVED_AT = '2026-08-13T17:00:00.000Z';
const now = new Date().toISOString();

const owner = ownerActor(asOwnerId(OWNER_ID), asOrganizationId(ORG));
const otherOwner = ownerActor(asOwnerId('owner_d181_review_other'), asOrganizationId(OTHER_ORG));

let db: TestDatabase;
let keySeq = 0;

function nextKey(prefix = 'idem-msg'): string {
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

function summaryPoint(overrides: Partial<TaskSummaryPoint> = {}): TaskSummaryPoint {
  return {
    id: 'sp_1',
    kind: 'request',
    label: 'Request',
    order: 0,
    value: 'Confirm the driveway appointment',
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
  return new Request('http://localhost/api/v1/messages/reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    sourceOccurrenceId: '0|com.google.android.apps.messaging|1|null|0',
    selectedText: SELECTED,
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

async function post(
  body: unknown,
  headers: Record<string, string> = { 'idempotency-key': nextKey() },
): Promise<Response> {
  return createMessagesReview(reviewRequest(body, headers));
}

async function expectError(response: Response, status: number, code: string): Promise<unknown> {
  expect(response.status).toBe(status);
  const json = await response.json();
  expect(json.error.code).toBe(code);
  return json;
}

async function messagesEventCount(organizationId = ORG): Promise<number> {
  return db.prisma.communicationEvent.count({
    where: { organizationId, sourceType: 'google_messages' },
  });
}

async function messagesExcerptCount(organizationId = ORG): Promise<number> {
  const events = await db.prisma.communicationEvent.findMany({
    where: { organizationId, sourceType: 'google_messages' },
    select: { id: true },
  });
  if (events.length === 0) {
    return 0;
  }
  return db.prisma.temporaryCommunicationExcerpt.count({
    where: { organizationId, communicationEventId: { in: events.map((event) => event.id) } },
  });
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

describe('D181 POST /api/v1/messages/reviews', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
    await createOrUpdatePendingCommunicationAccount(db.prisma, {
      organizationId: ORG,
      accountId: 'acct_d181_review',
      emailAddress: `${ORG}@acme.example`,
      externalAccountId: 'google-d181-review',
    });
    await persistConnectedCommunicationAccount(db.prisma, {
      organizationId: ORG,
      accountId: 'acct_d181_review',
      emailAddress: `${ORG}@acme.example`,
      externalAccountId: 'google-d181-review',
      connectedAt: now,
      historyId: 'hist_d181_review',
    });
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
    await db.prisma.taskSuggestion.deleteMany();
    await db.prisma.interpretationRun.deleteMany();
    await db.prisma.taskAssignment.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.auditEvent.deleteMany();
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

  it('lets an authenticated Owner Review a valid Google Messages occurrence', async () => {
    useProvider(
      new CountingInterpretationProvider(
        interpretationResult([
          proposedTask(),
          proposedTask({
            summaryPoints: [
              summaryPoint({ id: 'sp_2', kind: 'next_action', value: 'Call the contractor' }),
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
    expect(JSON.stringify(body)).not.toContain(SELECTED);

    const suggestion = body.taskSuggestions[0];
    expect(suggestion.organizationId).toBe(ORG);
    expect(suggestion.sourceReference.sourceType).toBe('google_messages');
    expect(suggestion.sourceCommunicationEventId).toBeUndefined();
    expect(suggestion.sourceReference.contactHint).toBeUndefined();
    expect(suggestion.sourceReference.title).toBeUndefined();

    const run = await db.prisma.interpretationRun.findFirstOrThrow();
    expect(run.sourceKind).toBe('google_messages');
    expect(run.organizationId).toBe(ORG);
    expect(await db.prisma.task.count()).toBe(0);
    expect(await db.prisma.taskAssignment.count()).toBe(0);

    const event = await db.prisma.communicationEvent.findFirstOrThrow({
      where: { organizationId: ORG, sourceType: 'google_messages' },
    });
    expect(event.accountId).toBeNull();
    expect(event.fromAddress).toBe('');
    expect(event.snippet).toBeNull();
    expect(event.subject).toBeNull();
    expect(event.providerMessageId).toBe(
      buildGoogleMessagesProviderMessageId(validBody().sourceOccurrenceId as string),
    );

    const excerpt = await db.prisma.temporaryCommunicationExcerpt.findUniqueOrThrow({
      where: { communicationEventId: event.id },
    });
    expect(excerpt.content).toBe(SELECTED);
    expect(excerpt.organizationId).toBe(ORG);
    expect(await messagesEventCount()).toBe(1);
    expect(await messagesExcerptCount()).toBe(1);

    expect(await db.prisma.communicationAccount.count()).toBe(1);
    expect(await db.prisma.communicationAccount.findFirstOrThrow()).toMatchObject({
      id: 'acct_d181_review',
    });
  });

  it('returns truthful zero proposals without creating a Task', async () => {
    useProvider(new CountingInterpretationProvider(interpretationResult([])));
    const res = await post(validBody());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.taskSuggestions).toEqual([]);
    expect(await db.prisma.task.count()).toBe(0);
    expect(await db.prisma.interpretationRun.findFirstOrThrow()).toMatchObject({
      sourceKind: 'google_messages',
      outcome: 'no_proposals',
    });
  });

  it('replays the same organization, key, and occurrence without calling the provider again', async () => {
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const key = nextKey('idem-replay');

    const first = await post(validBody(), { 'idempotency-key': key });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.idempotentReplay).toBe(false);

    const replay = await post(validBody(), { 'idempotency-key': key });
    expect(replay.status).toBe(200);
    const body = await replay.json();
    expect(body.idempotentReplay).toBe(true);
    expect(body.taskSuggestions).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
    expect(await db.prisma.interpretationRun.count()).toBe(1);
    expect(await db.prisma.communicationEvent.count()).toBe(1);
    expect(await messagesEventCount()).toBe(1);
    expect(await messagesExcerptCount()).toBe(1);
  });

  it('conflicts when the same key is reused for a different Messages occurrence', async () => {
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const key = nextKey('idem-conflict');

    const first = await post(validBody(), { 'idempotency-key': key });
    expect(first.status).toBe(200);
    const eventsBefore = await messagesEventCount();
    const excerptsBefore = await messagesExcerptCount();
    const firstEvent = await db.prisma.communicationEvent.findFirstOrThrow({
      where: { organizationId: ORG, sourceType: 'google_messages' },
    });
    const firstExcerpt = await db.prisma.temporaryCommunicationExcerpt.findUniqueOrThrow({
      where: { communicationEventId: firstEvent.id },
    });

    const conflict = await post(validBody({ sourceOccurrenceId: 'other-occurrence' }), {
      'idempotency-key': key,
    });
    await expectError(conflict, 409, 'IDEMPOTENCY_KEY_CONFLICT');
    expect(provider.calls).toHaveLength(1);
    expect(await db.prisma.interpretationRun.count()).toBe(1);
    expect(await messagesEventCount()).toBe(eventsBefore);
    expect(await messagesExcerptCount()).toBe(excerptsBefore);
    expect(
      await db.prisma.temporaryCommunicationExcerpt.findUniqueOrThrow({
        where: { communicationEventId: firstEvent.id },
      }),
    ).toMatchObject({ id: firstExcerpt.id, content: SELECTED });
  });

  it('conflicts on the same key with different selected text without persisting another source', async () => {
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const key = nextKey('idem-text');

    const first = await post(validBody(), { 'idempotency-key': key });
    expect(first.status).toBe(200);
    const eventsBefore = await messagesEventCount();
    const excerptsBefore = await messagesExcerptCount();

    const conflict = await post(
      validBody({ selectedText: `${SELECTED} Please also bring the key.` }),
      {
        'idempotency-key': key,
      },
    );
    await expectError(conflict, 409, 'IDEMPOTENCY_KEY_CONFLICT');
    expect(provider.calls).toHaveLength(1);
    expect(await messagesEventCount()).toBe(eventsBefore);
    expect(await messagesExcerptCount()).toBe(excerptsBefore);
    const event = await db.prisma.communicationEvent.findFirstOrThrow({
      where: { organizationId: ORG, sourceType: 'google_messages' },
    });
    expect(
      await db.prisma.temporaryCommunicationExcerpt.findUniqueOrThrow({
        where: { communicationEventId: event.id },
      }),
    ).toMatchObject({ content: SELECTED });
  });

  it('conflicts on the same key with a different observedAt without persisting another source', async () => {
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const key = nextKey('idem-observed');

    const first = await post(validBody(), { 'idempotency-key': key });
    expect(first.status).toBe(200);
    const eventsBefore = await messagesEventCount();
    const excerptsBefore = await messagesExcerptCount();

    const conflict = await post(validBody({ observedAt: '2026-08-14T09:00:00.000Z' }), {
      'idempotency-key': key,
    });
    await expectError(conflict, 409, 'IDEMPOTENCY_KEY_CONFLICT');
    expect(provider.calls).toHaveLength(1);
    expect(await messagesEventCount()).toBe(eventsBefore);
    expect(await messagesExcerptCount()).toBe(excerptsBefore);
  });

  it('replays equivalent observedAt encodings of the same instant without a second source write', async () => {
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const key = nextKey('idem-observed-eq');

    const first = await post(validBody({ observedAt: '2026-08-13T17:00:00.000Z' }), {
      'idempotency-key': key,
    });
    expect(first.status).toBe(200);
    const replay = await post(validBody({ observedAt: '2026-08-13T10:00:00-07:00' }), {
      'idempotency-key': key,
    });
    expect(replay.status).toBe(200);
    expect((await replay.json()).idempotentReplay).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(await messagesEventCount()).toBe(1);
    expect(await messagesExcerptCount()).toBe(1);
  });

  it.each([
    ['invalid', 'yesterday'],
    ['zone-less', '2026-08-13T17:00:00'],
    ['date-only', '2026-08-13'],
  ])('rejects a %s observedAt before any Messages persistence', async (_label, observedAt) => {
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const res = await post(validBody({ observedAt }));
    const json = (await expectError(res, 400, 'VALIDATION_ERROR')) as {
      error: { details?: Array<{ field: string }> };
    };
    expect(json.error.details?.map((detail) => detail.field)).toContain('observedAt');
    expect(provider.calls).toHaveLength(0);
    expect(await db.prisma.interpretationRun.count()).toBe(0);
    expect(await messagesEventCount()).toBe(0);
    expect(await messagesExcerptCount()).toBe(0);
    expect(await db.prisma.communicationEvent.count()).toBe(0);
    expect(await db.prisma.temporaryCommunicationExcerpt.count()).toBe(0);
  });

  it('does not treat another organization as a replay of this organization', async () => {
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const key = nextKey('idem-cross-org');

    const first = await post(validBody(), { 'idempotency-key': key });
    expect(first.status).toBe(200);
    const firstSuggestionId = (await first.json()).taskSuggestions[0].id;
    const firstEventCount = await db.prisma.communicationEvent.count({
      where: { organizationId: ORG },
    });

    authOwner(otherOwner);
    const other = await post(validBody(), { 'idempotency-key': key });
    expect(other.status).toBe(200);
    const otherBody = await other.json();
    expect(otherBody.idempotentReplay).toBe(false);
    expect(otherBody.taskSuggestions[0].id).not.toBe(firstSuggestionId);
    expect(otherBody.taskSuggestions[0].organizationId).toBe(OTHER_ORG);
    expect(provider.calls).toHaveLength(2);
    expect(await db.prisma.communicationEvent.count({ where: { organizationId: ORG } })).toBe(
      firstEventCount,
    );
    expect(await db.prisma.interpretationRun.count({ where: { organizationId: OTHER_ORG } })).toBe(
      1,
    );
  });

  it('refuses a body that tries to choose source kind or supply Gmail fields', async () => {
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const res = await post(
      validBody({
        sourceKind: 'gmail',
        rawInput: 'spoofed',
        organizationId: OTHER_ORG,
        capturedAt: OBSERVED_AT,
        accountId: 'acct_d181_review',
        fromAddress: '+15555550100',
        conversationTitle: 'Mom',
      }),
    );
    const json = (await expectError(res, 400, 'VALIDATION_ERROR')) as {
      error: { details?: Array<{ field: string }> };
    };
    expect(json.error.details?.map((detail) => detail.field)).toEqual(
      expect.arrayContaining([
        'sourceKind',
        'rawInput',
        'organizationId',
        'capturedAt',
        'accountId',
        'fromAddress',
        'conversationTitle',
      ]),
    );
    expect(provider.calls).toHaveLength(0);
  });

  it('does not place selected text or sender-like values into audit notes', async () => {
    useProvider(new CountingInterpretationProvider(interpretationResult([proposedTask()])));
    const res = await post(validBody());
    expect(res.status).toBe(200);
    const notes = await db.prisma.auditEvent.findMany({
      select: { note: true, action: true },
    });
    for (const row of notes) {
      expect(row.note ?? '').not.toContain(SELECTED);
      expect(row.note ?? '').not.toContain('15555550100');
    }
  });

  it('leaves existing Gmail CommunicationEvent rows intact', async () => {
    await upsertCommunicationEvent(db.prisma, {
      organizationId: ORG,
      accountId: 'acct_d181_review',
      message: inboxMessage({ eventId: 'evt_d181_gmail', providerMessageId: 'msg_d181_gmail' }),
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: ORG,
      communicationEventId: 'evt_d181_gmail',
      excerptId: 'ex_evt_d181_gmail',
      content: 'Gmail excerpt stays here',
      purgeAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    useProvider(new CountingInterpretationProvider(interpretationResult([proposedTask()])));

    const res = await post(validBody());
    expect(res.status).toBe(200);
    const gmail = await db.prisma.communicationEvent.findUniqueOrThrow({
      where: { id: 'evt_d181_gmail' },
    });
    expect(gmail.accountId).toBe('acct_d181_review');
    expect(gmail.sourceType).toBe('gmail');
    const gmailExcerpt = await db.prisma.temporaryCommunicationExcerpt.findUniqueOrThrow({
      where: { communicationEventId: 'evt_d181_gmail' },
    });
    expect(gmailExcerpt.content).toBe('Gmail excerpt stays here');
  });

  it('does not import A6 suggestion extraction or process-service', () => {
    const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const files = [
      'lib/messages/review-service.ts',
      'lib/messages/validate-review-body.ts',
      'app/api/v1/messages/reviews/route.ts',
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

  it('maps a retryable provider failure to 503 without persisting an occurrence', async () => {
    useProvider(new CountingInterpretationProvider(interpretationResult([proposedTask()])));
    providerState.current = {
      name: 'failing-interpretation',
      async interpret(): Promise<InterpretationResult> {
        throw new AiProviderError('AI_TIMEOUT', 'retryable', 'provider timed out');
      },
    };

    const res = await post(validBody(), { 'idempotency-key': nextKey('idem-503') });
    await expectError(res, 503, 'DEPENDENCY_UNAVAILABLE');
    expect(await db.prisma.interpretationRun.count()).toBe(0);
    expect(await db.prisma.taskSuggestion.count()).toBe(0);
    expect(await messagesEventCount()).toBe(1);
    expect(await messagesExcerptCount()).toBe(1);
    const failedEvent = await db.prisma.communicationEvent.findFirstOrThrow({
      where: { organizationId: ORG, sourceType: 'google_messages' },
    });
    expect(
      await db.prisma.temporaryCommunicationExcerpt.findUniqueOrThrow({
        where: { communicationEventId: failedEvent.id },
      }),
    ).toMatchObject({ content: SELECTED });
  });

  it('retries a provider 503 against the same occurrence without creating a second event or excerpt', async () => {
    const key = nextKey('idem-503-retry');
    providerState.current = {
      name: 'failing-interpretation',
      async interpret(): Promise<InterpretationResult> {
        throw new AiProviderError('AI_TIMEOUT', 'retryable', 'provider timed out');
      },
    };

    const failed = await post(validBody(), { 'idempotency-key': key });
    await expectError(failed, 503, 'DEPENDENCY_UNAVAILABLE');
    const eventAfterFailure = await db.prisma.communicationEvent.findFirstOrThrow({
      where: { organizationId: ORG, sourceType: 'google_messages' },
    });
    const excerptAfterFailure = await db.prisma.temporaryCommunicationExcerpt.findUniqueOrThrow({
      where: { communicationEventId: eventAfterFailure.id },
    });

    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const retry = await post(validBody(), { 'idempotency-key': key });
    expect(retry.status).toBe(200);
    expect((await retry.json()).idempotentReplay).toBe(false);
    expect(provider.calls).toHaveLength(1);
    expect(await db.prisma.interpretationRun.count()).toBe(1);
    expect(await db.prisma.taskSuggestion.count()).toBe(1);
    expect(await messagesEventCount()).toBe(1);
    expect(await messagesExcerptCount()).toBe(1);
    expect(
      await db.prisma.communicationEvent.findFirstOrThrow({
        where: { organizationId: ORG, sourceType: 'google_messages' },
      }),
    ).toMatchObject({ id: eventAfterFailure.id });
    expect(
      await db.prisma.temporaryCommunicationExcerpt.findUniqueOrThrow({
        where: { communicationEventId: eventAfterFailure.id },
      }),
    ).toMatchObject({ id: excerptAfterFailure.id, content: SELECTED });
  });
});
