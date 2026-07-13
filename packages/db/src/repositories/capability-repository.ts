import type { TaskCapability } from '@aicaa/domain';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import { fromIso, mapCapability } from '../mappers/domain-mappers.js';
import { PersistenceError, notFound, uniqueViolation } from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export type PersistedCapability = TaskCapability & { tokenHash: string };

/**
 * Persist a capability authorization record.
 * Callers supply `tokenHash` only — never a raw secret (D063). Hashing is Phase 3.
 */
export async function createCapability(
  db: Client,
  organizationId: string,
  capability: TaskCapability,
  tokenHash: string,
  revocationReason?: string | null,
): Promise<PersistedCapability> {
  if (capability.status === 'used') {
    throw new PersistenceError('VALIDATION', 'A4 must not persist CapabilityStatus.used (D056).');
  }

  try {
    const row = await db.taskCapability.create({
      data: {
        id: capability.id,
        organizationId,
        taskId: capability.taskId,
        assignmentId: capability.assignmentId,
        recipientId: capability.recipientId ?? null,
        intendedRecipientEmail: capability.intendedRecipientEmail,
        scope: asJson(capability.scope),
        status: capability.status,
        tokenHash,
        issuedAt: fromIso(capability.issuedAt)!,
        expiresAt: fromIso(capability.expiresAt)!,
        revokedAt: fromIso(capability.revokedAt ?? null),
        revocationReason: revocationReason ?? null,
        lastUsedAt: fromIso(capability.lastUsedAt ?? null),
      },
    });
    return mapCapability(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw uniqueViolation('Capability tokenHash must be unique.');
    }
    throw error;
  }
}

export async function getCapabilityById(
  db: Client,
  organizationId: string,
  capabilityId: string,
): Promise<PersistedCapability> {
  const row = await db.taskCapability.findFirst({
    where: { id: capabilityId, organizationId },
  });
  if (!row) {
    throw notFound(`Capability ${capabilityId} not found for organization.`);
  }
  return mapCapability(row);
}

export async function revokeCapabilityRecord(
  db: Client,
  organizationId: string,
  capabilityId: string,
  revokedAt: string,
  reason: string,
): Promise<PersistedCapability> {
  const existing = await getCapabilityById(db, organizationId, capabilityId);
  if (existing.status === 'revoked') {
    return existing;
  }

  const row = await db.taskCapability.update({
    where: { id: capabilityId },
    data: {
      status: 'revoked',
      revokedAt: fromIso(revokedAt)!,
      revocationReason: reason,
    },
  });
  return mapCapability(row);
}

export async function markCapabilityExpiredRecord(
  db: Client,
  organizationId: string,
  capabilityId: string,
): Promise<PersistedCapability> {
  const existing = await getCapabilityById(db, organizationId, capabilityId);
  if (existing.status === 'expired' || existing.status === 'revoked') {
    return existing;
  }
  const row = await db.taskCapability.update({
    where: { id: capabilityId },
    data: { status: 'expired' },
  });
  return mapCapability(row);
}
