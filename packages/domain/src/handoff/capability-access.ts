import type { CapabilityRevocationReason, CapabilityStatus } from '../value-objects/capability.js';
import type { AssignmentDeliveryStatus, TaskCapability } from '../value-objects/capability.js';
import type { TaskAssignment } from '../value-objects/task-assignment.js';
import type { UtcInstant } from '../types/timestamps.js';
import { categoryForHandoffCode, handoffFail, handoffOk, type HandoffResult } from './failures.js';

/**
 * Recipient capability is actionable only when delivery reached `sent` (D092).
 * Pending/failed (or missing) delivery must never expose an actionable handoff.
 * Provider acceptance (`sent`) does not imply Recipient read/open.
 */
export function isRecipientHandoffCapabilityActionable(input: {
  capability: Pick<TaskCapability, 'status' | 'expiresAt'>;
  deliveryStatus: AssignmentDeliveryStatus | undefined | null;
  now: UtcInstant;
}): boolean {
  if (input.deliveryStatus !== 'sent') {
    return false;
  }
  if (input.capability.status !== 'active') {
    return false;
  }
  return input.capability.expiresAt > input.now;
}

export function assertRecipientHandoffCapabilityActionable(input: {
  capability: Pick<TaskCapability, 'status' | 'expiresAt'>;
  deliveryStatus: AssignmentDeliveryStatus | undefined | null;
  now: UtcInstant;
}): HandoffResult<void> {
  if (!isRecipientHandoffCapabilityActionable(input)) {
    return handoffFail(
      'FORBIDDEN',
      categoryForHandoffCode('FORBIDDEN'),
      'Capability is not actionable until handoff delivery is sent.',
    );
  }
  return handoffOk(undefined);
}

/** Probing-safe public message for generic capability auth failures (A4 / A7.1). */
export const GENERIC_CAPABILITY_UNAUTHORIZED_MESSAGE = 'Unauthorized.';

/**
 * Public failure recommendation for a positively matched stored capability (D086, A7.1).
 *
 * Special safe result (only case):
 * - matched + internal `revocationReason === 'superseded'` → `CAPABILITY_NO_LONGER_ACTIVE`
 *
 * All other unusable matched states (manual, assignment_ended, expired, used, inactive
 * without positively identified supersession) → generic `UNAUTHORIZED` — indistinguishable
 * from unknown/unmatched tokens. Internal revocation reasons stay for persistence/audit only
 * and must not appear in the public failure payload.
 *
 * Token hashing/matching remains an application-boundary concern.
 */
export function mapMatchedCapabilityAccessDenial(input: {
  status: CapabilityStatus;
  revocationReason?: CapabilityRevocationReason | null;
}): HandoffResult<never> {
  if (input.status === 'revoked' && input.revocationReason === 'superseded') {
    return handoffFail(
      'CAPABILITY_NO_LONGER_ACTIVE',
      categoryForHandoffCode('CAPABILITY_NO_LONGER_ACTIVE'),
      'This link is no longer active.',
    );
  }

  // Do not confirm prior validity or expose internal revocation reason.
  return handoffFail(
    'UNAUTHORIZED',
    categoryForHandoffCode('UNAUTHORIZED'),
    GENERIC_CAPABILITY_UNAUTHORIZED_MESSAGE,
  );
}

/**
 * Public failure for unknown, malformed, missing, or unmatched capability tokens.
 * Same code and message as non-superseded matched unusable capabilities (anti-enumeration).
 */
export function mapUnmatchedCapabilityAccessDenial(): HandoffResult<never> {
  return handoffFail(
    'UNAUTHORIZED',
    categoryForHandoffCode('UNAUTHORIZED'),
    GENERIC_CAPABILITY_UNAUTHORIZED_MESSAGE,
  );
}

/**
 * Multiple active capabilities are never permitted (D086).
 */
export function assertSingleActiveCapability(input: {
  assignment: TaskAssignment | undefined;
  candidateActiveCapabilityId: string;
  otherActiveCapabilityIds: string[];
}): HandoffResult<void> {
  const activeOnAssignment = input.assignment?.activeCapabilityId;
  const others = input.otherActiveCapabilityIds.filter(
    (id) => id !== input.candidateActiveCapabilityId,
  );
  if (others.length > 0) {
    return handoffFail(
      'DOMAIN_CONFLICT',
      categoryForHandoffCode('DOMAIN_CONFLICT'),
      'A Task may have only one active Recipient capability at a time.',
    );
  }
  if (
    activeOnAssignment &&
    activeOnAssignment !== input.candidateActiveCapabilityId &&
    input.assignment?.capabilityStatus === 'active'
  ) {
    return handoffFail(
      'DOMAIN_CONFLICT',
      categoryForHandoffCode('DOMAIN_CONFLICT'),
      'A Task may have only one active Recipient capability at a time.',
    );
  }
  return handoffOk(undefined);
}
