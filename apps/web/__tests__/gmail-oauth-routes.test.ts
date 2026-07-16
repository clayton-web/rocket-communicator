// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOrganizationId, asOwnerId, GMAIL_READONLY_SCOPE, ownerActor } from '@aicaa/domain';
import {
  createGmailOAuthState,
  getCommunicationAccountByOrganization,
  getGmailOAuthCredentialByAccountId,
  persistGmailConnectionTransaction,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { CIPHERTEXT_PURPOSE, encryptToken } from '@/lib/gmail/token-encryption';
import { hashOAuthState } from '@/lib/gmail/pkce';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

vi.mock('@/lib/gmail/oauth-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gmail/oauth-client')>(
    '@/lib/gmail/oauth-client',
  );
  return {
    ...actual,
    exchangeGmailCode: vi.fn(),
    verifyGmailIdentity: vi.fn(),
    revokeGmailToken: vi.fn(),
  };
});

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { exchangeGmailCode, revokeGmailToken, verifyGmailIdentity } from '@/lib/gmail/oauth-client';
import { GET as getConnection } from '@/app/api/v1/gmail/connection/route';
import { POST as startOAuth } from '@/app/api/v1/gmail/oauth/start/route';
import { GET as oauthCallback } from '@/app/api/v1/gmail/oauth/callback/route';
import { POST as disconnect } from '@/app/api/v1/gmail/disconnect/route';

const org = 'org_gmail_http';
const otherOrg = 'org_gmail_other';
const owner = ownerActor(asOwnerId('owner_gmail'), asOrganizationId(org));
const otherOwner = ownerActor(asOwnerId('owner_gmail_other'), asOrganizationId(otherOrg));
const now = '2026-07-16T15:00:00.000Z';

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

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function assertNoSecrets(payload: unknown) {
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toMatch(/refresh[_-]?token/i);
  expect(serialized).not.toMatch(/access[_-]?token/i);
  expect(serialized).not.toMatch(/code_verifier|pkce|ciphertext|encryptionKeyVersion/i);
  expect(serialized).not.toContain('enc-');
}

let db: TestDatabase;

async function seedState(rawState: string, overrides?: { expiresAt?: string }) {
  const createdAt = new Date().toISOString();
  const expiresAt = overrides?.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await createGmailOAuthState(db.prisma, {
    id: `gost_${createHash('sha256').update(rawState).digest('hex').slice(0, 12)}`,
    stateHash: hashOAuthState(rawState),
    organizationId: org,
    ownerId: owner.ownerId,
    encryptedPkceVerifier: encryptToken(
      'verifier_cb',
      CIPHERTEXT_PURPOSE.GMAIL_PKCE_VERIFIER,
      material,
    ),
    encryptionKeyVersion: '1',
    redirectPath: '/settings/gmail',
    createdAt,
    expiresAt,
  });
}

describe('A5.3 Gmail OAuth HTTP routes', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    clearDbTestRuntime();
    await db.close();
  });

  beforeEach(() => {
    installDbTestRuntime(db.prisma);
    vi.clearAllMocks();
    authOwner();
  });

  describe('GET /api/v1/gmail/connection', () => {
    it('requires Owner auth', async () => {
      vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
      const res = await getConnection(new Request('http://localhost/api/v1/gmail/connection'));
      expect(res.status).toBe(401);
    });

    it('returns not_connected when no account exists', async () => {
      const res = await getConnection(new Request('http://localhost/api/v1/gmail/connection'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('not_connected');
      expect(body.inboxOnly).toBe(true);
      expect(body.readonlyScope).toBe(true);
      expect(body.pollingIntervalMinutes).toBe(5);
      assertNoSecrets(body);
    });

    it('returns connected status without secrets and does not call Google', async () => {
      await persistGmailConnectionTransaction({
        db: db.prisma,
        organizationId: org,
        accountId: 'cacct_org',
        emailAddress: 'owner@example.com',
        externalAccountId: 'sub_status',
        connectedAt: now,
        credential: {
          id: 'gcred_org',
          encryptedRefreshToken: encryptToken(
            'rt_status',
            CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN,
            material,
          ),
          grantedScopes: GMAIL_READONLY_SCOPE,
          encryptionKeyVersion: '1',
        },
        audit: {
          id: 'audit_status',
          organizationId: org,
          actorKind: 'owner',
          ownerId: owner.ownerId,
          action: 'gmail_connected',
          outcome: 'succeeded',
          recordedAt: now,
        },
      });

      const res = await getConnection(new Request('http://localhost/api/v1/gmail/connection'));
      const body = await res.json();
      expect(body.status).toBe('connected');
      expect(body.emailAddress).toBe('owner@example.com');
      assertNoSecrets(body);
      expect(vi.mocked(exchangeGmailCode)).not.toHaveBeenCalled();
      expect(vi.mocked(verifyGmailIdentity)).not.toHaveBeenCalled();
    });

    it('isolates organizations', async () => {
      authOwner(otherOwner);
      const res = await getConnection(new Request('http://localhost/api/v1/gmail/connection'));
      const body = await res.json();
      expect(body.status).toBe('not_connected');
    });
  });

  describe('POST /api/v1/gmail/oauth/start', () => {
    it('does not export a GET handler', async () => {
      const mod = await import('@/app/api/v1/gmail/oauth/start/route');
      expect(mod).not.toHaveProperty('GET');
      expect(typeof mod.POST).toBe('function');
    });

    it('requires Owner auth', async () => {
      vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
      const res = await startOAuth(
        new Request('http://localhost/api/v1/gmail/oauth/start', { method: 'POST' }),
      );
      expect(res.status).toBe(401);
    });

    it('redirects to Google with readonly scopes; stores hash only; no-store', async () => {
      const res = await startOAuth(
        new Request('http://localhost/api/v1/gmail/oauth/start?returnPath=/settings/gmail', {
          method: 'POST',
        }),
      );
      expect(res.status).toBe(302);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const location = res.headers.get('location')!;
      const url = new URL(location);
      expect(url.hostname).toContain('accounts.google.com');
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('scope')).toContain(GMAIL_READONLY_SCOPE);
      expect(url.searchParams.get('scope')).not.toMatch(/gmail\.(modify|compose|send)/);

      const rawState = url.searchParams.get('state');
      expect(rawState).toBeTruthy();

      const bodyText = await res.text();
      expect(bodyText).not.toMatch(/code_verifier|refresh|client_secret/i);
      expect(bodyText).not.toContain(rawState!);
      expect(res.headers.get('content-type') ?? '').not.toMatch(/json/i);

      const rows = await db.prisma.gmailOAuthState.findMany({
        where: { organizationId: org },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.stateHash).toBe(hashOAuthState(rawState!));
      expect(JSON.stringify(rows[0])).not.toContain(rawState!);
      expect(rows[0]?.encryptedPkceVerifier).toBeTruthy();
      // Ciphertext must not contain the plaintext verifier value.
      expect(rows[0]?.encryptedPkceVerifier).not.toMatch(/verifier_cb|code_verifier/);
      const envelope = JSON.parse(rows[0]!.encryptedPkceVerifier!);
      expect(envelope.p).toBe(CIPHERTEXT_PURPOSE.GMAIL_PKCE_VERIFIER);
    });
  });

  describe('GET /api/v1/gmail/oauth/callback', () => {
    it('persists a connected account on a valid exchange', async () => {
      await seedState('state_valid');
      vi.mocked(exchangeGmailCode).mockResolvedValue({
        refreshToken: 'rt_valid',
        accessToken: 'at_valid',
        accessTokenExpiresAt: '2026-07-16T16:00:00.000Z',
        grantedScopes: GMAIL_READONLY_SCOPE,
        tokenType: 'Bearer',
        idToken: 'id_valid',
      });
      vi.mocked(verifyGmailIdentity).mockResolvedValue({
        email: 'owner@example.com',
        hostedDomain: 'example.com',
        subject: 'google-sub-valid',
        emailVerified: true,
      });

      const res = await oauthCallback(
        new Request(
          'http://localhost/api/v1/gmail/oauth/callback?code=auth_code&state=state_valid',
        ),
      );
      expect(res.status).toBe(302);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const location = new URL(res.headers.get('location')!);
      expect(location.pathname).toBe('/settings/gmail');
      expect(location.searchParams.get('gmail')).toBe('connected');
      expect(location.search).not.toMatch(/token|code=|rt_|at_/i);

      const account = await getCommunicationAccountByOrganization(db.prisma, org);
      expect(account?.status).toBe('connected');
      expect(account?.emailAddress).toBe('owner@example.com');
      expect(account?.historyState).toBe('unset');
      const credential = await getGmailOAuthCredentialByAccountId(db.prisma, org, account!.id);
      expect(credential?.encryptedRefreshToken).toBeTruthy();
      expect(credential?.encryptedRefreshToken).not.toContain('rt_valid');
      expect(credential?.encryptedAccessToken).toBeNull();
      const refreshEnvelope = JSON.parse(credential!.encryptedRefreshToken!);
      expect(refreshEnvelope.p).toBe(CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN);

      const consumed = await db.prisma.gmailOAuthState.findUnique({
        where: { stateHash: hashOAuthState('state_valid') },
      });
      expect(consumed?.consumedAt).not.toBeNull();
      expect(consumed?.encryptedPkceVerifier).toBeNull();
    });

    it('rejects invalid/missing state with a safe redirect', async () => {
      const res = await oauthCallback(
        new Request('http://localhost/api/v1/gmail/oauth/callback?code=x&state=missing'),
      );
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('location')!);
      expect(location.searchParams.get('gmail_error')).toBe('invalid_state');
      expect(location.search).not.toMatch(/token|code=auth/i);
    });

    it('rejects expired state with expired_state', async () => {
      await seedState('state_expired_cb', {
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const res = await oauthCallback(
        new Request('http://localhost/api/v1/gmail/oauth/callback?code=x&state=state_expired_cb'),
      );
      const location = new URL(res.headers.get('location')!);
      expect(location.searchParams.get('gmail_error')).toBe('expired_state');
    });

    it('rejects OAuth denial without echoing the provider error', async () => {
      await seedState('state_denied');
      const res = await oauthCallback(
        new Request(
          'http://localhost/api/v1/gmail/oauth/callback?error=access_denied&state=state_denied',
        ),
      );
      const location = new URL(res.headers.get('location')!);
      expect(location.searchParams.get('gmail_error')).toBe('oauth_denied');
      expect(location.search).not.toContain('access_denied');
    });

    it('rejects a domain mismatch', async () => {
      await seedState('state_domain');
      vi.mocked(exchangeGmailCode).mockResolvedValue({
        refreshToken: 'rt',
        accessToken: 'at',
        accessTokenExpiresAt: null,
        grantedScopes: GMAIL_READONLY_SCOPE,
        tokenType: 'Bearer',
        idToken: 'id',
      });
      vi.mocked(verifyGmailIdentity).mockResolvedValue({
        email: 'other@evil.example',
        hostedDomain: 'evil.example',
        subject: 'sub',
        emailVerified: true,
      });

      const res = await oauthCallback(
        new Request('http://localhost/api/v1/gmail/oauth/callback?code=auth&state=state_domain'),
      );
      const location = new URL(res.headers.get('location')!);
      expect(location.searchParams.get('gmail_error')).toBe('domain_mismatch');
    });

    it('rejects a missing refresh token', async () => {
      await seedState('state_nort');
      vi.mocked(exchangeGmailCode).mockResolvedValue({
        refreshToken: null,
        accessToken: 'at',
        accessTokenExpiresAt: null,
        grantedScopes: GMAIL_READONLY_SCOPE,
        tokenType: 'Bearer',
        idToken: 'id',
      });
      vi.mocked(verifyGmailIdentity).mockResolvedValue({
        email: 'owner@example.com',
        hostedDomain: 'example.com',
        subject: 'sub',
        emailVerified: true,
      });

      const res = await oauthCallback(
        new Request('http://localhost/api/v1/gmail/oauth/callback?code=auth&state=state_nort'),
      );
      const location = new URL(res.headers.get('location')!);
      expect(location.searchParams.get('gmail_error')).toBe('missing_refresh_token');
    });

    it('rejects replay of a consumed state', async () => {
      await seedState('state_replay');
      vi.mocked(exchangeGmailCode).mockResolvedValue({
        refreshToken: 'rt',
        accessToken: 'at',
        accessTokenExpiresAt: null,
        grantedScopes: GMAIL_READONLY_SCOPE,
        tokenType: 'Bearer',
        idToken: 'id',
      });
      vi.mocked(verifyGmailIdentity).mockResolvedValue({
        email: 'owner@example.com',
        hostedDomain: 'example.com',
        subject: 'sub-replay',
        emailVerified: true,
      });

      const first = await oauthCallback(
        new Request('http://localhost/api/v1/gmail/oauth/callback?code=a&state=state_replay'),
      );
      expect(new URL(first.headers.get('location')!).searchParams.get('gmail')).toBe('connected');

      const second = await oauthCallback(
        new Request('http://localhost/api/v1/gmail/oauth/callback?code=a&state=state_replay'),
      );
      expect(new URL(second.headers.get('location')!).searchParams.get('gmail_error')).toBe(
        'invalid_state',
      );
    });

    it('rejects PKCE ciphertext substituted with refresh-token purpose', async () => {
      const rawState = 'state_purpose_swap';
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await createGmailOAuthState(db.prisma, {
        id: 'gost_purpose_swap',
        stateHash: hashOAuthState(rawState),
        organizationId: org,
        ownerId: owner.ownerId,
        encryptedPkceVerifier: encryptToken(
          'not-a-verifier',
          CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN,
          material,
        ),
        encryptionKeyVersion: '1',
        redirectPath: '/settings/gmail',
        createdAt,
        expiresAt,
      });
      vi.mocked(exchangeGmailCode).mockResolvedValue({
        refreshToken: 'rt',
        accessToken: 'at',
        accessTokenExpiresAt: null,
        grantedScopes: GMAIL_READONLY_SCOPE,
        tokenType: 'Bearer',
        idToken: 'id',
      });

      const res = await oauthCallback(
        new Request(`http://localhost/api/v1/gmail/oauth/callback?code=auth&state=${rawState}`),
      );
      const location = new URL(res.headers.get('location')!);
      expect(location.searchParams.get('gmail_error')).toBe('invalid_state');
      expect(vi.mocked(exchangeGmailCode)).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/gmail/disconnect', () => {
    it('requires Owner auth and explicit confirmation', async () => {
      vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
      const unauth = await disconnect(
        jsonRequest('http://localhost/api/v1/gmail/disconnect', 'POST', {
          confirmation: 'confirmed',
        }),
      );
      expect(unauth.status).toBe(401);

      authOwner();
      const bad = await disconnect(
        jsonRequest('http://localhost/api/v1/gmail/disconnect', 'POST', {
          confirmation: 'nope',
        }),
      );
      expect(bad.status).toBe(400);
    });

    it('wipes credentials even when Google revocation fails', async () => {
      const existing = await getCommunicationAccountByOrganization(db.prisma, org);
      const accountId = existing?.id ?? 'cacct_org';
      await persistGmailConnectionTransaction({
        db: db.prisma,
        organizationId: org,
        accountId,
        emailAddress: 'owner@example.com',
        externalAccountId: 'sub_disc',
        connectedAt: now,
        credential: {
          id: 'gcred_org',
          encryptedRefreshToken: encryptToken(
            'rt_disc',
            CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN,
            material,
          ),
          grantedScopes: GMAIL_READONLY_SCOPE,
          encryptionKeyVersion: '1',
        },
        audit: {
          id: 'audit_disc_connect',
          organizationId: org,
          actorKind: 'owner',
          ownerId: owner.ownerId,
          action: 'gmail_connected',
          outcome: 'succeeded',
          recordedAt: now,
        },
      });
      vi.mocked(revokeGmailToken).mockResolvedValue(false);

      const res = await disconnect(
        jsonRequest('http://localhost/api/v1/gmail/disconnect', 'POST', {
          confirmation: 'confirmed',
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.connection.status).toBe('disconnected');
      assertNoSecrets(body);

      const account = await getCommunicationAccountByOrganization(db.prisma, org);
      expect(account?.status).toBe('disconnected');
      expect(account?.syncLockUntil).toBeNull();
      const credential = await getGmailOAuthCredentialByAccountId(db.prisma, org, accountId);
      expect(credential).toBeNull();
    });

    it('is idempotent for an already-disconnected account', async () => {
      const res = await disconnect(
        jsonRequest('http://localhost/api/v1/gmail/disconnect', 'POST', {
          confirmation: 'confirmed',
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.connection.status).toBe('disconnected');
    });

    it('returns 404 when no account exists for the organization', async () => {
      authOwner(otherOwner);
      const res = await disconnect(
        jsonRequest('http://localhost/api/v1/gmail/disconnect', 'POST', {
          confirmation: 'confirmed',
        }),
      );
      expect(res.status).toBe(404);
    });
  });
});
