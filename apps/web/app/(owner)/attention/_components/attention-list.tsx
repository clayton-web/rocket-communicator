import Link from 'next/link';
import type { OwnerAttentionView } from '@/lib/reminders/attention';
import { EmptyState } from '../../_components/empty-state';
import { PageHeader } from '../../_components/page-header';
import { StatusBadge } from '../../_components/status-badge';
import styles from '../../tasks/tasks.module.css';

/**
 * Owner Attention list (A8.6a; D108, D112).
 *
 * Presentation only, and deliberately built from the components the Task list already uses —
 * `PageHeader`, `StatusBadge`, `EmptyState`, and the same list styling. A second visual language
 * for what is still a list of Tasks would be a new set of accessibility and mobile behaviours to
 * re-prove for no gain, and this list is structurally identical to the one on `/tasks`.
 *
 * Every sentence rendered here was chosen in the projection. This component picks no copy, decides
 * no tone, and derives nothing, so what the Owner reads and what the unit tests assert are the same
 * strings.
 *
 * ## Truthfulness constraints
 *
 * The header says what this page covers, because "Attention" over a list of two things implies the
 * absence of a third. Reminder automation is the only thing A8.6a can see, and an Owner who reads
 * an unqualified empty state as "nothing anywhere is wrong" has been misled by omission (D112).
 *
 * Nothing here claims to be live. The page is rendered once per navigation and says so: no polling,
 * no revalidation, no "as of" freshness badge that would go stale the moment it painted.
 */
export function AttentionList({ view }: { view: OwnerAttentionView }) {
  return (
    // The Owner shell layout supplies the container, landmark, and navigation.
    <>
      <PageHeader
        title="Attention"
        description="Reminder schedules that stopped and need a decision from you. This page covers reminder automation only, and shows what was true when it loaded."
      />
      {view.items.length === 0 ? (
        <EmptyState
          message="No reminder schedule needs your attention."
          explanation="A Task appears here when its reminders stop and cannot restart on their own. This page does not monitor anything or update by itself — reload it to check again."
        />
      ) : (
        <ul className={styles.list}>
          {view.items.map((item) => (
            <li key={item.taskId}>
              <Link href={item.href}>
                <span className={styles.itemTitle}>{item.taskTitle}</span>
                <span className={styles.itemBadges}>
                  <StatusBadge label={item.badge} tone={item.badgeTone} />
                </span>
                <span className={styles.meta}>{item.headline}</span>
                <span className={styles.meta}>{item.explanation}</span>
                {item.dueDateText ? (
                  <span className={styles.meta}>Due date: {item.dueDateText}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {view.batchFilled ? (
        <p className={styles.muted}>
          This list is capped, so more Tasks may need your attention than are shown. Resolving the
          ones above will reveal any others.
        </p>
      ) : null}
    </>
  );
}
