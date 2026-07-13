import { describe, expect, it } from 'vitest';
import { mapDisplayName, mapSupabaseUserToSession } from '@/lib/auth/session';

describe('session mapping', () => {
  const organizationId = 'org_configured_123';

  it('maps ownerId, organizationId, and role from configuration', () => {
    const session = mapSupabaseUserToSession(
      {
        id: 'user-abc',
        email: 'owner@example.com',
        user_metadata: { full_name: 'Owner Name' },
        app_metadata: {},
        aud: 'authenticated',
        created_at: '2026-01-01T00:00:00.000Z',
      },
      organizationId,
    );

    expect(session).toEqual({
      ownerId: 'user-abc',
      organizationId,
      role: 'owner',
      displayName: 'Owner Name',
    });
  });

  it('uses email-derived display name fallback', () => {
    const session = mapSupabaseUserToSession(
      {
        id: 'user-abc',
        email: 'owner@example.com',
        user_metadata: {},
        app_metadata: {},
        aud: 'authenticated',
        created_at: '2026-01-01T00:00:00.000Z',
      },
      organizationId,
    );

    expect(session.displayName).toBe('owner');
    expect(session.organizationId).toBe(organizationId);
    expect(session.role).toBe('owner');
  });

  it('does not derive organizationId from email domain', () => {
    const session = mapSupabaseUserToSession(
      {
        id: 'user-abc',
        email: 'owner@other-domain.com',
        user_metadata: {},
        app_metadata: {},
        aud: 'authenticated',
        created_at: '2026-01-01T00:00:00.000Z',
      },
      organizationId,
    );

    expect(session.organizationId).toBe(organizationId);
    expect(session.organizationId).not.toBe('other-domain.com');
  });

  it('maps display names from metadata or email', () => {
    expect(
      mapDisplayName({
        email: 'owner@example.com',
        user_metadata: { full_name: '  Pat Example  ' },
      }),
    ).toBe('Pat Example');
    expect(mapDisplayName({ email: 'owner@example.com', user_metadata: {} })).toBe('owner');
  });
});
