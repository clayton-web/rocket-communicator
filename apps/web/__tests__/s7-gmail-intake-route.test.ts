// @vitest-environment node
/**
 * S7 Gmail intake read API: GET /api/v1/gmail/intake (D179).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  asOrganizationId,
  asOwnerId,
  ownerActor,
  type ParsedGmailMessageFixture,
} from '@aicaa/domain';
import {
  createOrUpdatePendingCommunicationAccount,
  persistConnectedCommunicationAccount,
  purgeTemporaryCommunicationExcerpt,
  upsertCommunicationEvent,
  upsertTemporaryCommunicationExcerpt,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { GET as listGmailIntake } from '@/app/api/v1/gmail/intake/route';
import { ENABLE_GMAIL_REVIEW_ENV } from '@/lib/gmail/review-release-config';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

const ORG = 'org_s7_intake';
const OTHER_ORG = 'org_s7_intake_other';
const OWNER_ID = 'owner_s7_intake';
const now = new Date().toISOString();
const futurePurge = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const pastPurge = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const owner = ownerActor(asOwnerId(OWNER_ID), asOrganizationId(ORG));
const otherOwner = ownerActor(asOwnerId('owner_s7_intake_other'), asOrganizationId(OTHER_ORG));

let db: TestDatabase;

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
    subject: 'Please review',
    snippet: 'Can you look at this',
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
    historyId: 'hist_intake',
  });
}

async function seedEligible(
  organizationId: string,
  accountId: string,
  eventId: string,
  providerMessageId: string,
  extras: Partial<ParsedGmailMessageFixture> = {},
): Promise<void> {
  await upsertCommunicationEvent(db.prisma, {
    organizationId,
    accountId,
    message: inboxMessage({ eventId, providerMessageId, ...extras }),
  });
  await upsertTemporaryCommunicationExcerpt(db.prisma, {
    organizationId,
    communicationEventId: eventId,
    excerptId: `ex_${eventId}`,
    content: `Excerpt for ${eventId}`,
    purgeAt: futurePurge,
  });
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

describe('S7 GET /api/v1/gmail/intake', () => {
  const originalGmailReviewFlag = process.env[ENABLE_GMAIL_REVIEW_ENV];

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccount(ORG, 'acct_s7_intake');
    await seedAccount(OTHER_ORG, 'acct_s7_intake_other');
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
    await db.prisma.temporaryCommunicationExcerpt.deleteMany();
    await db.prisma.communicationEvent.deleteMany();
  });

  afterEach(() => {
    clearDbTestRuntime();
  });

  it('requires Owner authentication', async () => {
    vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
    const res = await listGmailIntake(new Request('http://localhost/api/v1/gmail/intake'));
    expect(res.status).toBe(401);
  });

  it("returns only this organization's eligible Gmail items and omits excerpt bodies", async () => {
    await seedEligible(ORG, 'acct_s7_intake', 'evt_intake_mine', 'msg_intake_mine');
    await seedEligible(
      OTHER_ORG,
      'acct_s7_intake_other',
      'evt_intake_theirs',
      'msg_intake_theirs',
      {
        fromAddress: 'other@example.com',
      },
    );

    const res = await listGmailIntake(new Request('http://localhost/api/v1/gmail/intake'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toEqual({
      id: 'evt_intake_mine',
      fromAddress: 'sender@example.com',
      subject: 'Please review',
      snippet: 'Can you look at this',
      receivedAt: expect.any(String),
    });
    expect(body.nextCursor).toBeNull();

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('Excerpt for');
    expect(serialized).not.toContain(OTHER_ORG);
    expect(body.items[0]).not.toHaveProperty('organizationId');
    expect(body.items[0]).not.toHaveProperty('labelIds');
    expect(body.items[0]).not.toHaveProperty('suggestionProcessingStatus');
    expect(body.items[0]).not.toHaveProperty('providerMessageId');
  });

  it('omits ineligible, expired, and other-org Gmail occurrences', async () => {
    await seedEligible(ORG, 'acct_s7_intake', 'evt_ok', 'msg_ok');

    await seedEligible(ORG, 'acct_s7_intake', 'evt_left', 'msg_left');
    await db.prisma.communicationEvent.update({
      where: { id: 'evt_left' },
      data: { labelIds: ['TRASH'] },
    });

    await upsertCommunicationEvent(db.prisma, {
      organizationId: ORG,
      accountId: 'acct_s7_intake',
      message: inboxMessage({ eventId: 'evt_expired', providerMessageId: 'msg_expired' }),
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: ORG,
      communicationEventId: 'evt_expired',
      excerptId: 'ex_evt_expired',
      content: 'Expired',
      purgeAt: pastPurge,
    });

    await seedEligible(ORG, 'acct_s7_intake', 'evt_purged', 'msg_purged');
    await purgeTemporaryCommunicationExcerpt(db.prisma, ORG, 'evt_purged', now);

    const res = await listGmailIntake(new Request('http://localhost/api/v1/gmail/intake'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(['evt_ok']);
  });

  it('does not import A6 suggestion extraction or process-service', () => {
    const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const files = [
      'lib/gmail/intake-service.ts',
      'lib/gmail/intake-dto.ts',
      'app/api/v1/gmail/intake/route.ts',
    ];
    for (const file of files) {
      const source = readFileSync(path.join(webRoot, file), 'utf8');
      expect(source).not.toMatch(/evaluateSuggestionRelevance/);
      expect(source).not.toMatch(/SuggestionExtractionResult/);
      expect(source).not.toMatch(/AI_EMPTY_OUTPUT/);
      expect(source).not.toMatch(/lib\/suggestions/);
      expect(source).not.toMatch(/internal\/suggestions\/process/);
      expect(source).not.toMatch(/claimSuggestionProcessingBatch/);
    }
  });
});
