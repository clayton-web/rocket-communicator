import 'server-only';
import { OAuth2Client } from 'google-auth-library';
import { getGmailOAuthConfig, type GmailOAuthConfig } from './config';
import { GmailSyncError } from './sync-errors';

/**
 * Exchange a refresh token for a short-lived access token (memory only).
 * Never logs tokens. Never persists the access token.
 */
export async function getGmailAccessToken(input: {
  refreshToken: string;
  config?: GmailOAuthConfig;
}): Promise<string> {
  const config = input.config ?? getGmailOAuthConfig();
  const client = new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
  client.setCredentials({ refresh_token: input.refreshToken });

  try {
    const result = await client.getAccessToken();
    const token = result.token;
    if (!token) {
      throw new GmailSyncError('needs_reauth', 'Gmail access token refresh returned empty.');
    }
    return token;
  } catch (error) {
    if (error instanceof GmailSyncError) {
      throw error;
    }
    throw mapAccessTokenError(error);
  }
}

function mapAccessTokenError(error: unknown): GmailSyncError {
  const status = readHttpStatus(error);
  const message = readErrorMessage(error);
  const oauthError = readOAuthErrorCode(error);

  // google-auth-library / Gaxios often returns HTTP 400 with data.error=invalid_grant
  // and a generic message ("Request failed with status code 400"), which previously
  // collapsed to `unknown` and left the account stuck in `connected`.
  if (
    status === 401 ||
    status === 403 ||
    oauthError === 'invalid_grant' ||
    oauthError === 'unauthorized_client' ||
    /invalid_grant/i.test(message)
  ) {
    return new GmailSyncError('needs_reauth');
  }
  if (status === 429 || oauthError === 'rate_limit_exceeded') {
    return new GmailSyncError('rate_limited');
  }
  if (typeof status === 'number' && status >= 500 && status <= 599) {
    return new GmailSyncError('google_unavailable');
  }
  if (isNetworkish(error) || /ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|network/i.test(message)) {
    return new GmailSyncError('network_failure');
  }
  return new GmailSyncError('unknown');
}

function readHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const record = error as {
    status?: unknown;
    code?: unknown;
    response?: { status?: unknown };
  };
  if (typeof record.status === 'number') {
    return record.status;
  }
  if (typeof record.response?.status === 'number') {
    return record.response.status;
  }
  if (typeof record.code === 'number') {
    return record.code;
  }
  return undefined;
}

/**
 * Reads OAuth error codes from Gaxios-style errors without embedding response bodies
 * or tokens into thrown messages.
 */
function readOAuthErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const data = (error as { response?: { data?: unknown } }).response?.data;
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const code = (data as { error?: unknown }).error;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return '';
}

function isNetworkish(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNREFUSED'
  );
}

export type GmailAccessTokenProvider = typeof getGmailAccessToken;
