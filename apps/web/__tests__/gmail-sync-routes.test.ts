// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOrganizationId, asOwnerId, GMAIL_READONLY_SCOPE, ownerActor } from '@aicaa/domain';
import {
  acquireGmailSyncLock,
  createGmailSyncRun,
  finishGmailSyncRun,
  getCommunicationAccountByOrganization,
  persistGmailConnectionTransaction,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { CIPHERTEXT_PURPOSE, encryptToken } from '@/lib/gmail/token-encryption';

const { mockGetAccessToken } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
}));

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    setCredentials: vi.fn(),
    getAccessToken: mockGetAccessToken,
  })),
}));

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { POST as postSync } from '@/app/api/v1/gmail/sync/route';
import { GET as getSyncRuns } from '@/app/api/v1/gmail/sync-runs/route';

const org = 'org_test_123';
const owner = ownerActor(asOwnerId('owner_gmail_routes'), asOrganizationId(org));
const now = '2026-07-16T17:00:00.000Z';
const accountId = 'cacct_sync_routes';
const credentialId = 'gcred_sync_routes';

const material = {
  key: Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex'),
  version: '1',
};

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

function assertSafeDto(payload: unknown) {
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toMatch(/refresh[_-]?token/i);
  expect(serialized).not.toMatch(/access[_-]?token/i);
  expect(serialized).not.toMatch(/historyId/i);
  expect(serialized).not.toContain('enc-');
  expect(serialized).not.toContain('rt_sync');
  expect(serialized).not.toContain('ya29');
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let db: TestDatabase;
const fetchMock = vi.fn();

async function seedConnectedAccount() {
  await persistGmailConnectionTransaction({
    db: db.prisma,
    organizationId: org,
    accountId,
    emailAddress: 'owner@example.com',
    externalAccountId: 'google-sub-routes',
    connectedAt: now,
    credential: {
      id: credentialId,
      encryptedRefreshToken: encryptToken(
        'rt_sync_routes',
        CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN,
        material,
      ),
      grantedScopes: GMAIL_READONLY_SCOPE,
      encryptionKeyVersion: '1',
    },
    audit: {
      id: `audit_routes_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      organizationId: org,
      actorKind: 'owner',
      ownerId: owner.ownerId,
      action: 'gmail_connected',
      outcome: 'succeeded',
      recordedAt: now,
    },
  });

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
}

describe('A5.4 Gmail sync HTTP routes', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    clearDbTestRuntime();
    vi.unstubAllGlobals();
    await db.close();
  });

  beforeEach(async () => {
    installDbTestRuntime(db.prisma);
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    mockGetAccessToken.mockResolvedValue({ token: 'ya29.test_access' });
    authOwner();
    await seedConnectedAccount();
  });

  describe('POST /api/v1/gmail/sync', () => {
    it('requires Owner auth', async () => {
      vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
      const res = await postSync(
        new Request('http://localhost/api/v1/gmail/sync', { method: 'POST' }),
      );
      expect(res.status).toBe(401);
    });

    it('runs initial sync and returns safe DTOs', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          emailAddress: 'owner@example.com',
          historyId: '7777',
        }),
      );

      const res = await postSync(
        new Request('http://localhost/api/v1/gmail/sync', { method: 'POST' }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = await res.json();
      expect(body.run.trigger).toBe('initial');
      expect(body.run.outcome).toBe('succeeded');
      expect(body.run.eventsCreated).toBe(0);
      expect(body.connection.status).toBe('connected');
      assertSafeDto(body);

      const account = await getCommunicationAccountByOrganization(db.prisma, org);
      expect(account?.historyId).toBe('7777');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/profile');
    });

    it('maps lock conflict to 409', async () => {
      const lockUntil = new Date(Date.now() + 60_000).toISOString();
      const lock = await acquireGmailSyncLock(
        db.prisma,
        org,
        accountId,
        lockUntil,
        new Date().toISOString(),
        'held_by_other',
      );
      expect(lock.acquired).toBe(true);

      const res = await postSync(jsonRequest('http://localhost/api/v1/gmail/sync', 'POST', {}));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('DOMAIN_CONFLICT');
      assertSafeDto(body);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/gmail/sync-runs', () => {
    it('requires Owner auth', async () => {
      vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
      const res = await getSyncRuns(new Request('http://localhost/api/v1/gmail/sync-runs'));
      expect(res.status).toBe(401);
    });

    it('returns paginated safe sync-run DTOs without historyId or tokens', async () => {
      const run = await createGmailSyncRun(db.prisma, {
        id: 'gsrun_list_1',
        organizationId: org,
        accountId,
        trigger: 'manual',
        startedAt: now,
        historyIdBefore: '100',
        requestId: 'req_list_1',
      });
      await finishGmailSyncRun(db.prisma, {
        organizationId: org,
        runId: run.id,
        outcome: 'succeeded',
        finishedAt: now,
        historyIdAfter: '200',
        messagesExamined: 1,
        eventsCreated: 1,
        eventsUpdated: 0,
        messagesSkipped: 0,
      });

      const res = await getSyncRuns(
        new Request('http://localhost/api/v1/gmail/sync-runs?limit=10'),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = await res.json();
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.nextCursor === null || typeof body.nextCursor === 'string').toBe(true);

      const item = body.items.find((row: { id: string }) => row.id === 'gsrun_list_1');
      expect(item).toMatchObject({
        id: 'gsrun_list_1',
        trigger: 'manual',
        outcome: 'succeeded',
        messagesExamined: 1,
        eventsCreated: 1,
      });
      expect(item).not.toHaveProperty('historyId');
      expect(item).not.toHaveProperty('historyIdBefore');
      expect(item).not.toHaveProperty('historyIdAfter');
      expect(item).not.toHaveProperty('organizationId');
      expect(item).not.toHaveProperty('accountId');
      assertSafeDto(body);
    });
  });
});
