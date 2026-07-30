'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from '../owner-shell.module.css';

/**
 * Owner navigation (P1.4).
 *
 * The only client component the shell introduces, and only because active state needs the
 * current pathname, which a server layout cannot read. It imports nothing from `lib/auth`,
 * `lib/db`, or `lib/observability`, so no server-only code can follow it into the browser
 * bundle; `p1-4-shell.test.tsx` asserts that.
 *
 * Destinations are exactly what exists today. Recipients, Gmail settings, suggestions, and
 * reminders are deliberately absent: their endpoints or milestones may exist, but their
 * Owner surfaces do not, and navigation to an absent surface would be a false claim about
 * the product (D089, D111).
 */
const DESTINATIONS = [
  { href: '/tasks', label: 'Tasks' },
  { href: '/attention', label: 'Attention' },
] as const;

/** A destination is current for its own path and for anything nested beneath it. */
function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function OwnerNav() {
  const pathname = usePathname() ?? '';

  return (
    <nav className={styles.nav} aria-label="Owner">
      <ul className={styles.navList}>
        {DESTINATIONS.map(({ href, label }) => {
          const current = isCurrent(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={current ? `${styles.navLink} ${styles.navLinkCurrent}` : styles.navLink}
                // Keeps `/tasks/{taskId}` marked under Tasks rather than orphaning the deeper route.
                aria-current={current ? 'page' : undefined}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
