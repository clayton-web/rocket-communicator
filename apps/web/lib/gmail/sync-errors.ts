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
  lock_conflict: 'A Gmail sync is already in progress.',
  configuration_error: 'Gmail is not configured.',
  unknown: 'Gmail sync failed.',
};

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
