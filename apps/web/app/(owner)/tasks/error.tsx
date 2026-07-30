'use client';

import styles from './tasks.module.css';

/**
 * Segment error boundary for the Owner Task pages (`/tasks`, `/tasks/[taskId]`).
 * Auth redirect and not-found signals bypass this boundary, so it only renders for
 * genuine render/dependency failures. The raw error is never shown to the Owner.
 */
export default function TasksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    // Renders inside the Owner shell, so navigation and identity survive the failure and
    // the Owner is never stranded on a page with no way out.
    <>
      <h1 className={styles.title}>Tasks could not be loaded</h1>
      <p className={`${styles.banner} ${styles.bannerError}`} role="alert">
        A service this page depends on did not respond. No Task was created, changed, or handed off.
      </p>
      <p className={styles.muted}>
        Retry loading the page. If it keeps failing, the deployment needs operator attention before
        Tasks can be used.
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={reset}>
          Retry
        </button>
      </div>
      {error.digest ? (
        <p className={styles.muted}>
          Reference for server logs: <span className={styles.statusPill}>{error.digest}</span>
        </p>
      ) : null}
    </>
  );
}
