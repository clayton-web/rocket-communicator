import Link from 'next/link';
import styles from './owner-boundary.module.css';

/**
 * Not-found state for the Owner route group (P1.5).
 *
 * Reached only when an Owner page calls `notFound()`. Today the single caller is
 * `/tasks/{taskId}`, which does so when the Task service reports `NOT_FOUND` for the
 * authenticated Owner. An address the application does not serve at all never matches this
 * group and falls to the chrome-free root not-found page instead.
 *
 * The distinction this page exists to make is "the Task is not there" versus "the application
 * failed": the Owner group error boundary handles the second, and conflating them would send
 * an Owner to look for an outage that never happened.
 *
 * It states nothing about why the Task is absent. A Task that was never visible to this Owner
 * and a Task that was deleted are indistinguishable here, and claiming either would be a
 * guess. No query is issued to find out — the shell performs no database work.
 */
export default function OwnerNotFound() {
  return (
    <>
      <h1 className={styles.title}>Task not found</h1>
      <p className={`${styles.banner} ${styles.bannerInfo}`} role="status">
        No Task is available at this address for your account.
      </p>
      <p className={styles.muted}>
        The link may be out of date. Open the Task list to find the Task you are looking for.
      </p>
      <p className={styles.muted}>
        <Link href="/tasks">Back to Tasks</Link>
      </p>
    </>
  );
}
