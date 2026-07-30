import styles from './presentation.module.css';

/**
 * Empty state (P1.4 / D112).
 *
 * `role="status"` so the emptiness is announced after a navigation rather than leaving a
 * screen-reader user with silence they cannot distinguish from a still-loading page.
 *
 * `explanation` exists to keep empty states honest. "No Tasks yet." alone leaves the Owner
 * guessing whether the list is genuinely empty, filtered, or broken, and D112 requires
 * experience states to say what is actually true. Callers should state the reason, never imply
 * that something is being watched or is on its way.
 */
export function EmptyState({ message, explanation }: { message: string; explanation?: string }) {
  return (
    <div className={styles.empty} role="status">
      <p className={styles.emptyMessage}>{message}</p>
      {explanation ? <p className={styles.emptyExplanation}>{explanation}</p> : null}
    </div>
  );
}
