import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { createGoogleSupabaseUser } from './fixtures/supabase-user';

const getUser = vi.fn();
const getSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser,
      getSession,
    },
  })),
}));

describe('require-owner authenticated request validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.OWNER_WORKSPACE_DOMAIN = 'example.com';
    process.env.OWNER_ORGANIZATION_ID = 'org_test_123';
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
    expect(getSession).not.toHaveBeenCalled();
    expect(owner?.session.ownerId).toBe('11111111-2222-3333-4444-555555555555');
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
