import {
  invalidateCapabilityOnAssignmentChange,
  markCapabilityExpired,
  revokeCapability,
  type OwnerActor,
  type TaskCapability,
  type UtcInstant,
} from '@aicaa/domain';
import {
  createAuditEvent,
  getCapabilityById,
  markCapabilityExpiredRecord,
  persistReturnToOwner,
  revokeCapabilityRecord,
  updateActiveAssignmentCapabilityBinding,
  type AuditEventRecord,
  type DbClient,
  type PersistedCapability,
} from '@aicaa/db';
import { readPersistenceErrorCode } from '@/lib/errors/safe-error-shapes';
import { capabilityTokenError } from './errors';
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
  const existing = await getCapabilityById(
    input.db,
    input.owner.organizationId,
    input.capabilityId,
  );
  const revokedDomain = revokeCapability(omitTokenHash(existing), input.now);

  const capability = await revokeCapabilityRecord(
    input.db,
    input.owner.organizationId,
    input.capabilityId,
    revokedDomain.revokedAt ?? input.now,
    input.reason ?? 'owner_revoked',
  );

  await updateActiveAssignmentCapabilityBinding(
    input.db,
    input.owner.organizationId,
    capability.taskId,
    {
      activeCapabilityId: null,
      capabilityStatus: 'revoked',
    },
  ).catch((error: unknown) => {
    if (readPersistenceErrorCode(error) === 'NOT_FOUND') {
      return;
    }
    throw error;
  });

  const audit = await createAuditEvent(input.db, {
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
 */
export async function persistCapabilityExpiryIfNeeded(input: {
  db: DbClient;
  organizationId: string;
  capabilityId: string;
  now: UtcInstant;
}): Promise<TaskCapability | null> {
  const existing = await getCapabilityById(input.db, input.organizationId, input.capabilityId);
  const domain = omitTokenHash(existing);
  if (domain.status === 'revoked' || domain.status === 'expired') {
    return domain;
  }
  if (domain.expiresAt > input.now) {
    return null;
  }
  markCapabilityExpired(domain, input.now);
  const updated = await markCapabilityExpiredRecord(
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
  const existing = await getCapabilityById(input.db, input.organizationId, input.capabilityId);
  invalidateCapabilityOnAssignmentChange(omitTokenHash(existing), input.now);
  return revokeCapabilityRecord(
    input.db,
    input.organizationId,
    input.capabilityId,
    input.now,
    input.reason ?? 'assignment_changed',
  );
}

/**
 * Re-export persistence return-to-Owner orchestration used after domain return.
 * Invalidates the named capability in the same transaction.
 */
export async function returnToOwnerWithCapabilityInvalidation(
  input: Parameters<typeof persistReturnToOwner>[0],
): Promise<Awaited<ReturnType<typeof persistReturnToOwner>>> {
  if (!input.capabilityId) {
    throw capabilityTokenError(
      'ISSUANCE_PRECONDITION',
      'Return-to-Owner requires the capability id to invalidate.',
    );
  }
  return persistReturnToOwner(input);
}
