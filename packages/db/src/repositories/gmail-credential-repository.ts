import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { fromIso, type GmailOAuthCredentialRecord } from '../mappers/domain-mappers.js';
import { notFound, organizationMismatch } from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

function mapCredential(row: {
  id: string;
  accountId: string;
  organizationId: string;
  encryptedRefreshToken: string;
  encryptedAccessToken: string | null;
  accessTokenExpiresAt: Date | null;
  grantedScopes: string;
  tokenType: string | null;
  encryptionKeyVersion: string;
}): GmailOAuthCredentialRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    organizationId: row.organizationId,
    encryptedRefreshToken: row.encryptedRefreshToken,
    encryptedAccessToken: row.encryptedAccessToken,
    accessTokenExpiresAt: row.accessTokenExpiresAt ? row.accessTokenExpiresAt.toISOString() : null,
    grantedScopes: row.grantedScopes,
    tokenType: row.tokenType,
    encryptionKeyVersion: row.encryptionKeyVersion,
  };
}

/**
 * Persist ciphertext-only Gmail OAuth material (D070).
 * Callers supply already-encrypted token strings — encryption is a later A5 chunk.
 */
export async function persistEncryptedGmailCredential(
  db: Client,
  input: {
    id: string;
    accountId: string;
    organizationId: string;
    encryptedRefreshToken: string;
    encryptedAccessToken?: string | null;
    accessTokenExpiresAt?: string | null;
    grantedScopes: string;
    tokenType?: string | null;
    encryptionKeyVersion: string;
  },
): Promise<GmailOAuthCredentialRecord> {
  const row = await db.gmailOAuthCredential.upsert({
    where: { accountId: input.accountId },
    create: {
      id: input.id,
      accountId: input.accountId,
      organizationId: input.organizationId,
      encryptedRefreshToken: input.encryptedRefreshToken,
      encryptedAccessToken: input.encryptedAccessToken ?? null,
      accessTokenExpiresAt: fromIso(input.accessTokenExpiresAt ?? null),
      grantedScopes: input.grantedScopes,
      tokenType: input.tokenType ?? null,
      encryptionKeyVersion: input.encryptionKeyVersion,
    },
    update: {
      encryptedRefreshToken: input.encryptedRefreshToken,
      encryptedAccessToken: input.encryptedAccessToken ?? null,
      accessTokenExpiresAt: fromIso(input.accessTokenExpiresAt ?? null),
      grantedScopes: input.grantedScopes,
      tokenType: input.tokenType ?? null,
      encryptionKeyVersion: input.encryptionKeyVersion,
    },
  });

  if (row.organizationId !== input.organizationId) {
    throw organizationMismatch('GmailOAuthCredential belongs to a different organization.');
  }

  return mapCredential(row);
}

export async function getGmailOAuthCredentialByAccountId(
  db: Client,
  organizationId: string,
  accountId: string,
): Promise<GmailOAuthCredentialRecord | null> {
  const row = await db.gmailOAuthCredential.findFirst({
    where: { accountId, organizationId },
  });
  return row ? mapCredential(row) : null;
}

export async function requireGmailOAuthCredentialByAccountId(
  db: Client,
  organizationId: string,
  accountId: string,
): Promise<GmailOAuthCredentialRecord> {
  const row = await getGmailOAuthCredentialByAccountId(db, organizationId, accountId);
  if (!row) {
    throw notFound(`GmailOAuthCredential for account ${accountId} not found.`);
  }
  return row;
}
