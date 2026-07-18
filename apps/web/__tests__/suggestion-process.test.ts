// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AiProviderError,
  MockSuggestionExtractionProvider,
  DEFAULT_SUGGESTION_POLICY_VERSION,
} from '@aicaa/ai';
import {
  createOrUpdatePendingCommunicationAccount,
  createTaskSuggestion,
  getCommunicationEventById,
  getTaskSuggestionBySourceEventId,
  getTemporaryCommunicationExcerptByEventId,
  persistConnectedCommunicationAccount,
  upsertCommunicationEvent,
  upsertTemporaryCommunicationExcerpt,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import {
  asCommunicationEventId,
  asOrganizationId,
  asTaskSuggestionId,
  computeWorkflowSafetyCeilingPurgeAt,
  type ParsedGmailMessageFixture,
  type TaskSuggestion,
} from '@aicaa/domain';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import {
  runInternalSuggestionProcess,
  SuggestionProcessConfigurationError,
  PROCESS_STOP_MARGIN_MS,
} from '@/lib/suggestions/process-service';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { POST } from '@/app/api/v1/internal/suggestions/process/route';

const SECRET = 'cron-secret-for-suggestion-process-32b!';
const org = 'org_sug_proc';
const now = '2026-07-17T18:00:00.000Z';
const accountId = 'acct_sug_proc';
const ingestPurgeAt = '2026-07-24T18:00:00.000Z';

let db: TestDatabase;

function inboxMessage(
  overrides: Partial<ParsedGmailMessageFixture> &
    Pick<ParsedGmailMessageFixture, 'eventId' | 'providerMessageId'>,
): ParsedGmailMessageFixture {
  return {
    providerThreadId: 'thread_sug',
    internalDate: now,
    fromAddress: 'sender@example.com',
    toAddresses: ['owner@acme.example'],
    subject: 'Please review the contract',
    snippet: 'Need your decision by Friday',
    labelIds: ['INBOX'],
    hasAttachments: false,
    attachmentMetadata: [],
    ...overrides,
  };
}

async function seedAccount(): Promise<void> {
  await createOrUpdatePendingCommunicationAccount(db.prisma, {
    organizationId: org,
    accountId,
    emailAddress: 'owner@acme.example',
    externalAccountId: 'google-sub-sug',
  });
  await persistConnectedCommunicationAccount(db.prisma, {
    organizationId: org,
    accountId,
    emailAddress: 'owner@acme.example',
    externalAccountId: 'google-sub-sug',
    connectedAt: now,
    historyId: 'hist_1',
  });
}

async function seedEvent(
  eventId: string,
  providerMessageId: string,
  overrides: Partial<ParsedGmailMessageFixture> = {},
  withExcerpt = true,
): Promise<void> {
  await upsertCommunicationEvent(db.prisma, {
    organizationId: org,
    accountId,
    message: inboxMessage({ eventId, providerMessageId, ...overrides }),
  });
  if (withExcerpt) {
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: eventId,
      excerptId: `ex_${eventId}`,
      content: overrides.snippet ?? 'Need your decision by Friday on the vendor quote.',
      purgeAt: ingestPurgeAt,
    });
  }
}

function mockExtraction() {
  return new MockSuggestionExtractionProvider({
    result: {
      summaryPoints: [
        {
          id: 'sp_1',
          kind: 'request',
          label: 'Decision',
          order: 0,
          value: 'Decide on the vendor quote',
        },
      ],
      proposedDueAt: null,
      proposedPriority: 'normal',
      proposedRecipientHint: null,
      policyVersion: DEFAULT_SUGGESTION_POLICY_VERSION,
      modelVersion: 'mock-model',
    },
  });
}

function processRequest(auth?: string | null): Request {
  const headers = new Headers();
  if (auth !== null) {
    headers.set('authorization', auth ?? `Bearer ${SECRET}`);
  }
  return new Request('http://localhost/api/v1/internal/suggestions/process', {
    method: 'POST',
    headers,
  });
}

describe('A6.3 suggestion process service + route', () => {
  beforeAll(async () => {
    process.env.CRON_SECRET = SECRET;
    process.env.OWNER_ORGANIZATION_ID = org;
    db = await createTestDatabase();
    await seedAccount();
  });

  afterAll(async () => {
    clearDbTestRuntime();
    delete process.env.CRON_SECRET;
    await db.close();
  });

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    installDbTestRuntime(db.prisma);
  });

  it('skips irrelevant events without calling AI', async () => {
    await seedEvent('evt_skip', 'msg_skip', {
      subject: 'Auto-Reply: Away',
      snippet: 'I am out of office',
      fromAddress: 'person@example.com',
    });
    let aiCalls = 0;
    const provider = new MockSuggestionExtractionProvider({
      handler: async () => {
        aiCalls += 1;
        throw new Error('should not be called');
      },
    });

    const result = await runInternalSuggestionProcess({
      db: db.prisma,
      requestId: 'req_skip',
      now,
      deps: { provider, skipConfigAssert: true },
    });

    expect(result.response.skippedIrrelevant).toBeGreaterThanOrEqual(1);
    expect(aiCalls).toBe(0);
    const event = await getCommunicationEventById(db.prisma, org, 'evt_skip');
    expect(event.suggestionProcessingStatus).toBe('skipped_irrelevant');
    expect(event.suggestionLastErrorCode).toBe('AUTOREPLY_SUBJECT');
    expect(event.suggestionClaimOwner).toBeNull();
  });

  it('creates a suggestion and extends excerpt retention on success', async () => {
    await seedEvent('evt_ok', 'msg_ok');
    const result = await runInternalSuggestionProcess({
      db: db.prisma,
      requestId: 'req_ok',
      now,
      deps: { provider: mockExtraction(), skipConfigAssert: true },
    });
    expect(result.response.suggestionsCreated).toBeGreaterThanOrEqual(1);
    const event = await getCommunicationEventById(db.prisma, org, 'evt_ok');
    expect(event.suggestionProcessingStatus).toBe('suggestion_created');
    expect(event.suggestionProcessingAttempts).toBeGreaterThanOrEqual(1);
    const suggestion = await getTaskSuggestionBySourceEventId(db.prisma, org, 'evt_ok');
    expect(suggestion?.status).toBe('pending');
    expect(suggestion?.sourceCommunicationEventId).toBe('evt_ok');
    const excerpt = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_ok');
    expect(excerpt?.purgeAt).toBe(computeWorkflowSafetyCeilingPurgeAt(now));
    const audits = await db.prisma.auditEvent.findMany({
      where: { organizationId: org, communicationEventId: 'evt_ok' },
    });
    expect(audits.some((a) => a.systemId === 'suggestion_process')).toBe(true);
    expect(JSON.stringify(audits)).not.toMatch(/Need your decision|vendor quote/i);
  });

  it('records retryable failure for timeout/rate-limit/invalid output', async () => {
    await seedEvent('evt_retry', 'msg_retry');
    const result = await runInternalSuggestionProcess({
      db: db.prisma,
      requestId: 'req_retry',
      now,
      deps: {
        provider: new MockSuggestionExtractionProvider({
          error: new AiProviderError('AI_TIMEOUT', 'retryable', 'timeout'),
        }),
        skipConfigAssert: true,
      },
    });
    expect(result.response.failedRetryable).toBeGreaterThanOrEqual(1);
    const event = await getCommunicationEventById(db.prisma, org, 'evt_retry');
    expect(event.suggestionProcessingStatus).toBe('failed_retryable');
    expect(event.suggestionLastErrorCode).toBe('AI_TIMEOUT');
  });

  it('records permanent failure for policy refusal', async () => {
    await seedEvent('evt_perm', 'msg_perm');
    const result = await runInternalSuggestionProcess({
      db: db.prisma,
      requestId: 'req_perm',
      now,
      deps: {
        provider: new MockSuggestionExtractionProvider({
          error: new AiProviderError('AI_POLICY_REFUSAL', 'permanent', 'refused'),
        }),
        skipConfigAssert: true,
      },
    });
    expect(result.response.failedPermanent).toBeGreaterThanOrEqual(1);
    const event = await getCommunicationEventById(db.prisma, org, 'evt_perm');
    expect(event.suggestionProcessingStatus).toBe('failed_permanent');
  });

  it('does not permanently poison events on global AI misconfiguration', async () => {
    const previousKey = process.env.OPENAI_API_KEY;
    const previousEnabled = process.env.SUGGESTION_AI_ENABLED;
    delete process.env.OPENAI_API_KEY;
    process.env.SUGGESTION_AI_ENABLED = 'true';
    await seedEvent('evt_cfg', 'msg_cfg');
    try {
      await expect(
        runInternalSuggestionProcess({
          db: db.prisma,
          requestId: 'req_cfg',
          now,
          deps: {
            // Force config assert path without skip
            skipConfigAssert: false,
          },
        }),
      ).rejects.toBeInstanceOf(SuggestionProcessConfigurationError);

      const event = await getCommunicationEventById(db.prisma, org, 'evt_cfg');
      expect(event.suggestionProcessingStatus).toBe('unprocessed');
      expect(event.suggestionClaimOwner).toBeNull();
    } finally {
      if (previousKey !== undefined) {
        process.env.OPENAI_API_KEY = previousKey;
      } else {
        delete process.env.OPENAI_API_KEY;
      }
      if (previousEnabled !== undefined) {
        process.env.SUGGESTION_AI_ENABLED = previousEnabled;
      } else {
        delete process.env.SUGGESTION_AI_ENABLED;
      }
    }
  });

  it('treats existing unique suggestion as success-equivalent after verify', async () => {
    await seedEvent('evt_uniq', 'msg_uniq');
    const existing: TaskSuggestion = {
      id: asTaskSuggestionId('sug_preexisting'),
      organizationId: asOrganizationId(org),
      status: 'pending',
      summaryPoints: [
        { id: 'sp1', kind: 'next_action', label: 'Act', order: 0, value: 'Follow up' },
      ],
      voiceOriginated: false,
      sourceCommunicationEventId: asCommunicationEventId('evt_uniq'),
      retention: {},
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await createTaskSuggestion(db.prisma, org, existing);

    // Mark event claimable still (suggestion exists but processing status unprocessed)
    const result = await runInternalSuggestionProcess({
      db: db.prisma,
      requestId: 'req_uniq',
      now,
      deps: { provider: mockExtraction(), skipConfigAssert: true },
    });
    expect(result.response.suggestionsCreated).toBeGreaterThanOrEqual(1);
    const event = await getCommunicationEventById(db.prisma, org, 'evt_uniq');
    expect(event.suggestionProcessingStatus).toBe('suggestion_created');
    const suggestion = await getTaskSuggestionBySourceEventId(db.prisma, org, 'evt_uniq');
    expect(suggestion?.id).toBe('sug_preexisting');
  });

  it('stops claiming when soft deadline is already past stop margin', async () => {
    await seedEvent('evt_deadline', 'msg_deadline');
    const started = Date.now();
    const result = await runInternalSuggestionProcess({
      db: db.prisma,
      requestId: 'req_deadline',
      now,
      startedAtMs: started,
      deadlineMs: started, // already expired
      deps: { provider: mockExtraction(), skipConfigAssert: true },
    });
    expect(result.response.claimed).toBe(0);
    const event = await getCommunicationEventById(db.prisma, org, 'evt_deadline');
    expect(event.suggestionProcessingStatus).toBe('unprocessed');
    expect(event.suggestionProcessingAttempts).toBe(0);
  });

  it('releases soft-deadline claims without burning attempts or marking failed_retryable', async () => {
    await seedEvent('evt_deadline_release', 'msg_deadline_release');
    const claimOwner = 'suggestion_process:req_deadline_manual';
    const runtime = await loadDbRuntime();
    const claimed = await runtime.claimSuggestionProcessingBatch(db.prisma, {
      claimOwner,
      claimUntil: '2026-07-17T18:10:00.000Z',
      now,
      limit: 1,
    });
    expect(claimed).toHaveLength(1);
    const beforeAttempts = claimed[0]!.suggestionProcessingAttempts;
    await runtime.persistClaimReleasedWithoutOutcome({
      db: db.prisma,
      organizationId: claimed[0]!.organizationId,
      eventId: claimed[0]!.id,
      claimOwner,
      reasonCode: 'SOFT_DEADLINE_REACHED',
      audit: {
        id: 'aud_release_test',
        organizationId: claimed[0]!.organizationId,
        actorKind: 'system',
        systemId: 'suggestion_process',
        action: 'suggestion.process.claim_released',
        outcome: 'succeeded',
        recordedAt: now,
        note: 'SOFT_DEADLINE_REACHED',
      },
    });
    const after = await getCommunicationEventById(
      db.prisma,
      claimed[0]!.organizationId,
      claimed[0]!.id,
    );
    expect(after.suggestionClaimOwner).toBeNull();
    expect(after.suggestionProcessingStatus).toBe('unprocessed');
    expect(after.suggestionProcessingAttempts).toBe(beforeAttempts - 1);
    expect(PROCESS_STOP_MARGIN_MS).toBeGreaterThan(0);
  });

  it('uses request-scoped claim owner', async () => {
    await seedEvent('evt_owner', 'msg_owner');
    await runInternalSuggestionProcess({
      db: db.prisma,
      requestId: 'req_owner_abc',
      now,
      deps: { provider: mockExtraction(), skipConfigAssert: true },
    });
    const audits = await db.prisma.auditEvent.findMany({
      where: { requestId: 'req_owner_abc' },
    });
    expect(audits.length).toBeGreaterThan(0);
  });

  it('POST route requires cron auth and returns sanitized aggregate when idle', async () => {
    const unauthorized = await POST(processRequest(null));
    expect(unauthorized.status).toBe(401);

    await db.prisma.communicationEvent.updateMany({
      where: { organizationId: org },
      data: {
        suggestionProcessingStatus: 'suggestion_created',
        suggestionClaimOwner: null,
        suggestionClaimUntil: null,
      },
    });
    process.env.OPENAI_API_KEY = 'sk-test-local-only';
    process.env.SUGGESTION_AI_ENABLED = 'true';

    const res = await POST(processRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      claimed: 0,
      skippedIrrelevant: 0,
      suggestionsCreated: 0,
      failedRetryable: 0,
      failedPermanent: 0,
      requestId: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toMatch(/sk-test|excerpt|prompt|stack/i);

    delete process.env.OPENAI_API_KEY;
    delete process.env.SUGGESTION_AI_ENABLED;
  });

  it('POST returns sanitized 500 when AI is not configured', async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.SUGGESTION_AI_ENABLED = 'true';
    await seedEvent('evt_route_cfg', 'msg_route_cfg');
    const res = await POST(processRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toBe('Suggestion processing is not configured correctly.');
    expect(JSON.stringify(body)).not.toMatch(/OPENAI|sk-|stack|excerpt/i);
    const event = await getCommunicationEventById(db.prisma, org, 'evt_route_cfg');
    expect(event.suggestionProcessingStatus).toBe('unprocessed');
    delete process.env.SUGGESTION_AI_ENABLED;
  });

  it('POST unauthorized does not leak secret', async () => {
    const res = await POST(processRequest('Bearer wrong'));
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
  });
});
