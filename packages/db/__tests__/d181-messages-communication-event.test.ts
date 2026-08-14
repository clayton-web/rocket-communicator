import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claimSuggestionProcessingBatch,
  createOrUpdatePendingCommunicationAccount,
  persistConnectedCommunicationAccount,
  upsertCommunicationEvent,
  upsertGoogleMessagesReviewEvent,
  upsertTemporaryCommunicationExcerpt,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const org = 'org_d181_event';
const now = '2026-08-13T18:00:00.000Z';
const claimUntil = '2026-08-13T18:05:00.000Z';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  path.join(
    root,
    'prisma/migrations/20260814010000_d181_messages_review_persistence/migration.sql',
  ),
  'utf8',
);

describe('D181 Messages CommunicationEvent persistence', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await createOrUpdatePendingCommunicationAccount(db.prisma, {
      organizationId: org,
      accountId: 'acct_d181',
      emailAddress: 'owner@acme.example',
      externalAccountId: 'google-d181',
    });
    await persistConnectedCommunicationAccount(db.prisma, {
      organizationId: org,
      accountId: 'acct_d181',
      emailAddress: 'owner@acme.example',
      externalAccountId: 'google-d181',
      connectedAt: now,
      historyId: 'hist_d181',
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('makes accountId nullable in schema and migration while keeping Gmail required', () => {
    const eventBlock = schema.match(
      /model CommunicationEvent \{[\s\S]*?@@map\("communication_events"\)/,
    )?.[0];
    expect(eventBlock).toMatch(/accountId\s+String\?\s+@map\("account_id"\)/);
    expect(eventBlock).toMatch(/account\s+CommunicationAccount\?/);
    expect(schema).toMatch(/enum InterpretationSourceKind \{[\s\S]*google_messages/);
    expect(migration).toContain('ALTER COLUMN "account_id" DROP NOT NULL');
    expect(migration).toContain('communication_events_account_id_source_chk');
    expect(migration).toContain("source_type = 'gmail' AND account_id IS NOT NULL");
    expect(migration).toContain("source_type = 'google_messages' AND account_id IS NULL");
    expect(migration).toContain("ADD VALUE 'google_messages'");
    expect(migration).not.toContain('CREATE TABLE');
  });

  it('creates a Google Messages event without a CommunicationAccount', async () => {
    const { event, created } = await upsertGoogleMessagesReviewEvent(db.prisma, {
      organizationId: org,
      eventId: 'cmsg_d181_one',
      sourceOccurrenceId: 'occ-one',
      dedupeKey: 'd'.repeat(64),
      observedAt: now,
    });
    expect(created).toBe(true);
    expect(event.accountId).toBeNull();
    expect(event.sourceType).toBe('google_messages');
    expect(event.fromAddress).toBe('');
    expect(event.snippet).toBeNull();
    expect(event.subject).toBeNull();
    expect(
      await db.prisma.communicationAccount.count({ where: { id: { not: 'acct_d181' } } }),
    ).toBe(0);

    const reused = await upsertGoogleMessagesReviewEvent(db.prisma, {
      organizationId: org,
      eventId: 'cmsg_d181_other',
      sourceOccurrenceId: 'occ-one',
      dedupeKey: 'e'.repeat(64),
      observedAt: now,
    });
    expect(reused.created).toBe(false);
    expect(reused.event.id).toBe('cmsg_d181_one');
  });

  it('keeps Gmail events requiring an account after the nullability change', async () => {
    const { event } = await upsertCommunicationEvent(db.prisma, {
      organizationId: org,
      accountId: 'acct_d181',
      message: {
        eventId: 'evt_d181_gmail',
        providerMessageId: 'msg_d181_gmail',
        providerThreadId: 'thread_d181',
        internalDate: now,
        receivedAt: now,
        fromAddress: 'sender@example.com',
        toAddresses: ['owner@acme.example'],
        subject: 'Quote',
        snippet: 'Please review',
        labelIds: ['INBOX'],
        hasAttachments: false,
        attachmentMetadata: [],
      },
    });
    expect(event.accountId).toBe('acct_d181');
    expect(event.sourceType).toBe('gmail');

    await expect(
      db.prisma.communicationEvent.create({
        data: {
          id: 'evt_d181_gmail_null',
          organizationId: org,
          accountId: null,
          sourceType: 'gmail',
          providerMessageId: 'msg_d181_gmail_null',
          providerThreadId: 'thread_null',
          dedupeKey: 'gmail-null-account',
          internalDate: now,
          receivedAt: now,
          fromAddress: 'sender@example.com',
          toAddresses: [],
          labelIds: ['INBOX'],
          hasAttachments: false,
          attachmentMetadata: [],
          status: 'active',
        },
      }),
    ).rejects.toThrow();
  });

  it('does not let A6 claim Google Messages events', async () => {
    await upsertGoogleMessagesReviewEvent(db.prisma, {
      organizationId: org,
      eventId: 'cmsg_d181_a6',
      sourceOccurrenceId: 'occ-a6',
      dedupeKey: 'f'.repeat(64),
      observedAt: now,
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: 'cmsg_d181_a6',
      excerptId: 'exm_d181_a6',
      content: 'Selected review text',
      purgeAt: '2026-08-20T18:00:00.000Z',
    });
    await upsertCommunicationEvent(db.prisma, {
      organizationId: org,
      accountId: 'acct_d181',
      message: {
        eventId: 'evt_d181_a6_gmail',
        providerMessageId: 'msg_d181_a6_gmail',
        providerThreadId: 'thread_a6',
        internalDate: now,
        receivedAt: now,
        fromAddress: 'sender@example.com',
        toAddresses: ['owner@acme.example'],
        subject: 'Quote',
        snippet: 'Please review',
        labelIds: ['INBOX'],
        hasAttachments: false,
        attachmentMetadata: [],
      },
    });

    const claimed = await claimSuggestionProcessingBatch(db.prisma, {
      claimOwner: 'a6-d181',
      claimUntil,
      now,
      limit: 10,
      organizationId: org,
    });
    expect(claimed.map((event) => event.id)).toContain('evt_d181_a6_gmail');
    expect(claimed.map((event) => event.id)).not.toContain('cmsg_d181_a6');
    expect(claimed.every((event) => event.sourceType === 'gmail')).toBe(true);
    const messages = await db.prisma.communicationEvent.findUniqueOrThrow({
      where: { id: 'cmsg_d181_a6' },
    });
    expect(messages.suggestionProcessingStatus).toBe('unprocessed');
    expect(messages.suggestionClaimOwner).toBeNull();
  });
});
