import type { DomainErrorDetail } from '../errors/domain-errors.js';
import { DomainError, type DomainErrorCode } from '../errors/domain-errors.js';

/**
 * Handoff-facing failure codes aligned with A7.1 ErrorCode values.
 * Application boundaries map these to HTTP; domain stays transport-neutral.
 */
export type HandoffErrorCode =
  | DomainErrorCode
  | 'RECIPIENT_HANDOFF_NOT_AVAILABLE'
  | 'CAPABILITY_NO_LONGER_ACTIVE'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'HANDOFF_NOT_ELIGIBLE'
  | 'RECIPIENT_INACTIVE'
  | 'GMAIL_NOT_CONNECTED'
  | 'GMAIL_SEND_SCOPE_REQUIRED'
  | 'GMAIL_SOURCE_UNAVAILABLE'
  | 'HANDOFF_INCOMPLETE_FORWARD_PROHIBITED'
  | 'HANDOFF_DELIVERY_FAILED'
  | 'HANDOFF_IN_PROGRESS';

export type HandoffFailureCategory =
  | 'validation'
  | 'authorization'
  | 'concurrency'
  | 'domain_conflict'
  | 'retryable_dependency'
  | 'not_found';

export interface HandoffFailure {
  code: HandoffErrorCode;
  category: HandoffFailureCategory;
  message: string;
  details?: DomainErrorDetail[];
}

export type HandoffResult<T> = { ok: true; value: T } | { ok: false; failure: HandoffFailure };

export function handoffOk<T>(value: T): HandoffResult<T> {
  return { ok: true, value };
}

export function handoffFail(
  code: HandoffErrorCode,
  category: HandoffFailureCategory,
  message: string,
  details?: DomainErrorDetail[],
): HandoffResult<never> {
  return { ok: false, failure: { code, category, message, details } };
}

/**
 * Map a subset of handoff failures onto DomainError for call sites that throw.
 * Prefer returning HandoffResult from handoff policies.
 */
export function handoffFailureToDomainError(failure: HandoffFailure): DomainError {
  const domainCodes: ReadonlySet<string> = new Set([
    'VALIDATION_ERROR',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'INVALID_STATE_TRANSITION',
    'PRECONDITION_REQUIRED',
    'PRECONDITION_FAILED',
    'DOMAIN_CONFLICT',
    'RATE_LIMITED',
    'DEPENDENCY_UNAVAILABLE',
    'INTERNAL_ERROR',
  ]);

  if (domainCodes.has(failure.code)) {
    return new DomainError(failure.code as DomainErrorCode, failure.message, failure.details);
  }

  const mapped: DomainErrorCode =
    failure.category === 'authorization'
      ? 'FORBIDDEN'
      : failure.category === 'concurrency'
        ? 'PRECONDITION_FAILED'
        : failure.category === 'domain_conflict'
          ? 'DOMAIN_CONFLICT'
          : failure.category === 'retryable_dependency'
            ? 'DEPENDENCY_UNAVAILABLE'
            : failure.category === 'not_found'
              ? 'NOT_FOUND'
              : 'VALIDATION_ERROR';

  return new DomainError(mapped, failure.message, failure.details);
}

export function categoryForHandoffCode(code: HandoffErrorCode): HandoffFailureCategory {
  switch (code) {
    case 'UNAUTHORIZED':
    case 'FORBIDDEN':
    case 'GMAIL_SEND_SCOPE_REQUIRED':
    case 'CAPABILITY_NO_LONGER_ACTIVE':
      return 'authorization';
    case 'PRECONDITION_REQUIRED':
    case 'PRECONDITION_FAILED':
      return 'concurrency';
    case 'DOMAIN_CONFLICT':
    case 'IDEMPOTENCY_KEY_CONFLICT':
    case 'HANDOFF_IN_PROGRESS':
    case 'INVALID_STATE_TRANSITION':
      return 'domain_conflict';
    case 'GMAIL_NOT_CONNECTED':
    case 'HANDOFF_DELIVERY_FAILED':
    case 'DEPENDENCY_UNAVAILABLE':
      return 'retryable_dependency';
    case 'NOT_FOUND':
      return 'not_found';
    default:
      return 'validation';
  }
}
