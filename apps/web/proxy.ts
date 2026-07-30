import { NextResponse, type NextRequest } from 'next/server';
import { AuthConfigError } from '@/lib/auth/errors';
import { createProxyClient } from '@/lib/supabase/proxy';

/** Recipient capability page surface — path-token authorization only. */
const CAPABILITY_PAGE_PREFIX = '/c/';

/** Recipient capability HTTP surface — path-token authorization only. */
const CAPABILITY_API_PREFIX = '/api/v1/capabilities/';

function withCapabilityPageHeaders(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return response;
}

/**
 * True for Recipient capability surfaces, which never consult the Owner session.
 *
 * Matching is an exact, case-sensitive prefix ending in `/` so neighbouring names
 * (`/capabilities`, `/api/v1/capabilities-admin`, `/cx/...`) stay on the Owner path.
 * A wrong answer here cannot grant access: the proxy performs no authorization, and
 * Owner routes independently verify identity before serving anything.
 */
export function isRecipientCapabilityPath(pathname: string): boolean {
  return pathname.startsWith(CAPABILITY_PAGE_PREFIX) || pathname.startsWith(CAPABILITY_API_PREFIX);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Recipient capability pages use path-token authorization only.
  // Skip Owner session refresh so opening /c/[token] never creates or requires a session.
  if (pathname.startsWith(CAPABILITY_PAGE_PREFIX)) {
    return withCapabilityPageHeaders(NextResponse.next({ request }));
  }

  // Recipient capability APIs likewise ignore Owner cookies (D049, D050, D059).
  // They set their own response headers, so nothing is added or removed here.
  if (pathname.startsWith(CAPABILITY_API_PREFIX)) {
    return NextResponse.next({ request });
  }

  let client: ReturnType<typeof createProxyClient>;
  try {
    client = createProxyClient(request);
  } catch (error) {
    if (error instanceof AuthConfigError) {
      return NextResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: error.message,
            requestId: crypto.randomUUID(),
            correlationId: null,
          },
        },
        { status: 500 },
      );
    }
    throw error;
  }

  try {
    // Cookie maintenance only — never an authorization decision, so the result is
    // discarded. `getSession()` contacts Supabase solely when the access token has
    // reached its refresh margin, in which case it rotates the token and writes the
    // refreshed cookies through the proxy cookie adapter onto both the incoming
    // request and the outgoing response. Verified identity is established exactly
    // once per request by `getAuthenticatedOwner()` via `auth.getUser()`.
    await client.supabase.auth.getSession();
  } catch {
    // Session state that cannot even be read (a truncated or foreign auth cookie makes
    // Supabase cookie storage throw) leaves nothing to maintain. The proxy grants no
    // access, so continuing is safe and keeps a bad cookie from 500ing every request;
    // the route still refuses to serve anything without a verified user.
  }

  return client.getResponse();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
