import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { createGoogleSupabaseUser } from './fixtures/supabase-user';

const getUser = vi.fn();
const getSession = vi.fn();
const extractOwnerCredential = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser,
      getSession,
    },
  })),
}));

vi.mock('@/lib/auth/owner-credential', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/owner-credential')>(
    '@/lib/auth/owner-credential',
  );
  return {
    ...actual,
    extractOwnerCredential: (...args: unknown[]) => extractOwnerCredential(...args),
  };
});

describe('require-owner authenticated request validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.OWNER_WORKSPACE_DOMAIN = 'example.com';
    process.env.OWNER_ORGANIZATION_ID = 'org_test_123';
    extractOwnerCredential.mockResolvedValue({ kind: 'cookie' });
  });

  it('uses auth.getUser() and does not rely on getSession()', async () => {
    getUser.mockResolvedValue({
      data: {
        user: createGoogleSupabaseUser({ email: 'owner@example.com', hostedDomain: 'example.com' }),
      },
      error: null,
    });

    const owner = await getAuthenticatedOwner();

    expect(getUser).toHaveBeenCalledOnce();
    expect(getUser).toHaveBeenCalledWith();
    expect(getSession).not.toHaveBeenCalled();
    expect(owner?.session.ownerId).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('verifies Bearer JWT through the same getUser + allowlist pipeline', async () => {
    extractOwnerCredential.mockResolvedValue({
      kind: 'bearer',
      accessToken: 'supabase-access-jwt',
    });
    getUser.mockResolvedValue({
      data: {
        user: createGoogleSupabaseUser({ email: 'owner@example.com', hostedDomain: 'example.com' }),
      },
      error: null,
    });

    const owner = await getAuthenticatedOwner();

    expect(getUser).toHaveBeenCalledOnce();
    expect(getUser).toHaveBeenCalledWith('supabase-access-jwt');
    expect(owner?.session).toEqual({
      ownerId: '11111111-2222-3333-4444-555555555555',
      organizationId: 'org_test_123',
      role: 'owner',
      displayName: expect.any(String),
    });
  });

  it('rejects Bearer users without a verified hosted domain claim', async () => {
    extractOwnerCredential.mockResolvedValue({
      kind: 'bearer',
      accessToken: 'supabase-access-jwt',
    });
    getUser.mockResolvedValue({
      data: {
        user: createGoogleSupabaseUser({
          email: 'owner@example.com',
          hostedDomain: null,
        }),
      },
      error: null,
    });

    await expect(getAuthenticatedOwner()).resolves.toBeNull();
  });

  it('rejects when Bearer getUser reports an auth error', async () => {
    extractOwnerCredential.mockResolvedValue({
      kind: 'bearer',
      accessToken: 'invalid-jwt',
    });
    getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid JWT' },
    });

    await expect(getAuthenticatedOwner()).resolves.toBeNull();
  });

  it('rejects users without a verified hosted domain claim', async () => {
    getUser.mockResolvedValue({
      data: {
        user: createGoogleSupabaseUser({
          email: 'owner@example.com',
          hostedDomain: null,
        }),
      },
      error: null,
    });

    await expect(getAuthenticatedOwner()).resolves.toBeNull();
  });

  it('rejects the request when the session cookie cannot be read at all', async () => {
    // `@supabase/ssr` throws while decoding a truncated or foreign `sb-*-auth-token`
    // cookie instead of reporting an auth error. An unreadable cookie is not an identity,
    // so it must reject rather than propagate and turn every Owner request into a 500.
    getUser.mockRejectedValue(new Error('Invalid UTF-8 sequence'));

    await expect(getAuthenticatedOwner()).resolves.toBeNull();
  });

  it('does not trust user_metadata.custom_claims.hd when identity claims are absent', async () => {
    getUser.mockResolvedValue({
      data: {
        user: createGoogleSupabaseUser({
          email: 'owner@example.com',
          hostedDomain: null,
          hostedDomainLocation: 'none',
          includeUserMetadataCustomClaimsHd: true,
        }),
      },
      error: null,
    });

    await expect(getAuthenticatedOwner()).resolves.toBeNull();
  });
});
