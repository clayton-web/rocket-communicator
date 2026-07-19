import type { OwnerActor, UtcInstant } from '@aicaa/domain';
import type { CreateAuditEventInput } from '@aicaa/db';

export type RecipientAuditAction = 'create_recipient' | 'update_recipient' | 'deactivate_recipient';

/**
 * Build a privacy-safe Owner-attributed audit event for a Recipient mutation (A7.6).
 * The note records the Recipient id and, for updates, the changed field NAMES only.
 * Raw email values and full request bodies are never recorded, and the Recipient email is
 * never written to `intendedRecipientEmail` (which is reserved for delivery snapshots).
 */
export function buildRecipientAudit(input: {
  id: string;
  owner: OwnerActor;
  action: RecipientAuditAction;
  now: UtcInstant;
  recipientId: string;
  changedFields?: readonly string[];
  requestId?: string;
  correlationId?: string | null;
}): CreateAuditEventInput {
  const note =
    input.action === 'update_recipient' && input.changedFields && input.changedFields.length > 0
      ? `recipient=${input.recipientId}; changed=${[...input.changedFields].sort().join(',')}`
      : `recipient=${input.recipientId}`;

  return {
    id: input.id,
    organizationId: input.owner.organizationId,
    actorKind: 'owner',
    ownerId: input.owner.ownerId,
    action: input.action,
    outcome: 'succeeded',
    note,
    requestId: input.requestId,
    correlationId: input.correlationId ?? undefined,
    recordedAt: input.now,
  };
}
