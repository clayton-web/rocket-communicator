/**
 * Privacy-safe failure categories for operational diagnostics (P1.1 / D113–D115).
 * Prefer these over raw exception messages. Distinct from business outcomes.
 */
export type OperationalFailureCategory =
  | 'AUTH_FAILURE'
  | 'AUTHZ_FAILURE'
  | 'VALIDATION_FAILURE'
  | 'CONCURRENCY_CONFLICT'
  | 'DATABASE_FAILURE'
  | 'EXTERNAL_PROVIDER_FAILURE'
  | 'AMBIGUOUS_OUTCOME'
  | 'INTERNAL_FAILURE'
  | 'UNKNOWN_FAILURE';

export function classifyOperationalFailure(error: unknown): OperationalFailureCategory {
  try {
    const name = readString(error, 'name');
    const code = readString(error, 'code');

    if (name === 'AuthConfigError') {
      return 'INTERNAL_FAILURE';
    }
    if (name === 'TaskServiceError' || name === 'RecipientManagementError') {
      return classifyServiceCode(code);
    }
    if (name === 'RecipientCapabilityServiceError') {
      return classifyServiceCode(code);
    }
    if (name === 'CapabilityTokenError') {
      return 'AUTHZ_FAILURE';
    }
    if (name === 'PersistenceError') {
      if (code === 'OPTIMISTIC_CONCURRENCY') {
        return 'CONCURRENCY_CONFLICT';
      }
      if (
        code === 'TRANSACTION_FAILED' ||
        code === 'UNIQUE_VIOLATION' ||
        code === 'FOREIGN_KEY_VIOLATION'
      ) {
        return 'DATABASE_FAILURE';
      }
      return 'DATABASE_FAILURE';
    }
    if (
      name === 'PrismaClientInitializationError' ||
      name === 'PrismaClientKnownRequestError' ||
      name === 'PrismaClientUnknownRequestError' ||
      name === 'PrismaClientRustPanicError' ||
      name === 'PrismaClientValidationError'
    ) {
      return 'DATABASE_FAILURE';
    }
    if (name === 'GmailRequestError' || name === 'GmailSyncError' || name === 'GmailConfigError') {
      return 'EXTERNAL_PROVIDER_FAILURE';
    }
    return 'UNKNOWN_FAILURE';
  } catch {
    return 'UNKNOWN_FAILURE';
  }
}

function classifyServiceCode(code: string | undefined): OperationalFailureCategory {
  switch (code) {
    case 'UNAUTHORIZED':
      return 'AUTH_FAILURE';
    case 'FORBIDDEN':
      return 'AUTHZ_FAILURE';
    case 'VALIDATION_ERROR':
      return 'VALIDATION_FAILURE';
    case 'PRECONDITION_FAILED':
    case 'PRECONDITION_REQUIRED':
    case 'PERSISTENCE_CONFLICT':
    case 'DOMAIN_CONFLICT':
    case 'INVALID_STATE_TRANSITION':
    case 'ASSIGNMENT_PRECONDITION':
    case 'ISSUANCE_CONFLICT':
    case 'ISSUANCE_PRECONDITION':
      return 'CONCURRENCY_CONFLICT';
    case 'NOT_FOUND':
      return 'VALIDATION_FAILURE';
    default:
      return 'INTERNAL_FAILURE';
  }
}

function readString(value: unknown, key: string): string | undefined {
  try {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value !== 'object' && typeof value !== 'function') {
      return undefined;
    }
    const candidate = Reflect.get(value, key);
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
  } catch {
    return undefined;
  }
}
