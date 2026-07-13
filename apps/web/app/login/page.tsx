import { Suspense } from 'react';
import { getAuthConfig } from '@/lib/auth/config';
import { LoginPageContent } from './login-page-content';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const { ownerWorkspaceDomain } = getAuthConfig();

  return (
    <Suspense
      fallback={
        <main>
          <h1>Owner sign in</h1>
        </main>
      }
    >
      <LoginPageContent workspaceDomainHint={ownerWorkspaceDomain} />
    </Suspense>
  );
}
