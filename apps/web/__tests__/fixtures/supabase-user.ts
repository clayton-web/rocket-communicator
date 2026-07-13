import type { User } from '@supabase/supabase-js';

interface GoogleSupabaseUserOptions {
  id?: string;
  email: string;
  hostedDomain?: string | null;
  includeUserMetadataHd?: boolean;
  provider?: string;
}

/**
 * Supabase User shape returned by auth.getUser() after Google OAuth.
 * The verified Workspace `hd` claim is on identities[].identity_data, not user_metadata.
 */
export function createGoogleSupabaseUser({
  id = '11111111-2222-3333-4444-555555555555',
  email,
  hostedDomain = 'example.com',
  includeUserMetadataHd = false,
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

  if (hostedDomain) {
    identityData.hd = hostedDomain;
  }

  const userMetadata: Record<string, unknown> = {
    avatar_url: identityData.avatar_url,
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

  if (includeUserMetadataHd && hostedDomain) {
    userMetadata.hd = hostedDomain;
  }

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
