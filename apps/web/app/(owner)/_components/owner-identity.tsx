import styles from '../owner-shell.module.css';

/**
 * Owner identity and sign-out (P1.4).
 *
 * A server component with no client state. Sign-out is a native form POST rather than a
 * button with a handler, so it works without JavaScript and cannot be triggered by a
 * prefetch — `next/link` is deliberately not used here (see `app/auth/sign-out/route.ts`).
 *
 * `displayName` is `null` when no valid session resolved. The identity line is then omitted
 * and the sign-out control is not offered, because offering it would imply a session that
 * does not exist. The page's own gate is what redirects.
 */
export function OwnerIdentity({ displayName }: { displayName: string | null }) {
  if (!displayName) {
    return null;
  }

  return (
    <div className={styles.identity}>
      <span className={styles.identityName}>
        <span className={styles.srOnly}>Signed in as </span>
        {displayName}
      </span>
      <form method="post" action="/auth/sign-out" className={styles.signOutForm}>
        <button type="submit" className={styles.signOutButton}>
          Sign out
        </button>
      </form>
    </div>
  );
}
