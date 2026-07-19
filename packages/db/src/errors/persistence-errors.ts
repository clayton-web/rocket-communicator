export type PersistenceErrorCode =
  | 'NOT_FOUND'
  | 'ORGANIZATION_MISMATCH'
  | 'OPTIMISTIC_CONCURRENCY'
  | 'UNIQUE_VIOLATION'
  | 'VALIDATION'
  | 'TRANSACTION_FAILED'
  /** D080: Approve must not include recipientId in A6. Maps to HTTP 400 in A6.2. */
  | 'RECIPIENT_HANDOFF_NOT_AVAILABLE'
  /** Same Idempotency-Key reused with a conflicting fingerprint (A7). */
  | 'IDEMPOTENCY_KEY_CONFLICT'
  /** Durable handoff attempt already pending for this key/task (A7). */
  | 'HANDOFF_IN_PROGRESS'
  /** Domain/state conflict for handoff transitions (A7). */
  | 'DOMAIN_CONFLICT'
  /** Illegal attempt lifecycle transition (A7). */
  | 'INVALID_STATE';

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string) {
    super(message);
    this.name = 'PersistenceError';
    this.code = code;
  }
}

export function notFound(message: string): PersistenceError {
  return new PersistenceError('NOT_FOUND', message);
}

export function organizationMismatch(message: string): PersistenceError {
  return new PersistenceError('ORGANIZATION_MISMATCH', message);
}

export function optimisticConcurrency(message: string): PersistenceError {
  return new PersistenceError('OPTIMISTIC_CONCURRENCY', message);
}

export function uniqueViolation(message: string): PersistenceError {
  return new PersistenceError('UNIQUE_VIOLATION', message);
}

export function persistenceValidation(message: string): PersistenceError {
  return new PersistenceError('VALIDATION', message);
}

export function recipientHandoffNotAvailable(
  message = 'Approve must not include recipientId in A6 (D080).',
): PersistenceError {
  return new PersistenceError('RECIPIENT_HANDOFF_NOT_AVAILABLE', message);
}

export function idempotencyKeyConflict(message: string): PersistenceError {
  return new PersistenceError('IDEMPOTENCY_KEY_CONFLICT', message);
}

export function handoffInProgress(message: string): PersistenceError {
  return new PersistenceError('HANDOFF_IN_PROGRESS', message);
}

export function domainConflict(message: string): PersistenceError {
  return new PersistenceError('DOMAIN_CONFLICT', message);
}

export function invalidState(message: string): PersistenceError {
  return new PersistenceError('INVALID_STATE', message);
}
