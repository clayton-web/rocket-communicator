import type { CommunicationAccount } from '@aicaa/domain';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { fromIso, mapCommunicationAccount } from '../mappers/domain-mappers.js';
import { notFound, organizationMismatch } from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

export async function getCommunicationAccountByOrganization(
  db: Client,
  organizationId: string,
): Promise<CommunicationAccount | null> {
  const row = await db.communicationAccount.findUnique({
    where: {
      organizationId_provider: {
        organizationId,
        provider: 'gmail',
      },
    },
  });
  return row ? mapCommunicationAccount(row) : null;
}

export async function getCommunicationAccountById(
  db: Client,
  organizationId: string,
  accountId: string,
): Promise<CommunicationAccount> {
  const row = await db.communicationAccount.findFirst({
    where: { id: accountId, organizationId },
  });
  if (!row) {
    throw notFound(`CommunicationAccount ${accountId} not found for organization.`);
  }
  return mapCommunicationAccount(row);
}

/** Create or refresh a pending Gmail account row (OAuth in progress). One Gmail account per org. */
export async function createOrUpdatePendingCommunicationAccount(
  db: Client,
  input: {
    organizationId: string;
    accountId: string;
    emailAddress: string;
    externalAccountId: string;
  },
): Promise<CommunicationAccount> {
  const existing = await db.communicationAccount.findUnique({
    where: {
      organizationId_provider: {
        organizationId: input.organizationId,
        provider: 'gmail',
      },
    },
  });

  if (existing && existing.id !== input.accountId) {
    throw organizationMismatch(
      'Organization already has a Gmail CommunicationAccount with a different id.',
    );
  }

  const row = await db.communicationAccount.upsert({
    where: { id: input.accountId },
    create: {
      id: input.accountId,
      organizationId: input.organizationId,
      provider: 'gmail',
      emailAddress: input.emailAddress,
      externalAccountId: input.externalAccountId,
      status: 'pending',
      historyState: 'unset',
      historyId: null,
      connectedAt: null,
      disconnectedAt: null,
      lastSyncAt: null,
      lastSuccessAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
      syncLockUntil: null,
    },
    update: {
      emailAddress: input.emailAddress,
      externalAccountId: input.externalAccountId,
      status: 'pending',
      disconnectedAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
    },
  });

  if (row.organizationId !== input.organizationId) {
    throw organizationMismatch('CommunicationAccount belongs to a different organization.');
  }

  return mapCommunicationAccount(row);
}

export async function persistConnectedCommunicationAccount(
  db: Client,
  input: {
    organizationId: string;
    accountId: string;
    emailAddress: string;
    externalAccountId: string;
    connectedAt: string;
    historyId?: string | null;
  },
): Promise<CommunicationAccount> {
  const row = await db.communicationAccount.update({
    where: { id: input.accountId },
    data: {
      emailAddress: input.emailAddress,
      externalAccountId: input.externalAccountId,
      status: 'connected',
      historyState: input.historyId ? 'valid' : 'unset',
      historyId: input.historyId ?? null,
      connectedAt: fromIso(input.connectedAt)!,
      disconnectedAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
    },
  });
  if (row.organizationId !== input.organizationId) {
    throw organizationMismatch('CommunicationAccount belongs to a different organization.');
  }
  return mapCommunicationAccount(row);
}

export async function markCommunicationAccountNeedsReauth(
  db: Client,
  organizationId: string,
  accountId: string,
  errorCode: string,
  at: string,
): Promise<CommunicationAccount> {
  const row = await db.communicationAccount.update({
    where: { id: accountId },
    data: {
      status: 'needs_reauth',
      lastErrorCode: errorCode,
      lastErrorAt: fromIso(at)!,
    },
  });
  if (row.organizationId !== organizationId) {
    throw organizationMismatch('CommunicationAccount belongs to a different organization.');
  }
  return mapCommunicationAccount(row);
}

export async function markCommunicationAccountResyncRequired(
  db: Client,
  organizationId: string,
  accountId: string,
  errorCode: string,
  at: string,
): Promise<CommunicationAccount> {
  const row = await db.communicationAccount.update({
    where: { id: accountId },
    data: {
      status: 'resync_required',
      historyState: 'resync_required',
      lastErrorCode: errorCode,
      lastErrorAt: fromIso(at)!,
    },
  });
  if (row.organizationId !== organizationId) {
    throw organizationMismatch('CommunicationAccount belongs to a different organization.');
  }
  return mapCommunicationAccount(row);
}

/**
 * Disconnect account and delete encrypted credential material (cascade).
 * Does not delete durable CommunicationEvent provider ids.
 */
export async function disconnectCommunicationAccount(
  db: Client,
  organizationId: string,
  accountId: string,
  disconnectedAt: string,
): Promise<CommunicationAccount> {
  await db.gmailOAuthCredential.deleteMany({
    where: { accountId, organizationId },
  });

  const row = await db.communicationAccount.update({
    where: { id: accountId },
    data: {
      status: 'disconnected',
      disconnectedAt: fromIso(disconnectedAt)!,
      syncLockUntil: null,
      syncLockOwner: null,
      lastErrorCode: null,
      lastErrorAt: null,
    },
  });
  if (row.organizationId !== organizationId) {
    throw organizationMismatch('CommunicationAccount belongs to a different organization.');
  }
  return mapCommunicationAccount(row);
}

export async function acquireGmailSyncLock(
  db: Client,
  organizationId: string,
  accountId: string,
  lockUntil: string,
  now: string,
  lockOwner: string,
): Promise<{ acquired: boolean; account: CommunicationAccount | null }> {
  const nowDate = fromIso(now)!;
  const result = await db.communicationAccount.updateMany({
    where: {
      id: accountId,
      organizationId,
      OR: [{ syncLockUntil: null }, { syncLockUntil: { lt: nowDate } }],
    },
    data: {
      syncLockUntil: fromIso(lockUntil)!,
      syncLockOwner: lockOwner,
    },
  });

  if (result.count === 0) {
    const existing = await getCommunicationAccountByOrganization(db, organizationId);
    return { acquired: false, account: existing };
  }

  const account = await getCommunicationAccountById(db, organizationId, accountId);
  return { acquired: true, account };
}

/**
 * Release a sync lock. Only the owning token may clear a non-expired lock.
 * Expired locks may be cleared by any caller (stale reclaim cleanup).
 */
export async function releaseGmailSyncLock(
  db: Client,
  organizationId: string,
  accountId: string,
  lockOwner: string,
  now: string,
): Promise<{ released: boolean; account: CommunicationAccount }> {
  const nowDate = fromIso(now)!;
  const owned = await db.communicationAccount.updateMany({
    where: {
      id: accountId,
      organizationId,
      syncLockOwner: lockOwner,
    },
    data: {
      syncLockUntil: null,
      syncLockOwner: null,
    },
  });
  if (owned.count === 1) {
    const account = await getCommunicationAccountById(db, organizationId, accountId);
    return { released: true, account };
  }

  const stale = await db.communicationAccount.updateMany({
    where: {
      id: accountId,
      organizationId,
      syncLockUntil: { lt: nowDate },
    },
    data: {
      syncLockUntil: null,
      syncLockOwner: null,
    },
  });
  const account = await getCommunicationAccountById(db, organizationId, accountId);
  return { released: stale.count === 1, account };
}
