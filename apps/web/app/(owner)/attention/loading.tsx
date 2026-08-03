import styles from '../tasks/tasks.module.css';

/**
 * Route loading boundary for the Owner Attention surface (A8.6a; D112).
 *
 * States only that the page is loading. It must not pre-empt the answer — "Checking for problems…"
 * would imply a scan is running, and a boundary that flashed "Nothing needs your attention" before
 * the query returned would be a reassurance the page had not yet earned.
 */
export default function Loading() {
  return (
    <p className={styles.muted} role="status">
      Loading Attention…
    </p>
  );
}
