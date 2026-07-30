import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getAuthConfig } from '@/lib/auth/config';

export interface ProxySupabase {
  supabase: ReturnType<typeof createServerClient>;
  /**
   * The response the proxy must return. Call this **after** the Supabase call, never
   * before: a token rotation replaces the response so the refreshed cookies reach the
   * route handling this same request.
   */
  getResponse(): NextResponse;
}

/**
 * Supabase client for the Next.js proxy, wired so a refreshed session reaches both the
 * browser and the route serving the current request.
 *
 * `NextResponse.next({ request })` copies the request headers into `x-middleware-request-*`
 * override headers **at construction time** (Next.js `handleMiddlewareField`). Mutating
 * `request.cookies` afterwards therefore updates the in-memory request object but not the
 * already-captured snapshot, so the route would still read the pre-rotation cookie and
 * spend a second refresh round trip on a refresh token the proxy had just consumed.
 * Recreating the response inside `setAll` re-captures the headers, which is why the
 * Supabase Next.js middleware guidance builds the response there rather than up front.
 */
export function createProxyClient(
  request: NextRequest,
  /**
   * Proxy-derived request header to force onto every downstream request. Applied on each
   * response construction rather than once, so the value survives cookie rotation. `null`
   * means "delete only", which is how a caller-supplied value is denied on routes that
   * carry no authorized value of their own.
   */
  internalHeader?: { name: string; value: string | null },
): ProxySupabase {
  const { supabaseUrl, supabaseAnonKey } = getAuthConfig();

  /*
   * Headers are re-derived from `request` on every call rather than snapshotted once,
   * because `setAll` writes rotated cookies onto `request.cookies`, which is backed by the
   * request's `cookie` header. Reusing a stale snapshot would drop the rotation and cost the
   * route a second refresh round trip on a token the proxy had just consumed.
   */
  const buildResponse = () => {
    if (!internalHeader) {
      return NextResponse.next({ request });
    }
    const headers = new Headers(request.headers);
    // Unconditional delete before any set: an inbound value can never survive.
    headers.delete(internalHeader.name);
    if (internalHeader.value !== null) {
      headers.set(internalHeader.name, internalHeader.value);
    }
    return NextResponse.next({ request: { headers } });
  };

  let response = buildResponse();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = buildResponse();
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  return { supabase, getResponse: () => response };
}
