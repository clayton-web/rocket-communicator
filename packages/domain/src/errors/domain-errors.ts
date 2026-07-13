export type DomainErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_STATE_TRANSITION'
  | 'PRECONDITION_REQUIRED'
  | 'PRECONDITION_FAILED'
  | 'DOMAIN_CONFLICT'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface DomainErrorDetail {
  field: string;
  message: string;
}

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: DomainErrorDetail[];

  constructor(code: DomainErrorCode, message: string, details?: DomainErrorDetail[]) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function validationError(message: string, details?: DomainErrorDetail[]): DomainError {
  return new DomainError('VALIDATION_ERROR', message, details);
}

export function forbiddenError(message: string): DomainError {
  return new DomainError('FORBIDDEN', message);
}

export function invalidTransition(message: string): DomainError {
  return new DomainError('INVALID_STATE_TRANSITION', message);
}

export function preconditionRequired(message: string): DomainError {
  return new DomainError('PRECONDITION_REQUIRED', message);
}

export function preconditionFailed(message: string): DomainError {
  return new DomainError('PRECONDITION_FAILED', message);
}

export function domainConflict(message: string): DomainError {
  return new DomainError('DOMAIN_CONFLICT', message);
}
