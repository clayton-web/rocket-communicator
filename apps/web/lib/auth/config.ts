import { AuthConfigError } from './errors';

export interface AuthConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  appUrl: string;
  ownerWorkspaceDomain: string;
  ownerOrganizationId: string;
}

function requireConfiguredEnv(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new AuthConfigError(`${name} is required.`);
  }
  return trimmed;
}

function normalizeAppUrl(appUrl: string): string {
  return appUrl.replace(/\/$/, '');
}

export function getPublicAuthConfig(): Pick<
  AuthConfig,
  'supabaseUrl' | 'supabaseAnonKey' | 'appUrl'
> {
  // NEXT_PUBLIC_* must use static process.env access so Next.js can inline them in client bundles.
  return {
    supabaseUrl: requireConfiguredEnv(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      'NEXT_PUBLIC_SUPABASE_URL',
    ),
    supabaseAnonKey: requireConfiguredEnv(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ),
    appUrl: normalizeAppUrl(
      requireConfiguredEnv(process.env.NEXT_PUBLIC_APP_URL, 'NEXT_PUBLIC_APP_URL'),
    ),
  };
}

export function getAuthConfig(): AuthConfig {
  const publicConfig = getPublicAuthConfig();

  return {
    ...publicConfig,
    ownerWorkspaceDomain: requireConfiguredEnv(
      process.env.OWNER_WORKSPACE_DOMAIN,
      'OWNER_WORKSPACE_DOMAIN',
    ),
    ownerOrganizationId: requireConfiguredEnv(
      process.env.OWNER_ORGANIZATION_ID,
      'OWNER_ORGANIZATION_ID',
    ),
  };
}
