// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OWNER_PATH_HEADER, ownerDocumentPath } from '@/lib/owner/owner-path-header';
import { createGoogleSupabaseUser } from './fixtures/supabase-user';

/**
 * P1.5 Owner pathname header evidence.
 *
 * The Owner shell gate needs the requested path before anything streams, and the App Router
 * gives a layout no way to ask for it. `proxy.ts` therefore derives the path from the URL it
 * is handling and forwards it as `x-aicaa-owner-path`.
 *
 * That makes this header the one piece of request-shaped input the gate consumes, so the
 * suite is built around a single question: can anything a caller sends change where an
 * unauthenticated visitor is sent? Three independent layers are measured rather than
 * inspected — the matcher in isolation, the real proxy against a stubbed Supabase, and the
 * real layout module driving the real `requireOwnerPage` and `resolveSafeNextPath`.
 *
 * The proxy still decides nothing. It never calls `getUser()`, never reads a capability
 * token, and never redirects; the value it forwards is routing context that the layout
 * revalidates before use.
 */

const SUPABASE_URL = 'https://example.supabase.co';
const STORAGE_KEY = 'sb-example-auth-token';
const USER_ENDPOINT = `${SUPABASE_URL}/auth/v1/user`;
const TOKEN_ENDPOINT = `${SUPABASE_URL}/auth/v1/token`;

/**
 * Next.js delivers proxy request-header mutations to the route through `x-middleware-request-*`
 * override headers, which the framework consumes and strips before the response is written to
 * the wire. Reading that channel is how a Vitest process observes what the route will receive.
 */
const OVERRIDE_HEADER = `x-middleware-request-${OWNER_PATH_HEADER}`;

const CAPABILITY_TOKEN = 'a'.repeat(40);

describe('P1.5 Owner document path matching', () => {
  it.each(['/tasks', '/attention', '/tasks/task_example'])('authorizes %s', (pathname) => {
    expect(ownerDocumentPath(pathname)).toBe(pathname);
  });

  it('authorizes a realistic opaque Task id', () => {
    expect(ownerDocumentPath('/tasks/task_uZO79O0tW6H4Irsg')).toBe('/tasks/task_uZO79O0tW6H4Irsg');
  });

  it.each([
    ['/', 'the unauthenticated landing page'],
    ['/login', 'the login page'],
    ['/auth/callback', 'an auth route'],
    ['/auth/sign-out', 'the sign-out route'],
    [`/c/${CAPABILITY_TOKEN}`, 'a Recipient capability page'],
    [`/api/v1/capabilities/${CAPABILITY_TOKEN}/tasks/task_1`, 'a capability API'],
    ['/api/v1/tasks', 'an unrelated Owner API'],
    ['/api/v1/session', 'the session API'],
    ['/favicon.ico', 'a static asset'],
    ['/_next/static/chunk.js', 'a build asset'],
  ])('leaves %s unset (%s)', (pathname) => {
    expect(ownerDocumentPath(pathname)).toBeNull();
  });

  it.each([
    ['/tasks/', 'a trailing slash with no id'],
    ['/tasks//a', 'an empty first segment'],
    ['/tasks/a/b', 'a segment deeper than Task detail'],
    ['/tasks/a%2Fb', 'a percent-encoded separator'],
    ['/tasks/a%2fb', 'a lowercase percent-encoded separator'],
    ['/tasks/a%5Cb', 'a percent-encoded backslash'],
    ['/tasks/a\\b', 'a literal backslash'],
    ['/tasks/a\u0000b', 'a NUL control character'],
    ['/tasks/a\u001fb', 'a unit-separator control character'],
    ['/tasks/..', 'a parent-directory segment'],
    ['/tasks/.', 'a current-directory segment'],
    ['/tasks/c/token', 'a capability-shaped path under /tasks'],
    ['/tasksextra', 'a prefix collision'],
    ['/attention/extra', 'a segment below /attention'],
    ['//tasks', 'a protocol-relative lookalike'],
    ['/Tasks', 'a case variant'],
  ])('rejects %s (%s)', (pathname) => {
    expect(ownerDocumentPath(pathname)).toBeNull();
  });

  it('carries only a pathname, never a query string or fragment', () => {
    // `nextUrl.pathname` already excludes both; this pins that the matcher would reject them
    // rather than quietly widening what a login redirect replays.
    expect(ownerDocumentPath('/tasks?filter=all')).toBeNull();
    expect(ownerDocumentPath('/tasks#section')).toBeNull();
  });
});

describe('P1.5 proxy header derivation', () => {
  let calls: { user: number; refresh: number; all: string[] };
  let currentUser: ReturnType<typeof createGoogleSupabaseUser>;
  let cookieJar: Map<string, string>;

  function encodeSessionCookie(value: Record<string, unknown>): string {
    return `base64-${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
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

  /** Run the real proxy — real `createProxyClient`, real header construction. */
  async function runProxy(pathname: string, requestHeaders: Record<string, string> = {}) {
    const { proxy } = await import('@/proxy');
    const cookieHeader = [...cookieJar.entries()]
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join('; ');
    return proxy(
      new NextRequest(`http://localhost:3000${pathname}`, {
        headers: cookieHeader ? { ...requestHeaders, cookie: cookieHeader } : requestHeaders,
      }),
    );
  }

  beforeEach(() => {
    vi.resetModules();
    calls = { user: 0, refresh: 0, all: [] };
    currentUser = createGoogleSupabaseUser({
      email: 'owner@example.com',
      hostedDomain: 'example.com',
    });
    cookieJar = new Map();

    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.OWNER_WORKSPACE_DOMAIN = 'example.com';
    process.env.OWNER_ORGANIZATION_ID = 'org_test_123';

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['/tasks', '/attention', '/tasks/task_example'])(
    'forwards %s to the route as a request header',
    async (pathname) => {
      const response = await runProxy(pathname);

      expect(response.headers.get(OVERRIDE_HEADER)).toBe(pathname);
    },
  );

  it.each([
    '/',
    '/login',
    '/auth/callback',
    '/api/v1/tasks',
    '/api/v1/session',
    '/tasks/a/b',
    '/tasks/',
  ])('forwards no header for %s', async (pathname) => {
    const response = await runProxy(pathname);

    expect(response.headers.get(OVERRIDE_HEADER)).toBeNull();
  });

  it.each([
    ['/tasks', '/attention'],
    ['/attention', '/tasks'],
    ['/tasks/task_real', '/attention'],
    ['/tasks', '//evil.example'],
    ['/tasks', 'https://evil.example/tasks'],
    ['/tasks', 'javascript:alert(1)'],
    ['/attention', `/c/${CAPABILITY_TOKEN}`],
    ['/tasks/task_real', '/tasks/task_forged'],
    ['/tasks', '/\\evil.example'],
    ['/attention', '/tasks/a%2Fb'],
  ])('overwrites a spoofed inbound value on %s (sent %s)', async (pathname, spoofed) => {
    const response = await runProxy(pathname, { [OWNER_PATH_HEADER]: spoofed });

    // The requested pathname always wins, whatever the caller claimed.
    expect(response.headers.get(OVERRIDE_HEADER)).toBe(pathname);
  });

  it.each(['/', '/login', '/api/v1/tasks'])(
    'deletes a spoofed inbound value on %s rather than passing it through',
    async (pathname) => {
      const response = await runProxy(pathname, { [OWNER_PATH_HEADER]: '/tasks' });

      // A route with no authorized value of its own must forward nothing, not the claim.
      expect(response.headers.get(OVERRIDE_HEADER)).toBeNull();
    },
  );

  it.each([`/c/${CAPABILITY_TOKEN}`, `/api/v1/capabilities/${CAPABILITY_TOKEN}/tasks/task_1`])(
    'strips a spoofed inbound value on the capability branch %s',
    async (pathname) => {
      const response = await runProxy(pathname, { [OWNER_PATH_HEADER]: '/tasks' });

      expect(response.headers.get(OVERRIDE_HEADER)).toBeNull();
      // The capability branch returns before any Owner session work at all.
      expect(calls.all).toEqual([]);
    },
  );

  it('carries the pathname only, dropping the query string', async () => {
    const response = await runProxy('/tasks?filter=all&secret=value');

    expect(response.headers.get(OVERRIDE_HEADER)).toBe('/tasks');
  });

  it('never places the header on the response the browser receives', async () => {
    const response = await runProxy('/tasks', { [OWNER_PATH_HEADER]: '/attention' });

    // The value travels inward through the framework's request-override channel, which Next.js
    // consumes and strips. Nothing sets a same-named response header.
    expect(response.headers.get(OWNER_PATH_HEADER)).toBeNull();
    expect([...response.headers.keys()]).not.toContain(OWNER_PATH_HEADER);
  });

  it('keeps the header on the response rebuilt during cookie rotation', async () => {
    cookieJar = new Map([[STORAGE_KEY, encodeSessionCookie(session({ expired: true }))]]);

    const response = await runProxy('/tasks/task_example');

    // `NextResponse.next()` snapshots request headers at construction, so the rotation path
    // builds a second response. Both the rotated cookie and the derived path must survive it,
    // or the route pays a redundant refresh or loses its return path.
    expect(calls.refresh).toBe(1);
    expect(response.headers.get(OVERRIDE_HEADER)).toBe('/tasks/task_example');
    expect(response.cookies.get(STORAGE_KEY)?.value).toContain('base64-');
    const forwarded = response.headers.get('x-middleware-request-cookie') ?? '';
    expect(decodeURIComponent(forwarded)).toContain('base64-');
  });

  it('performs no verified identity operation while deriving the header', async () => {
    cookieJar = new Map([[STORAGE_KEY, encodeSessionCookie(session({ expired: false }))]]);

    await runProxy('/tasks');

    // Cookie maintenance only. Identity stays with the route.
    expect(calls.user).toBe(0);
  });
});

describe('P1.5 Owner shell gate', () => {
  const getAuthenticatedOwner = vi.fn();
  const redirect = vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  let requestHeaders = new Headers();

  beforeEach(() => {
    vi.resetModules();
    getAuthenticatedOwner.mockReset();
    redirect.mockClear();
    requestHeaders = new Headers();

    // Real `requireOwnerPage`, real `resolveSafeNextPath`, real layout module: only the
    // identity source and the framework's redirect are substituted, so what is measured is
    // the actual validation chain rather than a restatement of it.
    vi.doMock('@/lib/auth/require-owner', () => ({ getAuthenticatedOwner }));
    vi.doMock('next/navigation', () => ({ redirect, usePathname: () => '/tasks' }));
    vi.doMock('next/headers', () => ({ headers: async () => requestHeaders }));
  });

  /** Render the real layout and report where it sent the request, if anywhere. */
  async function renderGate(): Promise<{ redirectedTo: string | null }> {
    const { default: OwnerLayout } = await import('@/app/(owner)/layout');
    try {
      await OwnerLayout({ children: null });
      return { redirectedTo: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith('NEXT_REDIRECT:')) {
        throw error;
      }
      return { redirectedTo: message.slice('NEXT_REDIRECT:'.length) };
    }
  }

  it.each([
    ['/tasks', '/login?next=%2Ftasks'],
    ['/attention', '/login?next=%2Fattention'],
    ['/tasks/task_example', '/login?next=%2Ftasks%2Ftask_example'],
  ])('sends an unauthenticated %s to %s', async (pathname, expected) => {
    getAuthenticatedOwner.mockResolvedValue(null);
    requestHeaders.set(OWNER_PATH_HEADER, pathname);

    expect(await renderGate()).toEqual({ redirectedTo: expected });
  });

  it('returns no chrome at all when it redirects', async () => {
    getAuthenticatedOwner.mockResolvedValue(null);
    requestHeaders.set(OWNER_PATH_HEADER, '/tasks');

    const { default: OwnerLayout } = await import('@/app/(owner)/layout');

    // The gate must abort before producing an element tree. A layout that returned chrome and
    // redirected afterwards is exactly the flash this stage removes.
    await expect(OwnerLayout({ children: null })).rejects.toThrow('NEXT_REDIRECT');
  });

  it.each([
    ['https://evil.example/tasks', 'an absolute external URL'],
    ['//evil.example', 'a protocol-relative URL'],
    ['/\\evil.example', 'a backslash-smuggled host'],
    ['javascript:alert(1)', 'a javascript scheme'],
    ['/tasks:evil', 'a scheme smuggled after the slash'],
    ['/tasks\u001f', 'a unit-separator control character'],
    ['tasks', 'a relative path'],
    ['', 'an empty value'],
  ])('refuses %s as a redirect target (%s)', async (candidate) => {
    getAuthenticatedOwner.mockResolvedValue(null);
    requestHeaders.set(OWNER_PATH_HEADER, candidate);

    // `resolveSafeNextPath` is the final gate on the value regardless of how it arrived, so a
    // hypothetically compromised header still cannot become an open redirect.
    expect(await renderGate()).toEqual({ redirectedTo: '/login?next=%2Ftasks' });
  });

  it.each([
    ['a NUL', '/tasks\u0000/evil'],
    ['a line feed', '/tasks\nLocation: https://evil.example'],
    ['a carriage return', '/tasks\r\nLocation: https://evil.example'],
  ])('cannot carry %s through the header at all', (_label, candidate) => {
    // The characters that would enable response splitting are rejected by the header
    // implementation itself, a layer below `resolveSafeNextPath`. The remaining control
    // characters do travel, and the assertions above show the path validator refusing them.
    expect(() => requestHeaders.set(OWNER_PATH_HEADER, candidate)).toThrow();
    expect(ownerDocumentPath(candidate)).toBeNull();
  });

  it('falls back to /tasks when no header is present', async () => {
    getAuthenticatedOwner.mockResolvedValue(null);

    expect(await renderGate()).toEqual({ redirectedTo: '/login?next=%2Ftasks' });
  });

  it('resolves identity exactly once for an authenticated request', async () => {
    getAuthenticatedOwner.mockResolvedValue({
      session: { displayName: 'Owner Example' },
    });
    requestHeaders.set(OWNER_PATH_HEADER, '/tasks');

    const { redirectedTo } = await renderGate();

    expect(redirectedTo).toBeNull();
    // The gate resolves, then hands the same value to the chrome. A second resolution here
    // would be a second verified `getUser()` for every Owner document request.
    expect(getAuthenticatedOwner).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('renders the Owner shell for an authenticated request', async () => {
    getAuthenticatedOwner.mockResolvedValue({ session: { displayName: 'Owner Example' } });
    requestHeaders.set(OWNER_PATH_HEADER, '/attention');

    const { default: OwnerLayout } = await import('@/app/(owner)/layout');
    const tree = await OwnerLayout({ children: null });

    expect(tree).not.toBeNull();
  });
});

describe('P1.5 header containment', () => {
  const webRoot = join(__dirname, '..');

  /** Every source file under the app, excluding tests and build output. */
  function sourceFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') {
          continue;
        }
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (/\.(ts|tsx)$/.test(entry)) {
          found.push(full);
        }
      }
    };
    for (const dir of ['app', 'lib', 'e2e']) {
      walk(join(webRoot, dir));
    }
    found.push(join(webRoot, 'proxy.ts'));
    return found;
  }

  it('is referenced by only the modules that define, set, and consume it', () => {
    const referencing = sourceFiles()
      .filter((file) => readFileSync(file, 'utf8').includes(OWNER_PATH_HEADER))
      .map((file) => file.slice(webRoot.length + 1))
      .sort();

    // The literal name lives in one module. The proxy and the layout reach it by import, and
    // the e2e spec proves the spoofing behaviour against a real server. Anything else
    // appearing here means a new consumer started treating routing context as input.
    expect(referencing).toEqual([
      'e2e/specs/owner-gate-flash.spec.ts',
      'lib/owner/owner-path-header.ts',
    ]);
  });

  it('is never read by the page-level defence-in-depth gate', () => {
    const source = readFileSync(join(webRoot, 'lib/owner/require-owner-page.ts'), 'utf8');

    // `requireOwnerPage` receives a return path as an argument. If it read the header itself
    // the page gate would inherit the layout's input surface instead of staying independent.
    expect(source).not.toContain('owner-path-header');
    expect(source).not.toContain('headers()');
    expect(source).toContain('resolveSafeNextPath');
  });

  it('is never consumed by a Recipient capability surface', () => {
    const capabilitySources = sourceFiles().filter(
      (file) => file.includes('/c/') || file.includes('/capabilities/'),
    );

    expect(capabilitySources.length).toBeGreaterThan(0);
    for (const file of capabilitySources) {
      expect(readFileSync(file, 'utf8')).not.toContain('owner-path-header');
    }
  });

  it('is never emitted through operational logging or an audit event', () => {
    const definition = readFileSync(join(webRoot, 'lib/owner/owner-path-header.ts'), 'utf8');
    const proxySource = readFileSync(join(webRoot, 'proxy.ts'), 'utf8');
    const layoutSource = readFileSync(join(webRoot, 'app/(owner)/layout.tsx'), 'utf8');

    // A pathname in a log line turns routing context into a retained record of what the Owner
    // looked at, which nothing here has a reason to keep.
    for (const source of [definition, proxySource, layoutSource]) {
      expect(source).not.toMatch(/emitOperationalLog|recordAuditEvent|console\.|process\.stdout/);
    }
  });

  it('is never used to build user-visible error copy', () => {
    const layoutSource = readFileSync(join(webRoot, 'app/(owner)/layout.tsx'), 'utf8');

    expect(layoutSource).not.toMatch(/throw new |Error\(/);
  });

  it('leaves the proxy free of any authorization decision', () => {
    const source = readFileSync(join(webRoot, 'proxy.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    // The proxy maintains cookies and describes routing. It must not verify identity, decide
    // membership, redirect on who the caller is, or inspect a capability token's value.
    expect(source).not.toContain('getUser');
    expect(source).not.toContain('isWorkspaceDomainPermitted');
    expect(source).not.toContain('NextResponse.redirect');
    expect(source).not.toContain('requireOwner');
    // Capability handling is a prefix test on the path, never a look at the token itself.
    expect(source).not.toMatch(/token|bearer/i);
  });
});
