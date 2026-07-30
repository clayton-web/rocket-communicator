import { NextResponse } from 'next/server';
import { AuthConfigError } from '@/lib/auth/errors';
import { getAuthConfig } from '@/lib/auth/config';
import { internalErrorResponse } from '@/lib/auth/http';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /auth/sign-out — end the Owner session (P1.4).
 *
 * Deliberately outside `/api/v1`, following the `/auth/callback` precedent: session
 * establishment and teardown are browser navigation concerns, not part of the versioned
 * product contract, so no OpenAPI path, schema, or generated client changes.
 *
 * `POST` only. No `GET` handler is exported, so Next.js answers a GET with 405 and there is
 * no URL that ends a session by being visited. That matters concretely rather than
 * theoretically: `next/link` prefetches, so a GET sign-out link would sign the Owner out
 * while they were merely looking at a page that linked to it. The shell therefore submits a
 * native form and never links here.
 *
 * `supabase.auth.signOut()` revokes server-side and clears the cookie, so the session is
 * genuinely invalidated rather than hidden — a subsequent `/tasks` request finds no session
 * and `requireOwnerPage` redirects to `/login`.
 */
export async function POST(request: Request) {
  try {
    const config = getAuthConfig();
    const supabase = await createClient();

    // Fail-open on teardown: if revocation errors, the local cookie is still cleared and the
    // Owner is still returned to the signed-out surface. Leaving them on an authenticated
    // page believing they had signed out would be the worse outcome.
    await supabase.auth.signOut();

    // 303 so the browser follows with GET. A 307 would replay the POST against `/login`,
    // which exports no POST handler and would answer 405.
    return NextResponse.redirect(new URL('/login?signed_out=1', config.appUrl), 303);
  } catch (error) {
    if (error instanceof AuthConfigError) {
      return internalErrorResponse(error.message);
    }
    // Never leak a dependency failure detail to the browser; `request` is unused otherwise.
    void request;
    throw error;
  }
}
