// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * P1.4 route-structure evidence.
 *
 * The Owner shell lives in a `(owner)` route group. Route groups are the one Next.js
 * feature where a filesystem change is supposed to have *no* URL consequence, so the risk
 * is the opposite of usual: a mistake here is silent. These assertions therefore prove
 * three things from the filesystem rather than from intent:
 *
 *   1. the group name never reaches a public URL;
 *   2. exactly the authorized routes are inside the shell;
 *   3. `/`, `/login`, `/auth/**`, `/c/{token}`, and the capability APIs stay outside it.
 */

const appRoot = join(__dirname, '../app');
const ownerGroup = join(appRoot, '(owner)');

/** Every route file under `app`, as a public URL path (route groups removed). */
function routeUrls(): Map<string, string> {
  const urls = new Map<string, string>();

  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // `(group)` contributes no URL segment; `_components` is a private folder.
        if (entry.startsWith('_')) {
          continue;
        }
        walk(full, entry.startsWith('(') && entry.endsWith(')') ? segments : [...segments, entry]);
        continue;
      }
      if (entry === 'page.tsx' || entry === 'route.ts') {
        urls.set(`/${segments.join('/')}` || '/', full.replace(appRoot, ''));
      }
    }
  };

  walk(appRoot, []);
  return urls;
}

const urls = routeUrls();

describe('Owner route group changes no public URL', () => {
  it('preserves the Owner page URLs exactly', () => {
    expect(urls.has('/tasks')).toBe(true);
    expect(urls.has('/tasks/[taskId]')).toBe(true);
    expect(urls.has('/attention')).toBe(true);
  });

  it('never leaks the group name into a URL', () => {
    const leaked = [...urls.keys()].filter((url) => url.includes('(') || url.includes(')'));

    expect(leaked).toEqual([]);
  });

  it('keeps the unauthenticated and Recipient surfaces at their existing URLs', () => {
    expect(urls.has('/')).toBe(true);
    expect(urls.has('/login')).toBe(true);
    expect(urls.has('/auth/callback')).toBe(true);
    expect(urls.has('/c/[token]')).toBe(true);
    expect(urls.has('/api/v1/session')).toBe(true);
    expect(urls.has('/api/v1/capabilities/[token]/tasks/[taskId]')).toBe(true);
  });

  it('adds no health or readiness surface', () => {
    // Explicitly unauthorized by the P1 scope; a contract test already covers OpenAPI.
    const suspicious = [...urls.keys()].filter((url) => /health|readi|status$/i.test(url));

    expect(suspicious).toEqual([]);
  });
});

describe('Owner shell membership is exactly the authorized set', () => {
  it('contains only the Task subtree and the attention destination', () => {
    const groupUrls = [...urls.entries()]
      .filter(([, file]) => file.startsWith('/(owner)/'))
      .map(([url]) => url)
      .sort();

    expect(groupUrls).toEqual(['/attention', '/tasks', '/tasks/[taskId]']);
  });

  it.each([
    ['/', 'page.tsx'],
    ['/login', 'login/page.tsx'],
    ['/auth/callback', 'auth/callback/route.ts'],
    ['/c/[token]', 'c/[token]/page.tsx'],
  ])('keeps %s outside the Owner shell', (_url, relative) => {
    expect(existsSync(join(appRoot, relative))).toBe(true);
    expect(existsSync(join(ownerGroup, relative))).toBe(false);
  });

  it('places no API route inside the Owner shell', () => {
    expect(existsSync(join(ownerGroup, 'api'))).toBe(false);
  });

  it('declares the shell landmark once, in the group layout', () => {
    const layout = readFileSync(join(ownerGroup, 'layout.tsx'), 'utf8');

    expect(layout).toContain('id="main-content"');
    expect(layout).toContain('data-owner-shell');
    expect([...layout.matchAll(/<main\b/g)]).toHaveLength(1);
  });

  it('leaves the root layout without a competing landmark or shell', () => {
    const rootLayout = readFileSync(join(appRoot, 'layout.tsx'), 'utf8');

    expect(rootLayout).not.toContain('<main');
    expect(rootLayout).not.toContain('<nav');
    // Product name stays as decided in D120; P1 must not rename it.
    expect(rootLayout).toContain('AI Communication Action Assistant');
  });

  it('scopes the global main container away from the shell landmark', () => {
    const globals = readFileSync(join(appRoot, 'globals.css'), 'utf8');

    // Without this, `/tasks` would get the unshelled page padding plus the shell's own.
    expect(globals).toContain('main:not([data-owner-shell])');
  });
});

describe('proxy path matching is unaffected by the route group', () => {
  it('still matches on pathname only, with capability prefixes intact', () => {
    const proxy = readFileSync(join(__dirname, '../proxy.ts'), 'utf8');

    expect(proxy).toContain('const { pathname } = request.nextUrl');
    expect(proxy).not.toContain('(owner)');
    expect(proxy).toMatch(/matcher:\s*\[/);
  });
});
