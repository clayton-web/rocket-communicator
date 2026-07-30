import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import Link from 'next/link';
import { OWNER_PATH_HEADER } from '@/lib/owner/owner-path-header';
import { requireOwnerPage } from '@/lib/owner/require-owner-page';
import { ownerShellIdentity } from '@/lib/owner/shell-context';
import { OwnerIdentity } from './_components/owner-identity';
import { OwnerNav } from './_components/owner-nav';
import styles from './owner-shell.module.css';

/**
 * Owner application shell (P1.4 / D111 area 1, D116, D118).
 *
 * Wraps every authenticated Owner route. `(owner)` is a Next.js route group, so it adds no
 * URL segment: `/tasks`, `/tasks/{taskId}`, and `/attention` keep their public paths, and
 * `proxy.ts` — which matches on pathname — is unaffected.
 *
 * Because the chrome lives in a layout rather than in each page, it persists across
 * `loading.tsx` and `error.tsx`, which render inside it. That is what stops navigation from
 * disappearing mid-navigation, without either boundary reproducing a shell of its own.
 *
 * `/`, `/login`, `/auth/**`, `/c/{token}`, and the capability APIs are deliberately outside
 * this group. `/` in particular must keep serving unauthenticated visitors, which is a
 * documented A7 closure baseline.
 *
 * Identity resolution shares the page's single verified `getUser()` through the render-pass
 * memo in `lib/auth/require-owner.ts`; see that file and `e2e/specs/owner-shell-auth.spec.ts`
 * for the measured evidence. The shell performs no database work and owns no `<h1>`: the
 * product name is a link, so each page keeps exactly one page-level heading.
 *
 * The gate lives here rather than in each page (P1.5) because a page-level redirect only
 * runs after this layout has already returned chrome, which painted a signed-out Owner shell
 * for the length of the redirect. Gating above the chrome means an unauthenticated request
 * produces a redirect and nothing else. The page-level `requireOwnerPage()` calls stay
 * exactly as they were: they are the gate that actually protects data, and this one is an
 * additional gate that protects the *appearance* of the application.
 */
export default async function OwnerLayout({ children }: { children: ReactNode }) {
  /*
   * A layout is not told which URL it is rendering, so `proxy.ts` derives the requested Owner
   * pathname from the URL it handles and forwards it here. The value is routing context, not
   * identity: it decides only where a rejected visitor is sent back to, and `requireOwnerPage`
   * still puts it through `resolveSafeNextPath` before it can become a redirect target. An
   * absent header — any route the proxy did not authorize — falls back to `/tasks`.
   */
  const requestedPath = (await headers()).get(OWNER_PATH_HEADER);
  const owner = await requireOwnerPage(requestedPath ?? '/tasks');
  const { displayName } = ownerShellIdentity(owner);

  return (
    <div className={styles.shell}>
      {/* First focusable control on every Owner route, visible only when focused. */}
      <a href="#main-content" className={styles.skipLink}>
        Skip to main content
      </a>

      <header className={styles.header}>
        <div className={styles.headerBar}>
          <Link href="/tasks" className={styles.product}>
            AI Communication Action Assistant
          </Link>
          <OwnerIdentity displayName={displayName} />
        </div>
        <OwnerNav />
      </header>

      <main id="main-content" data-owner-shell="" className={styles.main}>
        {children}
      </main>
    </div>
  );
}
