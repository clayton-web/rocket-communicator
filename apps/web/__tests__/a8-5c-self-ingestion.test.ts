// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asOrganizationId,
  asOwnerId,
  GMAIL_READONLY_SCOPE,
  isRocketGeneratedOwnerNotification,
  ownerActor,
  ROCKET_GENERATED_HEADER_NAME,
} from '@aicaa/domain';
import { persistGmailConnectionTransaction } from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { CIPHERTEXT_PURPOSE, encryptToken } from '@/lib/gmail/token-encryption';
import { runOwnerGmailSync } from '@/lib/gmail/sync-engine';
import { normalizeGmailMessage } from '@/lib/gmail/normalize';
import { buildOwnerNotificationEmail } from '@/lib/gmail/outbound/owner-notification-email';
import { buildAssignmentEmail } from '@/lib/gmail/outbound/assignment-email';
import { buildReminderEmail } from '@/lib/gmail/outbound/reminder-email';
import { buildMimeMessage } from '@/lib/gmail/transport/mime';
import type { GmailApiClient } from '@/lib/gmail/gmail-api-client';

/**
 * A8.5c self-ingestion protection (D136).
 *
 * An Owner Event Notification is sent from the connected mailbox to itself, so Gmail files it under
 * both `SENT` and `INBOX` and D068 would happily ingest it. Left alone, the assistant reads its own
 * mail and offers the Owner a Task Suggestion derived from a notification about a Task they already
 * have — and every notification about that suggestion would produce another one.
 *
 * The exclusion is one fixed header and nothing else, which is the property most of these tests
 * exist to pin down: the ordinary self-sent mail an Owner might genuinely want noticed must stay
 * ingestible.
 *
 * No Gmail request is made anywhere in this file. The sync engine is driven with an injected client.
 */

const org = 'org_test_a85c';
const owner = ownerActor(asOwnerId('owner_a85c'), asOrganizationId(org));
const now = '2026-08-20T18:00:00.000Z';
const accountId = 'cacct_a85c';
const OWNER_MAILBOX = 'owner@example.com';

const material = {
  key: Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex'),
  version: '1',
};

function b64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

let db: TestDatabase;

async function seedConnectedAccount() {
  await persistGmailConnectionTransaction({
    db: db.prisma,
    organizationId: org,
    accountId,
    emailAddress: OWNER_MAILBOX,
    externalAccountId: 'google-sub-a85c',
    connectedAt: now,
    credential: {
      id: 'gcred_a85c',
      encryptedRefreshToken: encryptToken(
        'rt_a85c',
        CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN,
        material,
      ),
      grantedScopes: GMAIL_READONLY_SCOPE,
      encryptionKeyVersion: '1',
    },
    audit: {
      id: `audit_a85c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      organizationId: org,
      actorKind: 'owner',
      ownerId: owner.ownerId,
      action: 'gmail_connected',
      outcome: 'succeeded',
      recordedAt: now,
    },
  });
}

/**
 * A Gmail API message with arbitrary extra headers.
 *
 * Defaults to the shape an Owner notification actually produces: sent from the connected mailbox to
 * itself, so Gmail labels it both `SENT` and `INBOX`.
 */
function message(
  id: string,
  options: {
    headers?: Array<{ name: string; value: string }>;
    labelIds?: string[];
    from?: string;
    to?: string;
    body?: string;
  } = {},
) {
  return {
    id,
    threadId: `thread_${id}`,
    labelIds: options.labelIds ?? ['INBOX', 'SENT'],
    snippet: 'snippet',
    internalDate: '1755712800000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: options.from ?? OWNER_MAILBOX },
        { name: 'To', value: options.to ?? OWNER_MAILBOX },
        { name: 'Subject', value: 'Subject line' },
        ...(options.headers ?? []),
      ],
      body: { data: b64url(options.body ?? 'Body text') },
    },
  };
}

const MARKER = { name: ROCKET_GENERATED_HEADER_NAME, value: 'owner-event-notification' };

/** Drive one incremental sync over exactly the supplied messages. */
async function sync(messages: ReturnType<typeof message>[]) {
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
          messagesAdded: messages.map((m) => ({ message: { id: m.id } })),
        },
      ],
    })),
    getMessage: vi.fn(async ({ messageId }: { messageId: string }) => {
      const found = messages.find((m) => m.id === messageId);
      if (!found) {
        throw new Error(`unexpected message fetch: ${messageId}`);
      }
      return found;
    }),
  };

  const result = await runOwnerGmailSync(
    { owner, db: db.prisma, now, requestId: `req_${Math.random().toString(36).slice(2, 8)}` },
    { gmailClient, getAccessToken: vi.fn(async () => 'access_token_memory_only') },
  );

  const events = await db.prisma.communicationEvent.findMany({ where: { organizationId: org } });
  const excerpts = await db.prisma.temporaryCommunicationExcerpt.findMany({
    where: { organizationId: org },
  });
  return { result, events, excerpts };
}

describe('A8.5c self-ingestion protection: the marker on the wire', () => {
  it('is exactly one header on a real Owner notification', () => {
    const mime = buildMimeMessage(
      buildOwnerNotificationEmail({
        from: { email: OWNER_MAILBOX },
        to: { email: OWNER_MAILBOX },
        eventType: 'task_completed_by_recipient',
        actorKind: 'capability',
        occurredAt: now,
        summaryLines: ['Confirm the venue booking'],
      }),
      {
        now: new Date(now),
        boundaryFactory: () => 'BOUNDARY',
        messageIdFactory: () => 'fixed@example.com',
      },
    );

    const header = mime.split('\r\n\r\n')[0];
    const matches = header.match(/X-Rocket-Generated:[^\r\n]*/g) ?? [];
    expect(matches).toEqual(['X-Rocket-Generated: owner-event-notification']);
  });

  it('is absent from assignment mail and from Recipient reminders', () => {
    const reminder = buildMimeMessage(
      buildReminderEmail({
        from: { email: OWNER_MAILBOX },
        to: { email: 'recipient@example.com' },
        summaryLines: ['Confirm the venue booking'],
        dueLocalDate: '2026-08-21',
        timeZone: 'America/Los_Angeles',
      }),
    );
    expect(reminder).not.toContain(ROCKET_GENERATED_HEADER_NAME);

    const assignment = buildMimeMessage(
      buildAssignmentEmail({
        from: { email: OWNER_MAILBOX },
        to: { email: 'recipient@example.com' },
        taskTitle: 'Confirm the venue booking',
        taskSummary: '- Confirm the venue booking',
        ownerContext: 'Sent by your assistant.',
        capabilityUrl: 'https://app.example.com/c/tok_abc',
      }),
    );
    expect(assignment).not.toContain(ROCKET_GENERATED_HEADER_NAME);
  });
});

describe('A8.5c self-ingestion protection: the eligibility decision', () => {
  const CASES: ReadonlyArray<readonly [string, readonly string[], boolean]> = [
    ['the exact ratified marker', ['owner-event-notification'], true],
    [
      'a differently cased marker, which is the same fixed token',
      ['Owner-Event-Notification'],
      true,
    ],
    ['a marker left padded by header unfolding', ['  owner-event-notification '], true],
    ['no marker at all', [], false],
    ['an empty value', [''], false],
    ['a suffixed near-miss', ['owner-event-notification-x'], false],
    ['a prefixed near-miss', ['x-owner-event-notification'], false],
    ['underscores instead of hyphens', ['owner_event_notification'], false],
    ['a different Rocket message class nobody ratified', ['assignment-email'], false],
    [
      'a duplicated marker, which Rocket cannot emit',
      ['owner-event-notification', 'owner-event-notification'],
      false,
    ],
    [
      'a duplicate pairing a real marker with junk',
      ['owner-event-notification', 'nonsense'],
      false,
    ],
  ];

  for (const [what, values, expected] of CASES) {
    it(`${expected ? 'grants' : 'refuses'} the exclusion for ${what}`, () => {
      expect(isRocketGeneratedOwnerNotification(values)).toBe(expected);
    });
  }
});

describe('A8.5c self-ingestion protection: header extraction', () => {
  it('collects every marker value rather than only the first', () => {
    const normalized = normalizeGmailMessage(
      message('msg_dup', { headers: [MARKER, { ...MARKER, value: 'nonsense' }] }),
    );
    expect(normalized.rocketGeneratedMarkers).toEqual(['owner-event-notification', 'nonsense']);
  });

  it('matches the header name case-insensitively, as RFC 5322 requires', () => {
    const normalized = normalizeGmailMessage(
      message('msg_case', {
        headers: [{ name: 'x-rocket-GENERATED', value: 'owner-event-notification' }],
      }),
    );
    expect(isRocketGeneratedOwnerNotification(normalized.rocketGeneratedMarkers)).toBe(true);
  });

  it('finds no marker in a message that merely mentions one in its body', () => {
    const normalized = normalizeGmailMessage(
      message('msg_body', {
        body: `Please note: X-Rocket-Generated: owner-event-notification\nThanks`,
      }),
    );
    expect(normalized.rocketGeneratedMarkers).toEqual([]);
  });
});

describe('A8.5c self-ingestion protection: end-to-end through the sync engine', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    clearDbTestRuntime();
    await db.close();
  });

  beforeEach(async () => {
    installDbTestRuntime(db.prisma);
    await db.prisma.temporaryCommunicationExcerpt.deleteMany({ where: { organizationId: org } });
    await db.prisma.communicationEvent.deleteMany({ where: { organizationId: org } });
    await seedConnectedAccount();
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: {
        historyId: null,
        historyState: 'unset',
        status: 'connected',
        syncLockUntil: null,
        syncLockOwner: null,
      },
    });
  });

  it('does not ingest a marked Owner notification', async () => {
    const { result, events } = await sync([message('msg_marked', { headers: [MARKER] })]);
    expect(result.run.eventsCreated).toBe(0);
    expect(result.run.messagesSkipped).toBe(1);
    expect(events).toHaveLength(0);
  });

  it('creates no temporary excerpt for a marked message', async () => {
    const { excerpts } = await sync([
      message('msg_marked_excerpt', { headers: [MARKER], body: 'Body worth excerpting' }),
    ]);
    expect(excerpts).toHaveLength(0);
  });

  it('leaves A6 no suggestion candidate, because there is no event to claim', async () => {
    const { events } = await sync([message('msg_marked_candidate', { headers: [MARKER] })]);
    // A6 claims `CommunicationEvent` rows with `suggestionProcessingStatus = 'unprocessed'`. No row
    // exists, so the candidate cannot be produced later by any downstream change.
    expect(events.filter((e) => e.suggestionProcessingStatus === 'unprocessed')).toHaveLength(0);
  });

  it('still ingests ordinary self-sent mail', async () => {
    const { result, events } = await sync([message('msg_self_sent')]);
    expect(result.run.eventsCreated).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].providerMessageId).toBe('msg_self_sent');
  });

  it('still ingests SENT plus INBOX mail under the existing D068 rules', async () => {
    const { result } = await sync([
      message('msg_sent_inbox', { labelIds: ['INBOX', 'SENT'], from: 'someone@example.com' }),
    ]);
    expect(result.run.eventsCreated).toBe(1);
  });

  it('keeps excluding Draft, Spam, and Trash for reasons that predate the marker', async () => {
    for (const label of ['DRAFT', 'SPAM', 'TRASH']) {
      await db.prisma.communicationEvent.deleteMany({ where: { organizationId: org } });
      const { result } = await sync([
        message(`msg_${label.toLowerCase()}`, { labelIds: ['INBOX', label] }),
      ]);
      expect(result.run.eventsCreated).toBe(0);
    }
  });

  it('ingests a near-miss marker rather than granting it the exclusion', async () => {
    const { result } = await sync([
      message('msg_near_miss', {
        headers: [{ name: ROCKET_GENERATED_HEADER_NAME, value: 'owner-event-notification-x' }],
      }),
    ]);
    expect(result.run.eventsCreated).toBe(1);
  });

  it('ingests a duplicated marker, failing closed without broadening the exclusion', async () => {
    const { result } = await sync([message('msg_dup_marker', { headers: [MARKER, MARKER] })]);
    expect(result.run.eventsCreated).toBe(1);
  });

  it('ingests a message that only quotes the marker in its body', async () => {
    const { result } = await sync([
      message('msg_body_quote', {
        body: 'They asked me to add X-Rocket-Generated: owner-event-notification here.',
      }),
    ]);
    expect(result.run.eventsCreated).toBe(1);
  });

  it('excludes the marked message and keeps the unmarked one in the same page', async () => {
    const { result, events } = await sync([
      message('msg_pair_marked', { headers: [MARKER] }),
      message('msg_pair_plain'),
    ]);
    expect(result.run.eventsCreated).toBe(1);
    expect(result.run.messagesSkipped).toBe(1);
    expect(events.map((e) => e.providerMessageId)).toEqual(['msg_pair_plain']);
  });
});
