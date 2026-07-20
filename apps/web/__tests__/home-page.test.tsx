import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HomePage from '../app/page';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';

describe('HomePage', () => {
  it('renders signed-out Owner authentication entry point', async () => {
    vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
    render(await HomePage());

    expect(
      screen.getByRole('heading', { name: 'AI Communication Action Assistant' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Owner authentication is available.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in with Google Workspace' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('renders signed-in Owner session summary', async () => {
    vi.mocked(getAuthenticatedOwner).mockResolvedValue({
      user: {
        id: 'user-abc',
        email: 'owner@example.com',
        user_metadata: {},
        app_metadata: {},
        aud: 'authenticated',
        created_at: '2026-01-01T00:00:00.000Z',
      },
      actor: {
        kind: 'owner',
        ownerId: 'user-abc',
        organizationId: 'org_test_123',
      },
      session: {
        ownerId: 'user-abc',
        organizationId: 'org_test_123',
        role: 'owner',
        displayName: 'Owner Name',
      },
    });

    render(await HomePage());
    expect(screen.getByText('Signed in as Owner.')).toBeInTheDocument();
    expect(screen.getByText('Display name: Owner Name')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/tasks');
  });
});
