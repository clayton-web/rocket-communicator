import 'server-only';
import { getPublicAuthConfig } from '@/lib/auth/config';

/**
 * Gmail OAuth is a distinct, server-only integration boundary from Supabase Owner
 * authentication (A5 decision). Missing configuration fails closed and never echoes
 * secret values in messages or logs.
 */
export class GmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailConfigError';
  }
}

export interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
  appUrl: string;
  ownerWorkspaceDomain: string;
  ownerOrganizationId: string;
}

/** Default in-app destination for OAuth completion (UI lands in a later chunk). */
export const DEFAULT_GMAIL_RETURN_PATH = '/settings/gmail';

/** Server-only callback path. Kept in sync with the app route file location. */
export const GMAIL_OAUTH_CALLBACK_PATH = '/api/v1/gmail/oauth/callback';

function requireConfiguredEnv(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    // Name only — never the value.
    throw new GmailConfigError(`${name} is required.`);
  }
  return trimmed;
}

/**
 * Strict server-only Gmail OAuth config. `GMAIL_OAUTH_REDIRECT_URL` is optional and
 * safely derived from `NEXT_PUBLIC_APP_URL` when unset.
 */
export function getGmailOAuthConfig(env: NodeJS.ProcessEnv = process.env): GmailOAuthConfig {
  const { appUrl } = getPublicAuthConfig();

  const clientId = requireConfiguredEnv(env.GOOGLE_GMAIL_CLIENT_ID, 'GOOGLE_GMAIL_CLIENT_ID');
  const clientSecret = requireConfiguredEnv(
    env.GOOGLE_GMAIL_CLIENT_SECRET,
    'GOOGLE_GMAIL_CLIENT_SECRET',
  );
  const ownerWorkspaceDomain = requireConfiguredEnv(
    env.OWNER_WORKSPACE_DOMAIN,
    'OWNER_WORKSPACE_DOMAIN',
  );
  const ownerOrganizationId = requireConfiguredEnv(
    env.OWNER_ORGANIZATION_ID,
    'OWNER_ORGANIZATION_ID',
  );

  const configuredRedirect = env.GMAIL_OAUTH_REDIRECT_URL?.trim();
  const redirectUrl = configuredRedirect
    ? configuredRedirect
    : `${appUrl}${GMAIL_OAUTH_CALLBACK_PATH}`;

  return {
    clientId,
    clientSecret,
    redirectUrl,
    appUrl,
    ownerWorkspaceDomain,
    ownerOrganizationId,
  };
}
