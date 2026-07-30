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
export function createProxyClient(request: NextRequest): ProxySupabase {
  const { supabaseUrl, supabaseAnonKey } = getAuthConfig();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  return { supabase, getResponse: () => response };
}
