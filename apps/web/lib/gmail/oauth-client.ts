import 'server-only';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { GMAIL_READONLY_SCOPE } from '@aicaa/domain';
import { getGmailOAuthConfig, type GmailOAuthConfig } from './config';

/**
 * Minimal server-only Gmail OAuth surface (A5.3).
 *
 * Uses `google-auth-library` for the authorization URL, PKCE code exchange, verified
 * OpenID identity, and best-effort revocation. No Gmail message API client is pulled in;
 * `googleapis` is intentionally NOT a dependency. This module is server-only and must never
 * enter a client bundle.
 */

/** openid + email are required for verified identity; gmail.readonly is the only data scope (D070). */
export const GMAIL_OAUTH_SCOPES = ['openid', 'email', GMAIL_READONLY_SCOPE] as const;

/** Accepted Google ID-token issuers after signature verification. */
const GOOGLE_ID_TOKEN_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export { CodeChallengeMethod };

export interface GmailTokenExchangeResult {
  refreshToken: string | null;
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  grantedScopes: string;
  tokenType: string | null;
  idToken: string | null;
}

export interface GmailVerifiedIdentity {
  email: string;
  hostedDomain: string;
  subject: string;
  emailVerified: boolean;
}

function createClient(config: GmailOAuthConfig): OAuth2Client {
  return new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUrl,
  });
}

/** Build the Google authorization URL with offline access, consent, PKCE, and readonly scope. */
export function buildGmailAuthUrl(input: {
  state: string;
  codeChallenge: string;
  config?: GmailOAuthConfig;
}): string {
  const config = input.config ?? getGmailOAuthConfig();
  const client = createClient(config);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: false,
    scope: [...GMAIL_OAUTH_SCOPES],
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
}

/** Exchange an authorization code + PKCE verifier for tokens (server-side). */
export async function exchangeGmailCode(input: {
  code: string;
  codeVerifier: string;
  config?: GmailOAuthConfig;
}): Promise<GmailTokenExchangeResult> {
  const config = input.config ?? getGmailOAuthConfig();
  const client = createClient(config);
  const { tokens } = await client.getToken({
    code: input.code,
    codeVerifier: input.codeVerifier,
  });

  return {
    refreshToken: tokens.refresh_token ?? null,
    accessToken: tokens.access_token ?? null,
    accessTokenExpiresAt:
      typeof tokens.expiry_date === 'number' ? new Date(tokens.expiry_date).toISOString() : null,
    grantedScopes: typeof tokens.scope === 'string' ? tokens.scope : '',
    tokenType: tokens.token_type ?? null,
    idToken: tokens.id_token ?? null,
  };
}

/**
 * Verify the returned OpenID id_token and extract the connected mailbox identity.
 * Checks signature (via Google certs), audience = client id, issuer, expiry, email,
 * email_verified, subject, and hosted-domain claim presence. Does not trust query params.
 */
export async function verifyGmailIdentity(input: {
  idToken: string;
  config?: GmailOAuthConfig;
}): Promise<GmailVerifiedIdentity> {
  const config = input.config ?? getGmailOAuthConfig();
  const client = createClient(config);
  const ticket = await client.verifyIdToken({
    idToken: input.idToken,
    audience: config.clientId,
  });
  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('Google identity payload is missing.');
  }
  if (!payload.iss || !GOOGLE_ID_TOKEN_ISSUERS.has(payload.iss)) {
    throw new Error('Google identity issuer is invalid.');
  }
  if (
    payload.aud !== config.clientId &&
    !(Array.isArray(payload.aud) && payload.aud.includes(config.clientId))
  ) {
    throw new Error('Google identity audience is invalid.');
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) {
    throw new Error('Google identity token is expired.');
  }
  if (!payload.email || typeof payload.email !== 'string') {
    throw new Error('Google identity email is missing.');
  }
  if (payload.email_verified !== true) {
    throw new Error('Google identity email is not verified.');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Google identity subject is missing.');
  }
  if (!payload.hd || typeof payload.hd !== 'string' || !payload.hd.trim()) {
    throw new Error('Google identity hosted domain is missing.');
  }
  return {
    email: payload.email,
    hostedDomain: payload.hd,
    subject: payload.sub,
    emailVerified: true,
  };
}

/** Best-effort revocation of a Gmail token at Google. Returns true only on confirmed success. */
export async function revokeGmailToken(input: {
  token: string;
  config?: GmailOAuthConfig;
}): Promise<boolean> {
  const config = input.config ?? getGmailOAuthConfig();
  const client = createClient(config);
  try {
    await client.revokeToken(input.token);
    return true;
  } catch {
    return false;
  }
}
