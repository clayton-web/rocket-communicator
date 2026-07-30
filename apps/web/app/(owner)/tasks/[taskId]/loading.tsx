import styles from '../tasks.module.css';

/**
 * Route loading boundary for Owner Task detail (P1.3 / D112, P1.4).
 *
 * Reads only. Shows no Task summary, status, notes, or handoff affordance, so nothing is
 * implied about a Task before the server has answered. Since P1.4 it renders inside the
 * Owner shell, so the chrome persists across the navigation.
 */
export default function Loading() {
  return (
    <p className={styles.muted} role="status">
      Loading Task…
    </p>
  );
}
