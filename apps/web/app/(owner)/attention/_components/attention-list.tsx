import Link from 'next/link';
import type { OwnerAttentionView } from '@/lib/reminders/attention';
import { EmptyState } from '../../_components/empty-state';
import { StatusBadge } from '../../_components/status-badge';
import listStyles from '../../tasks/tasks.module.css';
import styles from '../attention.module.css';

/**
 * `/attention` section one: reminder schedules that stopped (A8.6a; D108, D112).
 *
 * Presentation only, and deliberately built from the components the Task list already uses —
 * `StatusBadge`, `EmptyState`, and the same list styling. A second visual language for what is
 * still a list of Tasks would be a new set of accessibility and mobile behaviours to re-prove for
 * no gain, and this list is structurally identical to the one on `/tasks`.
 *
 * Every sentence rendered here was chosen in the projection. This component picks no copy, decides
 * no tone, and derives nothing, so what the Owner reads and what the unit tests assert are the same
 * strings.
 *
 * ## Truthfulness constraints
 *
 * A8.6c made this a section rather than the whole page, and that changed what its silence claims.
 * It used to own the page heading and had to qualify it, because "Attention" over a reminder-only
 * list implied the absence of everything else (D112). Now the page heading covers both sections and
 * this one names its own scope in its heading, so an empty reminder list reads as "no reminder
 * schedule needs you" rather than as an all-clear for the product.
 *
 * Nothing here claims to be live. The page is rendered once per navigation and says so: no polling,
 * no revalidation, no "as of" freshness badge that would go stale the moment it painted.
 */
export function AttentionList({ view }: { view: OwnerAttentionView }) {
  return (
    <section aria-labelledby="attention-reminders-heading">
      <h2 id="attention-reminders-heading" className={styles.sectionTitle}>
        Reminder schedules that stopped
      </h2>
      <p className={styles.sectionDescription}>
        Tasks whose reminder automation stopped and cannot restart on its own. Each one needs a
        decision from you.
      </p>
      {view.items.length === 0 ? (
        <EmptyState
          message="No reminder schedule needs your attention."
          explanation="A Task appears here when its reminders stop and cannot restart on their own. This section does not monitor anything or update by itself — reload the page to look again."
        />
      ) : (
        <ul className={listStyles.list}>
          {view.items.map((item) => (
            <li key={item.taskId}>
              <Link href={item.href}>
                <span className={listStyles.itemTitle}>{item.taskTitle}</span>
                <span className={listStyles.itemBadges}>
                  <StatusBadge label={item.badge} tone={item.badgeTone} />
                </span>
                <span className={listStyles.meta}>{item.headline}</span>
                <span className={listStyles.meta}>{item.explanation}</span>
                {item.dueDateText ? (
                  <span className={listStyles.meta}>Due date: {item.dueDateText}</span>
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
    </section>
  );
}
