import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { fromIso, toIso } from '../mappers/domain-mappers.js';

type Client = DbClient | DbTransaction;

export type GmailOAuthStateRecord = {
  id: string;
  stateHash: string;
  organizationId: string;
  ownerId: string;
  /** Present only on successful atomic consume (pre-wipe value). Null after wipe / on inspect. */
  encryptedPkceVerifier: string | null;
  encryptionKeyVersion: string;
  redirectPath: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

/**
 * Persist a short-lived, single-use Owner Gmail OAuth state (A5.3).
 * Stores SHA-256 `stateHash` and an encrypted PKCE verifier envelope — never the raw state,
 * plaintext verifier, authorization code, or OAuth tokens.
 */
export async function createGmailOAuthState(
  db: Client,
  input: {
    id: string;
    stateHash: string;
    organizationId: string;
    ownerId: string;
    encryptedPkceVerifier: string;
    encryptionKeyVersion: string;
    redirectPath: string;
    createdAt: string;
    expiresAt: string;
  },
): Promise<void> {
  await db.gmailOAuthState.create({
    data: {
      id: input.id,
      stateHash: input.stateHash,
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      encryptedPkceVerifier: input.encryptedPkceVerifier,
      encryptionKeyVersion: input.encryptionKeyVersion,
      redirectPath: input.redirectPath,
      createdAt: fromIso(input.createdAt)!,
      expiresAt: fromIso(input.expiresAt)!,
      consumedAt: null,
    },
  });
}

/**
 * Atomically consume an OAuth state exactly once by `stateHash`.
 * The single winner receives the encrypted PKCE verifier; concurrent or replayed
 * consumption, expiry, missing verifier, or an unknown hash all return null.
 * On success the encrypted verifier column is nulled so it cannot be reused.
 */
export async function consumeGmailOAuthState(
  db: DbClient,
  input: { stateHash: string; now: string },
): Promise<GmailOAuthStateRecord | null> {
  const nowDate = fromIso(input.now)!;

  return db.$transaction(async (tx) => {
    const row = await tx.gmailOAuthState.findFirst({
      where: {
        stateHash: input.stateHash,
        consumedAt: null,
        expiresAt: { gt: nowDate },
        encryptedPkceVerifier: { not: null },
      },
    });
    if (!row || !row.encryptedPkceVerifier) {
      return null;
    }

    const result = await tx.gmailOAuthState.updateMany({
      where: {
        id: row.id,
        consumedAt: null,
        expiresAt: { gt: nowDate },
        encryptedPkceVerifier: { not: null },
      },
      data: {
        consumedAt: nowDate,
        encryptedPkceVerifier: null,
      },
    });

    if (result.count !== 1) {
      return null;
    }

    return {
      id: row.id,
      stateHash: row.stateHash,
      organizationId: row.organizationId,
      ownerId: row.ownerId,
      encryptedPkceVerifier: row.encryptedPkceVerifier,
      encryptionKeyVersion: row.encryptionKeyVersion,
      redirectPath: row.redirectPath,
      createdAt: toIso(row.createdAt),
      expiresAt: toIso(row.expiresAt),
      consumedAt: toIso(nowDate),
    };
  });
}

/**
 * Inspect a state row by hash without consuming it.
 * Used only to distinguish expired vs unknown/replayed for safe redirect categories.
 * Never returns the encrypted verifier.
 */
export async function inspectGmailOAuthState(
  db: Client,
  input: { stateHash: string },
): Promise<{
  expiresAt: string;
  consumedAt: string | null;
  redirectPath: string;
} | null> {
  const row = await db.gmailOAuthState.findUnique({
    where: { stateHash: input.stateHash },
    select: {
      expiresAt: true,
      consumedAt: true,
      redirectPath: true,
    },
  });
  if (!row) {
    return null;
  }
  return {
    expiresAt: toIso(row.expiresAt),
    consumedAt: row.consumedAt ? toIso(row.consumedAt) : null,
    redirectPath: row.redirectPath,
  };
}

/** Best-effort cleanup of expired or already-consumed OAuth state rows. */
export async function deleteFinishedGmailOAuthStates(
  db: Client,
  input: { before: string },
): Promise<number> {
  const beforeDate = fromIso(input.before)!;
  const result = await db.gmailOAuthState.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: beforeDate } }, { consumedAt: { not: null } }],
    },
  });
  return result.count;
}
