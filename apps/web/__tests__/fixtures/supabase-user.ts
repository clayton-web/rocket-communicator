import type { User } from '@supabase/supabase-js';

type HostedDomainLocation = 'custom_claims' | 'top_level' | 'both' | 'none';

interface GoogleSupabaseUserOptions {
  id?: string;
  email: string;
  hostedDomain?: string | null;
  hostedDomainLocation?: HostedDomainLocation;
  includeUserMetadataCustomClaimsHd?: boolean;
  provider?: string;
}

/**
 * Supabase User shape returned by auth.getUser() after Google OAuth.
 * Live Workspace `hd` is observed on identities[].identity_data.custom_claims.hd.
 */
export function createGoogleSupabaseUser({
  id = '11111111-2222-3333-4444-555555555555',
  email,
  hostedDomain = 'example.com',
  hostedDomainLocation = 'custom_claims',
  includeUserMetadataCustomClaimsHd = false,
  provider = 'google',
}: GoogleSupabaseUserOptions): User {
  const identityData: Record<string, unknown> = {
    avatar_url: 'https://lh3.googleusercontent.com/a/example',
    email,
    email_verified: true,
    full_name: 'Owner Name',
    iss: 'https://accounts.google.com',
    name: 'Owner Name',
    phone_verified: false,
    picture: 'https://lh3.googleusercontent.com/a/example',
    provider_id: '1234567890',
    sub: '1234567890',
  };

  const location =
    hostedDomain == null ? 'none' : hostedDomainLocation === 'both' ? 'both' : hostedDomainLocation;

  if (hostedDomain && (location === 'top_level' || location === 'both')) {
    identityData.hd = hostedDomain;
  }

  if (hostedDomain && (location === 'custom_claims' || location === 'both')) {
    identityData.custom_claims = { hd: hostedDomain };
  }

  const userMetadata: Record<string, unknown> = {
    avatar_url: identityData.avatar_url,
    custom_claims: hostedDomain && includeUserMetadataCustomClaimsHd ? { hd: hostedDomain } : {},
    email,
    email_verified: true,
    full_name: 'Owner Name',
    iss: 'https://accounts.google.com',
    name: 'Owner Name',
    phone_verified: false,
    picture: identityData.picture,
    provider_id: identityData.provider_id,
    sub: identityData.sub,
  };

  return {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    phone: '',
    confirmed_at: '2026-01-01T00:00:00.000Z',
    last_sign_in_at: '2026-01-01T00:00:00.000Z',
    app_metadata: {
      provider,
      providers: [provider],
    },
    user_metadata: userMetadata,
    identities: [
      {
        identity_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        id: '1234567890',
        user_id: id,
        identity_data: identityData,
        provider,
        last_sign_in_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    is_anonymous: false,
  };
}
