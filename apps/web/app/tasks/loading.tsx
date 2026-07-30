import styles from './tasks.module.css';

/**
 * Route loading boundary for the Owner Task list (P1.3 / D112).
 *
 * Reads only. States what is actually happening and shows no Task data, no status,
 * and no navigation or shell of its own — the Owner shell is P1.4.
 */
export default function Loading() {
  return (
    <div className={styles.wrap}>
      <p className={styles.muted} role="status">
        Loading Tasks…
      </p>
    </div>
  );
}
