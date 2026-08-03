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

/** One expirable capability, with just enough identity to expire it and describe the event. */
export interface ExpirableCapabilityRow {
  readonly id: string;
  readonly organizationId: string;
  readonly taskId: string;
  readonly expiresAt: string;
}

/**
 * Active capabilities whose expiry instant has passed, oldest first (A8.5d).
 *
 * The scan half of the expiry observation. `status = 'active'` plus `expires_at <=` the supplied
 * instant is exactly the leading edge of `(organization_id, status, expires_at)`, and revoked,
 * already-expired, and `used` rows are excluded by the predicate rather than by a later filter, so
 * the sweep can never re-emit an expiry or overwrite a revocation it is not entitled to touch.
 *
 * Deliberately global across organizations, like the reminder due-scan and the notification scan:
 * expiry is a property of the clock, not of a tenant, and scanning per organization would let one
 * busy Owner starve another.
 *
 * The instant is an argument. Nothing here reads a clock (D103).
 */
export async function listExpirableCapabilities(
  db: Client,
  input: { readonly expiresAtOrBefore: string; readonly limit: number },
): Promise<ExpirableCapabilityRow[]> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw persistenceValidation('Capability expiry scan limit must be between 1 and 500.');
  }
  const rows = await db.taskCapability.findMany({
    where: { status: 'active', expiresAt: { lte: fromIso(input.expiresAtOrBefore)! } },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    take: input.limit,
    select: { id: true, organizationId: true, taskId: true, expiresAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    taskId: row.taskId,
    expiresAt: row.expiresAt.toISOString(),
  }));
}

/**
 * Transition one capability to expired, at most once, and say whether this call was the one that
 * did it (A8.5d).
 *
 * Compare-and-set on `status = 'active'` **and** on the expiry actually having passed. The first
 * predicate is what makes two observers of the same lapse produce one transition; the second is what
 * stops a caller expiring a capability that has not expired, which the read-then-write
 * {@link markCapabilityExpiredRecord} could be talked into by a stale read.
 *
 * A revoked or consumed capability matches neither predicate and is left exactly as it is. That
 * ordering matters: revocation is a decision somebody made, expiry is only the clock arriving, and
 * the clock must never overwrite a decision.
 */
export async function expireCapabilityIfDue(
  db: Client,
  input: { readonly organizationId: string; readonly capabilityId: string; readonly at: string },
): Promise<{ readonly expired: boolean; readonly capability: PersistedCapability }> {
  const changed = await db.taskCapability.updateMany({
    where: {
      id: input.capabilityId,
      organizationId: input.organizationId,
      status: 'active',
      expiresAt: { lte: fromIso(input.at)! },
    },
    data: { status: 'expired', revocationReason: 'expired' },
  });
  const capability = await getCapabilityById(db, input.organizationId, input.capabilityId);
  return { expired: changed.count === 1, capability };
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
