import type {
  AssignmentId,
  CapabilityId,
  OrganizationId,
  RecipientId,
  TaskId,
} from '../types/ids.js';
import type { UtcInstant } from '../types/timestamps.js';
import type { AssignmentDeliveryStatus } from '../value-objects/capability.js';
import type { CapabilityRevocationReason } from '../value-objects/capability.js';

/** D037 acknowledgement version supported by A7 handoff (A7.1 contract). */
export const HANDOFF_ACKNOWLEDGEMENT_V1 = 'handoff_confirmed_v1' as const;

export type HandoffAcknowledgement = typeof HANDOFF_ACKNOWLEDGEMENT_V1;

/** Server-selected delivery path (D090, D094). Clients must not choose this. */
export type HandoffDeliveryPath = 'gmail_forward' | 'assignment_email';

/** Durable handoff attempt delivery lifecycle (D092). */
export type HandoffAttemptStatus = AssignmentDeliveryStatus;

/**
 * How an Owner handoff request should be interpreted relative to prior attempts.
 * Distinct from delivery status.
 */
export type HandoffMode =
  | 'new_attempt'
  | 'replay_pending'
  | 'retry_failed'
  | 'replay_sent'
  | 'explicit_reforward'
  | 'reassignment';

export type HandoffIdempotencyOutcomeKind =
  | 'new_request'
  | 'replay_in_progress'
  | 'retry_failed'
  | 'replay_success'
  | 'key_conflict'
  | 'new_attempt_security_inputs_changed';

/** Privacy-safe audit intents for later application/persistence (not written in A7.2). */
export type HandoffAuditIntentType =
  | 'handoff_confirmed'
  | 'handoff_attempt_created'
  | 'delivery_accepted'
  | 'delivery_failed'
  | 'retry_requested'
  | 'explicit_reforward_requested'
  | 'reassignment_requested'
  | 'capability_superseded'
  | 'recipient_deactivated';

export interface HandoffAuditIntent {
  type: HandoffAuditIntentType;
  organizationId: OrganizationId;
  occurredAt: UtcInstant;
  taskId?: TaskId;
  recipientId?: RecipientId;
  attemptId?: string;
  capabilityId?: CapabilityId;
  deliveryPath?: HandoffDeliveryPath;
  /**
   * Opaque provider message id only — never MIME, bodies, tokens, or raw provider errors.
   */
  providerMessageId?: string;
  revocationReason?: CapabilityRevocationReason;
}

/**
 * Domain model of a durable handoff attempt (D092). Persistence shape is A7.3+.
 * Does not include raw capability secrets, MIME, or OAuth material.
 */
export interface HandoffAttempt {
  id: string;
  taskId: TaskId;
  organizationId: OrganizationId;
  recipientId: RecipientId;
  acknowledgement: HandoffAcknowledgement;
  deliveryPath: HandoffDeliveryPath;
  status: HandoffAttemptStatus;
  idempotencyKey: string;
  /** Hash of the canonical security-relevant fingerprint (not the raw key). */
  requestFingerprint: string;
  capabilityId?: CapabilityId;
  assignmentId?: AssignmentId;
  /** Set only after Gmail accepted send — not Recipient read/open. */
  providerMessageId?: string | null;
  createdAt: UtcInstant;
  updatedAt: UtcInstant;
}

export interface HandoffFingerprintInputs {
  organizationId: OrganizationId;
  taskId: TaskId;
  recipientId: RecipientId;
  acknowledgement: HandoffAcknowledgement;
}

/** Injectable hashing boundary — domain does not choose a crypto implementation. */
export type HandoffFingerprintHasher = (canonicalUtf8: string) => string;

export type { CapabilityRevocationReason };
