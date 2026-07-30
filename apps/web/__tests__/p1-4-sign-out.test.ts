// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P1.4 sign-out evidence.
 *
 * P1 acceptance requires a reachable sign-out. It is served from `/auth/sign-out` rather than
 * `/api/v1/session` so no versioned contract, OpenAPI document, or generated client changes —
 * matching the `/auth/callback` precedent, where session establishment already sits outside the
 * product API.
 */

const signOutMock = vi.fn(async () => ({ error: null }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signOut: signOutMock } }),
}));

const routePath = join(__dirname, '../app/auth/sign-out/route.ts');

describe('POST /auth/sign-out', () => {
  beforeEach(() => {
    vi.resetModules();
    signOutMock.mockClear();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.OWNER_WORKSPACE_DOMAIN = 'example.com';
    process.env.OWNER_ORGANIZATION_ID = 'org_test_123';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('revokes the session server-side rather than clearing visible state', async () => {
    const { POST } = await import('@/app/auth/sign-out/route');

    await POST(new Request('http://localhost:3000/auth/sign-out', { method: 'POST' }));

    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('redirects to the signed-out surface with a status the browser follows as GET', async () => {
    const { POST } = await import('@/app/auth/sign-out/route');

    const response = await POST(
      new Request('http://localhost:3000/auth/sign-out', { method: 'POST' }),
    );

    // 303 specifically: a 307 would replay the POST against `/login`, which has no POST handler.
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/login');
  });

  it('exports no GET handler, so no visited URL can end a session', async () => {
    const route = await import('@/app/auth/sign-out/route');

    // `next/link` prefetches. A GET sign-out would end the session on hover or prefetch.
    expect('GET' in route).toBe(false);
    expect('HEAD' in route).toBe(false);
    expect('DELETE' in route).toBe(false);
    expect(typeof route.POST).toBe('function');
  });

  it('lives outside the versioned product API', () => {
    const apiV1 = join(__dirname, '../app/api/v1');

    expect(readdirSync(apiV1)).not.toContain('sign-out');
    expect(routePath).toContain(join('app', 'auth', 'sign-out'));
  });

  it('changes no OpenAPI document or generated client', () => {
    const contractsRoot = join(__dirname, '../../../packages/contracts');
    const paths = readdirSync(join(contractsRoot, 'openapi/paths'));

    // The contract must not learn about sign-out; that is the whole reason for this location.
    expect(paths.filter((entry) => /sign-?out/i.test(entry))).toEqual([]);
  });

  it('follows the /auth/callback architectural precedent', () => {
    const signOut = readFileSync(routePath, 'utf8');
    const callback = readFileSync(join(__dirname, '../app/auth/callback/route.ts'), 'utf8');

    for (const shared of ['@/lib/supabase/server', '@/lib/auth/config', '@/lib/auth/http']) {
      expect(callback).toContain(shared);
      expect(signOut).toContain(shared);
    }
  });

  it('is never rendered as a link anywhere in the application', () => {
    const appRoot = join(__dirname, '../app');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.tsx')) {
          const source = readFileSync(full, 'utf8');
          if (/(?:href=|Link[^>]*href=)["'`]\/auth\/sign-out/.test(source)) {
            offenders.push(full);
          }
        }
      }
    };
    walk(appRoot);

    expect(offenders).toEqual([]);
  });
});
