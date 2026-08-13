// @vitest-environment node
/**
 * S7 Exclude Sender: Gmail-specific organization-scoped sender exclusion (D180).
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
import { GET as listGmailIntake } from '@/app/api/v1/gmail/intake/route';
import { POST as createGmailReview } from '@/app/api/v1/gmail/reviews/route';
import { POST as createGmailSenderExclusion } from '@/app/api/v1/gmail/sender-exclusions/route';
import { DELETE as deleteGmailSenderExclusion } from '@/app/api/v1/gmail/sender-exclusions/[exclusionId]/route';
import { UNPARSEABLE_GMAIL_FROM_SENTINEL } from '@/lib/gmail/normalize';

const ORG = 'org_s7_exclude';
const OTHER_ORG = 'org_s7_exclude_other';
const OWNER_ID = 'owner_s7_exclude';
const EXCERPT = 'Please send the revised quote tomorrow afternoon and book the survey.';
const now = new Date().toISOString();
const futurePurge = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const owner = ownerActor(asOwnerId(OWNER_ID), asOrganizationId(ORG));
const otherOwner = ownerActor(asOwnerId('owner_s7_exclude_other'), asOrganizationId(OTHER_ORG));

let db: TestDatabase;
let keySeq = 0;

function nextKey(prefix = 'idem-exclude'): string {
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
    value: 'Send the revised quote',
    ...overrides,
  } as TaskSummaryPoint;
}

function proposedTask(): ProposedTask {
  return {
    summaryPoints: [summaryPoint()],
    peopleHints: [],
    deadlineExpression: null,
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

function inboxMessage(
  overrides: Partial<ParsedGmailMessageFixture> &
    Pick<ParsedGmailMessageFixture, 'eventId' | 'providerMessageId'>,
): ParsedGmailMessageFixture {
  return {
    providerThreadId: 'thread_exclude',
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
    historyId: 'hist_exclude',
  });
}

async function seedEligible(input: {
  organizationId: string;
  accountId: string;
  eventId: string;
  providerMessageId: string;
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
    content: EXCERPT,
    purgeAt: futurePurge,
  });
}

function excludeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/gmail/sender-exclusions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function reviewRequest(communicationEventId: string, idempotencyKey: string): Request {
  return new Request('http://localhost/api/v1/gmail/reviews', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify({ communicationEventId }),
  });
}

async function expectError(response: Response, status: number, code: string): Promise<unknown> {
  expect(response.status).toBe(status);
  const json = await response.json();
  expect(json.error.code).toBe(code);
  return json;
}

describe('S7 Gmail sender exclusion (D180)', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccount(ORG, 'acct_s7_exclude');
    await seedAccount(OTHER_ORG, 'acct_s7_exclude_other');
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => {
    installDbTestRuntime(db.prisma);
    authOwner();
    providerState.current = null;
  });

  afterEach(async () => {
    clearDbTestRuntime();
    await db.prisma.auditEvent.deleteMany();
    await db.prisma.gmailSenderExclusion.deleteMany();
    await db.prisma.taskSuggestion.deleteMany();
    await db.prisma.interpretationRun.deleteMany();
    await db.prisma.temporaryCommunicationExcerpt.deleteMany();
    await db.prisma.communicationEvent.deleteMany();
  });

  it('creates an organization-scoped exclusion and hides that sender from intake immediately', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_exclude',
      eventId: 'evt_exclude_now',
      providerMessageId: 'msg_exclude_now',
    });
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_exclude',
      eventId: 'evt_keep',
      providerMessageId: 'msg_keep',
      extras: {
        fromAddress: 'other@example.com',
        receivedAt: new Date(Date.now() - 1000).toISOString(),
      },
    });

    const created = await createGmailSenderExclusion(
      excludeRequest({ communicationEventId: 'evt_exclude_now' }),
    );
    expect(created.status).toBe(200);
    const body = await created.json();
    expect(body.id).toEqual(expect.any(String));
    expect(body.createdAt).toEqual(expect.any(String));
    expect(body).not.toHaveProperty('senderAddress');
    expect(body).not.toHaveProperty('fromAddress');

    const intake = await listGmailIntake(new Request('http://localhost/api/v1/gmail/intake'));
    expect(intake.status).toBe(200);
    const page = await intake.json();
    expect(page.items.map((item: { id: string }) => item.id)).toEqual(['evt_keep']);
  });

  it('lets two organizations exclude the same sender independently', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_exclude',
      eventId: 'evt_mine',
      providerMessageId: 'msg_mine',
    });
    await seedEligible({
      organizationId: OTHER_ORG,
      accountId: 'acct_s7_exclude_other',
      eventId: 'evt_theirs',
      providerMessageId: 'msg_theirs',
    });

    const mine = await createGmailSenderExclusion(
      excludeRequest({ communicationEventId: 'evt_mine' }),
    );
    expect(mine.status).toBe(200);

    authOwner(otherOwner);
    const theirs = await createGmailSenderExclusion(
      excludeRequest({ communicationEventId: 'evt_theirs' }),
    );
    expect(theirs.status).toBe(200);
    const mineBody = await mine.json();
    const theirsBody = await theirs.json();
    expect(mineBody.id).not.toBe(theirsBody.id);

    authOwner();
    const myIntake = await listGmailIntake(new Request('http://localhost/api/v1/gmail/intake'));
    expect((await myIntake.json()).items).toEqual([]);

    authOwner(otherOwner);
    const theirIntake = await listGmailIntake(new Request('http://localhost/api/v1/gmail/intake'));
    expect((await theirIntake.json()).items).toEqual([]);
    expect(await db.prisma.gmailSenderExclusion.count()).toBe(2);
  });

  it('filters a later eligible occurrence from the same sender and refuses a new Review', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_exclude',
      eventId: 'evt_first',
      providerMessageId: 'msg_first',
    });
    const created = await createGmailSenderExclusion(
      excludeRequest({ communicationEventId: 'evt_first' }),
    );
    expect(created.status).toBe(200);

    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_exclude',
      eventId: 'evt_later',
      providerMessageId: 'msg_later',
      extras: { receivedAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(await db.prisma.communicationEvent.count({ where: { organizationId: ORG } })).toBe(2);

    const intake = await listGmailIntake(new Request('http://localhost/api/v1/gmail/intake'));
    expect((await intake.json()).items).toEqual([]);

    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const review = await createGmailReview(reviewRequest('evt_later', nextKey()));
    await expectError(review, 409, 'DOMAIN_CONFLICT');
    expect(provider.calls).toHaveLength(0);
    expect(await db.prisma.interpretationRun.count()).toBe(0);
    expect(await db.prisma.taskSuggestion.count()).toBe(0);
  });

  it('does not alter A5 Gmail ingestion of an excluded sender', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_exclude',
      eventId: 'evt_ingest_first',
      providerMessageId: 'msg_ingest_first',
    });
    expect(
      (
        await createGmailSenderExclusion(
          excludeRequest({ communicationEventId: 'evt_ingest_first' }),
        )
      ).status,
    ).toBe(200);

    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_exclude',
      eventId: 'evt_ingest_later',
      providerMessageId: 'msg_ingest_later',
    });
    const stored = await db.prisma.communicationEvent.findFirstOrThrow({
      where: { id: 'evt_ingest_later', organizationId: ORG },
    });
    expect(stored.fromAddress).toBe('sender@example.com');
    expect(stored.sourceType).toBe('gmail');
  });

  it('replays a D161 committed interpretation after a later exclusion without calling the provider again', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_exclude',
      eventId: 'evt_replay',
      providerMessageId: 'msg_replay',
    });
    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const key = nextKey('idem-after-exclude');

    const first = await createGmailReview(reviewRequest('evt_replay', key));
    expect(first.status).toBe(200);
    expect((await first.json()).idempotentReplay).toBe(false);
    expect(provider.calls).toHaveLength(1);
    const runCount = await db.prisma.interpretationRun.count();
    const suggestionCount = await db.prisma.taskSuggestion.count();
    expect(runCount).toBe(1);
    expect(suggestionCount).toBe(1);

    expect(
      (await createGmailSenderExclusion(excludeRequest({ communicationEventId: 'evt_replay' })))
        .status,
    ).toBe(200);

    const replay = await createGmailReview(reviewRequest('evt_replay', key));
    expect(replay.status).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody.idempotentReplay).toBe(true);
    expect(replayBody.taskSuggestions).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
    expect(await db.prisma.interpretationRun.count()).toBe(runCount);
    expect(await db.prisma.taskSuggestion.count()).toBe(suggestionCount);
  });

  it('refuses unknown@invalid as an exclusion key so malformed senders are not grouped', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_exclude',
      eventId: 'evt_malformed_a',
      providerMessageId: 'msg_malformed_a',
      extras: { fromAddress: UNPARSEABLE_GMAIL_FROM_SENTINEL },
    });
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_exclude',
      eventId: 'evt_malformed_b',
      providerMessageId: 'msg_malformed_b',
      extras: {
        fromAddress: UNPARSEABLE_GMAIL_FROM_SENTINEL,
        receivedAt: new Date(Date.now() - 1000).toISOString(),
      },
    });

    const res = await createGmailSenderExclusion(
      excludeRequest({ communicationEventId: 'evt_malformed_a' }),
    );
    await expectError(res, 400, 'VALIDATION_ERROR');
    expect(await db.prisma.gmailSenderExclusion.count()).toBe(0);

    const intake = await listGmailIntake(new Request('http://localhost/api/v1/gmail/intake'));
    expect((await intake.json()).items.map((item: { id: string }) => item.id).sort()).toEqual([
      'evt_malformed_a',
      'evt_malformed_b',
    ]);
  });

  it('restores S7 eligibility after the exclusion is removed', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_exclude',
      eventId: 'evt_restore',
      providerMessageId: 'msg_restore',
    });
    const created = await createGmailSenderExclusion(
      excludeRequest({ communicationEventId: 'evt_restore' }),
    );
    const exclusion = await created.json();

    const hidden = await listGmailIntake(new Request('http://localhost/api/v1/gmail/intake'));
    expect((await hidden.json()).items).toEqual([]);

    const removed = await deleteGmailSenderExclusion(new Request('http://localhost/'), {
      params: Promise.resolve({ exclusionId: exclusion.id }),
    });
    expect(removed.status).toBe(200);

    const restored = await listGmailIntake(new Request('http://localhost/api/v1/gmail/intake'));
    expect((await restored.json()).items.map((item: { id: string }) => item.id)).toEqual([
      'evt_restore',
    ]);

    const provider = useProvider(
      new CountingInterpretationProvider(interpretationResult([proposedTask()])),
    );
    const review = await createGmailReview(reviewRequest('evt_restore', nextKey()));
    expect(review.status).toBe(200);
    expect(provider.calls).toHaveLength(1);
  });

  it('records create/remove audit with Owner/org attribution and without sender PII in notes', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_exclude',
      eventId: 'evt_audit',
      providerMessageId: 'msg_audit',
    });
    const created = await createGmailSenderExclusion(
      excludeRequest({ communicationEventId: 'evt_audit' }),
    );
    const exclusion = await created.json();

    const createdAudits = await db.prisma.auditEvent.findMany({
      where: { action: 'gmail_sender_excluded', organizationId: ORG },
    });
    expect(createdAudits).toHaveLength(1);
    expect(createdAudits[0]?.actorKind).toBe('owner');
    expect(createdAudits[0]?.ownerId).toBe(OWNER_ID);
    expect(createdAudits[0]?.organizationId).toBe(ORG);
    expect(createdAudits[0]?.note).toBeNull();
    expect(createdAudits[0]?.intendedRecipientEmail).toBeNull();
    expect(createdAudits[0]?.communicationEventId).toBe('evt_audit');
    expect(JSON.stringify(createdAudits[0])).not.toContain('sender@example.com');

    await deleteGmailSenderExclusion(new Request('http://localhost/'), {
      params: Promise.resolve({ exclusionId: exclusion.id }),
    });
    const removedAudits = await db.prisma.auditEvent.findMany({
      where: { action: 'gmail_sender_exclusion_removed', organizationId: ORG },
    });
    expect(removedAudits).toHaveLength(1);
    expect(removedAudits[0]?.ownerId).toBe(OWNER_ID);
    expect(removedAudits[0]?.note).toBeNull();
    expect(removedAudits[0]?.intendedRecipientEmail).toBeNull();
    expect(JSON.stringify(removedAudits[0])).not.toContain('sender@example.com');
  });

  it('is idempotent for an already-excluded sender and does not write a second create audit', async () => {
    await seedEligible({
      organizationId: ORG,
      accountId: 'acct_s7_exclude',
      eventId: 'evt_again',
      providerMessageId: 'msg_again',
    });
    const first = await createGmailSenderExclusion(
      excludeRequest({ communicationEventId: 'evt_again' }),
    );
    const second = await createGmailSenderExclusion(
      excludeRequest({ communicationEventId: 'evt_again' }),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await first.json()).id).toBe((await second.json()).id);
    expect(await db.prisma.gmailSenderExclusion.count()).toBe(1);
    expect(await db.prisma.auditEvent.count({ where: { action: 'gmail_sender_excluded' } })).toBe(
      1,
    );
  });

  it('does not import A6 suggestion extraction or change A5 ingest modules', () => {
    const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const files = [
      'lib/gmail/sender-exclusion-service.ts',
      'lib/gmail/validate-exclusion-body.ts',
      'app/api/v1/gmail/sender-exclusions/route.ts',
      'app/api/v1/gmail/sender-exclusions/[exclusionId]/route.ts',
      'lib/gmail/sync-engine.ts',
      'lib/gmail/poll-service.ts',
    ];
    for (const file of files) {
      const source = readFileSync(path.join(webRoot, file), 'utf8');
      expect(source).not.toMatch(/evaluateSuggestionRelevance/);
      expect(source).not.toMatch(/SuggestionExtractionResult/);
      expect(source).not.toMatch(/AI_EMPTY_OUTPUT/);
      expect(source).not.toMatch(/from '@\/lib\/suggestions/);
      expect(source).not.toMatch(/claimSuggestionProcessingBatch/);
    }
    const ingest = readFileSync(path.join(webRoot, 'lib/gmail/sync-engine.ts'), 'utf8');
    expect(ingest).not.toMatch(/sender-exclusion/);
    expect(ingest).not.toMatch(/GmailSenderExclusion/);
  });
});
