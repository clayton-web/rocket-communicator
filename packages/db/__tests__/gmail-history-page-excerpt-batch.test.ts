/**
 * Gmail history-page excerpt batch persistence.
 *
 * Eligible excerpt writes are page-level: one prefetch, one createMany for new rows, and
 * per-existing-row updateMany only while purgedAt is null. PGlite covers atomicity.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DomainError,
  MAX_GMAIL_EXCERPT_BYTES,
  asCommunicationEventId,
  asTemporaryCommunicationExcerptId,
  measureExcerptByteLength,
  type ParsedGmailMessageFixture,
} from '@aicaa/domain';
import {
  PersistenceError,
  createOrUpdatePendingCommunicationAccount,
  getCommunicationAccountByOrganization,
  getCommunicationEventByProviderMessageId,
  getTemporaryCommunicationExcerptByEventId,
  persistConnectedCommunicationAccount,
  persistGmailHistoryPageTransaction,
  purgeTemporaryCommunicationExcerpt,
  upsertCommunicationEvent,
  upsertTemporaryCommunicationExcerpt,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const org = 'org_gmail_excerpt_batch';
const otherOrg = 'org_gmail_excerpt_batch_other';
const accountId = 'acct_gmail_excerpt_batch';
const otherAccountId = 'acct_gmail_excerpt_batch_other';
const now = '2026-08-17T00:00:00.000Z';
const later = '2026-08-17T01:00:00.000Z';
const purgeAt = '2026-08-24T00:00:00.000Z';
const laterPurgeAt = '2026-08-31T00:00:00.000Z';

function inboxMessage(
  overrides: Partial<ParsedGmailMessageFixture> &
    Pick<ParsedGmailMessageFixture, 'eventId' | 'providerMessageId'>,
): ParsedGmailMessageFixture {
  return {
    providerThreadId: `thread_${overrides.providerMessageId}`,
    internalDate: now,
    fromAddress: 'sender@example.com',
    toAddresses: ['owner@example.com'],
    subject: 'Hello',
    snippet: 'Body preview',
    labelIds: ['INBOX'],
    hasAttachments: false,
    attachmentMetadata: [],
    ...overrides,
  };
}

describe('Gmail history-page excerpt batch persistence (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await createOrUpdatePendingCommunicationAccount(db.prisma, {
      organizationId: org,
      accountId,
      emailAddress: 'owner@batch.example',
      externalAccountId: 'google-excerpt-batch',
    });
    await persistConnectedCommunicationAccount(db.prisma, {
      organizationId: org,
      accountId,
      emailAddress: 'owner@batch.example',
      externalAccountId: 'google-excerpt-batch',
      connectedAt: now,
      historyId: 'hist_0',
    });
    await createOrUpdatePendingCommunicationAccount(db.prisma, {
      organizationId: otherOrg,
      accountId: otherAccountId,
      emailAddress: 'owner@other.example',
      externalAccountId: 'google-excerpt-batch-other',
    });
    await persistConnectedCommunicationAccount(db.prisma, {
      organizationId: otherOrg,
      accountId: otherAccountId,
      emailAddress: 'owner@other.example',
      externalAccountId: 'google-excerpt-batch-other',
      connectedAt: now,
      historyId: 'hist_other_0',
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates multiple new eligible excerpts in one page commit', async () => {
    const page = await persistGmailHistoryPageTransaction({
      db: db.prisma,
      organizationId: org,
      accountId,
      historyIdBefore: 'hist_0',
      historyIdAfter: 'hist_new',
      ingestRunId: 'run_new',
      syncedAt: later,
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId('evt_new_a'),
          providerMessageId: 'msg_new_a',
          excerptId: asTemporaryCommunicationExcerptId('ex_new_a'),
          excerptContent: 'new excerpt a',
          excerptPurgeAt: purgeAt,
        }),
        inboxMessage({
          eventId: asCommunicationEventId('evt_new_b'),
          providerMessageId: 'msg_new_b',
          excerptId: asTemporaryCommunicationExcerptId('ex_new_b'),
          excerptContent: 'new excerpt b',
          excerptPurgeAt: purgeAt,
        }),
      ],
    });

    expect(page.eventsCreated).toBe(2);
    expect(page.account.historyId).toBe('hist_new');

    const excerptA = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_new_a');
    const excerptB = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_new_b');
    expect(excerptA).toMatchObject({
      id: 'ex_new_a',
      content: 'new excerpt a',
      byteLength: measureExcerptByteLength('new excerpt a'),
      purgeAt,
      purgedAt: null,
    });
    expect(excerptB).toMatchObject({
      id: 'ex_new_b',
      content: 'new excerpt b',
      byteLength: measureExcerptByteLength('new excerpt b'),
      purgeAt,
      purgedAt: null,
    });
  });

  it('updates only content and byteLength on an existing unpurged excerpt', async () => {
    const eventId = 'evt_refresh';
    await upsertCommunicationEvent(db.prisma, {
      organizationId: org,
      accountId,
      message: inboxMessage({
        eventId: asCommunicationEventId(eventId),
        providerMessageId: 'msg_refresh',
      }),
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: eventId,
      excerptId: 'ex_refresh',
      content: 'original body',
      purgeAt,
    });

    const page = await persistGmailHistoryPageTransaction({
      db: db.prisma,
      organizationId: org,
      accountId,
      historyIdBefore: 'hist_new',
      historyIdAfter: 'hist_refresh',
      ingestRunId: 'run_refresh',
      syncedAt: later,
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId('evt_refresh_ignored'),
          providerMessageId: 'msg_refresh',
          excerptId: asTemporaryCommunicationExcerptId('ex_refresh_ignored'),
          excerptContent: 'refreshed body',
          excerptPurgeAt: laterPurgeAt,
        }),
      ],
    });

    expect(page.eventsUpdated).toBe(1);
    const excerpt = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, eventId);
    expect(excerpt?.id).toBe('ex_refresh');
    expect(excerpt?.content).toBe('refreshed body');
    expect(excerpt?.byteLength).toBe(measureExcerptByteLength('refreshed body'));
    expect(excerpt?.purgeAt).toBe(purgeAt);
    expect(excerpt?.purgedAt).toBeNull();
  });

  it('does not resurrect an already-purged excerpt and still advances the page', async () => {
    const eventId = 'evt_purged';
    await upsertCommunicationEvent(db.prisma, {
      organizationId: org,
      accountId,
      message: inboxMessage({
        eventId: asCommunicationEventId(eventId),
        providerMessageId: 'msg_purged',
      }),
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: eventId,
      excerptId: 'ex_purged',
      content: 'body that will be purged',
      purgeAt,
    });
    await purgeTemporaryCommunicationExcerpt(db.prisma, org, eventId, later);
    const before = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, eventId);

    const page = await persistGmailHistoryPageTransaction({
      db: db.prisma,
      organizationId: org,
      accountId,
      historyIdBefore: 'hist_refresh',
      historyIdAfter: 'hist_purged',
      ingestRunId: 'run_purged',
      syncedAt: '2026-08-17T02:00:00.000Z',
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId(eventId),
          providerMessageId: 'msg_purged',
          subject: 'Hello after archive',
          excerptId: asTemporaryCommunicationExcerptId('ex_purged_new'),
          excerptContent: 'restored body must not land',
          excerptPurgeAt: laterPurgeAt,
        }),
      ],
    });

    expect(page.eventsUpdated).toBe(1);
    expect(page.account.historyId).toBe('hist_purged');
    const event = await getCommunicationEventByProviderMessageId(db.prisma, org, 'msg_purged');
    expect(event?.subject).toBe('Hello after archive');

    const after = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, eventId);
    expect(after?.id).toBe(before?.id);
    expect(after?.content).toBe('');
    expect(after?.byteLength).toBe(0);
    expect(after?.purgedAt).toBe(later);
    expect(after?.purgeAt).toBe(purgeAt);
  });

  it('keeps the first excerpt id and last content for a duplicate provider message', async () => {
    const page = await persistGmailHistoryPageTransaction({
      db: db.prisma,
      organizationId: org,
      accountId,
      historyIdBefore: 'hist_purged',
      historyIdAfter: 'hist_dup',
      ingestRunId: 'run_dup',
      syncedAt: later,
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId('evt_dup'),
          providerMessageId: 'msg_dup',
          excerptId: asTemporaryCommunicationExcerptId('ex_dup_first'),
          excerptContent: 'first body',
          excerptPurgeAt: purgeAt,
        }),
        inboxMessage({
          eventId: asCommunicationEventId('evt_dup_ignored'),
          providerMessageId: 'msg_dup',
          subject: 'Hello again',
          excerptId: asTemporaryCommunicationExcerptId('ex_dup_last'),
          excerptContent: 'last body',
          excerptPurgeAt: laterPurgeAt,
        }),
      ],
    });

    expect(page.eventsCreated).toBe(1);
    expect(page.eventsUpdated).toBe(1);
    const event = await getCommunicationEventByProviderMessageId(db.prisma, org, 'msg_dup');
    expect(event?.id).toBe('evt_dup');
    expect(event?.subject).toBe('Hello again');
    const excerpt = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_dup');
    expect(excerpt?.id).toBe('ex_dup_first');
    expect(excerpt?.content).toBe('last body');
    expect(excerpt?.byteLength).toBe(measureExcerptByteLength('last body'));
    expect(excerpt?.purgeAt).toBe(purgeAt);
    expect(excerpt?.purgedAt).toBeNull();
  });

  it('fails closed when an incoming excerpt id already belongs to a different event', async () => {
    await upsertCommunicationEvent(db.prisma, {
      organizationId: org,
      accountId,
      message: inboxMessage({
        eventId: asCommunicationEventId('evt_owner'),
        providerMessageId: 'msg_owner',
      }),
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: 'evt_owner',
      excerptId: 'ex_owned',
      content: 'owned body',
      purgeAt,
    });
    const before = await getCommunicationAccountByOrganization(db.prisma, org);

    await expect(
      persistGmailHistoryPageTransaction({
        db: db.prisma,
        organizationId: org,
        accountId,
        historyIdBefore: 'hist_dup',
        historyIdAfter: 'hist_collision',
        ingestRunId: 'run_collision',
        syncedAt: later,
        messages: [
          inboxMessage({
            eventId: asCommunicationEventId('evt_collision'),
            providerMessageId: 'msg_collision',
            excerptId: asTemporaryCommunicationExcerptId('ex_owned'),
            excerptContent: 'must not steal identity',
            excerptPurgeAt: purgeAt,
          }),
        ],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      return error instanceof PersistenceError && error.code === 'UNIQUE_VIOLATION';
    });

    const after = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(after?.historyId).toBe(before?.historyId);
    expect(
      await getCommunicationEventByProviderMessageId(db.prisma, org, 'msg_collision'),
    ).toBeNull();
    const owned = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_owner');
    expect(owned?.content).toBe('owned body');
  });

  it('does not expose or reuse another organization excerpt', async () => {
    const page = await persistGmailHistoryPageTransaction({
      db: db.prisma,
      organizationId: otherOrg,
      accountId: otherAccountId,
      historyIdBefore: 'hist_other_0',
      historyIdAfter: 'hist_other_1',
      ingestRunId: 'run_other',
      syncedAt: later,
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId('evt_other_a'),
          providerMessageId: 'msg_new_a',
          excerptId: asTemporaryCommunicationExcerptId('ex_other_a'),
          excerptContent: 'other org excerpt',
          excerptPurgeAt: purgeAt,
        }),
      ],
    });

    expect(page.eventsCreated).toBe(1);
    expect(
      await getCommunicationEventByProviderMessageId(db.prisma, otherOrg, 'msg_new_a'),
    ).toMatchObject({ id: 'evt_other_a', organizationId: otherOrg });
    expect(
      await getCommunicationEventByProviderMessageId(db.prisma, org, 'msg_new_a'),
    ).toMatchObject({
      id: 'evt_new_a',
      organizationId: org,
    });
    expect(
      await getTemporaryCommunicationExcerptByEventId(db.prisma, otherOrg, 'evt_new_a'),
    ).toBeNull();
    expect(
      await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_other_a'),
    ).toBeNull();
    const otherExcerpt = await getTemporaryCommunicationExcerptByEventId(
      db.prisma,
      otherOrg,
      'evt_other_a',
    );
    expect(otherExcerpt?.content).toBe('other org excerpt');
    expect(otherExcerpt?.id).toBe('ex_other_a');
  });

  it('refuses a stale historyIdBefore and leaves excerpts untouched (D076)', async () => {
    const beforeExcerpt = await getTemporaryCommunicationExcerptByEventId(
      db.prisma,
      org,
      'evt_new_a',
    );

    await expect(
      persistGmailHistoryPageTransaction({
        db: db.prisma,
        organizationId: org,
        accountId,
        historyIdBefore: 'hist_stale',
        historyIdAfter: 'hist_cas_fail',
        ingestRunId: 'run_cas',
        syncedAt: later,
        messages: [
          inboxMessage({
            eventId: asCommunicationEventId('evt_cas'),
            providerMessageId: 'msg_cas',
            excerptId: asTemporaryCommunicationExcerptId('ex_cas'),
            excerptContent: 'cas body',
            excerptPurgeAt: purgeAt,
          }),
        ],
      }),
    ).rejects.toBeInstanceOf(PersistenceError);

    const after = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(after?.historyId).toBe('hist_dup');
    expect(await getCommunicationEventByProviderMessageId(db.prisma, org, 'msg_cas')).toBeNull();
    const afterExcerpt = await getTemporaryCommunicationExcerptByEventId(
      db.prisma,
      org,
      'evt_new_a',
    );
    expect(afterExcerpt).toEqual(beforeExcerpt);
  });

  it('rolls back new events, excerpt creates, excerpt updates, and cursor on later failure', async () => {
    const before = await getCommunicationAccountByOrganization(db.prisma, org);
    const beforeRefresh = await getTemporaryCommunicationExcerptByEventId(
      db.prisma,
      org,
      'evt_refresh',
    );

    await expect(
      persistGmailHistoryPageTransaction({
        db: db.prisma,
        organizationId: org,
        accountId,
        historyIdBefore: 'hist_dup',
        historyIdAfter: 'hist_rollback',
        ingestRunId: 'run_rollback',
        syncedAt: later,
        messages: [
          inboxMessage({
            eventId: asCommunicationEventId('evt_rollback_new'),
            providerMessageId: 'msg_rollback_new',
            excerptId: asTemporaryCommunicationExcerptId('ex_rollback_new'),
            excerptContent: 'new row that must roll back',
            excerptPurgeAt: purgeAt,
          }),
          inboxMessage({
            eventId: asCommunicationEventId('evt_refresh'),
            providerMessageId: 'msg_refresh',
            excerptId: asTemporaryCommunicationExcerptId('ex_refresh'),
            excerptContent: 'updated body that must roll back',
            excerptPurgeAt: laterPurgeAt,
          }),
          inboxMessage({
            eventId: asCommunicationEventId('evt_rollback_fail'),
            providerMessageId: 'msg_rollback_fail',
            excerptId: asTemporaryCommunicationExcerptId('ex_rollback_fail'),
            excerptContent: 'x'.repeat(MAX_GMAIL_EXCERPT_BYTES + 1),
            excerptPurgeAt: purgeAt,
          }),
        ],
      }),
    ).rejects.toBeInstanceOf(DomainError);

    const after = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(after?.historyId).toBe(before?.historyId);
    expect(
      await getCommunicationEventByProviderMessageId(db.prisma, org, 'msg_rollback_new'),
    ).toBeNull();
    expect(
      await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_rollback_new'),
    ).toBeNull();
    const afterRefresh = await getTemporaryCommunicationExcerptByEventId(
      db.prisma,
      org,
      'evt_refresh',
    );
    expect(afterRefresh).toEqual(beforeRefresh);
  });

  it('reprocesses the same eligible page without duplicating events or excerpts', async () => {
    const first = await persistGmailHistoryPageTransaction({
      db: db.prisma,
      organizationId: org,
      accountId,
      historyIdBefore: 'hist_dup',
      historyIdAfter: 'hist_retry_1',
      ingestRunId: 'run_retry_1',
      syncedAt: later,
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId('evt_retry'),
          providerMessageId: 'msg_retry',
          excerptId: asTemporaryCommunicationExcerptId('ex_retry'),
          excerptContent: 'retry first',
          excerptPurgeAt: purgeAt,
        }),
      ],
    });
    expect(first.eventsCreated).toBe(1);

    const second = await persistGmailHistoryPageTransaction({
      db: db.prisma,
      organizationId: org,
      accountId,
      historyIdBefore: 'hist_retry_1',
      historyIdAfter: 'hist_retry_2',
      ingestRunId: 'run_retry_2',
      syncedAt: later,
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId('evt_retry_ignored'),
          providerMessageId: 'msg_retry',
          subject: 'Hello retry',
          excerptId: asTemporaryCommunicationExcerptId('ex_retry_ignored'),
          excerptContent: 'retry second',
          excerptPurgeAt: laterPurgeAt,
        }),
      ],
    });

    expect(second.eventsCreated).toBe(0);
    expect(second.eventsUpdated).toBe(1);
    expect(
      await db.prisma.communicationEvent.count({
        where: { organizationId: org, providerMessageId: 'msg_retry' },
      }),
    ).toBe(1);
    const excerpt = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_retry');
    expect(excerpt?.id).toBe('ex_retry');
    expect(excerpt?.content).toBe('retry second');
    expect(excerpt?.purgeAt).toBe(purgeAt);
    expect(excerpt?.purgedAt).toBeNull();
  });

  it('still purges an existing unpurged excerpt when the message leaves Inbox', async () => {
    const page = await persistGmailHistoryPageTransaction({
      db: db.prisma,
      organizationId: org,
      accountId,
      historyIdBefore: 'hist_retry_2',
      historyIdAfter: 'hist_left',
      ingestRunId: 'run_left',
      syncedAt: later,
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId('evt_retry'),
          providerMessageId: 'msg_retry',
          labelIds: ['SENT'],
        }),
      ],
    });

    expect(page.eventsUpdated).toBe(1);
    expect(page.messagesSkipped).toBe(0);
    const excerpt = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_retry');
    expect(excerpt?.content).toBe('');
    expect(excerpt?.byteLength).toBe(0);
    expect(excerpt?.purgedAt).toBe(later);
    expect(excerpt?.purgeAt).toBe(purgeAt);
  });
});
