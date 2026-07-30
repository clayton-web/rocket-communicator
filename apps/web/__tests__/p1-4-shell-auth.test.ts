// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoogleSupabaseUser } from './fixtures/supabase-user';

/**
 * P1.4 shell authentication evidence (D119).
 *
 * P1.4 moves the Owner chrome into a layout. A layout renders outside the page's request
 * diagnostic context, so the P1.3 memo alone would let it spend a second server-verified
 * `getUser()` — doubling the operation D119 budgets at exactly one per Owner page request.
 *
 * Like `owner-auth-call-count.test.ts`, this counts real Supabase Auth HTTP operations
 * against a stubbed `fetch`, never source call sites. Two things are proven here:
 *
 *   1. resolution is routed through a single render-pass memo, and every isolation property
 *      P1.3 established still holds — sequential requests, concurrent requests, refresh
 *      accounting, malformed cookies, the domain allowlist, and capability paths;
 *   2. the shell modules themselves stay free of database and observability work.
 *
 * The layout-plus-page count is additionally proven in the real Next.js runtime by
 * `e2e/specs/owner-shell-auth.spec.ts`, which counts `GET /auth/v1/user` requests arriving
 * at the Supabase Auth double during one Owner document request. That is the decisive
 * measurement: React's `cache` is inert outside a server render pass, so a Vitest process
 * cannot reproduce a genuine layout-plus-page pass, and this file does not pretend to.
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

function encodeSessionCookie(session: Record<string, unknown>): string {
  return `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}

function session(options: { expired: boolean }): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    access_token: 'access-token-value',
    refresh_token: 'refresh-token-value',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: nowSeconds + (options.expired ? -60 : 3600),
    user: currentUser,
  };
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
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

      throw new Error(`Unexpected fetch to ${url}`);
    }),
  );
}

async function loadModules() {
  const [{ getAuthenticatedOwner }, { runWithRequestContext }, { proxy }] = await Promise.all([
    import('@/lib/auth/require-owner'),
    import('@/lib/observability'),
    import('@/proxy'),
  ]);
  return { getAuthenticatedOwner, runWithRequestContext, proxy };
}

async function runProxy(pathname: string) {
  const { proxy } = await loadModules();
  const cookieHeader = [...cookieJar.entries()]
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
  const request = new NextRequest(`http://localhost:3000${pathname}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  return proxy(request);
}

describe('P1.4 shell authentication operation count', () => {
  beforeEach(() => {
    vi.resetModules();
    calls = { user: 0, refresh: 0, all: [] };
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

  it('resolves identity once when a shell and a page both ask inside one request context', async () => {
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    // The shell asks, then the page asks. One verified identity operation, one shared result.
    const [shell, page] = await runWithRequestContext({ routeTemplate: '/tasks' }, async () => {
      const first = await getAuthenticatedOwner();
      const second = await getAuthenticatedOwner();
      return [first, second];
    });

    expect(shell).not.toBeNull();
    expect(shell).toBe(page);
    expect(calls.user).toBe(1);
    expect(calls.refresh).toBe(0);
    expect(calls.all).toHaveLength(1);
  });

  it('keeps sequential Owner page requests isolated', async () => {
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    const first = await runWithRequestContext({ requestId: 'req-1' }, getAuthenticatedOwner);
    const second = await runWithRequestContext({ requestId: 'req-2' }, getAuthenticatedOwner);

    // Two requests must cost two verified identity operations: no cross-request cache.
    expect(calls.user).toBe(2);
    expect(first).not.toBe(second);
  });

  it('keeps concurrent Owner page requests isolated', async () => {
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    const [a, b] = await Promise.all([
      runWithRequestContext({ requestId: 'req-a' }, getAuthenticatedOwner),
      runWithRequestContext({ requestId: 'req-b' }, getAuthenticatedOwner),
    ]);

    expect(calls.user).toBe(2);
    expect(a).not.toBe(b);
  });

  it('counts a session refresh separately from the verified identity operation', async () => {
    cookieJar = new Map([[STORAGE_KEY, encodeSessionCookie(session({ expired: true }))]]);
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    const response = await runProxy('/tasks');
    const forwarded = response.headers.get('x-middleware-request-cookie');
    if (forwarded) {
      for (const pair of forwarded.split('; ')) {
        const index = pair.indexOf('=');
        if (index > 0) {
          cookieJar.set(pair.slice(0, index), decodeURIComponent(pair.slice(index + 1)));
        }
      }
    }
    await runWithRequestContext({ routeTemplate: '/tasks' }, getAuthenticatedOwner);

    // Cookie maintenance is not identity verification, and the budget must not conflate them.
    expect(calls.refresh).toBe(1);
    expect(calls.user).toBe(1);
    expect(calls.all).toHaveLength(2);
  });

  it('still fails closed on a malformed session cookie without any Auth call', async () => {
    cookieJar = new Map([[STORAGE_KEY, 'not-a-session']]);
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    await expect(
      runWithRequestContext({ requestId: 'req-1' }, getAuthenticatedOwner),
    ).resolves.toBeNull();
    expect(calls.all).toEqual([]);
  });

  it('still rejects an identity outside the Workspace domain, after verifying it', async () => {
    currentUser = createGoogleSupabaseUser({
      email: 'intruder@other.com',
      hostedDomain: 'other.com',
    });
    cookieJar = new Map([[STORAGE_KEY, encodeSessionCookie(session({ expired: false }))]]);
    const { getAuthenticatedOwner, runWithRequestContext } = await loadModules();

    await expect(
      runWithRequestContext({ requestId: 'req-1' }, getAuthenticatedOwner),
    ).resolves.toBeNull();
    // The allowlist is still applied to a server-verified user, never to a cookie claim.
    expect(calls.user).toBe(1);
  });

  it('still performs zero Owner authentication work for capability surfaces', async () => {
    await runProxy(`/api/v1/capabilities/${'a'.repeat(40)}/tasks/task_1`);
    await runProxy('/c/token-value');

    expect(calls.all).toEqual([]);
  });

  it('performs one verified identity operation for an unshelled page request', async () => {
    // `/` sits outside the Owner shell and resolves identity without a request context.
    const { getAuthenticatedOwner } = await loadModules();

    await getAuthenticatedOwner();

    expect(calls.user).toBe(1);
  });
});

describe('P1.4 render-pass memo is scoped to a render, not to a process', () => {
  beforeEach(() => {
    vi.resetModules();
    calls = { user: 0, refresh: 0, all: [] };
    currentUser = createGoogleSupabaseUser({
      email: 'owner@example.com',
      hostedDomain: 'example.com',
    });
    cookieJar = new Map([[STORAGE_KEY, encodeSessionCookie(session({ expired: false }))]]);
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('introduces no module-level identity cache that could outlive a request', async () => {
    const { getAuthenticatedOwner } = await loadModules();

    // Outside a render pass React's `cache` is a pass-through, so two context-free calls
    // must cost two operations. If this ever returns 1, a real cross-request cache exists.
    await getAuthenticatedOwner();
    await getAuthenticatedOwner();

    expect(calls.user).toBe(2);
  });

  it('memoizes through React cache rather than a hand-rolled store', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(join(__dirname, '../lib/auth/require-owner.ts'), 'utf8');

    expect(source).toContain("import { cache } from 'react'");
    expect(source).toContain('cache(resolveAuthenticatedOwner)');
    // Both branches must route through the render-pass memo or the layout misses it.
    expect([...source.matchAll(/resolveOwnerForRenderPass\(\)/g)]).toHaveLength(2);
    // No TTL, timer, or global map: nothing that could retain identity across requests.
    expect(source).not.toMatch(/setTimeout|setInterval|globalThis\.__/);
    expect(source).not.toMatch(/new Map\(/);
  });
});
