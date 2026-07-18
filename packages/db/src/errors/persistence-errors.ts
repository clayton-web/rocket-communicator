export type PersistenceErrorCode =
  | 'NOT_FOUND'
  | 'ORGANIZATION_MISMATCH'
  | 'OPTIMISTIC_CONCURRENCY'
  | 'UNIQUE_VIOLATION'
  | 'VALIDATION'
  | 'TRANSACTION_FAILED'
  /** D080: Approve must not include recipientId in A6. Maps to HTTP 400 in A6.2. */
  | 'RECIPIENT_HANDOFF_NOT_AVAILABLE';

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
