'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getPublicAuthConfig } from '@/lib/auth/config';

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized_domain:
    'This Google account is not authorized for this application workspace domain.',
  auth_failed: 'Sign-in failed. Please try again.',
  missing_code: 'Sign-in was interrupted. Please try again.',
};

interface LoginPageContentProps {
  workspaceDomainHint: string;
}

export function LoginPageContent({ workspaceDomainHint }: LoginPageContentProps) {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get('error');
  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] : null;

  const redirectTo = useMemo(() => {
    const { appUrl } = getPublicAuthConfig();
    return `${appUrl}/auth/callback`;
  }, []);

  async function signInWithGoogle() {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        // Account-selection UX only; Workspace enforcement uses verified identity_data.hd.
        queryParams: {
          hd: workspaceDomainHint,
        },
      },
    });

    if (error) {
      console.error('Google sign-in failed', error.message);
    }
  }

  return (
    <main>
      <h1>Owner sign in</h1>
      <p>Sign in with your Google Workspace account to continue.</p>
      {errorMessage ? (
        <p role="alert" className="status">
          {errorMessage}
        </p>
      ) : null}
      <button type="button" onClick={() => void signInWithGoogle()}>
        Sign in with Google
      </button>
    </main>
  );
}
