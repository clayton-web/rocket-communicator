/**
 * Gmail A5 excerpt re-ingest must not write retention/purge state.
 *
 * Create still establishes the D078/D181 birth deadline. An existing-row upsert may refresh
 * capped content, but must not shorten a D082 hold, refresh an approved ceiling, clear
 * `purgedAt`, or restore a purged body. PGlite serializes connections, so the concurrency
 * cases below prove both commit orders rather than true overlapping writers; the update
 * itself omits retention columns, which is what makes either order safe.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asCommunicationEventId,
  asOrganizationId,
  asTaskSuggestionId,
  asTemporaryCommunicationExcerptId,
  computeWorkflowSafetyCeilingPurgeAt,
  measureExcerptByteLength,
  type ParsedGmailMessageFixture,
  type TaskSuggestion,
} from '@aicaa/domain';
import {
  applyD082ExcerptRetention,
  createOrUpdatePendingCommunicationAccount,
  createTaskSuggestion,
  getCommunicationEventByProviderMessageId,
  getTemporaryCommunicationExcerptByEventId,
  persistConnectedCommunicationAccount,
  persistGmailHistoryPageTransaction,
  purgeTemporaryCommunicationExcerpt,
  upsertCommunicationEvent,
  upsertGoogleMessagesReviewEvent,
  upsertTemporaryCommunicationExcerpt,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const org = 'org_excerpt_reingest';
const accountId = 'acct_excerpt_reingest';
const now = '2026-07-16T12:00:00.000Z';
const ingestPurgeAt = '2026-07-23T12:00:00.000Z';
const laterIngestPurgeAt = '2026-08-27T12:00:00.000Z';
const shorterIngestPurgeAt = '2026-07-20T12:00:00.000Z';
const holdPurgeAt = computeWorkflowSafetyCeilingPurgeAt(now);
const approvedAt = '2026-07-20T12:00:00.000Z';
const approvedCeiling = computeWorkflowSafetyCeilingPurgeAt(approvedAt);
const purgedAt = '2026-07-16T13:00:00.000Z';

function inboxMessage(
  overrides: Partial<ParsedGmailMessageFixture> &
    Pick<ParsedGmailMessageFixture, 'eventId' | 'providerMessageId'>,
): ParsedGmailMessageFixture {
  return {
    providerThreadId: `thread_${overrides.providerMessageId}`,
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

function pendingProposal(input: {
  id: string;
  sourceCommunicationEventId: string;
  createdAt: string;
}): TaskSuggestion {
  return {
    id: asTaskSuggestionId(input.id),
    organizationId: asOrganizationId(org),
    status: 'pending',
    summaryPoints: [{ id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Follow up' }],
    voiceOriginated: false,
    sourceCommunicationEventId: asCommunicationEventId(input.sourceCommunicationEventId),
    sourceExcerptId: null,
    retention: {},
    version: 1,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

describe('TemporaryCommunicationExcerpt re-ingest retention (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await createOrUpdatePendingCommunicationAccount(db.prisma, {
      organizationId: org,
      accountId,
      emailAddress: 'owner@acme.example',
      externalAccountId: 'google-excerpt-reingest',
    });
    await persistConnectedCommunicationAccount(db.prisma, {
      organizationId: org,
      accountId,
      emailAddress: 'owner@acme.example',
      externalAccountId: 'google-excerpt-reingest',
      connectedAt: now,
      historyId: 'hist_0',
    });
  });

  afterAll(async () => {
    await db.close();
  });

  async function seedEvent(eventId: string, providerMessageId: string): Promise<void> {
    await upsertCommunicationEvent(db.prisma, {
      organizationId: org,
      accountId,
      message: inboxMessage({
        eventId: asCommunicationEventId(eventId),
        providerMessageId,
      }),
    });
  }

  it('does not shorten an active D082 hold on re-ingest', async () => {
    const eventId = 'evt_hold';
    await seedEvent(eventId, 'msg_hold');
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: eventId,
      excerptId: 'ex_hold',
      content: 'original hold body',
      purgeAt: ingestPurgeAt,
    });
    await db.prisma.temporaryCommunicationExcerpt.update({
      where: { communicationEventId: eventId },
      data: { purgeAt: new Date(holdPurgeAt) },
    });

    const updated = await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: eventId,
      excerptId: 'ex_hold_ignored',
      content: 're-ingested hold body',
      purgeAt: shorterIngestPurgeAt,
    });

    expect(updated.purgeAt).toBe(holdPurgeAt);
    expect(updated.purgedAt).toBeNull();
    expect(updated.content).toBe('re-ingested hold body');
  });

  it('does not refresh an approved D082 ceiling on late re-ingest', async () => {
    const eventId = 'evt_ceiling';
    await seedEvent(eventId, 'msg_ceiling');
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: eventId,
      excerptId: 'ex_ceiling',
      content: 'original ceiling body',
      purgeAt: ingestPurgeAt,
    });
    await db.prisma.temporaryCommunicationExcerpt.update({
      where: { communicationEventId: eventId },
      data: { purgeAt: new Date(approvedCeiling) },
    });

    const updated = await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: eventId,
      excerptId: 'ex_ceiling_ignored',
      content: 'late re-ingest body',
      purgeAt: laterIngestPurgeAt,
    });

    expect(updated.purgeAt).toBe(approvedCeiling);
    expect(updated.purgedAt).toBeNull();
    expect(updated.content).toBe('late re-ingest body');
  });

  it('refreshes unpurged content without touching retention columns', async () => {
    const eventId = 'evt_refresh';
    const original = 'original unpurged body';
    const refreshed = 'refreshed unpurged body';
    await seedEvent(eventId, 'msg_refresh');
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: eventId,
      excerptId: 'ex_refresh',
      content: original,
      purgeAt: ingestPurgeAt,
    });

    const updated = await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: eventId,
      excerptId: 'ex_refresh',
      content: refreshed,
      purgeAt: laterIngestPurgeAt,
    });

    expect(updated.content).toBe(refreshed);
    expect(updated.byteLength).toBe(measureExcerptByteLength(refreshed));
    expect(updated.purgeAt).toBe(ingestPurgeAt);
    expect(updated.purgedAt).toBeNull();
  });

  it('leaves a purged excerpt irreversible while the enclosing event update still succeeds', async () => {
    const eventId = 'evt_purged';
    await seedEvent(eventId, 'msg_purged');
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: eventId,
      excerptId: 'ex_purged',
      content: 'body that will be purged',
      purgeAt: ingestPurgeAt,
    });
    await purgeTemporaryCommunicationExcerpt(db.prisma, org, eventId, purgedAt);
    const before = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, eventId);

    const page = await persistGmailHistoryPageTransaction({
      db: db.prisma,
      organizationId: org,
      accountId,
      historyIdBefore: 'hist_0',
      historyIdAfter: 'hist_purged_reingest',
      ingestRunId: 'run_purged_reingest',
      syncedAt: '2026-07-16T14:00:00.000Z',
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId(eventId),
          providerMessageId: 'msg_purged',
          subject: 'Hello again after archive',
          excerptId: asTemporaryCommunicationExcerptId('ex_purged_new'),
          excerptContent: 'restored body must not land',
          excerptPurgeAt: laterIngestPurgeAt,
        }),
      ],
    });

    expect(page.eventsUpdated).toBe(1);
    const event = await getCommunicationEventByProviderMessageId(db.prisma, org, 'msg_purged');
    expect(event?.subject).toBe('Hello again after archive');

    const after = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, eventId);
    expect(after?.content).toBe('');
    expect(after?.byteLength).toBe(0);
    expect(after?.purgedAt).toBe(purgedAt);
    expect(after?.purgeAt).toBe(ingestPurgeAt);
    expect(after?.id).toBe(before?.id);
  });

  it('keeps the D082 entitlement regardless of re-ingest vs retention commit order', async () => {
    const firstEventId = 'evt_order_retention_first';
    const secondEventId = 'evt_order_ingest_first';
    await seedEvent(firstEventId, 'msg_order_retention_first');
    await seedEvent(secondEventId, 'msg_order_ingest_first');

    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: firstEventId,
      excerptId: 'ex_order_retention_first',
      content: 'order one body',
      purgeAt: ingestPurgeAt,
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: secondEventId,
      excerptId: 'ex_order_ingest_first',
      content: 'order two body',
      purgeAt: ingestPurgeAt,
    });

    await createTaskSuggestion(
      db.prisma,
      org,
      pendingProposal({
        id: 'sug_order_retention_first',
        sourceCommunicationEventId: firstEventId,
        createdAt: now,
      }),
    );
    await createTaskSuggestion(
      db.prisma,
      org,
      pendingProposal({
        id: 'sug_order_ingest_first',
        sourceCommunicationEventId: secondEventId,
        createdAt: now,
      }),
    );

    expect(
      await applyD082ExcerptRetention(db.prisma, org, {
        target: { kind: 'communication_event', communicationEventId: firstEventId },
      }),
    ).toBe(true);
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: firstEventId,
      excerptId: 'ex_order_retention_first',
      content: 're-ingested after hold',
      purgeAt: shorterIngestPurgeAt,
    });
    expect(
      (await getTemporaryCommunicationExcerptByEventId(db.prisma, org, firstEventId))?.purgeAt,
    ).toBe(holdPurgeAt);

    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: secondEventId,
      excerptId: 'ex_order_ingest_first',
      content: 're-ingested before hold',
      purgeAt: laterIngestPurgeAt,
    });
    expect(
      await applyD082ExcerptRetention(db.prisma, org, {
        target: { kind: 'communication_event', communicationEventId: secondEventId },
      }),
    ).toBe(true);
    expect(
      (await getTemporaryCommunicationExcerptByEventId(db.prisma, org, secondEventId))?.purgeAt,
    ).toBe(holdPurgeAt);
  });

  it('cannot restore an already-purged Messages Review excerpt through the shared primitive', async () => {
    const eventId = 'cmsg_d181_purged';
    await upsertGoogleMessagesReviewEvent(db.prisma, {
      organizationId: org,
      eventId,
      sourceOccurrenceId: 'occ-d181-purged',
      dedupeKey: 'm'.repeat(64),
      observedAt: now,
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: eventId,
      excerptId: 'exm_d181_purged',
      content: 'selected Messages text',
      purgeAt: ingestPurgeAt,
    });
    await purgeTemporaryCommunicationExcerpt(db.prisma, org, eventId, purgedAt);

    const after = await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: eventId,
      excerptId: 'exm_d181_purged',
      content: 'new selected text must not land',
      purgeAt: laterIngestPurgeAt,
    });

    expect(after.content).toBe('');
    expect(after.byteLength).toBe(0);
    expect(after.purgedAt).toBe(purgedAt);
    expect(after.purgeAt).toBe(ingestPurgeAt);
  });
});
