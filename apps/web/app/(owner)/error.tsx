'use client';

import styles from './owner-boundary.module.css';

/**
 * Error boundary for the Owner route group (P1.5).
 *
 * Covers every Owner segment that has no nearer boundary — `/attention` today, and any Owner
 * route added later, which is the point: a new Owner page inherits truthful failure handling
 * instead of falling through to a framework page. `/tasks` and `/tasks/{taskId}` keep their
 * own nearer boundary, whose copy can speak specifically about Tasks.
 *
 * It renders inside the Owner shell, so the header, identity, and navigation survive the
 * failure and the Owner is never stranded on a page with no way out.
 *
 * Auth redirects and `notFound()` are Next.js control flow and bypass this boundary, so it
 * only renders for genuine render or dependency failures. The raw error is never shown; only
 * the framework's `digest` hash, which correlates with the server log.
 */
export default function OwnerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <h1 className={styles.title}>This page could not be loaded</h1>
      <p className={`${styles.banner} ${styles.bannerError}`} role="alert">
        A service this page depends on did not respond.
      </p>
      <p className={styles.muted}>
        Retry loading the page. If it keeps failing, the deployment needs operator attention.
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={reset}>
          Retry
        </button>
      </div>
      {error.digest ? (
        <p className={styles.muted}>
          Reference for server logs: <span className={styles.reference}>{error.digest}</span>
        </p>
      ) : null}
    </>
  );
}
