import type { DbClient } from '../client/create-prisma-client.js';
import { createAuditEvent, type CreateAuditEventInput } from '../repositories/audit-repository.js';
import {
  createGmailSenderExclusion,
  deleteGmailSenderExclusionById,
  findGmailSenderExclusionByOrgAndAddress,
  isGmailSenderExclusionUniqueViolation,
  type GmailSenderExclusionRecord,
} from '../repositories/gmail-sender-exclusion-repository.js';

export type PersistGmailSenderExclusionInput = {
  db: DbClient;
  exclusion: {
    id: string;
    organizationId: string;
    senderAddress: string;
    createdByOwnerId: string;
  };
  audit: CreateAuditEventInput;
};

export type PersistGmailSenderExclusionResult = {
  exclusion: GmailSenderExclusionRecord;
  created: boolean;
};

/**
 * Create an organization-scoped Gmail sender exclusion, or return the existing row.
 *
 * Unique `(organizationId, senderAddress)` is the idempotency. A concurrent duplicate does not
 * write a second audit event.
 */
export async function persistGmailSenderExclusion(
  input: PersistGmailSenderExclusionInput,
): Promise<PersistGmailSenderExclusionResult> {
  const existing = await findGmailSenderExclusionByOrgAndAddress(
    input.db,
    input.exclusion.organizationId,
    input.exclusion.senderAddress,
  );
  if (existing) {
    return { exclusion: existing, created: false };
  }

  try {
    return await input.db.$transaction(async (tx) => {
      const exclusion = await createGmailSenderExclusion(tx, input.exclusion);
      await createAuditEvent(tx, input.audit);
      return { exclusion, created: true };
    });
  } catch (error) {
    if (!isGmailSenderExclusionUniqueViolation(error)) {
      throw error;
    }
    const raced = await findGmailSenderExclusionByOrgAndAddress(
      input.db,
      input.exclusion.organizationId,
      input.exclusion.senderAddress,
    );
    if (raced) {
      return { exclusion: raced, created: false };
    }
    throw error;
  }
}

export type RemoveGmailSenderExclusionInput = {
  db: DbClient;
  organizationId: string;
  exclusionId: string;
  audit: CreateAuditEventInput;
};

export async function removeGmailSenderExclusion(
  input: RemoveGmailSenderExclusionInput,
): Promise<GmailSenderExclusionRecord> {
  return input.db.$transaction(async (tx) => {
    const exclusion = await deleteGmailSenderExclusionById(
      tx,
      input.organizationId,
      input.exclusionId,
    );
    await createAuditEvent(tx, input.audit);
    return exclusion;
  });
}
