import 'server-only';
import type { PersistenceErrorCode } from '@aicaa/db';
import type { HandoffDeliveryPath } from '@aicaa/domain';
import type { TransportFailure, TransportFailureCategory } from '@/lib/gmail/transport/errors';
import type {
  HandoffOrchestrationResult,
  HandoffOutcomeCategory,
  HandoffOutcomeStatus,
} from './types';

/**
 * A7.5 outcome normalization.
 *
 * Collapses A7.3 persistence errors and A7.4 transport failures into a single privacy-safe internal
 * result taxonomy. No raw Prisma / Postgres / Google / MIME / OAuth / network error text escapes:
 * only stable codes, categories, and non-reversible fingerprints are propagated.
 */

const CATEGORY_STATUS: Record<HandoffOutcomeCategory, HandoffOutcomeStatus> = {
  delivered: 'success',
  delivered_replay: 'success',
  in_progress: 'in_progress',
  ambiguous: 'in_progress',
  previous_attempt_failed: 'failure',
  gmail_not_connected: 'failure',
  send_reconsent_required: 'failure',
  unsupported_delivery_path: 'failure',
  source_unavailable: 'failure',
  attachment_unavailable: 'failure',
  message_too_large: 'failure',
  invalid_recipient: 'failure',
  incomplete_forward: 'failure',
  unsupported_source_shape: 'failure',
  configuration_error: 'failure',
  known_provider_rejection: 'failure',
  retryable_provider_failure: 'failure',
  non_retryable_provider_failure: 'failure',
  provider_message_conflict: 'failure',
  idempotency_conflict: 'failure',
  handoff_in_progress: 'in_progress',
  unresolved_prior_handoff: 'failure',
  invalid_recipient_state: 'failure',
  persistence_conflict: 'failure',
  not_found: 'failure',
};

const SAFE_MESSAGES: Record<HandoffOutcomeCategory, string> = {
  delivered: 'Handoff message accepted by Gmail.',
  delivered_replay: 'Handoff was already delivered for this request.',
  in_progress: 'A handoff attempt is in progress; delivery outcome is not yet durable.',
  ambiguous:
    'Gmail send outcome is unknown; the message may or may not have been delivered. Reconciliation is required.',
  previous_attempt_failed:
    'A previous handoff attempt failed; use the explicit retry operation to resend.',
  gmail_not_connected: 'Owner Gmail must be connected before handoff delivery.',
  send_reconsent_required: 'Gmail send permission has not been granted; re-consent is required.',
  unsupported_delivery_path: 'The requested delivery path is not supported.',
  source_unavailable: 'The Gmail source message could not be read; handoff was not sent.',
  attachment_unavailable: 'A required attachment could not be retrieved; handoff was not sent.',
  message_too_large: 'The outbound message exceeds the maximum allowed size.',
  invalid_recipient: 'The recipient address was rejected.',
  incomplete_forward: 'The forward could not be assembled completely; handoff was not sent.',
  unsupported_source_shape: 'The source message structure is unsupported for forwarding.',
  configuration_error: 'Gmail transport is not configured correctly.',
  known_provider_rejection: 'Gmail rejected the message.',
  retryable_provider_failure: 'A temporary provider failure occurred; a retry may succeed.',
  non_retryable_provider_failure: 'The provider rejected the message and a retry will not help.',
  provider_message_conflict: 'A conflicting provider message id was recorded for this attempt.',
  idempotency_conflict: 'The idempotency key was reused with a conflicting request.',
  handoff_in_progress: 'A concurrent handoff attempt is in progress for this task.',
  unresolved_prior_handoff: 'A prior handoff for this task must be resolved first.',
  invalid_recipient_state: 'The recipient is not eligible for handoff.',
  persistence_conflict: 'A persistence conflict prevented the handoff.',
  not_found: 'The referenced resource was not found.',
};

const RETRYABLE_CATEGORIES: ReadonlySet<HandoffOutcomeCategory> = new Set([
  'retryable_provider_failure',
  'handoff_in_progress',
]);

const RECONCILIATION_CATEGORIES: ReadonlySet<HandoffOutcomeCategory> = new Set(['ambiguous']);

/** Build a normalized result from a category, filling status/message/flags from the tables above. */
export function outcome(
  category: HandoffOutcomeCategory,
  fields: {
    attemptId?: string;
    deliveryPath?: HandoffDeliveryPath;
    providerMessageId?: string;
    failureCode?: string;
    failureFingerprint?: string;
    retryable?: boolean;
    ambiguous?: boolean;
    reconciliationRequired?: boolean;
    message?: string;
  } = {},
): HandoffOrchestrationResult {
  return {
    status: CATEGORY_STATUS[category],
    category,
    message: fields.message ?? SAFE_MESSAGES[category],
    attemptId: fields.attemptId,
    deliveryPath: fields.deliveryPath,
    providerMessageId: fields.providerMessageId,
    retryable: fields.retryable ?? RETRYABLE_CATEGORIES.has(category),
    ambiguous: fields.ambiguous ?? category === 'ambiguous',
    reconciliationRequired:
      fields.reconciliationRequired ?? RECONCILIATION_CATEGORIES.has(category),
    failureCode: fields.failureCode,
    failureFingerprint: fields.failureFingerprint,
  };
}

const TRANSPORT_CODE_CATEGORY: Record<TransportFailure['code'], HandoffOutcomeCategory> = {
  GMAIL_AUTHORIZATION_INVALID: 'non_retryable_provider_failure',
  GMAIL_SEND_SCOPE_REQUIRED: 'send_reconsent_required',
  GMAIL_RATE_LIMITED: 'retryable_provider_failure',
  GMAIL_PROVIDER_UNAVAILABLE: 'retryable_provider_failure',
  GMAIL_NETWORK_ERROR: 'retryable_provider_failure',
  GMAIL_AMBIGUOUS_SEND: 'ambiguous',
  GMAIL_INVALID_RECIPIENT: 'invalid_recipient',
  GMAIL_INVALID_MESSAGE: 'known_provider_rejection',
  GMAIL_SOURCE_MESSAGE_UNAVAILABLE: 'source_unavailable',
  GMAIL_ATTACHMENT_UNAVAILABLE: 'attachment_unavailable',
  GMAIL_MESSAGE_TOO_LARGE: 'message_too_large',
  GMAIL_UNSUPPORTED_SOURCE_SHAPE: 'unsupported_source_shape',
  GMAIL_CONFIGURATION_ERROR: 'configuration_error',
};

/** Normalize an A7.4 transport failure into an internal outcome (privacy-safe). */
export function outcomeFromTransportFailure(
  failure: TransportFailure,
  fields: { attemptId?: string; deliveryPath?: HandoffDeliveryPath } = {},
): HandoffOrchestrationResult {
  const category = TRANSPORT_CODE_CATEGORY[failure.code];
  return outcome(category, {
    ...fields,
    failureCode: failure.code,
    failureFingerprint: failure.fingerprint,
    retryable: failure.retryable,
    ambiguous: failure.ambiguous,
    reconciliationRequired: failure.ambiguous,
  });
}

/**
 * Map an A7.4 transport failure category onto the A7.3 persisted `failureCategory` enum
 * (validation | authorization | concurrency | domain_conflict | retryable_dependency | not_found |
 * provider). Ambiguous failures are never persisted (the attempt stays pending), so they are not
 * represented here.
 */
export function persistedFailureCategory(
  category: TransportFailureCategory,
): 'validation' | 'authorization' | 'retryable_dependency' | 'not_found' | 'provider' {
  switch (category) {
    case 'authorization':
      return 'authorization';
    case 'rate_limited':
    case 'provider_unavailable':
    case 'network':
      return 'retryable_dependency';
    case 'not_found':
      return 'not_found';
    case 'validation':
    case 'configuration':
      return 'validation';
    case 'ambiguous':
      // Should never be persisted; treat defensively as retryable_dependency if ever reached.
      return 'retryable_dependency';
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}

const PERSISTENCE_CATEGORY: Record<PersistenceErrorCode, HandoffOutcomeCategory> = {
  NOT_FOUND: 'not_found',
  ORGANIZATION_MISMATCH: 'not_found',
  OPTIMISTIC_CONCURRENCY: 'persistence_conflict',
  UNIQUE_VIOLATION: 'persistence_conflict',
  VALIDATION: 'persistence_conflict',
  TRANSACTION_FAILED: 'persistence_conflict',
  RECIPIENT_HANDOFF_NOT_AVAILABLE: 'invalid_recipient_state',
  IDEMPOTENCY_KEY_CONFLICT: 'idempotency_conflict',
  HANDOFF_IN_PROGRESS: 'handoff_in_progress',
  DOMAIN_CONFLICT: 'unresolved_prior_handoff',
  INVALID_STATE: 'persistence_conflict',
};

const PERSISTENCE_ERROR_NAME = 'PersistenceError';
const ALL_PERSISTENCE_CODES = new Set<PersistenceErrorCode>(
  Object.keys(PERSISTENCE_CATEGORY) as PersistenceErrorCode[],
);

/**
 * Read the code from ANY `PersistenceError` (not limited to the shared safe-error allowlist), so the
 * orchestration can normalize the full A7 persistence taxonomy (IDEMPOTENCY_KEY_CONFLICT,
 * DOMAIN_CONFLICT, INVALID_STATE) that other consumers may not surface.
 */
export function readAnyPersistenceErrorCode(error: unknown): PersistenceErrorCode | undefined {
  if (error === null || typeof error !== 'object') {
    return undefined;
  }
  const name = Reflect.get(error, 'name');
  if (name !== PERSISTENCE_ERROR_NAME) {
    return undefined;
  }
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' && ALL_PERSISTENCE_CODES.has(code as PersistenceErrorCode)
    ? (code as PersistenceErrorCode)
    : undefined;
}

/** Normalize a persistence error into an internal outcome, or return undefined if not one. */
export function outcomeFromPersistenceError(
  error: unknown,
  fields: { attemptId?: string; deliveryPath?: HandoffDeliveryPath } = {},
): HandoffOrchestrationResult | undefined {
  const code = readAnyPersistenceErrorCode(error);
  if (!code) {
    return undefined;
  }
  const category = PERSISTENCE_CATEGORY[code];
  const retryable = code === 'OPTIMISTIC_CONCURRENCY' || category === 'handoff_in_progress';
  return outcome(category, { ...fields, retryable });
}
