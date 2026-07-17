import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GMAIL_READONLY_SCOPE } from '@aicaa/domain';
import {
  createOrUpdatePendingCommunicationAccount,
  listEligibleGmailAccountsForPoll,
  persistConnectedCommunicationAccount,
  persistEncryptedGmailCredential,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const now = '2026-07-16T18:00:00.000Z';

async function seedEligibleAccount(
  db: TestDatabase,
  input: {
    orgId: string;
    accountId: string;
    credentialId: string;
    lastSuccessAt?: string | null;
    historyId?: string | null;
    historyState?: 'unset' | 'valid' | 'resync_required';
    status?: 'connected' | 'needs_reauth' | 'resync_required' | 'disconnected' | 'pending';
    withCredential?: boolean;
  },
) {
  await createOrUpdatePendingCommunicationAccount(db.prisma, {
    organizationId: input.orgId,
    accountId: input.accountId,
    emailAddress: `${input.accountId}@example.com`,
    externalAccountId: `google-${input.accountId}`,
  });
  await persistConnectedCommunicationAccount(db.prisma, {
    organizationId: input.orgId,
    accountId: input.accountId,
    emailAddress: `${input.accountId}@example.com`,
    externalAccountId: `google-${input.accountId}`,
    connectedAt: now,
    historyId: input.historyId === undefined ? 'hist_100' : input.historyId,
  });

  if (input.withCredential !== false) {
    await persistEncryptedGmailCredential(db.prisma, {
      id: input.credentialId,
      accountId: input.accountId,
      organizationId: input.orgId,
      encryptedRefreshToken: 'cipher_refresh',
      grantedScopes: GMAIL_READONLY_SCOPE,
      encryptionKeyVersion: 'v1',
    });
  }

  await db.prisma.communicationAccount.update({
    where: { id: input.accountId },
    data: {
      status: input.status ?? 'connected',
      historyState: input.historyState ?? 'valid',
      historyId: input.historyId === undefined ? 'hist_100' : input.historyId,
      lastSuccessAt:
        input.lastSuccessAt === undefined || input.lastSuccessAt === null
          ? null
          : new Date(input.lastSuccessAt),
    },
  });
}

describe('listEligibleGmailAccountsForPoll', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('includes connected valid accounts with credentials and excludes others', async () => {
    await seedEligibleAccount(db, {
      orgId: 'org_poll_ok',
      accountId: 'acct_poll_ok',
      credentialId: 'cred_poll_ok',
      lastSuccessAt: '2026-07-16T17:00:00.000Z',
    });
    await seedEligibleAccount(db, {
      orgId: 'org_poll_unset',
      accountId: 'acct_poll_unset',
      credentialId: 'cred_poll_unset',
      historyId: null,
      historyState: 'unset',
    });
    await seedEligibleAccount(db, {
      orgId: 'org_poll_reauth',
      accountId: 'acct_poll_reauth',
      credentialId: 'cred_poll_reauth',
      status: 'needs_reauth',
    });
    await seedEligibleAccount(db, {
      orgId: 'org_poll_resync',
      accountId: 'acct_poll_resync',
      credentialId: 'cred_poll_resync',
      status: 'resync_required',
      historyState: 'resync_required',
    });
    await seedEligibleAccount(db, {
      orgId: 'org_poll_nocred',
      accountId: 'acct_poll_nocred',
      credentialId: 'cred_poll_nocred',
      withCredential: false,
    });

    const eligible = await listEligibleGmailAccountsForPoll(db.prisma, { limit: 3 });
    expect(eligible).toEqual([{ id: 'acct_poll_ok', organizationId: 'org_poll_ok' }]);
  });

  it('orders by lastSuccessAt ASC NULLS FIRST then id ASC and clamps limit', async () => {
    await seedEligibleAccount(db, {
      orgId: 'org_poll_a',
      accountId: 'acct_poll_z',
      credentialId: 'cred_poll_z',
      lastSuccessAt: null,
    });
    await seedEligibleAccount(db, {
      orgId: 'org_poll_b',
      accountId: 'acct_poll_a',
      credentialId: 'cred_poll_a',
      lastSuccessAt: null,
    });
    await seedEligibleAccount(db, {
      orgId: 'org_poll_c',
      accountId: 'acct_poll_mid',
      credentialId: 'cred_poll_mid',
      lastSuccessAt: '2026-07-16T10:00:00.000Z',
    });
    await seedEligibleAccount(db, {
      orgId: 'org_poll_d',
      accountId: 'acct_poll_late',
      credentialId: 'cred_poll_late',
      lastSuccessAt: '2026-07-16T12:00:00.000Z',
    });

    const limited = await listEligibleGmailAccountsForPoll(db.prisma, { limit: 2 });
    expect(limited.map((row) => row.id)).toEqual(['acct_poll_a', 'acct_poll_z']);

    const clampedHigh = await listEligibleGmailAccountsForPoll(db.prisma, { limit: 99 });
    expect(clampedHigh).toHaveLength(3);

    const clampedLow = await listEligibleGmailAccountsForPoll(db.prisma, { limit: 0 });
    expect(clampedLow).toHaveLength(1);

    const defaultLimit = await listEligibleGmailAccountsForPoll(db.prisma);
    expect(defaultLimit).toHaveLength(3);
  });
});
