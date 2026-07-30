import styles from '../tasks.module.css';

/**
 * Route loading boundary for Owner Task detail (P1.3 / D112).
 *
 * Reads only. Shows no Task summary, status, notes, or handoff affordance, so nothing
 * is implied about a Task before the server has answered.
 */
export default function Loading() {
  return (
    <div className={styles.wrap}>
      <p className={styles.muted} role="status">
        Loading Task…
      </p>
    </div>
  );
}
