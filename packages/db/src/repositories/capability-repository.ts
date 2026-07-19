import type { CapabilityRevocationReason, TaskCapability } from '@aicaa/domain';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import { fromIso, mapCapability } from '../mappers/domain-mappers.js';
import {
  PersistenceError,
  notFound,
  persistenceValidation,
  uniqueViolation,
} from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export type PersistedCapability = TaskCapability & {
  tokenHash: string;
  organizationId: string;
  actionableAt: string | null;
};

const REVOCATION_REASONS = new Set<CapabilityRevocationReason>([
  'superseded',
  'manual',
  'assignment_ended',
  'expired',
]);

export function assertCapabilityRevocationReason(
  reason: string,
): asserts reason is CapabilityRevocationReason {
  if (!REVOCATION_REASONS.has(reason as CapabilityRevocationReason)) {
    throw persistenceValidation(
      `Unsupported capability revocation reason: ${reason}. Expected superseded|manual|assignment_ended|expired.`,
    );
  }
}

/**
 * Persist a capability authorization record.
 * Callers supply `tokenHash` only — never a raw secret (D063).
 *
 * `actionableAt`:
 * - A4 / immediately usable capabilities: pass issuedAt (or omit to default to issuedAt)
 * - A7 handoff pending: pass null until Gmail send acceptance
 */
export async function createCapability(
  db: Client,
  organizationId: string,
  capability: TaskCapability,
  tokenHash: string,
  options?: {
    revocationReason?: CapabilityRevocationReason | null;
    /** Defaults to issuedAt for A4 compatibility. Pass null for non-actionable A7 handoff caps. */
    actionableAt?: string | null;
  },
): Promise<PersistedCapability> {
  if (capability.status === 'used') {
    throw new PersistenceError('VALIDATION', 'A4 must not persist CapabilityStatus.used (D056).');
  }

  const actionableAt =
    options && 'actionableAt' in options ? options.actionableAt : capability.issuedAt;

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
        actionableAt: fromIso(actionableAt),
        revokedAt: fromIso(capability.revokedAt ?? null),
        revocationReason: options?.revocationReason ?? capability.revocationReason ?? null,
        lastUsedAt: fromIso(capability.lastUsedAt ?? null),
      },
    });
    return mapCapability(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = JSON.stringify(error.meta?.target ?? '');
      if (target.includes('assignment_id') || target.includes('one_active')) {
        throw uniqueViolation('Assignment already has an active capability (D086).');
      }
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

/**
 * Lookup by token hash only. Token hash is globally unique; organization is recovered from the row.
 * Returns null when unknown (callers must not distinguish miss from soft denials in responses).
 */
export async function findCapabilityByTokenHash(
  db: Client,
  tokenHash: string,
): Promise<PersistedCapability | null> {
  const row = await db.taskCapability.findUnique({
    where: { tokenHash },
  });
  if (!row) {
    return null;
  }
  return mapCapability(row);
}

/** Active capabilities bound to a specific assignment (for one-active-link enforcement). */
export async function findActiveCapabilitiesForAssignment(
  db: Client,
  organizationId: string,
  assignmentId: string,
): Promise<PersistedCapability[]> {
  const rows = await db.taskCapability.findMany({
    where: { organizationId, assignmentId, status: 'active' },
    orderBy: { issuedAt: 'asc' },
  });
  return rows.map(mapCapability);
}

/**
 * Recipient-actionable check (A7.2 / A7.3).
 * Requires status active, not expired, and actionableAt set (A4 backfill / A7 after send).
 */
export function isPersistedCapabilityActionable(
  capability: Pick<PersistedCapability, 'status' | 'expiresAt' | 'actionableAt'>,
  now: string,
): boolean {
  if (capability.status !== 'active') {
    return false;
  }
  if (capability.actionableAt == null) {
    return false;
  }
  return capability.expiresAt > now;
}

export async function revokeCapabilityRecord(
  db: Client,
  organizationId: string,
  capabilityId: string,
  revokedAt: string,
  reason: CapabilityRevocationReason | string,
): Promise<PersistedCapability> {
  assertCapabilityRevocationReason(reason);
  const existing = await getCapabilityById(db, organizationId, capabilityId);
  if (existing.status === 'revoked') {
    return existing.revocationReason
      ? existing
      : mapCapability(
          await db.taskCapability.update({
            where: { id: capabilityId },
            data: { revocationReason: reason },
          }),
        );
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
    data: { status: 'expired', revocationReason: 'expired' },
  });
  return mapCapability(row);
}

/**
 * Rotate the token hash of an active, non-actionable capability during explicit retry preparation
 * (A7.5). This invalidates the previous link immediately and binds a freshly generated token.
 *
 * Only rotates when the capability is `status = active` AND `actionableAt = null` — i.e. a capability
 * awaiting (re)delivery. `actionableAt` is preserved as null (never activated by rotation). Callers
 * supply the new `tokenHash` only; the raw token is never seen here (D063).
 */
export async function rotateCapabilityTokenHash(
  db: Client,
  organizationId: string,
  capabilityId: string,
  newTokenHash: string,
): Promise<PersistedCapability> {
  try {
    const updated = await db.taskCapability.updateMany({
      where: {
        id: capabilityId,
        organizationId,
        status: 'active',
        actionableAt: null,
      },
      data: { tokenHash: newTokenHash },
    });
    if (updated.count === 1) {
      return getCapabilityById(db, organizationId, capabilityId);
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw uniqueViolation('Capability tokenHash must be unique.');
    }
    throw error;
  }

  const existing = await getCapabilityById(db, organizationId, capabilityId);
  if (existing.status !== 'active') {
    throw persistenceValidation('Only active capabilities can rotate their token.');
  }
  if (existing.actionableAt != null) {
    throw persistenceValidation('An actionable capability token must not be rotated.');
  }
  throw persistenceValidation('Capability token could not be rotated.');
}

/** Activate a previously non-actionable capability after Gmail send acceptance. */
export async function activateCapabilityRecord(
  db: Client,
  organizationId: string,
  capabilityId: string,
  actionableAt: string,
): Promise<PersistedCapability> {
  const updated = await db.taskCapability.updateMany({
    where: {
      id: capabilityId,
      organizationId,
      status: 'active',
      actionableAt: null,
    },
    data: { actionableAt: fromIso(actionableAt)! },
  });

  const existing = await getCapabilityById(db, organizationId, capabilityId);
  if (updated.count === 1) {
    return existing;
  }
  if (existing.status !== 'active') {
    throw persistenceValidation('Only active capabilities can become actionable.');
  }
  if (existing.actionableAt != null) {
    return existing;
  }
  throw persistenceValidation('Capability could not become actionable.');
}
