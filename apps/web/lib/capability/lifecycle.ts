import {
  invalidateCapabilityOnAssignmentChange,
  markCapabilityExpired,
  revokeCapability,
  type OwnerActor,
  type TaskCapability,
  type UtcInstant,
} from '@aicaa/domain';
import type { AuditEventRecord, DbClient, PersistedCapability } from '@aicaa/db';
import type { DbRuntimeModule } from '@/lib/db/runtime-db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { readPersistenceErrorCode } from '@/lib/errors/safe-error-shapes';
import { capabilityTokenError } from './errors';
import { observeCapabilityExpiryForOrganization } from './expiry';
import { omitTokenHash } from './validate';

/**
 * Explicit Owner revocation of a capability (persists revoked status).
 */
export async function revokeCapabilityForOwner(input: {
  db: DbClient;
  owner: OwnerActor;
  capabilityId: string;
  now: UtcInstant;
  reason?: string;
  requestId?: string;
  auditId?: string;
}): Promise<{ capability: TaskCapability; audit: AuditEventRecord }> {
  const dbRuntime = await loadDbRuntime();
  const existing = await dbRuntime.getCapabilityById(
    input.db,
    input.owner.organizationId,
    input.capabilityId,
  );
  const revokedDomain = revokeCapability(omitTokenHash(existing), input.now);

  const capability = await dbRuntime.revokeCapabilityRecord(
    input.db,
    input.owner.organizationId,
    input.capabilityId,
    revokedDomain.revokedAt ?? input.now,
    input.reason ?? 'manual',
  );

  await dbRuntime
    .updateActiveAssignmentCapabilityBinding(
      input.db,
      input.owner.organizationId,
      capability.taskId,
      {
        activeCapabilityId: null,
        capabilityStatus: 'revoked',
      },
    )
    .catch((error: unknown) => {
      if (readPersistenceErrorCode(error) === 'NOT_FOUND') {
        return;
      }
      throw error;
    });

  const audit = await dbRuntime.createAuditEvent(input.db, {
    id: input.auditId ?? `audit_revoke_${capability.id}`,
    organizationId: input.owner.organizationId,
    actorKind: 'owner',
    ownerId: input.owner.ownerId,
    capabilityId: capability.id,
    assignmentId: capability.assignmentId,
    taskId: capability.taskId,
    intendedRecipientEmail: capability.intendedRecipientEmail,
    action: 'revoke_task_capability',
    outcome: 'succeeded',
    requestId: input.requestId,
    recordedAt: input.now,
    note: input.reason,
  });

  return { capability: omitTokenHash(capability), audit };
}

/**
 * Persist expired status when wall-clock has passed `expiresAt`.
 * Must not be called from GET validation (D059 non-mutating).
 *
 * ## A8.5d: the same transaction the sweep uses (D133)
 *
 * This used to read the row and then write it, which was adequate while expiry was a private detail
 * of one request and inadequate the moment it became an event. Two problems, both fixed by routing
 * through {@link observeCapabilityExpiryForOrganization}: a revocation landing between the read and
 * the write could be overwritten by the clock, and an expiry observed here recorded no audit row at
 * all, so half of the system's expiries would have been notifiable and the other half invisible.
 *
 * The compare-and-set inside that transaction is also what makes a Recipient's click racing the
 * sweep produce one transition rather than two.
 */
export async function persistCapabilityExpiryIfNeeded(input: {
  db: DbClient;
  organizationId: string;
  capabilityId: string;
  now: UtcInstant;
}): Promise<TaskCapability | null> {
  const dbRuntime = await loadDbRuntime();
  const existing = await dbRuntime.getCapabilityById(
    input.db,
    input.organizationId,
    input.capabilityId,
  );
  const domain = omitTokenHash(existing);
  if (domain.status === 'revoked' || domain.status === 'expired') {
    return domain;
  }
  if (domain.expiresAt > input.now) {
    return null;
  }
  // The domain transition still gates the persistence one, unchanged: it refuses a capability that
  // has not reached `expiresAt`, and refusing here costs a throw instead of a transaction.
  markCapabilityExpired(domain, input.now);

  await observeCapabilityExpiryForOrganization({
    db: input.db,
    organizationId: input.organizationId,
    capabilityId: existing.id,
    taskId: existing.taskId,
    assignmentId: existing.assignmentId,
    expiredAt: existing.expiresAt,
    observedAt: input.now,
  });

  const updated = await dbRuntime.getCapabilityById(
    input.db,
    input.organizationId,
    input.capabilityId,
  );
  return omitTokenHash(updated);
}

/**
 * Invalidate capability when assignment is replaced or cleared (D056).
 */
export async function invalidateCapabilityOnAssignmentChangePersisted(input: {
  db: DbClient;
  organizationId: string;
  capabilityId: string;
  now: UtcInstant;
  reason?: string;
}): Promise<PersistedCapability> {
  const dbRuntime = await loadDbRuntime();
  const existing = await dbRuntime.getCapabilityById(
    input.db,
    input.organizationId,
    input.capabilityId,
  );
  invalidateCapabilityOnAssignmentChange(omitTokenHash(existing), input.now);
  return dbRuntime.revokeCapabilityRecord(
    input.db,
    input.organizationId,
    input.capabilityId,
    input.now,
    input.reason ?? 'assignment_ended',
  );
}

/**
 * Re-export persistence return-to-Owner orchestration used after domain return.
 * Invalidates the named capability in the same transaction.
 */
export async function returnToOwnerWithCapabilityInvalidation(
  input: Parameters<DbRuntimeModule['persistReturnToOwner']>[0],
): Promise<Awaited<ReturnType<DbRuntimeModule['persistReturnToOwner']>>> {
  if (!input.capabilityId) {
    throw capabilityTokenError(
      'ISSUANCE_PRECONDITION',
      'Return-to-Owner requires the capability id to invalidate.',
    );
  }
  return (await loadDbRuntime()).persistReturnToOwner(input);
}
