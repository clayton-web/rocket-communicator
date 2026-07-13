import { AuthConfigError } from './errors';

export interface AuthConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  appUrl: string;
  ownerWorkspaceDomain: string;
  ownerOrganizationId: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AuthConfigError(`${name} is required.`);
  }
  return value;
}

export function getAuthConfig(): AuthConfig {
  return {
    supabaseUrl: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    supabaseAnonKey: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    appUrl: requireEnv('NEXT_PUBLIC_APP_URL').replace(/\/$/, ''),
    ownerWorkspaceDomain: requireEnv('OWNER_WORKSPACE_DOMAIN'),
    ownerOrganizationId: requireEnv('OWNER_ORGANIZATION_ID'),
  };
}

export function getPublicAuthConfig(): Pick<
  AuthConfig,
  'supabaseUrl' | 'supabaseAnonKey' | 'appUrl'
> {
  return {
    supabaseUrl: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    supabaseAnonKey: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    appUrl: requireEnv('NEXT_PUBLIC_APP_URL').replace(/\/$/, ''),
  };
}
