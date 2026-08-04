import Link from 'next/link';
import type { OwnerMissedNotificationsView } from '@/lib/notifications/missed-notifications';
import { EmptyState } from '../../_components/empty-state';
import { StatusBadge } from '../../_components/status-badge';
import styles from '../attention.module.css';

/**
 * `/attention` section two: events Rocket could not tell the Owner about (A8.6c; D112, D133–D135).
 *
 * Presentation only. Every sentence rendered here was chosen in the projection, so what the Owner
 * reads and what the unit tests assert are the same strings, and no state-dependent wording is
 * decided twice.
 *
 * ## Why this sits under the reminder section rather than on its own page
 *
 * Both sections answer the same Owner question — "is there something I have not seen?" — and
 * splitting them across two routes would mean an Owner has to remember to check two places to get
 * one answer. They stay visually and semantically separate because they are not the same kind of
 * thing: section one lists conditions that are still true and that the Owner can repair, while
 * this lists events that already happened and cannot be undone. The two never show the same
 * underlying reminder condition, because the repository excludes reminder-stop events from this
 * read entirely.
 *
 * ## Truthfulness constraints
 *
 * There is nothing to act on here except reading, so the surface offers nothing else: no resend,
 * no dismissal, no acknowledgement, and no control that would imply Rocket will try again. Rocket
 * will not. Each item states the window it belongs to rather than implying permanence, because an
 * item that vanishes on its thirty-first day would otherwise look like it was resolved.
 *
 * Nothing here claims to be live. The section is rendered once per navigation and says so.
 */
export function MissedNotificationList({ view }: { view: OwnerMissedNotificationsView }) {
  return (
    <section className={styles.section} aria-labelledby="attention-missed-heading">
      <h2 id="attention-missed-heading" className={styles.sectionTitle}>
        Things Rocket could not tell you about
      </h2>
      <p className={styles.sectionDescription}>
        Events from the last {view.windowDays} days where Rocket meant to email you and the message
        never went out. Most recent first.
      </p>
      {view.items.length === 0 ? (
        <EmptyState
          message={`Rocket has no undelivered notifications from the last ${view.windowDays} days.`}
          explanation={`An item appears here when something happens to your delegated work and the email about it never goes out. Items leave this list only by passing ${view.windowDays} days old, so there is nothing to mark as read. This section does not update by itself — reload the page to look again.`}
        />
      ) : (
        <ul className={styles.list}>
          {view.items.map((item, index) => (
            /*
             * Index keys, deliberately. The intent's row identifier would be a stabler key and is
             * available, but carrying a database identifier into the projection so that React can
             * hold it is how internal identifiers end up rendered. This list is built once on the
             * server per navigation and is never reordered, filtered, or mutated in the browser,
             * which is exactly the case where an index key is equivalent.
             */
            <li key={index} className={styles.item}>
              <p className={styles.headline}>{item.headline}</p>
              <p className={styles.badges}>
                <StatusBadge label={item.outcomeBadge} tone={item.outcomeTone} />
              </p>
              <p className={styles.meta}>{item.outcomeExplanation}</p>
              <p className={styles.meta}>Happened: {item.occurredAtText}</p>
              {item.settledAtText ? (
                <p className={styles.meta}>Rocket stopped trying: {item.settledAtText}</p>
              ) : null}
              <p className={styles.meta}>Caused by: {item.actorLabel}</p>
              <p className={styles.meta}>
                {item.nextStep}
                {item.href === null ? null : (
                  <>
                    {' '}
                    <Link href={item.href}>{item.taskTitle}</Link>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
      {view.batchFilled ? (
        <p className={styles.muted}>
          This list is capped, so more may have gone undelivered in the last {view.windowDays} days
          than are shown here.
        </p>
      ) : null}
    </section>
  );
}
