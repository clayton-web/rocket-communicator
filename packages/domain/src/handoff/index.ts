export type {
  HandoffAcknowledgement,
  HandoffDeliveryPath,
  HandoffAttemptStatus,
  HandoffMode,
  HandoffIdempotencyOutcomeKind,
  HandoffAuditIntentType,
  HandoffAuditIntent,
  HandoffAttempt,
  HandoffFingerprintInputs,
  HandoffFingerprintHasher,
  CapabilityRevocationReason,
} from './types.js';
export { HANDOFF_ACKNOWLEDGEMENT_V1 } from './types.js';

export type {
  HandoffErrorCode,
  HandoffFailureCategory,
  HandoffFailure,
  HandoffResult,
} from './failures.js';
export {
  handoffOk,
  handoffFail,
  handoffFailureToDomainError,
  categoryForHandoffCode,
} from './failures.js';

export { parseHandoffAcknowledgement, assertHandoffAcknowledgement } from './acknowledgement.js';

export {
  isGmailOriginSource,
  selectHandoffDeliveryPath,
  rejectClientDeliveryPathOverride,
  hasUsableGmailSourceIdentifiers,
} from './delivery-path.js';

export {
  canonicalizeHandoffFingerprint,
  computeHandoffRequestFingerprint,
  identityHandoffFingerprintHasher,
} from './fingerprint.js';

export type { GmailConnectionFacts, GmailPrerequisiteInput } from './gmail-prerequisites.js';
export { evaluateGmailHandoffPrerequisites } from './gmail-prerequisites.js';

export type {
  GmailForwardPreflightFacts,
  IncompleteForwardDecision,
} from './incomplete-forward.js';
export {
  evaluateIncompleteForwardPreflight,
  assertNoDeliveryPathFallbackOnForwardFailure,
} from './incomplete-forward.js';

export {
  normalizeRecipientEmail,
  isValidRecipientEmailShape,
  assertValidRecipientEmail,
  assertValidRecipientDisplayName,
  evaluateRecipientForHandoff,
  planRecipientDeactivation,
  evaluateDuplicateRecipientEmail,
} from './recipient-rules.js';

export type { IdempotencyEvaluationInput, IdempotencyEvaluation } from './idempotency.js';
export { evaluateHandoffIdempotency, classifySecurityInputChangeOnSameKey } from './idempotency.js';

export {
  GENERIC_CAPABILITY_UNAUTHORIZED_MESSAGE,
  isRecipientHandoffCapabilityActionable,
  assertRecipientHandoffCapabilityActionable,
  mapMatchedCapabilityAccessDenial,
  mapUnmatchedCapabilityAccessDenial,
  assertSingleActiveCapability,
} from './capability-access.js';

export type {
  HandoffIntentMode,
  HandoffEligibilityInput,
  HandoffEligibilityOk,
} from './eligibility.js';
export { evaluateHandoffEligibility, intentModeToHandoffMode } from './eligibility.js';

export type {
  HandoffEffect,
  HandoffTransitionPlan,
  PlanNewHandoffAttemptInput,
} from './lifecycle.js';
export {
  planNewHandoffAttempt,
  planFailedAttemptRetry,
  planExplicitReforward,
  planReassignment,
  planDeliveryAccepted,
  planDeliveryFailed,
  planIdempotentPendingReplay,
  planIdempotentSentReplay,
  assertSentActivatesCapability,
} from './lifecycle.js';

export {
  assertCreateTaskRejectsRecipientId,
  isUnassignedCreateTaskPath,
} from './create-task-compat.js';

export { assertHandoffAuditIntentIsPrivacySafe, isHandoffAuditIntentType } from './audit-intent.js';
