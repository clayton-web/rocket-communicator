import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { GMAIL_READONLY_SCOPE } from '@aicaa/domain';
import {
  consumeGmailOAuthState,
  createGmailOAuthState,
  deleteFinishedGmailOAuthStates,
  getCommunicationAccountByOrganization,
  getGmailOAuthCredentialByAccountId,
  inspectGmailOAuthState,
  persistGmailConnectionTransaction,
  persistGmailDisconnectTransaction,
} from '../src/index.js';
import type { CreateAuditEventInput } from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const org = 'org_oauth_a';
const owner = 'owner_oauth_a';
const now = '2026-07-16T12:00:00.000Z';
const later = '2026-07-16T12:20:00.000Z';

function hash(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function connectionAudit(action: string): CreateAuditEventInput {
  return {
    id: `audit_${action}_${Math.random().toString(36).slice(2)}`,
    organizationId: org,
    actorKind: 'owner',
    ownerId: owner,
    action,
    outcome: 'succeeded',
    recordedAt: now,
  };
}

describe('A5.3 Gmail OAuth state store (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('stores stateHash only and never a raw state column', async () => {
    const raw = 'raw_state_value_never_persisted';
    await createGmailOAuthState(db.prisma, {
      id: 'gost_hash',
      stateHash: hash(raw),
      organizationId: org,
      ownerId: owner,
      encryptedPkceVerifier: 'v1:enc-pkce',
      encryptionKeyVersion: '1',
      redirectPath: '/settings/gmail',
      createdAt: now,
      expiresAt: later,
    });

    const rows = await db.prisma.gmailOAuthState.findMany({ where: { id: 'gost_hash' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.stateHash).toBe(hash(raw));
    expect(JSON.stringify(rows[0])).not.toContain(raw);
    expect(rows[0]).not.toHaveProperty('codeVerifier');
  });

  it('atomically consumes by stateHash and wipes encrypted PKCE', async () => {
    await createGmailOAuthState(db.prisma, {
      id: 'gost_ok',
      stateHash: hash('state_ok'),
      organizationId: org,
      ownerId: owner,
      encryptedPkceVerifier: 'v1:enc-pkce-ok',
      encryptionKeyVersion: '1',
      redirectPath: '/settings/gmail',
      createdAt: now,
      expiresAt: later,
    });

    const consumed = await consumeGmailOAuthState(db.prisma, {
      stateHash: hash('state_ok'),
      now,
    });
    expect(consumed).not.toBeNull();
    expect(consumed?.encryptedPkceVerifier).toBe('v1:enc-pkce-ok');
    expect(consumed?.organizationId).toBe(org);

    const after = await db.prisma.gmailOAuthState.findUnique({ where: { id: 'gost_ok' } });
    expect(after?.consumedAt).not.toBeNull();
    expect(after?.encryptedPkceVerifier).toBeNull();
  });

  it('rejects wrong state hash', async () => {
    await createGmailOAuthState(db.prisma, {
      id: 'gost_wrong',
      stateHash: hash('correct'),
      organizationId: org,
      ownerId: owner,
      encryptedPkceVerifier: 'v1:enc',
      encryptionKeyVersion: '1',
      redirectPath: '/settings/gmail',
      createdAt: now,
      expiresAt: later,
    });
    const consumed = await consumeGmailOAuthState(db.prisma, {
      stateHash: hash('incorrect'),
      now,
    });
    expect(consumed).toBeNull();
  });

  it('rejects replay of an already-consumed state', async () => {
    await createGmailOAuthState(db.prisma, {
      id: 'gost_replay',
      stateHash: hash('state_replay'),
      organizationId: org,
      ownerId: owner,
      encryptedPkceVerifier: 'v1:enc-replay',
      encryptionKeyVersion: '1',
      redirectPath: '/settings/gmail',
      createdAt: now,
      expiresAt: later,
    });

    const first = await consumeGmailOAuthState(db.prisma, {
      stateHash: hash('state_replay'),
      now,
    });
    const second = await consumeGmailOAuthState(db.prisma, {
      stateHash: hash('state_replay'),
      now,
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('rejects an expired state', async () => {
    await createGmailOAuthState(db.prisma, {
      id: 'gost_expired',
      stateHash: hash('state_expired'),
      organizationId: org,
      ownerId: owner,
      encryptedPkceVerifier: 'v1:enc-expired',
      encryptionKeyVersion: '1',
      redirectPath: '/settings/gmail',
      createdAt: '2026-07-16T11:00:00.000Z',
      expiresAt: '2026-07-16T11:10:00.000Z',
    });

    const consumed = await consumeGmailOAuthState(db.prisma, {
      stateHash: hash('state_expired'),
      now,
    });
    expect(consumed).toBeNull();
    const inspected = await inspectGmailOAuthState(db.prisma, {
      stateHash: hash('state_expired'),
    });
    expect(inspected?.consumedAt).toBeNull();
  });

  it('allows only one winner under concurrent consumption', async () => {
    await createGmailOAuthState(db.prisma, {
      id: 'gost_concurrent',
      stateHash: hash('state_concurrent'),
      organizationId: org,
      ownerId: owner,
      encryptedPkceVerifier: 'v1:enc-concurrent',
      encryptionKeyVersion: '1',
      redirectPath: '/settings/gmail',
      createdAt: now,
      expiresAt: later,
    });

    const [a, b] = await Promise.all([
      consumeGmailOAuthState(db.prisma, { stateHash: hash('state_concurrent'), now }),
      consumeGmailOAuthState(db.prisma, { stateHash: hash('state_concurrent'), now }),
    ]);

    const winners = [a, b].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.encryptedPkceVerifier).toBe('v1:enc-concurrent');
  });

  it('purges expired and consumed states', async () => {
    await createGmailOAuthState(db.prisma, {
      id: 'gost_purge',
      stateHash: hash('state_purge'),
      organizationId: org,
      ownerId: owner,
      encryptedPkceVerifier: 'v',
      encryptionKeyVersion: '1',
      redirectPath: '/settings/gmail',
      createdAt: '2026-07-16T10:00:00.000Z',
      expiresAt: '2026-07-16T10:10:00.000Z',
    });
    const removed = await deleteFinishedGmailOAuthStates(db.prisma, { before: now });
    expect(removed).toBeGreaterThanOrEqual(1);
  });
});

describe('A5.3 Gmail connection transactions (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('persists a new connection with encrypted credential and Owner audit atomically', async () => {
    const result = await persistGmailConnectionTransaction({
      db: db.prisma,
      organizationId: org,
      accountId: 'acct_connect',
      emailAddress: 'owner@acme.example',
      externalAccountId: 'google-sub-1',
      connectedAt: now,
      credential: {
        id: 'cred_connect',
        encryptedRefreshToken: 'v1:enc-refresh',
        grantedScopes: GMAIL_READONLY_SCOPE,
        encryptionKeyVersion: '1',
      },
      audit: connectionAudit('gmail_connected'),
    });

    expect(result.account.status).toBe('connected');
    expect(result.account.historyState).toBe('unset');
    const credential = await getGmailOAuthCredentialByAccountId(db.prisma, org, 'acct_connect');
    expect(credential?.encryptedRefreshToken).toBe('v1:enc-refresh');
  });

  it('replaces the encrypted refresh token on reconnect without duplicating the account', async () => {
    await persistGmailConnectionTransaction({
      db: db.prisma,
      organizationId: org,
      accountId: 'acct_connect',
      emailAddress: 'owner@acme.example',
      externalAccountId: 'google-sub-1',
      connectedAt: later,
      credential: {
        id: 'cred_connect',
        encryptedRefreshToken: 'v1:enc-refresh-rotated',
        grantedScopes: GMAIL_READONLY_SCOPE,
        encryptionKeyVersion: '1',
      },
      audit: connectionAudit('gmail_reconnected'),
    });

    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.id).toBe('acct_connect');
    const credential = await getGmailOAuthCredentialByAccountId(db.prisma, org, 'acct_connect');
    expect(credential?.encryptedRefreshToken).toBe('v1:enc-refresh-rotated');
  });

  it('wipes credential ciphertext and marks disconnected atomically', async () => {
    await persistGmailDisconnectTransaction({
      db: db.prisma,
      organizationId: org,
      accountId: 'acct_connect',
      disconnectedAt: later,
      audit: connectionAudit('gmail_disconnected'),
    });

    const account = await getCommunicationAccountByOrganization(db.prisma, org);
    expect(account?.status).toBe('disconnected');
    const credential = await getGmailOAuthCredentialByAccountId(db.prisma, org, 'acct_connect');
    expect(credential).toBeNull();
  });
});
