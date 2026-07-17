// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GMAIL_READONLY_SCOPE } from '@aicaa/domain';
import { persistGmailConnectionTransaction } from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { CIPHERTEXT_PURPOSE, encryptToken } from '@/lib/gmail/token-encryption';
import { GET, POST } from '@/app/api/v1/internal/gmail/poll/route';

const SECRET = 'cron-secret-for-route-tests-32chars!';
const org = 'org_poll_route';
const now = '2026-07-16T22:30:00.000Z';
const accountId = 'cacct_poll_route';

const material = {
  key: Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex'),
  version: '1',
};

let db: TestDatabase;

function pollRequest(method: 'GET' | 'POST', auth?: string | null): Request {
  const headers = new Headers();
  if (auth !== null) {
    headers.set('authorization', auth ?? `Bearer ${SECRET}`);
  }
  return new Request('http://localhost/api/v1/internal/gmail/poll', { method, headers });
}

describe('A5.5 internal Gmail poll routes', () => {
  beforeAll(async () => {
    process.env.CRON_SECRET = SECRET;
    process.env.OWNER_ORGANIZATION_ID = org;
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY_VERSION = '1';
    db = await createTestDatabase();
  });

  afterAll(async () => {
    clearDbTestRuntime();
    delete process.env.CRON_SECRET;
    await db.close();
  });

  beforeEach(async () => {
    process.env.CRON_SECRET = SECRET;
    installDbTestRuntime(db.prisma);
  });

  it('GET unauthorized without Bearer', async () => {
    const res = await GET(pollRequest('GET', null));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it('POST unauthorized with wrong secret', async () => {
    const res = await POST(pollRequest('POST', 'Bearer wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('GET and POST succeed with the same aggregate shape', async () => {
    await persistGmailConnectionTransaction({
      db: db.prisma,
      organizationId: org,
      accountId,
      emailAddress: 'owner@example.com',
      externalAccountId: 'google-sub-route',
      connectedAt: now,
      credential: {
        id: 'gcred_poll_route',
        encryptedRefreshToken: encryptToken(
          'rt_route',
          CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN,
          material,
        ),
        grantedScopes: GMAIL_READONLY_SCOPE,
        encryptionKeyVersion: '1',
      },
      audit: {
        id: `audit_poll_route_${Date.now()}`,
        organizationId: org,
        actorKind: 'owner',
        ownerId: 'owner_poll_route',
        action: 'gmail_connected',
        outcome: 'succeeded',
        recordedAt: now,
      },
    });
    // Unset history → not eligible → zero runs, still 200.
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyId: null, historyState: 'unset' },
    });

    const getRes = await GET(pollRequest('GET'));
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Cache-Control')).toBe('no-store');
    const getBody = await getRes.json();
    expect(getBody).toEqual({
      runsProcessed: 0,
      skippedLocked: 0,
      requestId: expect.any(String),
    });
    expect(JSON.stringify(getBody)).not.toMatch(/example\.com|rt_route|History|token/i);

    const postRes = await POST(pollRequest('POST'));
    expect(postRes.status).toBe(200);
    const postBody = await postRes.json();
    expect(postBody).toEqual({
      runsProcessed: 0,
      skippedLocked: 0,
      requestId: expect.any(String),
    });
  });

  it('returns 500 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(pollRequest('GET'));
    expect(res.status).toBe(500);
  });
});
