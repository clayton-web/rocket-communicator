'use client';

import styles from '../tasks/tasks.module.css';

/**
 * Segment error boundary for the Owner Attention surface (A8.6a; D112, D132).
 *
 * The wording matters more here than on most boundaries. This page's job is to tell an Owner
 * whether their reminder automation has stopped, so a failure to load it is not "nothing to see" —
 * it is "the answer is unknown", and the copy has to say the second thing. An Owner who reads a
 * broken attention page as a quiet one has been told the opposite of the truth.
 *
 * It also states what did not happen. The page only reads, so a failure here changed no schedule
 * and cancelled no reminder; without that sentence an Owner could reasonably wonder whether the
 * error was itself the thing that broke their reminders.
 *
 * Read-only, so retrying is safe and unconditional — no duplicate-submission concern, nothing to
 * preserve, and no unsaved input to lose. The raw error is never shown; the digest is offered so a
 * support conversation can name the failure without the Owner reading a stack trace.
 */
export default function AttentionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    // Renders inside the Owner shell, so navigation and identity survive the failure.
    <>
      <h1 className={styles.title}>Attention could not be loaded</h1>
      <p className={`${styles.banner} ${styles.bannerError}`} role="alert">
        A service this page depends on did not respond, so Rocket cannot tell you whether any
        reminder schedule needs your attention. Do not read this as an all-clear.
      </p>
      <p className={styles.muted}>
        Nothing was changed. This page only reads, so no reminder schedule was stopped, started, or
        altered by this failure.
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
