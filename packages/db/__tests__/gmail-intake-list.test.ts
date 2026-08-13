import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asCommunicationEventId, type ParsedGmailMessageFixture } from '@aicaa/domain';
import {
  GMAIL_INTAKE_MAX_SCAN,
  createOrUpdatePendingCommunicationAccount,
  listEligibleGmailIntakeEvents,
  persistConnectedCommunicationAccount,
  purgeTemporaryCommunicationExcerpt,
  upsertCommunicationEvent,
  upsertTemporaryCommunicationExcerpt,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const org = 'org_gmail_intake';
const otherOrg = 'org_gmail_intake_other';
const now = '2026-08-13T18:00:00.000Z';
const later = '2026-08-13T19:00:00.000Z';
const futurePurge = '2026-08-20T18:00:00.000Z';
const pastPurge = '2026-08-01T18:00:00.000Z';

function inboxMessage(
  overrides: Partial<ParsedGmailMessageFixture> &
    Pick<ParsedGmailMessageFixture, 'eventId' | 'providerMessageId'>,
): ParsedGmailMessageFixture {
  return {
    providerThreadId: 'thread_intake',
    internalDate: now,
    receivedAt: now,
    fromAddress: 'sender@example.com',
    toAddresses: ['owner@acme.example'],
    subject: 'Please review the quote',
    snippet: 'Can you look at this',
    labelIds: ['INBOX'],
    hasAttachments: false,
    attachmentMetadata: [],
    ...overrides,
  };
}

async function seedAccount(
  db: TestDatabase,
  organizationId: string,
  accountId: string,
): Promise<void> {
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
    historyId: 'hist_intake',
  });
}

describe('S7 Gmail intake listing (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccount(db, org, 'acct_intake');
    await seedAccount(db, otherOrg, 'acct_intake_other');
  });

  afterAll(async () => {
    await db.close();
  });

  it('returns only currently reviewable Gmail events for the requested organization', async () => {
    await upsertCommunicationEvent(db.prisma, {
      organizationId: org,
      accountId: 'acct_intake',
      message: inboxMessage({
        eventId: asCommunicationEventId('evt_intake_ok'),
        providerMessageId: 'msg_intake_ok',
      }),
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: 'evt_intake_ok',
      excerptId: 'ex_intake_ok',
      content: 'Please send the revised quote tomorrow.',
      purgeAt: futurePurge,
    });

    await upsertCommunicationEvent(db.prisma, {
      organizationId: otherOrg,
      accountId: 'acct_intake_other',
      message: inboxMessage({
        eventId: asCommunicationEventId('evt_intake_other'),
        providerMessageId: 'msg_intake_other',
        fromAddress: 'other@example.com',
      }),
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: otherOrg,
      communicationEventId: 'evt_intake_other',
      excerptId: 'ex_intake_other',
      content: 'Other org excerpt',
      purgeAt: futurePurge,
    });

    const page = await listEligibleGmailIntakeEvents(db.prisma, {
      organizationId: org,
      now,
      limit: 25,
    });

    expect(page.items.map((item) => item.id)).toEqual(['evt_intake_ok']);
    expect(page.items[0]?.fromAddress).toBe('sender@example.com');
    expect(page.nextCursor).toBeNull();
  });

  it('omits events whose excerpt is purged, expired, or whose labels left Inbox', async () => {
    await upsertCommunicationEvent(db.prisma, {
      organizationId: org,
      accountId: 'acct_intake',
      message: inboxMessage({
        eventId: asCommunicationEventId('evt_intake_purged'),
        providerMessageId: 'msg_intake_purged',
        receivedAt: later,
      }),
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: 'evt_intake_purged',
      excerptId: 'ex_intake_purged',
      content: 'Will be purged',
      purgeAt: futurePurge,
    });
    await purgeTemporaryCommunicationExcerpt(db.prisma, org, 'evt_intake_purged', now);

    await upsertCommunicationEvent(db.prisma, {
      organizationId: org,
      accountId: 'acct_intake',
      message: inboxMessage({
        eventId: asCommunicationEventId('evt_intake_expired'),
        providerMessageId: 'msg_intake_expired',
        receivedAt: later,
      }),
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: 'evt_intake_expired',
      excerptId: 'ex_intake_expired',
      content: 'Expired excerpt',
      purgeAt: pastPurge,
    });

    await upsertCommunicationEvent(db.prisma, {
      organizationId: org,
      accountId: 'acct_intake',
      message: inboxMessage({
        eventId: asCommunicationEventId('evt_intake_left'),
        providerMessageId: 'msg_intake_left',
        receivedAt: later,
        labelIds: ['INBOX'],
      }),
    });
    await db.prisma.communicationEvent.update({
      where: { id: 'evt_intake_left' },
      data: { labelIds: ['TRASH'] },
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: 'evt_intake_left',
      excerptId: 'ex_intake_left',
      content: 'Left inbox',
      purgeAt: futurePurge,
    });

    const page = await listEligibleGmailIntakeEvents(db.prisma, {
      organizationId: org,
      now,
      limit: 25,
    });

    expect(page.items.map((item) => item.id)).not.toContain('evt_intake_purged');
    expect(page.items.map((item) => item.id)).not.toContain('evt_intake_expired');
    expect(page.items.map((item) => item.id)).not.toContain('evt_intake_left');
  });

  it('paginates ordinary full and short eligible pages by receivedAt DESC, id DESC', async () => {
    const pageOrg = 'org_gmail_intake_pages';
    await seedAccount(db, pageOrg, 'acct_intake_pages');
    const times = [
      '2026-08-13T18:03:00.000Z',
      '2026-08-13T18:02:00.000Z',
      '2026-08-13T18:01:00.000Z',
    ];
    for (const [index, receivedAt] of times.entries()) {
      const eventId = `evt_page_${index}`;
      await upsertCommunicationEvent(db.prisma, {
        organizationId: pageOrg,
        accountId: 'acct_intake_pages',
        message: inboxMessage({
          eventId: asCommunicationEventId(eventId),
          providerMessageId: `msg_page_${index}`,
          receivedAt,
          internalDate: receivedAt,
        }),
      });
      await upsertTemporaryCommunicationExcerpt(db.prisma, {
        organizationId: pageOrg,
        communicationEventId: eventId,
        excerptId: `ex_page_${index}`,
        content: `Page excerpt ${index}`,
        purgeAt: futurePurge,
      });
    }

    const first = await listEligibleGmailIntakeEvents(db.prisma, {
      organizationId: pageOrg,
      now,
      limit: 2,
    });
    expect(first.items.map((item) => item.id)).toEqual(['evt_page_0', 'evt_page_1']);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await listEligibleGmailIntakeEvents(db.prisma, {
      organizationId: pageOrg,
      now,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((item) => item.id)).toEqual(['evt_page_2']);
    expect(second.nextCursor).toBeNull();

    const short = await listEligibleGmailIntakeEvents(db.prisma, {
      organizationId: pageOrg,
      now,
      limit: 25,
    });
    expect(short.items).toHaveLength(3);
    expect(short.nextCursor).toBeNull();
  });

  it('continues past a bounded scan of newer ineligible candidates to reach older eligible mail', async () => {
    const scanOrg = 'org_gmail_intake_scan';
    await seedAccount(db, scanOrg, 'acct_intake_scan');
    const olderEligibleAt = '2026-08-13T10:00:00.000Z';
    const newerBase = Date.parse('2026-08-13T18:00:00.000Z');

    await upsertCommunicationEvent(db.prisma, {
      organizationId: scanOrg,
      accountId: 'acct_intake_scan',
      message: inboxMessage({
        eventId: asCommunicationEventId('evt_scan_eligible'),
        providerMessageId: 'msg_scan_eligible',
        receivedAt: olderEligibleAt,
        internalDate: olderEligibleAt,
      }),
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: scanOrg,
      communicationEventId: 'evt_scan_eligible',
      excerptId: 'ex_scan_eligible',
      content: 'Older eligible excerpt',
      purgeAt: futurePurge,
    });

    const ineligibleCount = GMAIL_INTAKE_MAX_SCAN + 1;
    const events = [];
    const excerpts = [];
    for (let i = 0; i < ineligibleCount; i += 1) {
      const receivedAt = new Date(newerBase + i * 1000);
      const eventId = `evt_scan_inelig_${String(i).padStart(3, '0')}`;
      events.push({
        id: eventId,
        organizationId: scanOrg,
        accountId: 'acct_intake_scan',
        sourceType: 'gmail',
        providerMessageId: `msg_scan_inelig_${i}`,
        providerThreadId: 'thread_intake_scan',
        dedupeKey: `gmail:msg_scan_inelig_${i}`,
        internalDate: receivedAt,
        receivedAt,
        fromAddress: 'sender@example.com',
        toAddresses: ['owner@acme.example'],
        subject: 'Ineligible',
        snippet: 'Left inbox',
        labelIds: ['TRASH'],
        hasAttachments: false,
        attachmentMetadata: [],
        status: 'active',
      });
      excerpts.push({
        id: `ex_scan_inelig_${i}`,
        organizationId: scanOrg,
        communicationEventId: eventId,
        content: 'Live ineligible excerpt',
        byteLength: 24,
        purgeAt: new Date(futurePurge),
      });
    }
    await db.prisma.communicationEvent.createMany({ data: events });
    await db.prisma.temporaryCommunicationExcerpt.createMany({ data: excerpts });

    const seenCursors = new Set<string>();
    let cursor: string | null | undefined;
    let foundEligible = false;
    let pages = 0;
    while (pages < 8) {
      pages += 1;
      const page = await listEligibleGmailIntakeEvents(db.prisma, {
        organizationId: scanOrg,
        now,
        limit: 25,
        cursor,
      });
      if (page.items.some((item) => item.id === 'evt_scan_eligible')) {
        foundEligible = true;
        break;
      }
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toEqual(expect.any(String));
      expect(seenCursors.has(page.nextCursor!)).toBe(false);
      seenCursors.add(page.nextCursor!);
      cursor = page.nextCursor;
    }

    expect(foundEligible).toBe(true);
    expect(pages).toBeGreaterThan(1);
  });
});
