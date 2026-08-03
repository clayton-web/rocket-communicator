import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import type { AuditEventRecord } from '../mappers/domain-mappers.js';
import { createAuditEvent, type CreateAuditEventInput } from '../repositories/audit-repository.js';
import {
  expireCapabilityIfDue,
  type PersistedCapability,
} from '../repositories/capability-repository.js';
import {
  createOwnerNotificationIntent,
  type OwnerNotificationCapture,
} from '../repositories/owner-notification-repository.js';

/**
 * The single durable expiry transition for a capability (A8.5d, D133).
 *
 * ## Why this exists
 *
 * Every other event in the ratified taxonomy already had a transaction that made it true. Expiry did
 * not. `expiresAt` passing is not a write, so an untouched capability stayed `active` in the database
 * indefinitely while every reader treated it as expired — and an event nobody ever recorded is an
 * event nobody can be told about.
 *
 * There were two places that could notice: a Recipient presenting a lapsed token, which the validator
 * already persisted best-effort, and a sweep that goes looking. Both now come here. That is the point
 * of the function: expiry is one fact, so it gets one transaction, and a Recipient's click racing a
 * worker's scan produces one transition, one audit row, and one notification rather than two of each.
 *
 * ## What "at most once" rests on
 *
 * The compare-and-set inside {@link expireCapabilityIfDue}, and nothing else. The audit event and the
 * intent are written only by the caller that won it, so a loser writes nothing at all rather than
 * writing something harmless — there is no such thing as a harmless duplicate audit row. The unique
 * identity on the intent is the second line of defence, not the first.
 *
 * ## What it deliberately does not do
 *
 * It sends nothing, claims nothing, and touches no notification the worker might be holding. Expiry
 * observation and notification delivery are different jobs under different flags, and a capability's
 * authorization truth must never depend on whether an email could be sent about it.
 *
 * The instant is an argument, as everywhere in this package (D103): the caller decides what "now"
 * means, so a sweep and a validator racing the same capability agree about whether it has expired.
 */
export interface ObserveCapabilityExpiryInput {
  readonly db: DbClient | DbTransaction;
  readonly organizationId: string;
  readonly capabilityId: string;
  /** The observation instant. Expiry applies only when `expiresAt <= at`. */
  readonly at: string;
  /**
   * The audit row for the transition, written only if this call performs it. System-attributed:
   * expiry is the clock arriving, not something a Recipient or an Owner did (D133).
   */
  readonly audit: CreateAuditEventInput;
  readonly ownerNotification?: OwnerNotificationCapture;
}

export interface ObserveCapabilityExpiryResult {
  /** True only for the caller whose compare-and-set won. Everyone else gets false and wrote nothing. */
  readonly expired: boolean;
  readonly capability: PersistedCapability;
  readonly audit?: AuditEventRecord;
}

export async function observeCapabilityExpiry(
  input: ObserveCapabilityExpiryInput,
): Promise<ObserveCapabilityExpiryResult> {
  const run = async (tx: DbClient | DbTransaction): Promise<ObserveCapabilityExpiryResult> => {
    const { expired, capability } = await expireCapabilityIfDue(tx, {
      organizationId: input.organizationId,
      capabilityId: input.capabilityId,
      at: input.at,
    });
    if (!expired) {
      return { expired: false, capability };
    }

    const audit = await createAuditEvent(tx, input.audit);

    if (input.ownerNotification) {
      await createOwnerNotificationIntent(tx, {
        id: input.ownerNotification.id,
        organizationId: input.organizationId,
        eventType: 'capability_expired',
        subjectKind: 'task_capability',
        subjectId: capability.id,
        // Fixed, because a capability expires exactly once and can never return to `active`. The
        // identity is therefore complete without a version or an instant, and a second observer that
        // somehow got past the compare-and-set would still be refused by the unique index.
        occurrenceKey: 'expired',
        // When it expired, not when it was noticed. A sweep that runs an hour late reports the hour
        // the link lapsed, which is what the Owner needs in order to read the message correctly.
        occurredAt: capability.expiresAt,
        actorKind: input.audit.actorKind,
        ownerId: input.audit.ownerId ?? null,
        capabilityId: input.audit.capabilityId ?? capability.id,
        systemId: input.audit.systemId ?? null,
        assignmentId: input.audit.assignmentId ?? capability.assignmentId,
        attributionLabel: input.audit.attributionLabel ?? null,
        auditEventId: audit.id,
        requestId: input.audit.requestId ?? null,
        correlationId: input.audit.correlationId ?? null,
      });
    }

    return { expired: true, capability, audit };
  };

  // Accepts an open transaction so a caller already holding one — a future path that expires a
  // capability alongside another mutation — cannot end up with expiry committing separately from the
  // thing that caused it.
  return '$transaction' in input.db ? input.db.$transaction(run) : run(input.db);
}
