// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOrganizationId, asOwnerId, GMAIL_READONLY_SCOPE, ownerActor } from '@aicaa/domain';
import {
  acquireGmailSyncLock,
  getCommunicationAccountByOrganization,
  getCommunicationEventByProviderMessageId,
  getTemporaryCommunicationExcerptByEventId,
  persistGmailConnectionTransaction,
} from '@aicaa/db';
import * as aicaaDb from '@aicaa/db/runtime';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV } from '@/lib/db/diagnostics';
import { setDbRuntimeForTests } from '@/lib/db/runtime-db';
import { setDbForTests } from '@/lib/db/server';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { GmailConfigError } from '@/lib/gmail/config';
import {
  CIPHERTEXT_PURPOSE,
  encryptToken,
  TokenEncryptionError,
} from '@/lib/gmail/token-encryption';
import {
  MAX_HISTORY_PAGES_PER_RUN,
  runGmailAccountSync,
  runOwnerGmailSync,
} from '@/lib/gmail/sync-engine';
import { GmailSyncError } from '@/lib/gmail/sync-errors';
import type { GmailApiClient } from '@/lib/gmail/gmail-api-client';

const org = 'org_test_123';
const owner = ownerActor(asOwnerId('owner_gmail_sync'), asOrganizationId(org));
const now = '2026-07-16T16:00:00.000Z';
const accountId = 'cacct_sync_engine';
const credentialId = 'gcred_sync_engine';

const material = {
  key: Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex'),
  version: '1',
};

function b64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

function ctx(requestId = 'req_sync_engine', at = now) {
  return {
    owner,
    db: db.prisma,
    now: at,
    requestId,
  };
}

async function seedConnectedAccount() {
  await persistGmailConnectionTransaction({
    db: db.prisma,
    organizationId: org,
    accountId,
    emailAddress: 'owner@example.com',
    externalAccountId: 'google-sub-sync',
    connectedAt: now,
    credential: {
      id: credentialId,
      encryptedRefreshToken: encryptToken(
        'rt_sync_engine',
        CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN,
        material,
      ),
      grantedScopes: GMAIL_READONLY_SCOPE,
      encryptionKeyVersion: '1',
    },
    audit: {
      id: `audit_connect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      organizationId: org,
      actorKind: 'owner',
      ownerId: owner.ownerId,
      action: 'gmail_connected',
      outcome: 'succeeded',
      recordedAt: now,
    },
  });
}

function tokenProvider() {
  return vi.fn(async () => 'access_token_memory_only');
}

function gmailMessage(id: string, overrides: { labelIds?: string[]; body?: string } = {}) {
  return {
    id,
    threadId: `thread_${id}`,
    labelIds: overrides.labelIds ?? ['INBOX'],
    snippet: 'hi',
    internalDate: '1721145600000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'sender@example.com' },
        { name: 'To', value: 'owner@example.com' },
        { name: 'Subject', value: 'Hello' },
      ],
      body: { data: b64url(overrides.body ?? 'Hello from Gmail') },
    },
  };
}

function inboxMessage(id: string) {
  return gmailMessage(id);
}

function persistenceShapedError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = 'PersistenceError';
  Object.assign(error, { code });
  return error;
}

function prismaShapedError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = 'PrismaClientKnownRequestError';
  Object.assign(error, { code });
  return error;
}

function installHistoryPersistOverride(
  persist: typeof aicaaDb.persistGmailHistoryPageTransaction,
): void {
  setDbRuntimeForTests({
    ...aicaaDb,
    persistGmailHistoryPageTransaction: persist,
  });
  setDbForTests(db.prisma);
}

function cronSyncContext(requestId: string) {
  return {
    db: db.prisma,
    organizationId: org,
    accountId,
    trigger: 'cron' as const,
    actor: { kind: 'system' as const, systemId: 'gmail_poll' },
    now,
    requestId,
    allowInitial: false,
  };
}

let db: TestDatabase;

describe('A5.4 Gmail sync engine', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    clearDbTestRuntime();
    await db.close();
  });

  beforeEach(async () => {
    installDbTestRuntime(db.prisma);
    await seedConnectedAccount();
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: {
        historyId: null,
        historyState: 'unset',
        status: 'connected',
        syncLockUntil: null,
        syncLockOwner: null,
        lastErrorCode: null,
        lastErrorAt: null,
      },
    });
  });

  it('initial sync seeds history via getProfile only and creates zero events', async () => {
    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(async () => ({ historyId: '5000' })),
      listHistory: vi.fn(),
      getMessage: vi.fn(),
    };
    const getAccessToken = tokenProvider();

    const result = await runOwnerGmailSync(ctx(), { gmailClient, getAccessToken });

    expect(result.run.trigger).toBe('initial');
    expect(result.run.outcome).toBe('succeeded');
    expect(result.run.eventsCreated).toBe(0);
    expect(result.run.messagesExamined).toBe(0);
    expect(gmailClient.getProfile).toHaveBeenCalledTimes(1);
    expect(gmailClient.listHistory).not.toHaveBeenCalled();
    expect(gmailClient.getMessage).not.toHaveBeenCalled();

    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.historyId).toBe('5000');
    expect(account?.historyState).toBe('valid');
    expect(result.connection.historyState).toBe('valid');
  });

  it('incremental sync creates an event and advances the cursor', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '1000', historyState: 'valid' },
    });

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(async () => ({
        historyId: '1100',
        history: [
          {
            id: '1050',
            messagesAdded: [{ message: { id: 'msg_inc_1' } }],
          },
        ],
      })),
      getMessage: vi.fn(async () => inboxMessage('msg_inc_1')),
    };

    const result = await runOwnerGmailSync(ctx('req_inc'), {
      gmailClient,
      getAccessToken: tokenProvider(),
    });

    expect(result.run.trigger).toBe('manual');
    expect(result.run.outcome).toBe('succeeded');
    expect(result.run.eventsCreated).toBe(1);
    expect(result.run.messagesExamined).toBe(1);
    expect(gmailClient.getProfile).not.toHaveBeenCalled();
    expect(gmailClient.listHistory).toHaveBeenCalled();
    expect(gmailClient.getMessage).toHaveBeenCalledWith({
      accessToken: 'access_token_memory_only',
      messageId: 'msg_inc_1',
    });

    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.historyId).toBe('1100');
    const event = await getCommunicationEventByProviderMessageId(db.prisma, org, 'msg_inc_1');
    expect(event?.subject).toBe('Hello');

    const excerpt = await db.prisma.temporaryCommunicationExcerpt.findFirst({
      where: { organizationId: org, communicationEventId: event!.id },
    });
    expect(excerpt?.content).toBe('Hello from Gmail');
    expect(excerpt?.purgedAt).toBeNull();
    // D078: purgeAt = syncedAt + 7 days
    expect(excerpt?.purgeAt.toISOString()).toBe('2026-07-23T16:00:00.000Z');
  });

  it('skips a 404/malformed fetch and still commits the remaining page', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '8000', historyState: 'valid' },
    });

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(async () => ({
        historyId: '8100',
        history: [
          {
            id: '8050',
            messagesAdded: [
              { message: { id: 'msg_ok_before' } },
              { message: { id: 'msg_deleted_404' } },
              { message: { id: 'msg_ok_after' } },
            ],
          },
        ],
      })),
      getMessage: vi.fn(async ({ messageId }) => {
        if (messageId === 'msg_deleted_404') {
          // users.messages.get 404 is classified as malformed_message by the API client.
          throw new GmailSyncError('malformed_message');
        }
        return inboxMessage(messageId);
      }),
    };

    const result = await runOwnerGmailSync(ctx('req_malformed_fetch'), {
      gmailClient,
      getAccessToken: tokenProvider(),
    });

    expect(result.run.outcome).toBe('succeeded');
    expect(result.run.outcome).not.toBe('permanent_failure');
    expect(result.run.errorCode).toBeNull();
    expect(result.run.eventsCreated).toBe(2);
    expect(result.run.messagesSkipped).toBe(1);
    expect(result.run.messagesExamined).toBe(2);
    expect(gmailClient.getMessage).toHaveBeenCalledTimes(3);

    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.historyId).toBe('8100');
    expect(account?.historyState).toBe('valid');
    expect(result.run.historyIdAfter).toBe('8100');

    await expect(
      getCommunicationEventByProviderMessageId(db.prisma, org, 'msg_deleted_404'),
    ).resolves.toBeNull();
    const before = await getCommunicationEventByProviderMessageId(db.prisma, org, 'msg_ok_before');
    const after = await getCommunicationEventByProviderMessageId(db.prisma, org, 'msg_ok_after');
    expect(before?.subject).toBe('Hello');
    expect(after?.subject).toBe('Hello');

    await expect(
      db.prisma.temporaryCommunicationExcerpt.count({
        where: { organizationId: org, communicationEventId: before!.id },
      }),
    ).resolves.toBe(1);
    await expect(
      db.prisma.temporaryCommunicationExcerpt.count({
        where: { organizationId: org, communicationEventId: after!.id },
      }),
    ).resolves.toBe(1);
    await expect(
      db.prisma.communicationEvent.count({
        where: { organizationId: org, providerMessageId: 'msg_deleted_404' },
      }),
    ).resolves.toBe(0);
  });

  it('skips a fetched message that fails normalization with malformed_message', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '8200', historyState: 'valid' },
    });

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(async () => ({
        historyId: '8300',
        history: [
          {
            id: '8250',
            messagesAdded: [
              { message: { id: 'msg_norm_ok' } },
              { message: { id: 'msg_norm_malformed' } },
            ],
          },
        ],
      })),
      getMessage: vi.fn(async ({ messageId }) => {
        if (messageId === 'msg_norm_malformed') {
          const raw = inboxMessage(messageId);
          delete (raw as { internalDate?: string }).internalDate;
          return raw;
        }
        return inboxMessage(messageId);
      }),
    };

    const result = await runOwnerGmailSync(ctx('req_malformed_normalize'), {
      gmailClient,
      getAccessToken: tokenProvider(),
    });

    expect(result.run.outcome).toBe('succeeded');
    expect(result.run.eventsCreated).toBe(1);
    expect(result.run.messagesSkipped).toBe(1);
    expect(result.run.messagesExamined).toBe(2);
    expect(result.run.historyIdAfter).toBe('8300');

    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.historyId).toBe('8300');
    await expect(
      getCommunicationEventByProviderMessageId(db.prisma, org, 'msg_norm_malformed'),
    ).resolves.toBeNull();
    await expect(
      getCommunicationEventByProviderMessageId(db.prisma, org, 'msg_norm_ok'),
    ).resolves.toMatchObject({ subject: 'Hello' });
  });

  it('does not skip a non-malformed getMessage failure', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '8400', historyState: 'valid' },
    });

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(async () => ({
        historyId: '8500',
        history: [
          {
            id: '8450',
            messagesAdded: [
              { message: { id: 'msg_before_rate_limit' } },
              { message: { id: 'msg_rate_limited' } },
              { message: { id: 'msg_after_rate_limit' } },
            ],
          },
        ],
      })),
      getMessage: vi.fn(async ({ messageId }) => {
        if (messageId === 'msg_rate_limited') {
          throw new GmailSyncError('rate_limited');
        }
        return inboxMessage(messageId);
      }),
    };

    const result = await runOwnerGmailSync(ctx('req_rate_limited_fetch'), {
      gmailClient,
      getAccessToken: tokenProvider(),
    });

    expect(result.run.outcome).toBe('retryable_failure');
    expect(result.run.retryable).toBe(true);
    expect(result.run.errorCode).toBe('rate_limited');
    expect(result.run.messagesSkipped).toBe(0);
    expect(result.run.eventsCreated).toBe(0);
    expect(gmailClient.getMessage).toHaveBeenCalledTimes(2);
    expect(gmailClient.getMessage).not.toHaveBeenCalledWith({
      accessToken: 'access_token_memory_only',
      messageId: 'msg_after_rate_limit',
    });

    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.historyId).toBe('8400');
    expect(account?.historyState).toBe('valid');
    await expect(
      db.prisma.communicationEvent.count({
        where: {
          organizationId: org,
          providerMessageId: {
            in: ['msg_before_rate_limit', 'msg_rate_limited', 'msg_after_rate_limit'],
          },
        },
      }),
    ).resolves.toBe(0);
  });

  it('processes multiple history pages and commits the final cursor', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '1200', historyState: 'valid' },
    });

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi
        .fn()
        .mockResolvedValueOnce({
          historyId: '1299',
          nextPageToken: 'page_2_token',
          history: [
            {
              id: '1250',
              messagesAdded: [{ message: { id: 'msg_page_1' } }],
            },
          ],
        })
        .mockResolvedValueOnce({
          historyId: '1400',
          history: [
            {
              id: '1350',
              messagesAdded: [{ message: { id: 'msg_page_2' } }],
            },
          ],
        }),
      getMessage: vi.fn(async ({ messageId }) => inboxMessage(messageId)),
    };

    const result = await runOwnerGmailSync(ctx('req_multi_page'), {
      gmailClient,
      getAccessToken: tokenProvider(),
    });

    expect(result.run.outcome).toBe('succeeded');
    expect(result.run.eventsCreated).toBe(2);
    expect(result.run.messagesExamined).toBe(2);
    expect(gmailClient.listHistory).toHaveBeenNthCalledWith(1, {
      accessToken: 'access_token_memory_only',
      startHistoryId: '1200',
      pageToken: undefined,
    });
    expect(gmailClient.listHistory).toHaveBeenNthCalledWith(2, {
      accessToken: 'access_token_memory_only',
      startHistoryId: '1200',
      pageToken: 'page_2_token',
    });

    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.historyId).toBe('1400');
    expect(result.run.historyIdAfter).toBe('1400');
  });

  it('fetches a duplicate message id across pages only once', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '2000', historyState: 'valid' },
    });

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi
        .fn()
        .mockResolvedValueOnce({
          historyId: '2099',
          nextPageToken: 'dup_page_2',
          history: [
            {
              id: '2050',
              messagesAdded: [{ message: { id: 'msg_dup_pages' } }],
            },
          ],
        })
        .mockResolvedValueOnce({
          historyId: '2200',
          history: [
            {
              id: '2150',
              messagesAdded: [
                { message: { id: 'msg_dup_pages' } },
                { message: { id: 'msg_dup_pages_unique' } },
              ],
            },
          ],
        }),
      getMessage: vi.fn(async ({ messageId }) => inboxMessage(messageId)),
    };

    const result = await runOwnerGmailSync(ctx('req_duplicate_pages'), {
      gmailClient,
      getAccessToken: tokenProvider(),
    });

    expect(result.run.outcome).toBe('succeeded');
    expect(result.run.eventsCreated).toBe(2);
    expect(result.run.messagesExamined).toBe(2);
    expect(gmailClient.getMessage).toHaveBeenCalledTimes(2);
    expect(gmailClient.getMessage).toHaveBeenNthCalledWith(1, {
      accessToken: 'access_token_memory_only',
      messageId: 'msg_dup_pages',
    });
    expect(gmailClient.getMessage).toHaveBeenNthCalledWith(2, {
      accessToken: 'access_token_memory_only',
      messageId: 'msg_dup_pages_unique',
    });
  });

  it('leaves the old cursor unchanged when the page transaction fails', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '3000', historyState: 'valid' },
    });
    const overlongMessageId = `msg_${'x'.repeat(260)}`;

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(async () => ({
        historyId: '3100',
        history: [
          {
            id: '3050',
            messagesAdded: [{ message: { id: overlongMessageId } }],
          },
        ],
      })),
      getMessage: vi.fn(async () => inboxMessage(overlongMessageId)),
    };

    const result = await runOwnerGmailSync(ctx('req_transaction_failure'), {
      gmailClient,
      getAccessToken: tokenProvider(),
    });

    expect(gmailClient.listHistory).toHaveBeenCalledTimes(1);
    expect(gmailClient.getMessage).toHaveBeenCalledTimes(1);
    expect(['permanent_failure', 'retryable_failure']).toContain(result.run.outcome);
    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.historyId).toBe('3000');
    expect(account?.historyState).toBe('valid');
  });

  it('returns partial at the history page limit with the cursor at the last processed page', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '4000', historyState: 'valid' },
    });
    const pageTokenCalls: Array<string | undefined> = [];

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(async ({ pageToken }) => {
        const pageIndex = pageTokenCalls.length;
        pageTokenCalls.push(pageToken);
        return {
          historyId: `49${pageIndex}`,
          nextPageToken: `limit_token_${pageIndex + 1}`,
          history: [
            {
              id: String(4100 + pageIndex),
              messagesAdded: [{ message: { id: `msg_limit_${pageIndex}` } }],
            },
          ],
        };
      }),
      getMessage: vi.fn(async ({ messageId }) => inboxMessage(messageId)),
    };

    const result = await runOwnerGmailSync(ctx('req_page_limit'), {
      gmailClient,
      getAccessToken: tokenProvider(),
    });

    const lastProcessedHistoryId = String(4100 + MAX_HISTORY_PAGES_PER_RUN - 1);
    expect(result.run.outcome).toBe('partial');
    expect(result.run.retryable).toBe(true);
    expect(result.run.eventsCreated).toBe(MAX_HISTORY_PAGES_PER_RUN);
    expect(gmailClient.listHistory).toHaveBeenCalledTimes(MAX_HISTORY_PAGES_PER_RUN);
    expect(pageTokenCalls).toEqual([
      undefined,
      ...Array.from(
        { length: MAX_HISTORY_PAGES_PER_RUN - 1 },
        (_, index) => `limit_token_${index + 1}`,
      ),
    ]);

    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.historyId).toBe(lastProcessedHistoryId);
    expect(result.run.historyIdAfter).toBe(lastProcessedHistoryId);
  });

  it('stops before a history page that would exceed the message budget without advancing past it', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '6000', historyState: 'valid' },
    });

    // First page: 49 unique messages (under 50). Second page: 2 messages would exceed remaining 1.
    const firstPageIds = Array.from({ length: 49 }, (_, i) => `msg_budget_${i}`);
    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(async ({ pageToken }) => {
        if (!pageToken) {
          return {
            historyId: '6100',
            nextPageToken: 'budget_page_2',
            history: [
              {
                id: '6050',
                messagesAdded: firstPageIds.map((id) => ({ message: { id } })),
              },
            ],
          };
        }
        return {
          historyId: '6200',
          history: [
            {
              id: '6150',
              messagesAdded: [
                { message: { id: 'msg_budget_over_a' } },
                { message: { id: 'msg_budget_over_b' } },
              ],
            },
          ],
        };
      }),
      getMessage: vi.fn(async ({ messageId }) => inboxMessage(messageId)),
    };

    const result = await runOwnerGmailSync(ctx('req_msg_budget'), {
      gmailClient,
      getAccessToken: tokenProvider(),
    });

    expect(result.run.outcome).toBe('partial');
    expect(result.run.retryable).toBe(true);
    expect(result.run.messagesExamined).toBe(49);
    expect(result.run.eventsCreated).toBe(49);
    expect(gmailClient.listHistory).toHaveBeenCalledTimes(2);
    expect(gmailClient.getMessage).toHaveBeenCalledTimes(49);
    // Cursor advanced only through the committed first page (max history record id).
    expect(result.run.historyIdAfter).toBe('6050');
    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.historyId).toBe('6050');
  });

  it('replays the same message without creating a duplicate event', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '5000', historyState: 'valid' },
    });

    const firstClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(async () => ({
        historyId: '5100',
        history: [
          {
            id: '5050',
            messagesAdded: [{ message: { id: 'msg_replay_idempotent' } }],
          },
        ],
      })),
      getMessage: vi.fn(async () => inboxMessage('msg_replay_idempotent')),
    };
    const first = await runOwnerGmailSync(ctx('req_replay_first'), {
      gmailClient: firstClient,
      getAccessToken: tokenProvider(),
    });
    expect(first.run.eventsCreated).toBe(1);

    const event = await getCommunicationEventByProviderMessageId(
      db.prisma,
      org,
      'msg_replay_idempotent',
    );
    const afterFirst = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, event!.id);
    expect(afterFirst?.purgeAt).toBe('2026-07-23T16:00:00.000Z');
    expect(afterFirst?.purgedAt).toBeNull();

    const secondClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(async () => ({
        historyId: '5200',
        history: [
          {
            id: '5150',
            messagesAdded: [{ message: { id: 'msg_replay_idempotent' } }],
          },
        ],
      })),
      getMessage: vi.fn(async () => inboxMessage('msg_replay_idempotent')),
    };
    // Later syncedAt would rewrite purgeAt if re-ingest were still a retention writer.
    const second = await runOwnerGmailSync(ctx('req_replay_second', '2026-07-18T16:00:00.000Z'), {
      gmailClient: secondClient,
      getAccessToken: tokenProvider(),
    });

    expect(second.run.outcome).toBe('succeeded');
    expect(second.run.eventsCreated).toBe(0);
    expect(second.run.eventsUpdated).toBe(1);
    await expect(
      db.prisma.communicationEvent.count({
        where: { organizationId: org, providerMessageId: 'msg_replay_idempotent' },
      }),
    ).resolves.toBe(1);

    const excerpt = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, event!.id);
    expect(excerpt?.purgeAt).toBe(afterFirst?.purgeAt);
    expect(excerpt?.purgedAt).toBeNull();
    expect(excerpt?.content).toBe('Hello from Gmail');
  });

  it('does not restore a purged excerpt when a message leaves Inbox and later returns', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '7000', historyState: 'valid' },
    });

    const messageId = 'msg_archive_reentry';
    const ingestClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(async () => ({
        historyId: '7100',
        history: [
          {
            id: '7050',
            messagesAdded: [{ message: { id: messageId } }],
          },
        ],
      })),
      getMessage: vi.fn(async () => gmailMessage(messageId)),
    };
    const ingested = await runOwnerGmailSync(ctx('req_archive_ingest'), {
      gmailClient: ingestClient,
      getAccessToken: tokenProvider(),
    });
    expect(ingested.run.eventsCreated).toBe(1);

    const event = await getCommunicationEventByProviderMessageId(db.prisma, org, messageId);
    const afterIngest = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, event!.id);
    expect(afterIngest?.content).toBe('Hello from Gmail');
    expect(afterIngest?.purgedAt).toBeNull();
    const originalPurgeAt = afterIngest!.purgeAt;

    const archiveClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(async () => ({
        historyId: '7200',
        history: [
          {
            id: '7150',
            labelsRemoved: [{ message: { id: messageId }, labelIds: ['INBOX'] }],
          },
        ],
      })),
      getMessage: vi.fn(async () => gmailMessage(messageId, { labelIds: [] })),
    };
    const archived = await runOwnerGmailSync(ctx('req_archive_leave'), {
      gmailClient: archiveClient,
      getAccessToken: tokenProvider(),
    });
    expect(archived.run.eventsUpdated).toBe(1);

    const afterArchive = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, event!.id);
    expect(afterArchive?.content).toBe('');
    expect(afterArchive?.byteLength).toBe(0);
    expect(afterArchive?.purgedAt).toBe(now);
    expect(afterArchive?.purgeAt).toBe(originalPurgeAt);

    const reentryClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(async () => ({
        historyId: '7300',
        history: [
          {
            id: '7250',
            labelsAdded: [{ message: { id: messageId }, labelIds: ['INBOX'] }],
          },
        ],
      })),
      getMessage: vi.fn(async () => gmailMessage(messageId, { body: 'Restored from Inbox again' })),
    };
    const reentered = await runOwnerGmailSync(
      ctx('req_archive_reentry', '2026-07-18T16:00:00.000Z'),
      {
        gmailClient: reentryClient,
        getAccessToken: tokenProvider(),
      },
    );
    expect(reentered.run.outcome).toBe('succeeded');
    expect(reentered.run.eventsCreated).toBe(0);
    expect(reentered.run.eventsUpdated).toBe(1);

    const afterReentry = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, event!.id);
    expect(afterReentry?.content).toBe('');
    expect(afterReentry?.byteLength).toBe(0);
    expect(afterReentry?.purgedAt).toBe(now);
    expect(afterReentry?.purgeAt).toBe(originalPurgeAt);
    await expect(
      db.prisma.communicationEvent.count({
        where: { organizationId: org, providerMessageId: messageId },
      }),
    ).resolves.toBe(1);
  });

  it('maps invalid history to resync_required', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '2000', historyState: 'valid' },
    });

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(async () => {
        throw new GmailSyncError('invalid_history');
      }),
      getMessage: vi.fn(),
    };

    const result = await runOwnerGmailSync(ctx('req_invalid_hist'), {
      gmailClient,
      getAccessToken: tokenProvider(),
    });

    expect(result.run.outcome).toBe('resync_required');
    expect(result.run.errorCode).toBe('invalid_history');
    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.status).toBe('resync_required');
    expect(account?.historyState).toBe('resync_required');
    expect(account?.historyId).toBe('2000');
  });

  it('leaves resync_required blocked without explicit reseed confirmation', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '8800', historyState: 'resync_required', status: 'resync_required' },
    });

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(),
      getMessage: vi.fn(),
    };

    const result = await runOwnerGmailSync(ctx('req_resync_blocked'), {
      gmailClient,
      getAccessToken: tokenProvider(),
    });

    expect(result.run.outcome).toBe('resync_required');
    expect(result.run.errorCode).toBe('resync_required');
    expect(result.run.historyIdBefore).toBe('8800');
    expect(result.run.historyIdAfter).toBe('8800');
    expect(gmailClient.getProfile).not.toHaveBeenCalled();
    expect(gmailClient.listHistory).not.toHaveBeenCalled();
    expect(gmailClient.getMessage).not.toHaveBeenCalled();

    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.status).toBe('resync_required');
    expect(account?.historyState).toBe('resync_required');
    expect(account?.historyId).toBe('8800');
    expect(result.run.eventsCreated).toBe(0);
    await expect(
      db.prisma.auditEvent.count({
        where: {
          organizationId: org,
          action: 'gmail_history_cursor_reseeded',
          requestId: 'req_resync_blocked',
        },
      }),
    ).resolves.toBe(0);
  });

  it('reseeds the history cursor when the Owner explicitly confirms the continuity gap', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '8800', historyState: 'resync_required', status: 'resync_required' },
    });

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(async () => ({ historyId: '9900' })),
      listHistory: vi.fn(),
      getMessage: vi.fn(),
    };
    const eventsBefore = await db.prisma.communicationEvent.count({
      where: { organizationId: org },
    });
    const excerptsBefore = await db.prisma.temporaryCommunicationExcerpt.count({
      where: { organizationId: org },
    });

    const result = await runOwnerGmailSync(
      ctx('req_reseed_ok'),
      { gmailClient, getAccessToken: tokenProvider() },
      { confirmHistoryCursorReseed: true },
    );

    expect(result.run.trigger).toBe('manual');
    expect(result.run.outcome).toBe('succeeded');
    expect(result.run.historyIdBefore).toBe('8800');
    expect(result.run.historyIdAfter).toBe('9900');
    expect(result.run.eventsCreated).toBe(0);
    expect(result.run.messagesExamined).toBe(0);
    expect(result.connection.status).toBe('connected');
    expect(result.connection.historyState).toBe('valid');
    expect(gmailClient.getProfile).toHaveBeenCalledTimes(1);
    expect(gmailClient.listHistory).not.toHaveBeenCalled();
    expect(gmailClient.getMessage).not.toHaveBeenCalled();

    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.status).toBe('connected');
    expect(account?.historyState).toBe('valid');
    expect(account?.historyId).toBe('9900');
    await expect(
      db.prisma.communicationEvent.count({ where: { organizationId: org } }),
    ).resolves.toBe(eventsBefore);
    await expect(
      db.prisma.temporaryCommunicationExcerpt.count({ where: { organizationId: org } }),
    ).resolves.toBe(excerptsBefore);

    const audit = await db.prisma.auditEvent.findFirst({
      where: {
        organizationId: org,
        action: 'gmail_history_cursor_reseeded',
        requestId: 'req_reseed_ok',
      },
    });
    expect(audit?.outcome).toBe('succeeded');
    expect(audit?.note).toBe('history cursor reseeded; continuity gap acknowledged');
    expect(audit?.gmailSyncRunId).toBe(result.run.id);
    expect(audit?.ownerId).toBe(owner.ownerId);
  });

  it('refuses explicit reseed when historyState is not resync_required', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '1000', historyState: 'valid', status: 'connected' },
    });

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(),
      getMessage: vi.fn(),
    };

    await expect(
      runOwnerGmailSync(
        ctx('req_reseed_wrong_state'),
        { gmailClient, getAccessToken: tokenProvider() },
        { confirmHistoryCursorReseed: true },
      ),
    ).rejects.toMatchObject({ code: 'conflict' });

    expect(gmailClient.getProfile).not.toHaveBeenCalled();
    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.historyId).toBe('1000');
    expect(account?.historyState).toBe('valid');
    await expect(
      db.prisma.auditEvent.count({
        where: {
          organizationId: org,
          action: 'gmail_history_cursor_reseeded',
          requestId: 'req_reseed_wrong_state',
        },
      }),
    ).resolves.toBe(0);
  });

  it('leaves resync_required and the stale cursor when getProfile fails during reseed', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '8800', historyState: 'resync_required', status: 'resync_required' },
    });

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(async () => {
        throw new GmailSyncError('network_failure');
      }),
      listHistory: vi.fn(),
      getMessage: vi.fn(),
    };

    const result = await runOwnerGmailSync(
      ctx('req_reseed_profile_fail'),
      { gmailClient, getAccessToken: tokenProvider() },
      { confirmHistoryCursorReseed: true },
    );

    expect(result.run.outcome).toBe('retryable_failure');
    expect(result.run.errorCode).toBe('network_failure');
    expect(result.run.retryable).toBe(true);
    expect(gmailClient.getProfile).toHaveBeenCalledTimes(1);

    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.status).toBe('resync_required');
    expect(account?.historyState).toBe('resync_required');
    expect(account?.historyId).toBe('8800');
    await expect(
      db.prisma.auditEvent.count({
        where: {
          organizationId: org,
          action: 'gmail_history_cursor_reseeded',
          requestId: 'req_reseed_profile_fail',
        },
      }),
    ).resolves.toBe(0);
  });

  it('starts later incremental sync from the reseeded cursor, not the abandoned one', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: '8800', historyState: 'resync_required', status: 'resync_required' },
    });

    const reseedClient: GmailApiClient = {
      getProfile: vi.fn(async () => ({ historyId: '9900' })),
      listHistory: vi.fn(),
      getMessage: vi.fn(),
    };
    const reseeded = await runOwnerGmailSync(
      ctx('req_reseed_then_inc'),
      { gmailClient: reseedClient, getAccessToken: tokenProvider() },
      { confirmHistoryCursorReseed: true },
    );
    expect(reseeded.run.historyIdAfter).toBe('9900');

    const incrementalClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(async () => ({
        historyId: '9950',
        history: [
          {
            id: '9925',
            messagesAdded: [{ message: { id: 'msg_after_reseed' } }],
          },
        ],
      })),
      getMessage: vi.fn(async () => inboxMessage('msg_after_reseed')),
    };
    const incremental = await runOwnerGmailSync(ctx('req_after_reseed'), {
      gmailClient: incrementalClient,
      getAccessToken: tokenProvider(),
    });

    expect(incremental.run.outcome).toBe('succeeded');
    expect(incremental.run.eventsCreated).toBe(1);
    expect(incrementalClient.listHistory).toHaveBeenCalledWith({
      accessToken: 'access_token_memory_only',
      startHistoryId: '9900',
      pageToken: undefined,
    });
    expect(incrementalClient.getProfile).not.toHaveBeenCalled();
    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.historyId).toBe('9950');
  });

  it('exits early for needs_reauth accounts without calling Gmail', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { status: 'needs_reauth', historyId: '3000', historyState: 'valid' },
    });

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(),
      getMessage: vi.fn(),
    };
    const getAccessToken = tokenProvider();

    const result = await runOwnerGmailSync(ctx('req_reauth'), {
      gmailClient,
      getAccessToken,
    });

    expect(result.run.outcome).toBe('needs_reauth');
    expect(result.run.errorCode).toBe('needs_reauth');
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(gmailClient.getProfile).not.toHaveBeenCalled();
    expect(gmailClient.listHistory).not.toHaveBeenCalled();
  });

  it('throws lock_conflict when a sync lock is already held', async () => {
    const lockUntil = new Date(new Date(now).getTime() + 60_000).toISOString();
    const lock = await acquireGmailSyncLock(
      db.prisma,
      org,
      accountId,
      lockUntil,
      now,
      'other_run_holding_lock',
    );
    expect(lock.acquired).toBe(true);

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(),
      listHistory: vi.fn(),
      getMessage: vi.fn(),
    };

    await expect(
      runOwnerGmailSync(ctx('req_lock'), {
        gmailClient,
        getAccessToken: tokenProvider(),
      }),
    ).rejects.toMatchObject({ code: 'lock_conflict' });

    expect(gmailClient.getProfile).not.toHaveBeenCalled();
  });

  it('returns lock_conflict for a concurrent second sync', async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    const gmailClient: GmailApiClient = {
      getProfile: vi.fn(async () => {
        await gate;
        return { historyId: '9000' };
      }),
      listHistory: vi.fn(),
      getMessage: vi.fn(),
    };
    const deps = { gmailClient, getAccessToken: tokenProvider() };

    const first = runOwnerGmailSync(ctx('req_concurrent_a'), deps);
    // Allow the first run to acquire the lock and block inside getProfile.
    await vi.waitFor(async () => {
      expect(gmailClient.getProfile).toHaveBeenCalled();
    });

    await expect(runOwnerGmailSync(ctx('req_concurrent_b'), deps)).rejects.toMatchObject({
      code: 'lock_conflict',
    });

    releaseGate();
    const firstResult = await first;
    expect(firstResult.run.outcome).toBe('succeeded');
    expect(firstResult.run.trigger).toBe('initial');
  });

  describe('persistence diagnostic taxonomy', () => {
    const cursorBefore = '5000';
    const sensitiveSql =
      'SELECT history_id FROM communication_accounts WHERE id = $1; postgres://owner:rt_secret@db/app';

    async function seedIncrementalCursor() {
      await db.prisma.communicationAccount.update({
        where: { id: accountId },
        data: { historyId: cursorBefore, historyState: 'valid', status: 'connected' },
      });
    }

    function incrementalClient(messageId: string): GmailApiClient {
      return {
        getProfile: vi.fn(),
        listHistory: vi.fn(async () => ({
          historyId: '5100',
          history: [{ id: '5050', messagesAdded: [{ message: { id: messageId } }] }],
        })),
        getMessage: vi.fn(async () => inboxMessage(messageId)),
      };
    }

    async function snapshotPersistence() {
      return {
        eventsBefore: await db.prisma.communicationEvent.count({
          where: { organizationId: org },
        }),
        excerptsBefore: await db.prisma.temporaryCommunicationExcerpt.count({
          where: { organizationId: org },
        }),
      };
    }

    async function expectFailedDiagnosticRun(input: {
      requestId: string;
      errorCode: 'persistence_validation' | 'database_failure' | 'transaction_failure';
      messageId: string;
      eventsBefore: number;
      excerptsBefore: number;
    }) {
      const account = await getCommunicationAccountByOrganization(db.prisma, org);
      expect(account?.historyId).toBe(cursorBefore);
      expect(account?.historyState).toBe('valid');
      expect(account?.status).toBe('connected');
      expect(account?.syncLockUntil).toBeNull();
      expect(account?.lastErrorCode).toBeNull();
      const locked = await db.prisma.communicationAccount.findUnique({ where: { id: accountId } });
      expect(locked?.syncLockUntil).toBeNull();
      expect(locked?.syncLockOwner).toBeNull();

      expect(
        await db.prisma.communicationEvent.count({
          where: { organizationId: org, providerMessageId: input.messageId },
        }),
      ).toBe(0);
      expect(await db.prisma.communicationEvent.count({ where: { organizationId: org } })).toBe(
        input.eventsBefore,
      );
      expect(
        await db.prisma.temporaryCommunicationExcerpt.count({
          where: { organizationId: org },
        }),
      ).toBe(input.excerptsBefore);

      const run = await db.prisma.gmailSyncRun.findFirst({
        where: { organizationId: org, requestId: input.requestId },
      });
      expect(run?.trigger).toBe('cron');
      expect(run?.outcome).toBe('retryable_failure');
      expect(run?.retryable).toBe(true);
      expect(run?.errorCode).toBe(input.errorCode);
      expect(run?.historyIdBefore).toBe(cursorBefore);
      expect(run?.historyIdAfter).toBeNull();
      expect(run?.messagesExamined).toBe(0);
      expect(run?.eventsCreated).toBe(0);
      expect(run?.eventsUpdated).toBe(0);
      expect(JSON.stringify(run)).not.toMatch(/SELECT |postgres:\/\/|rt_secret|ya29/i);
    }

    it('persists persistence_validation when D075 cursor compare-and-set refuses the page', async () => {
      await seedIncrementalCursor();
      installHistoryPersistOverride(async (input) =>
        aicaaDb.persistGmailHistoryPageTransaction({
          ...input,
          historyIdBefore: 'mismatched_cursor',
        }),
      );

      const messageId = 'msg_d075_diag';
      const snapshot = await snapshotPersistence();
      const result = await runGmailAccountSync(cronSyncContext('req_d075_diag'), {
        gmailClient: incrementalClient(messageId),
        getAccessToken: tokenProvider(),
      });

      expect(result.status).toBe('completed');
      if (result.status !== 'completed') {
        return;
      }
      expect(result.run.errorCode).toBe('persistence_validation');
      expect(result.run.outcome).toBe('retryable_failure');
      expect(result.run.retryable).toBe(true);
      expect(result.connection.status).toBe('connected');
      await expectFailedDiagnosticRun({
        requestId: 'req_d075_diag',
        errorCode: 'persistence_validation',
        messageId,
        ...snapshot,
      });
    });

    it('persists persistence_validation for optimistic-concurrency abort without writing events', async () => {
      await seedIncrementalCursor();
      installHistoryPersistOverride(async () => {
        throw persistenceShapedError(
          'OPTIMISTIC_CONCURRENCY',
          `cursor generation changed; ${sensitiveSql}`,
        );
      });

      const messageId = 'msg_occ_diag';
      const snapshot = await snapshotPersistence();
      const result = await runGmailAccountSync(cronSyncContext('req_occ_diag'), {
        gmailClient: incrementalClient(messageId),
        getAccessToken: tokenProvider(),
      });

      expect(result.status).toBe('completed');
      if (result.status !== 'completed') {
        return;
      }
      expect(result.run.errorCode).toBe('persistence_validation');
      await expectFailedDiagnosticRun({
        requestId: 'req_occ_diag',
        errorCode: 'persistence_validation',
        messageId,
        ...snapshot,
      });
    });

    it('persists database_failure for Prisma known-request errors without storing the P-code or SQL', async () => {
      await seedIncrementalCursor();
      installHistoryPersistOverride(async () => {
        throw prismaShapedError(
          'P2028',
          `Transaction API error P2028: expired transaction. ${sensitiveSql} token=ya29.access`,
        );
      });

      const messageId = 'msg_p2028_diag';
      const snapshot = await snapshotPersistence();
      const result = await runGmailAccountSync(cronSyncContext('req_p2028_diag'), {
        gmailClient: incrementalClient(messageId),
        getAccessToken: tokenProvider(),
      });

      expect(result.status).toBe('completed');
      if (result.status !== 'completed') {
        return;
      }
      expect(result.run.errorCode).toBe('database_failure');
      expect(result.run.errorCode).not.toBe('P2028');
      await expectFailedDiagnosticRun({
        requestId: 'req_p2028_diag',
        errorCode: 'database_failure',
        messageId,
        ...snapshot,
      });
    });

    it('persists transaction_failure for TRANSACTION_FAILED without storing SQL', async () => {
      await seedIncrementalCursor();
      installHistoryPersistOverride(async () => {
        throw persistenceShapedError(
          'TRANSACTION_FAILED',
          `interactive transaction failed: ${sensitiveSql}`,
        );
      });

      const messageId = 'msg_tx_diag';
      const snapshot = await snapshotPersistence();
      const result = await runGmailAccountSync(cronSyncContext('req_tx_diag'), {
        gmailClient: incrementalClient(messageId),
        getAccessToken: tokenProvider(),
      });

      expect(result.status).toBe('completed');
      if (result.status !== 'completed') {
        return;
      }
      expect(result.run.errorCode).toBe('transaction_failure');
      await expectFailedDiagnosticRun({
        requestId: 'req_tx_diag',
        errorCode: 'transaction_failure',
        messageId,
        ...snapshot,
      });
    });

    describe('safe Prisma runtime diagnostics at the sync failure boundary', () => {
      const originalFlag = process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV];
      const originalDatabaseUrl = process.env.DATABASE_URL;
      const leakyPrismaMessage = [
        'Transaction API error P2028: expired transaction.',
        sensitiveSql,
        'token=ya29.access',
        'gmail body: Hello from Gmail secret inbox',
        'super_secret_value',
      ].join(' ');
      let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        delete process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV];
        process.env.DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/DATABASE';
      });

      afterEach(() => {
        consoleErrorSpy.mockRestore();
        if (originalFlag === undefined) {
          delete process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV];
        } else {
          process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = originalFlag;
        }
        if (originalDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = originalDatabaseUrl;
        }
      });

      function emittedDiagnosticLines(): string[] {
        return consoleErrorSpy.mock.calls
          .map((call) => String(call[0]))
          .filter((line) => line.includes('database_runtime_failure'));
      }

      it('keeps Prisma classification and stays silent when diagnostics are OFF', async () => {
        await seedIncrementalCursor();
        installHistoryPersistOverride(async () => {
          throw prismaShapedError('P2028', leakyPrismaMessage);
        });

        const result = await runGmailAccountSync(cronSyncContext('req_p2028_diag_off'), {
          gmailClient: incrementalClient('msg_p2028_diag_off'),
          getAccessToken: tokenProvider(),
        });

        expect(result.status).toBe('completed');
        if (result.status !== 'completed') {
          return;
        }
        expect(result.run.errorCode).toBe('database_failure');
        expect(result.run.outcome).toBe('retryable_failure');
        expect(result.run.retryable).toBe(true);
        expect(emittedDiagnosticLines()).toEqual([]);
      });

      it('emits a redacted Prisma P-code when diagnostics are ON without changing retryability', async () => {
        process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
        await seedIncrementalCursor();
        const prismaError = prismaShapedError('P2028', leakyPrismaMessage);
        Object.assign(prismaError, { clientVersion: '6.19.3' });
        installHistoryPersistOverride(async () => {
          throw prismaError;
        });

        const result = await runGmailAccountSync(cronSyncContext('req_p2028_diag_on'), {
          gmailClient: incrementalClient('msg_p2028_diag_on'),
          getAccessToken: tokenProvider(),
        });

        expect(result.status).toBe('completed');
        if (result.status !== 'completed') {
          return;
        }
        expect(result.run.errorCode).toBe('database_failure');
        expect(result.run.errorCode).not.toBe('P2028');
        expect(result.run.outcome).toBe('retryable_failure');
        expect(result.run.retryable).toBe(true);

        const lines = emittedDiagnosticLines();
        expect(lines).toHaveLength(1);
        const payload = JSON.parse(lines[0]!) as {
          event: string;
          prismaErrorClass?: string;
          prismaErrorCode?: string;
          clientVersion?: string;
          requestId?: string;
          message?: string;
          stack?: string;
        };
        expect(payload.event).toBe('database_runtime_failure');
        expect(payload.prismaErrorClass).toBe('PrismaClientKnownRequestError');
        expect(payload.prismaErrorCode).toBe('P2028');
        expect(payload.clientVersion).toBe('6.19.3');
        expect(payload.requestId).toBe('req_p2028_diag_on');
        expect(payload).not.toHaveProperty('message');
        expect(payload).not.toHaveProperty('stack');
        expect(lines[0]).not.toMatch(
          /postgres:\/\/|postgresql:\/\/|SELECT |ya29|Hello from Gmail|super_secret_value|rt_secret|PASSWORD/i,
        );
      });

      it('does not emit diagnostics for persistence_validation, GmailSyncError, GmailConfigError, or token encryption errors', async () => {
        process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
        await seedIncrementalCursor();

        const cases: Array<{
          requestId: string;
          throwError: Error;
          errorCode: 'persistence_validation' | 'malformed_message' | 'configuration_error';
          retryable: boolean;
        }> = [
          {
            requestId: 'req_diag_validation',
            throwError: persistenceShapedError(
              'OPTIMISTIC_CONCURRENCY',
              `cursor generation changed; ${leakyPrismaMessage}`,
            ),
            errorCode: 'persistence_validation',
            retryable: true,
          },
          {
            requestId: 'req_diag_malformed',
            throwError: new GmailSyncError('malformed_message'),
            errorCode: 'malformed_message',
            retryable: false,
          },
          {
            requestId: 'req_diag_config',
            throwError: new GmailConfigError('GOOGLE_GMAIL_CLIENT_SECRET is required.'),
            errorCode: 'configuration_error',
            retryable: false,
          },
          {
            requestId: 'req_diag_token',
            throwError: new TokenEncryptionError('Token cryptographic operation failed.'),
            errorCode: 'configuration_error',
            retryable: false,
          },
        ];

        for (const testCase of cases) {
          consoleErrorSpy.mockClear();
          installHistoryPersistOverride(async () => {
            throw testCase.throwError;
          });

          const result = await runGmailAccountSync(cronSyncContext(testCase.requestId), {
            gmailClient: incrementalClient(`msg_${testCase.requestId}`),
            getAccessToken: tokenProvider(),
          });

          expect(result.status).toBe('completed');
          if (result.status !== 'completed') {
            return;
          }
          expect(result.run.errorCode).toBe(testCase.errorCode);
          expect(result.run.retryable).toBe(testCase.retryable);
          expect(result.run.outcome).toBe(
            testCase.retryable ? 'retryable_failure' : 'permanent_failure',
          );
          expect(emittedDiagnosticLines()).toEqual([]);
        }
      });
    });
  });
});
