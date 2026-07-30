import styles from './tasks.module.css';

/**
 * Route loading boundary for the Owner Task list (P1.3 / D112, P1.4).
 *
 * Reads only. States what is actually happening and shows no Task data and no status.
 * Since P1.4 it renders inside the Owner shell, so navigation and identity stay on screen
 * for the whole navigation instead of vanishing and reappearing.
 */
export default function Loading() {
  return (
    <p className={styles.muted} role="status">
      Loading Tasks…
    </p>
  );
}
