import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DomainError,
  GMAIL_READONLY_SCOPE,
  MAX_GMAIL_EXCERPT_BYTES,
  asCommunicationAccountId,
  asCommunicationEventId,
  asGmailSyncRunId,
  asTemporaryCommunicationExcerptId,
  type ParsedGmailMessageFixture,
} from '@aicaa/domain';
import {
  PersistenceError,
  acquireGmailSyncLock,
  createAuditEvent,
  createGmailSyncRun,
  createOrUpdatePendingCommunicationAccount,
  disconnectCommunicationAccount,
  finishGmailSyncRun,
  getCommunicationAccountByOrganization,
  getCommunicationEventByProviderMessageId,
  getGmailOAuthCredentialByAccountId,
  getTemporaryCommunicationExcerptByEventId,
  listRecentGmailSyncRuns,
  markCommunicationAccountResyncRequired,
  persistConnectedCommunicationAccount,
  persistEncryptedGmailCredential,
  persistGmailHistoryPageTransaction,
  purgeTemporaryCommunicationExcerpt,
  releaseGmailSyncLock,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const orgA = 'org_gmail_a';
const orgB = 'org_gmail_b';
const now = '2026-07-16T12:00:00.000Z';
const later = '2026-07-16T12:05:00.000Z';
const purgeAt = '2026-07-23T12:00:00.000Z';

function inboxMessage(
  overrides: Partial<ParsedGmailMessageFixture> &
    Pick<ParsedGmailMessageFixture, 'eventId' | 'providerMessageId'>,
): ParsedGmailMessageFixture {
  return {
    providerThreadId: 'thread_1',
    internalDate: now,
    fromAddress: 'sender@example.com',
    toAddresses: ['owner@acme.example'],
    subject: 'Hello',
    snippet: 'Body preview',
    labelIds: ['INBOX'],
    hasAttachments: false,
    attachmentMetadata: [],
    ...overrides,
  };
}

describe('A5 Gmail persistence repositories (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('enforces one Gmail account per organization', async () => {
    await createOrUpdatePendingCommunicationAccount(db.prisma, {
      organizationId: orgA,
      accountId: 'acct_a1',
      emailAddress: 'owner@acme.example',
      externalAccountId: 'google-sub-a',
    });

    await expect(
      createOrUpdatePendingCommunicationAccount(db.prisma, {
        organizationId: orgA,
        accountId: 'acct_a2',
        emailAddress: 'other@acme.example',
        externalAccountId: 'google-sub-b',
      }),
    ).rejects.toBeInstanceOf(PersistenceError);

    await createOrUpdatePendingCommunicationAccount(db.prisma, {
      organizationId: orgB,
      accountId: 'acct_b1',
      emailAddress: 'owner@other.example',
      externalAccountId: 'google-sub-c',
    });
  });

  it('persists ciphertext credentials and wipes them on disconnect', async () => {
    const account = await persistConnectedCommunicationAccount(db.prisma, {
      organizationId: orgA,
      accountId: 'acct_a1',
      emailAddress: 'owner@acme.example',
      externalAccountId: 'google-sub-a',
      connectedAt: now,
      historyId: null,
    });

    await persistEncryptedGmailCredential(db.prisma, {
      id: 'cred_a1',
      accountId: account.id,
      organizationId: orgA,
      encryptedRefreshToken: 'cipher_refresh_v1',
      encryptedAccessToken: 'cipher_access_v1',
      accessTokenExpiresAt: later,
      grantedScopes: GMAIL_READONLY_SCOPE,
      tokenType: 'Bearer',
      encryptionKeyVersion: 'v1',
    });

    const stored = await getGmailOAuthCredentialByAccountId(db.prisma, orgA, account.id);
    expect(stored?.encryptedRefreshToken).toBe('cipher_refresh_v1');
    expect(stored?.encryptedAccessToken).toBe('cipher_access_v1');

    await disconnectCommunicationAccount(db.prisma, orgA, account.id, later);
    expect(await getGmailOAuthCredentialByAccountId(db.prisma, orgA, account.id)).toBeNull();
    const disconnected = await getCommunicationAccountByOrganization(db.prisma, orgA);
    expect(disconnected?.status).toBe('disconnected');
  });

  it('advances history cursor only when the page transaction commits (D075)', async () => {
    await createOrUpdatePendingCommunicationAccount(db.prisma, {
      organizationId: orgA,
      accountId: 'acct_a1',
      emailAddress: 'owner@acme.example',
      externalAccountId: 'google-sub-a',
    });
    await persistConnectedCommunicationAccount(db.prisma, {
      organizationId: orgA,
      accountId: 'acct_a1',
      emailAddress: 'owner@acme.example',
      externalAccountId: 'google-sub-a',
      connectedAt: now,
      historyId: null,
    });

    const run = await createGmailSyncRun(db.prisma, {
      id: 'run_1',
      organizationId: orgA,
      accountId: 'acct_a1',
      trigger: 'initial',
      startedAt: now,
      historyIdBefore: null,
      requestId: 'req_1',
    });

    const message = inboxMessage({
      eventId: asCommunicationEventId('evt_1'),
      providerMessageId: 'msg_1',
      excerptId: asTemporaryCommunicationExcerptId('ex_1'),
      excerptContent: 'temporary excerpt',
      excerptPurgeAt: purgeAt,
    });

    const page = await persistGmailHistoryPageTransaction({
      db: db.prisma,
      organizationId: orgA,
      accountId: 'acct_a1',
      historyIdBefore: null,
      historyIdAfter: 'hist_100',
      ingestRunId: run.id,
      syncedAt: later,
      messages: [message],
    });

    expect(page.eventsCreated).toBe(1);
    expect(page.account.historyId).toBe('hist_100');
    expect(page.account.historyState).toBe('valid');

    const event = await getCommunicationEventByProviderMessageId(db.prisma, orgA, 'msg_1');
    expect(event?.dedupeKey).toBe('gmail:msg_1');
    const excerpt = await getTemporaryCommunicationExcerptByEventId(db.prisma, orgA, 'evt_1');
    expect(excerpt?.content).toBe('temporary excerpt');
    expect(excerpt?.purgedAt).toBeNull();

    await finishGmailSyncRun(db.prisma, {
      organizationId: orgA,
      runId: run.id,
      outcome: 'succeeded',
      finishedAt: later,
      historyIdAfter: 'hist_100',
      messagesExamined: 1,
      eventsCreated: 1,
      eventsUpdated: 0,
      messagesSkipped: 0,
    });
  });

  it('leaves history cursor unchanged when the page transaction fails', async () => {
    const before = await getCommunicationAccountByOrganization(db.prisma, orgA);
    expect(before?.historyId).toBe('hist_100');

    await expect(
      persistGmailHistoryPageTransaction({
        db: db.prisma,
        organizationId: orgA,
        accountId: 'acct_a1',
        historyIdBefore: 'wrong_cursor',
        historyIdAfter: 'hist_999',
        ingestRunId: 'run_fail',
        syncedAt: later,
        messages: [
          inboxMessage({
            eventId: asCommunicationEventId('evt_fail'),
            providerMessageId: 'msg_fail',
          }),
        ],
      }),
    ).rejects.toBeInstanceOf(PersistenceError);

    const after = await getCommunicationAccountByOrganization(db.prisma, orgA);
    expect(after?.historyId).toBe('hist_100');
    expect(await getCommunicationEventByProviderMessageId(db.prisma, orgA, 'msg_fail')).toBeNull();
  });

  it('retries the same page without duplicating events', async () => {
    const page = await persistGmailHistoryPageTransaction({
      db: db.prisma,
      organizationId: orgA,
      accountId: 'acct_a1',
      historyIdBefore: 'hist_100',
      historyIdAfter: 'hist_200',
      ingestRunId: 'run_2',
      syncedAt: later,
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId('evt_1_retry'),
          providerMessageId: 'msg_1',
          subject: 'Hello again',
          labelIds: ['SENT'],
        }),
        inboxMessage({
          eventId: asCommunicationEventId('evt_skip'),
          providerMessageId: 'msg_sent',
          labelIds: ['SENT'],
        }),
      ],
    });

    expect(page.eventsCreated).toBe(0);
    expect(page.eventsUpdated).toBe(1);
    expect(page.messagesSkipped).toBe(1);
    expect(page.account.historyId).toBe('hist_200');

    const count = await db.prisma.communicationEvent.count({
      where: { organizationId: orgA, providerMessageId: 'msg_1' },
    });
    expect(count).toBe(1);
    const updated = await getCommunicationEventByProviderMessageId(db.prisma, orgA, 'msg_1');
    expect(updated?.labelIds).toEqual(['SENT']);
    expect(updated?.subject).toBe('Hello again');

    // Leave-Inbox: durable event retained; TemporaryCommunicationExcerpt promptly purged.
    const excerpt = await getTemporaryCommunicationExcerptByEventId(db.prisma, orgA, 'evt_1');
    expect(excerpt?.content).toBe('');
    expect(excerpt?.byteLength).toBe(0);
    expect(excerpt?.purgedAt).toBe(later);
  });

  it('marks resync_required without silently resetting the cursor (D076)', async () => {
    const marked = await markCommunicationAccountResyncRequired(
      db.prisma,
      orgA,
      'acct_a1',
      'gmail_history_invalid',
      later,
    );
    expect(marked.status).toBe('resync_required');
    expect(marked.historyState).toBe('resync_required');
    expect(marked.historyId).toBe('hist_200');
    expect(marked.lastErrorCode).toBe('gmail_history_invalid');
  });

  it('acquires and releases sync locks with overlap reporting', async () => {
    await persistConnectedCommunicationAccount(db.prisma, {
      organizationId: orgA,
      accountId: 'acct_a1',
      emailAddress: 'owner@acme.example',
      externalAccountId: 'google-sub-a',
      connectedAt: now,
      historyId: 'hist_200',
    });

    const first = await acquireGmailSyncLock(
      db.prisma,
      orgA,
      'acct_a1',
      '2026-07-16T12:10:00.000Z',
      later,
      'lock_owner_1',
    );
    expect(first.acquired).toBe(true);

    const second = await acquireGmailSyncLock(
      db.prisma,
      orgA,
      'acct_a1',
      '2026-07-16T12:15:00.000Z',
      later,
      'lock_owner_2',
    );
    expect(second.acquired).toBe(false);

    const wrongRelease = await releaseGmailSyncLock(
      db.prisma,
      orgA,
      'acct_a1',
      'lock_owner_2',
      later,
    );
    expect(wrongRelease.released).toBe(false);

    const rightRelease = await releaseGmailSyncLock(
      db.prisma,
      orgA,
      'acct_a1',
      'lock_owner_1',
      later,
    );
    expect(rightRelease.released).toBe(true);

    const third = await acquireGmailSyncLock(
      db.prisma,
      orgA,
      'acct_a1',
      '2026-07-16T12:20:00.000Z',
      later,
      'lock_owner_3',
    );
    expect(third.acquired).toBe(true);
    await releaseGmailSyncLock(db.prisma, orgA, 'acct_a1', 'lock_owner_3', later);

    // Expired lock can be reclaimed by a new owner.
    await acquireGmailSyncLock(
      db.prisma,
      orgA,
      'acct_a1',
      '2026-07-16T12:01:00.000Z',
      '2026-07-16T12:00:00.000Z',
      'lock_expired',
    );
    const reclaim = await acquireGmailSyncLock(
      db.prisma,
      orgA,
      'acct_a1',
      '2026-07-16T12:30:00.000Z',
      later,
      'lock_reclaim',
    );
    expect(reclaim.acquired).toBe(true);
    await releaseGmailSyncLock(db.prisma, orgA, 'acct_a1', 'lock_reclaim', later);
  });

  it('supports excerpt purge state and sync-run listing', async () => {
    // Leave-Inbox already purged evt_1; re-purge is idempotent for content clearing.
    const purged = await purgeTemporaryCommunicationExcerpt(db.prisma, orgA, 'evt_1', later);
    expect(purged.content).toBe('');
    expect(purged.byteLength).toBe(0);
    expect(purged.purgedAt).toBe(later);

    const run = await createGmailSyncRun(db.prisma, {
      id: asGmailSyncRunId('run_list'),
      organizationId: orgA,
      accountId: asCommunicationAccountId('acct_a1'),
      trigger: 'cron',
      startedAt: later,
      historyIdBefore: 'hist_200',
      requestId: 'req_list',
    });
    await finishGmailSyncRun(db.prisma, {
      organizationId: orgA,
      runId: run.id,
      outcome: 'skipped_locked',
      finishedAt: later,
      retryable: true,
      errorCode: 'sync_lock_held',
    });

    const runs = await listRecentGmailSyncRuns(db.prisma, orgA, 10);
    expect(runs.some((r) => r.id === 'run_list')).toBe(true);
  });

  it('records system audit actors for Gmail polling (D074)', async () => {
    const audit = await createAuditEvent(db.prisma, {
      id: 'aud_gmail_1',
      organizationId: orgA,
      actorKind: 'system',
      systemId: 'gmail_poll',
      communicationAccountId: 'acct_a1',
      gmailSyncRunId: 'run_1',
      action: 'gmail_poll',
      outcome: 'succeeded',
      recordedAt: later,
      requestId: 'req_poll',
    });
    expect(audit.actorKind).toBe('system');
    expect(audit.systemId).toBe('gmail_poll');
    expect(audit.ownerId).toBeUndefined();
  });

  it('keeps communication events isolated by organization', async () => {
    expect(await getCommunicationEventByProviderMessageId(db.prisma, orgB, 'msg_1')).toBeNull();
    const orgAEvent = await getCommunicationEventByProviderMessageId(db.prisma, orgA, 'msg_1');
    expect(orgAEvent?.organizationId).toBe(orgA);
    const orgBRuns = await listRecentGmailSyncRuns(db.prisma, orgB, 10);
    expect(orgBRuns.every((run) => run.organizationId === orgB)).toBe(true);
    expect(orgBRuns.some((run) => run.organizationId === orgA)).toBe(false);
  });

  it('persists an eligible multi-message page atomically and retries duplicate provider IDs', async () => {
    const orgC = 'org_gmail_c';
    await createOrUpdatePendingCommunicationAccount(db.prisma, {
      organizationId: orgC,
      accountId: 'acct_c1',
      emailAddress: 'owner@c.example',
      externalAccountId: 'google-sub-c-page',
    });
    await persistConnectedCommunicationAccount(db.prisma, {
      organizationId: orgC,
      accountId: 'acct_c1',
      emailAddress: 'owner@c.example',
      externalAccountId: 'google-sub-c-page',
      connectedAt: now,
      historyId: 'hist_c0',
    });

    const first = await persistGmailHistoryPageTransaction({
      db: db.prisma,
      organizationId: orgC,
      accountId: 'acct_c1',
      historyIdBefore: 'hist_c0',
      historyIdAfter: 'hist_c1',
      ingestRunId: 'run_c_multi',
      syncedAt: later,
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId('evt_c1'),
          providerMessageId: 'msg_c1',
          excerptId: asTemporaryCommunicationExcerptId('ex_c1'),
          excerptContent: 'first excerpt',
          excerptPurgeAt: purgeAt,
        }),
        inboxMessage({
          eventId: asCommunicationEventId('evt_c2'),
          providerMessageId: 'msg_c2',
          excerptId: asTemporaryCommunicationExcerptId('ex_c2'),
          excerptContent: 'second excerpt',
          excerptPurgeAt: purgeAt,
        }),
        inboxMessage({
          eventId: asCommunicationEventId('evt_c1_dup'),
          providerMessageId: 'msg_c1',
          subject: 'Hello again',
          excerptId: asTemporaryCommunicationExcerptId('ex_c1_dup'),
          excerptContent: 'duplicate-id excerpt',
          excerptPurgeAt: purgeAt,
        }),
      ],
    });

    expect(first.eventsCreated).toBe(2);
    expect(first.eventsUpdated).toBe(1);
    expect(first.account.historyId).toBe('hist_c1');
    expect(await db.prisma.communicationEvent.count({ where: { organizationId: orgC } })).toBe(2);
    const updated = await getCommunicationEventByProviderMessageId(db.prisma, orgC, 'msg_c1');
    expect(updated?.subject).toBe('Hello again');
    expect(updated?.id).toBe('evt_c1');
    const excerpt = await getTemporaryCommunicationExcerptByEventId(db.prisma, orgC, 'evt_c1');
    expect(excerpt?.content).toBe('duplicate-id excerpt');
    expect(excerpt?.purgedAt).toBeNull();
    expect(await getCommunicationEventByProviderMessageId(db.prisma, orgA, 'msg_c1')).toBeNull();
  });

  it('does not advance the cursor when later page persistence fails', async () => {
    const orgD = 'org_gmail_d';
    await createOrUpdatePendingCommunicationAccount(db.prisma, {
      organizationId: orgD,
      accountId: 'acct_d1',
      emailAddress: 'owner@d.example',
      externalAccountId: 'google-sub-d-page',
    });
    await persistConnectedCommunicationAccount(db.prisma, {
      organizationId: orgD,
      accountId: 'acct_d1',
      emailAddress: 'owner@d.example',
      externalAccountId: 'google-sub-d-page',
      connectedAt: now,
      historyId: 'hist_d0',
    });

    await expect(
      persistGmailHistoryPageTransaction({
        db: db.prisma,
        organizationId: orgD,
        accountId: 'acct_d1',
        historyIdBefore: 'hist_d0',
        historyIdAfter: 'hist_d_fail',
        ingestRunId: 'run_d_fail',
        syncedAt: later,
        messages: [
          inboxMessage({
            eventId: asCommunicationEventId('evt_d_ok'),
            providerMessageId: 'msg_d_ok',
          }),
          inboxMessage({
            eventId: asCommunicationEventId('evt_d_fail'),
            providerMessageId: 'msg_d_fail',
            excerptId: asTemporaryCommunicationExcerptId('ex_d_fail'),
            excerptContent: 'x'.repeat(MAX_GMAIL_EXCERPT_BYTES + 1),
            excerptPurgeAt: purgeAt,
          }),
        ],
      }),
    ).rejects.toBeInstanceOf(DomainError);

    const after = await getCommunicationAccountByOrganization(db.prisma, orgD);
    expect(after?.historyId).toBe('hist_d0');
    expect(await getCommunicationEventByProviderMessageId(db.prisma, orgD, 'msg_d_ok')).toBeNull();
    expect(
      await getCommunicationEventByProviderMessageId(db.prisma, orgD, 'msg_d_fail'),
    ).toBeNull();
  });
});
