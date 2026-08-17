import 'server-only';

/**
 * Safe Gmail sync failure categories. Messages never include tokens, mailbox addresses,
 * message content, or raw Google response bodies.
 */
export type GmailSyncErrorCode =
  | 'needs_reauth'
  | 'rate_limited'
  | 'google_unavailable'
  | 'network_failure'
  | 'invalid_history'
  | 'malformed_message'
  | 'database_failure'
  | 'persistence_validation'
  | 'transaction_failure'
  | 'lock_conflict'
  | 'configuration_error'
  | 'unknown';

const DEFAULT_RETRYABLE: Record<GmailSyncErrorCode, boolean> = {
  needs_reauth: false,
  rate_limited: true,
  google_unavailable: true,
  network_failure: true,
  invalid_history: false,
  malformed_message: false,
  database_failure: true,
  persistence_validation: true,
  transaction_failure: true,
  lock_conflict: true,
  configuration_error: false,
  unknown: false,
};

const SAFE_MESSAGES: Record<GmailSyncErrorCode, string> = {
  needs_reauth: 'Gmail authorization is no longer valid.',
  rate_limited: 'Gmail rate limit exceeded.',
  google_unavailable: 'Gmail is temporarily unavailable.',
  network_failure: 'Network failure talking to Gmail.',
  invalid_history: 'Gmail history cursor is invalid.',
  malformed_message: 'Gmail message payload was malformed.',
  database_failure: 'Gmail sync persistence failed.',
  persistence_validation: 'Gmail sync persistence was refused.',
  transaction_failure: 'Gmail sync transaction failed.',
  lock_conflict: 'A Gmail sync is already in progress.',
  configuration_error: 'Gmail is not configured.',
  unknown: 'Gmail sync failed.',
};

/** D075/D076 cursor compare-and-set and other persistence state refusals. */
const PERSISTENCE_VALIDATION_CODES = new Set(['VALIDATION', 'OPTIMISTIC_CONCURRENCY']);

/** Application-level transaction wrapper failure. Distinct from Prisma P####. */
const PERSISTENCE_TRANSACTION_CODES = new Set(['TRANSACTION_FAILED']);

/** Residual PersistenceError codes that remain a database-class failure. */
const PERSISTENCE_DATABASE_RESIDUAL_CODES = new Set([
  'NOT_FOUND',
  'ORGANIZATION_MISMATCH',
  'UNIQUE_VIOLATION',
]);

const PRISMA_KNOWN_REQUEST_CODE = /^P\d{4}$/;

/**
 * Map persistence/Prisma failures onto distinct, non-sensitive Gmail sync codes.
 *
 * Never copies exception messages, SQL, connection strings, Prisma meta, or
 * Gmail content into the returned error. Callers persist only `error.code`.
 */
export function classifyGmailPersistenceFailure(error: unknown): GmailSyncError | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') {
    return null;
  }
  if (PERSISTENCE_VALIDATION_CODES.has(code)) {
    return new GmailSyncError('persistence_validation');
  }
  if (PERSISTENCE_TRANSACTION_CODES.has(code)) {
    return new GmailSyncError('transaction_failure');
  }
  if (PERSISTENCE_DATABASE_RESIDUAL_CODES.has(code) || PRISMA_KNOWN_REQUEST_CODE.test(code)) {
    return new GmailSyncError('database_failure');
  }
  return null;
}

export class GmailSyncError extends Error {
  readonly code: GmailSyncErrorCode;
  readonly retryable: boolean;

  constructor(code: GmailSyncErrorCode, message?: string, retryable?: boolean) {
    super(message ?? SAFE_MESSAGES[code]);
    this.code = code;
    this.retryable = retryable ?? DEFAULT_RETRYABLE[code];
    this.name = 'GmailSyncError';
  }
}

/**
 * Classify an HTTP status from Gmail REST. Never embeds `bodyText` in the error message.
 * Callers may inspect bodyText privately (e.g. invalid_grant) before calling this helper.
 */
export function classifyGmailHttpError(status: number, _bodyText?: string): GmailSyncError {
  void _bodyText;
  if (status === 401 || status === 403) {
    return new GmailSyncError('needs_reauth');
  }
  if (status === 404) {
    return new GmailSyncError('invalid_history');
  }
  if (status === 429) {
    return new GmailSyncError('rate_limited');
  }
  if (status >= 500 && status <= 599) {
    return new GmailSyncError('google_unavailable');
  }
  return new GmailSyncError('unknown');
}

export function isGmailSyncError(error: unknown): error is GmailSyncError {
  return error instanceof GmailSyncError;
}
