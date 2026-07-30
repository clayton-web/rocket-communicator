import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { proxy, config, isRecipientCapabilityPath } from '@/proxy';

const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });

vi.mock('@/lib/supabase/proxy', () => ({
  createProxyClient: (request: NextRequest) => ({
    supabase: { auth: { getUser, getSession } },
    getResponse: () => NextResponse.next({ request }),
  }),
}));

describe('proxy entry point', () => {
  beforeEach(() => {
    getUser.mockClear();
    getSession.mockClear();
    vi.spyOn(NextResponse, 'next').mockImplementation(
      () => new NextResponse(null, { status: 200 }),
    );
  });

  it('exports the Next.js proxy matcher config', () => {
    expect(config.matcher).toEqual([
      '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ]);
  });

  it('refreshes cookies without performing a verified getUser for Owner pages', async () => {
    const request = new NextRequest('http://localhost:3000/');
    const response = await proxy(request);

    // Cookie maintenance only: getSession refreshes when the token is at its margin and
    // is never an authorization decision. Verified identity stays with the route.
    expect(getSession).toHaveBeenCalledOnce();
    expect(getUser).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('still serves the request when session state cannot be read', async () => {
    // A truncated or foreign `sb-*-auth-token` cookie makes Supabase cookie storage throw.
    // There is then no session to maintain, and the proxy authorizes nothing, so the
    // request must continue instead of 500ing on a cookie the visitor cannot clear.
    getSession.mockRejectedValueOnce(new Error('Invalid UTF-8 sequence'));

    const response = await proxy(new NextRequest('http://localhost:3000/tasks'));

    expect(response.status).toBe(200);
  });

  it('skips session refresh for /c/[token] and sets bearer-link protections', async () => {
    const response = await proxy(new NextRequest('http://localhost:3000/c/token-value'));

    expect(getSession).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toMatch(/noindex/);
  });

  it('skips Owner session work for Recipient capability APIs', async () => {
    const response = await proxy(
      new NextRequest(
        `http://localhost:3000/api/v1/capabilities/${'a'.repeat(40)}/tasks/task_1/notes`,
      ),
    );

    expect(getSession).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('does not add capability page headers to capability API responses', async () => {
    const response = await proxy(
      new NextRequest(`http://localhost:3000/api/v1/capabilities/${'a'.repeat(40)}/tasks/task_1`),
    );

    // Capability API routes own their own response headers; the proxy must not alter them.
    expect(response.headers.get('referrer-policy')).toBeNull();
    expect(response.headers.get('x-robots-tag')).toBeNull();
  });

  it.each([
    '/api/v1/tasks',
    '/api/v1/tasks/task_1/notes',
    '/api/v1/recipients',
    '/api/v1/session',
    '/tasks',
    '/tasks/task_1',
  ])('keeps Owner session refresh for %s', async (pathname) => {
    await proxy(new NextRequest(`http://localhost:3000${pathname}`));
    expect(getSession).toHaveBeenCalledOnce();
  });

  it.each([
    '/capabilities',
    '/capabilities/token/tasks/task_1',
    '/api/v1/capabilities',
    '/api/v1/capabilities-admin/token',
    '/api/v1/capabilities-admin',
    '/api/v1/capabilitiesx/token',
    '/api/v1/capability/token',
    '/api/v2/capabilities/token/tasks/task_1',
    '/c',
    '/cx/token-value',
    '/c-token-value',
    // Case-sensitive: Next.js route matching is case-sensitive, so `/C/token` has no
    // capability route to reach and must not be granted the capability exemption.
    '/C/token-value',
    // A percent-encoded separator stays inside one path segment; it is not `/c/{token}`.
    '/c%2Ftoken-value',
    '/api/v1/tasks/capabilities/token',
  ])('does not let the deceptive path %s bypass Owner session handling', async (pathname) => {
    expect(isRecipientCapabilityPath(pathname)).toBe(false);
    await proxy(new NextRequest(`http://localhost:3000${pathname}`));
    expect(getSession).toHaveBeenCalledOnce();
  });

  it.each([
    '/c/token-value',
    '/c/token-value/',
    '/c/',
    '/api/v1/capabilities/token/tasks/task_1',
    '/api/v1/capabilities/token',
    '/api/v1/capabilities/',
  ])('recognises %s as a Recipient capability path', (pathname) => {
    expect(isRecipientCapabilityPath(pathname)).toBe(true);
  });

  it.each([
    ['/tasks?next=/c/token-value', '/tasks'],
    ['/api/v1/tasks?ref=/api/v1/capabilities/token', '/api/v1/tasks'],
  ])('ignores capability-like text in the query string of %s', async (url, expectedPath) => {
    const request = new NextRequest(`http://localhost:3000${url}`);

    expect(request.nextUrl.pathname).toBe(expectedPath);
    expect(isRecipientCapabilityPath(request.nextUrl.pathname)).toBe(false);
    await proxy(request);
    expect(getSession).toHaveBeenCalledOnce();
  });

  it.each(['//c//token-value', '/api/v1//capabilities/token'])(
    'leaves the repeated-slash path %s on the Owner path without reaching a capability route',
    async (pathname) => {
      // Next.js normalizes `//` (and `\`) with a 308 redirect in `base-server` before a
      // route is matched, so a repeated-slash URL never serves capability content. Staying
      // on the Owner path here costs only a session refresh and grants nothing.
      expect(isRecipientCapabilityPath(pathname)).toBe(false);
      await proxy(new NextRequest(`http://localhost:3000${pathname}`));
      expect(getSession).toHaveBeenCalledOnce();
    },
  );

  it.each(['/./c/token-value', '/tasks/../c/token-value'])(
    'resolves the dot segment path %s to the capability route and skips Owner session work',
    async (pathname) => {
      const request = new NextRequest(`http://localhost:3000${pathname}`);

      expect(request.nextUrl.pathname).toBe('/c/token-value');
      await proxy(request);
      expect(getSession).not.toHaveBeenCalled();
    },
  );
});
