import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPageContent } from '../app/login/login-page-content';

const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signInWithOAuth,
    },
  }),
}));

describe('LoginPage', () => {
  afterEach(() => {
    cleanup();
    signInWithOAuth.mockClear();
  });
  it('renders the Owner Google sign-in page', () => {
    render(<LoginPageContent workspaceDomainHint="example.com" />);

    expect(screen.getByRole('heading', { name: 'Owner sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
  });

  it('passes the Workspace hd hint for account selection only', async () => {
    render(<LoginPageContent workspaceDomainHint="example.com" />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

    await waitFor(() => {
      expect(signInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: {
          redirectTo: 'http://localhost:3000/auth/callback',
          queryParams: {
            hd: 'example.com',
          },
        },
      });
    });
  });
});
