// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoogleSupabaseUser } from './fixtures/supabase-user';

/**
 * P1.3 authentication evidence.
 *
 * These tests count real Supabase HTTP operations, not source-code call sites: the real
 * proxy and the real server client run against a stubbed `fetch`, and every request to
 * the Auth API is recorded. `GET /auth/v1/user` is the server-verified identity call that
 * D119 budgets; `POST /auth/v1/token?grant_type=refresh_token` is cookie maintenance.
 */

const SUPABASE_URL = 'https://example.supabase.co';
const STORAGE_KEY = 'sb-example-auth-token';
const USER_ENDPOINT = `${SUPABASE_URL}/auth/v1/user`;
const TOKEN_ENDPOINT = `${SUPABASE_URL}/auth/v1/token`;

let cookieJar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [...cookieJar.entries()].map(([name, value]) => ({ name, value })),
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
  }),
}));

interface AuthCallLog {
  user: number;
  refresh: number;
  all: string[];
}

let calls: AuthCallLog;
let currentUser: ReturnType<typeof createGoogleSupabaseUser>;
/** Override the refresh endpoint for a single test (for example an invalid refresh token). */
let refreshResponder: (() => Response) | null = null;

function encodeSessionCookie(session: Record<string, unknown>): string {
  return `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}

function session(
  options: { expired: boolean } | { expiresInSeconds: number },
): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const offset =
    'expiresInSeconds' in options ? options.expiresInSeconds : options.expired ? -60 : 3600;
  return {
    access_token: 'access-token-value',
    refresh_token: 'refresh-token-value',
    token_type: 'bearer',
    expires_in: 3600,
    // The auth client refreshes within a 90s margin, so "valid" must clear it comfortably.
    expires_at: nowSeconds + offset,
    user: currentUser,
  };
}

/**
 * Copy the proxy's forwarded request cookies into the jar the route reads.
 *
 * Next.js delivers proxy cookie mutations to the route through the
 * `x-middleware-request-cookie` override header, so replaying that header is what makes
 * the route see the same cookies it would receive in a real request.
 */
function applyForwardedCookies(response: Response): void {
  const forwarded = response.headers.get('x-middleware-request-cookie');
  if (!forwarded) {
    return;
  }
  for (const pair of forwarded.split('; ')) {
    const index = pair.indexOf('=');
    if (index > 0) {
      cookieJar.set(pair.slice(0, index), decodeURIComponent(pair.slice(index + 1)));
    }
  }
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.all.push(url);

      if (url.startsWith(USER_ENDPOINT)) {
        calls.user += 1;
        return new Response(JSON.stringify(currentUser), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.startsWith(TOKEN_ENDPOINT)) {
        calls.refresh += 1;
        if (refreshResponder) {
          return refreshResponder();
        }
        return new Response(
          JSON.stringify({
            access_token: 'refreshed-access-token',
            refresh_token: 'refreshed-refresh-token',
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: currentUser,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected fetch to ${url}${init?.method ? ` (${init.method})` : ''}`);
    }),
  );
}

/**
 * Load the modules under test from one module registry.
 *
 * `require-owner` scopes its memo to the request context object owned by the
 * observability module, so both must come from the same registry for the memo to be
 * exercised at all — importing one statically and one after `resetModules` would
 * silently disable it and make the count assertions meaningless.
 */
async function loadModules() {
  const [{ getAuthenticatedOwner }, { runWithRequestContext }, { proxy }] = await Promise.all([
    import('@/lib/auth/require-owner'),
    import('@/lib/observability'),
    import('@/proxy'),
  ]);
  return { getAuthenticatedOwner, runWithRequestContext, proxy };
}

/** Run the real proxy for a path, carrying the current cookie jar. */
async function runProxy(pathname: string) {
  const { proxy } = await loadModules();
  const cookieHeader = [...cookieJar.entries()]
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
  const request = new NextRequest(`http://localhost:3000${pathname}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  const response = await proxy(request);
  return { request, response };
}

describe('Owner authentication operation count (P1.3)', () => {
  beforeEach(() => {
    vi.resetModules();
    calls = { user: 0, refresh: 0, all: [] };
    refreshResponder = null;
    currentUser = createGoogleSupabaseUser({
      email: 'owner@example.com',
      hostedDomain: 'example.com',
    });
    cookieJar = new Map([[STORAGE_KEY, encodeSessionCookie(session({ expired: false }))]]);

    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.OWNER_WORKSPACE_DOMAIN = 'example.com';
    process.env.OWNER_ORGANIZATION_ID = 'org_test_123';

    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('performs exactly one verified getUser across proxy and route for an Owner page', async () => {
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    await runProxy('/tasks');
    const owner = await runWithRequestContext({ routeTemplate: '/tasks' }, getAuthenticatedOwner);

    expect(owner?.session.ownerId).toBe('11111111-2222-3333-4444-555555555555');
    expect(calls.user).toBe(1);
    expect(calls.refresh).toBe(0);
  });

  it('performs exactly one verified getUser across proxy and route for an Owner API request', async () => {
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    await runProxy('/api/v1/tasks');
    const owner = await runWithRequestContext(
      { routeTemplate: '/api/v1/tasks' },
      getAuthenticatedOwner,
    );

    expect(owner).not.toBeNull();
    expect(calls.user).toBe(1);
  });

  it('refreshes an expiring session in the proxy without a verified getUser', async () => {
    cookieJar = new Map([[STORAGE_KEY, encodeSessionCookie(session({ expired: true }))]]);

    const { response } = await runProxy('/tasks');

    expect(calls.refresh).toBe(1);
    expect(calls.user).toBe(0);
    // The rotated cookie must be written back to the browser.
    expect(response.cookies.get(STORAGE_KEY)?.value).toContain('base64-');
  });

  it('publishes the rotated cookie to the route serving the same request', async () => {
    cookieJar = new Map([[STORAGE_KEY, encodeSessionCookie(session({ expired: true }))]]);

    const { response } = await runProxy('/tasks');

    // Next.js hands the route the cookies captured in `x-middleware-request-cookie`, not
    // the proxy's in-memory NextRequest. Asserting the override header is what proves the
    // route reads the rotated token instead of spending a second refresh on a token the
    // proxy already consumed. `NextResponse.next({ request })` snapshots these headers at
    // construction, so this fails if the response is not rebuilt after the rotation.
    const forwarded = response.headers.get('x-middleware-request-cookie') ?? '';
    const rotated = decodeURIComponent(forwarded.split(`${STORAGE_KEY}=`)[1] ?? '');
    const decoded = JSON.parse(
      Buffer.from(rotated.replace('base64-', ''), 'base64url').toString('utf8'),
    );

    expect(decoded.access_token).toBe('refreshed-access-token');
  });

  it('spends one refresh and one verified getUser when the proxy rotates for an Owner page', async () => {
    cookieJar = new Map([[STORAGE_KEY, encodeSessionCookie(session({ expired: true }))]]);
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    const { response } = await runProxy('/tasks');
    // Next.js gives the route the proxy's forwarded cookies; mirror that handoff so the
    // route reads what it would really receive rather than the pre-rotation jar.
    applyForwardedCookies(response);
    const owner = await runWithRequestContext({ routeTemplate: '/tasks' }, getAuthenticatedOwner);

    expect(owner).not.toBeNull();
    // 1 session refresh operation + 1 verified identity operation = 2 Auth HTTP calls.
    expect(calls.refresh).toBe(1);
    expect(calls.user).toBe(1);
    expect(calls.all).toHaveLength(2);
  });

  it('treats a token inside the refresh margin as due for rotation', async () => {
    // The auth client refreshes anything expiring within EXPIRY_MARGIN_MS (90s).
    cookieJar = new Map([[STORAGE_KEY, encodeSessionCookie(session({ expiresInSeconds: 30 }))]]);

    await runProxy('/tasks');

    expect(calls.refresh).toBe(1);
    expect(calls.user).toBe(0);
  });

  it('rejects the route when the refresh token is no longer valid', async () => {
    refreshResponder = () =>
      new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid Refresh' }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      );
    cookieJar = new Map([[STORAGE_KEY, encodeSessionCookie(session({ expired: true }))]]);
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    const { response } = await runProxy('/tasks');
    applyForwardedCookies(response);
    const owner = await runWithRequestContext({ routeTemplate: '/tasks' }, getAuthenticatedOwner);

    expect(owner).toBeNull();
    // The route retries the rejected refresh itself and never reaches a verified getUser.
    expect(calls.user).toBe(0);
    expect(calls.refresh).toBeGreaterThanOrEqual(1);
  });

  it('rejects a malformed session cookie without any Auth network call', async () => {
    cookieJar = new Map([[STORAGE_KEY, 'not-a-session']]);
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    const { response } = await runProxy('/tasks');
    applyForwardedCookies(response);

    await expect(
      runWithRequestContext({ routeTemplate: '/tasks' }, getAuthenticatedOwner),
    ).resolves.toBeNull();
    expect(calls.all).toEqual([]);
  });

  it('memoizes within one request context and still verifies exactly once', async () => {
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    const [first, second, third] = await runWithRequestContext({ requestId: 'req-1' }, async () =>
      Promise.all([getAuthenticatedOwner(), getAuthenticatedOwner(), getAuthenticatedOwner()]),
    );

    expect(calls.user).toBe(1);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('never reuses a resolution across requests', async () => {
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    await runWithRequestContext({ requestId: 'req-1' }, getAuthenticatedOwner);
    await runWithRequestContext({ requestId: 'req-2' }, getAuthenticatedOwner);

    expect(calls.user).toBe(2);
  });

  it('keeps concurrent requests isolated', async () => {
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    const [a, b] = await Promise.all([
      runWithRequestContext({ requestId: 'req-a' }, getAuthenticatedOwner),
      runWithRequestContext({ requestId: 'req-b' }, getAuthenticatedOwner),
    ]);

    expect(calls.user).toBe(2);
    expect(a).not.toBe(b);
  });

  it('rejects an unauthenticated request without a session cookie', async () => {
    cookieJar = new Map();
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    await expect(
      runWithRequestContext({ requestId: 'req-1' }, getAuthenticatedOwner),
    ).resolves.toBeNull();
    expect(calls.user).toBe(0);
  });

  it('rejects a verified user outside the Workspace domain allowlist', async () => {
    currentUser = createGoogleSupabaseUser({
      email: 'intruder@other.com',
      hostedDomain: 'other.com',
    });
    cookieJar = new Map([[STORAGE_KEY, encodeSessionCookie(session({ expired: false }))]]);
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    await expect(
      runWithRequestContext({ requestId: 'req-1' }, getAuthenticatedOwner),
    ).resolves.toBeNull();
    // Still server-verified before rejection — the allowlist is applied to a real user.
    expect(calls.user).toBe(1);
  });

  it('performs no Owner authentication work for Recipient capability surfaces', async () => {
    await runProxy(`/api/v1/capabilities/${'a'.repeat(40)}/tasks/task_1`);
    await runProxy('/c/token-value');

    expect(calls.all).toEqual([]);
  });
});
