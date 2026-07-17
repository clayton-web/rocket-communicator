import 'server-only';

/**
 * Safe, stable callback error categories. These are the ONLY values ever placed in a redirect
 * query string. They never contain tokens, authorization codes, state, PKCE material, email
 * addresses, or raw Google error bodies.
 */
export type GmailCallbackErrorCode =
  | 'invalid_state'
  | 'expired_state'
  | 'oauth_denied'
  | 'missing_code'
  | 'exchange_failed'
  | 'missing_refresh_token'
  | 'identity_unverified'
  | 'domain_mismatch'
  | 'duplicate_account'
  | 'persistence_failed'
  | 'configuration_error'
  | 'server_error';

export class GmailCallbackError extends Error {
  readonly code: GmailCallbackErrorCode;
  constructor(code: GmailCallbackErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'GmailCallbackError';
  }
}

/** Safe categories for the authenticated JSON endpoints (connection, disconnect, start, sync). */
export type GmailRequestErrorCode =
  | 'unauthorized'
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'lock_conflict'
  | 'configuration_error'
  | 'server_error';

export class GmailRequestError extends Error {
  readonly code: GmailRequestErrorCode;
  constructor(code: GmailRequestErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'GmailRequestError';
  }
}
