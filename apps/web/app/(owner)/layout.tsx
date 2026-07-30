import type { ReactNode } from 'react';
import Link from 'next/link';
import { loadOwnerShellIdentity } from '@/lib/owner/shell-context';
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
 */
export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const { displayName } = await loadOwnerShellIdentity();

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
