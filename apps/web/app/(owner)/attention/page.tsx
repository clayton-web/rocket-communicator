import { getDb } from '@/lib/db/server';
import { loadOwnerMissedNotificationsView } from '@/lib/notifications/missed-notifications-service';
import { requireOwnerPage } from '@/lib/owner/require-owner-page';
import { loadOwnerAttentionView } from '@/lib/reminders/attention-service';
import {
  createRequestId,
  elapsedMs,
  emitOperationalLog,
  isNextControlFlowError,
  monotonicNowMs,
  runWithRequestContext,
} from '@/lib/observability';
import { PageHeader } from '../_components/page-header';
import { AttentionList } from './_components/attention-list';
import { MissedNotificationList } from './_components/missed-notification-list';

export const dynamic = 'force-dynamic';

/**
 * Owner Attention surface (A8.6a; D108, D112, D118).
 *
 * ## What this page is for
 *
 * D108 will not allow Recipient reminder delivery to be enabled until the Owner can see the state
 * of the automation acting on their behalf, and a Task page alone does not satisfy that: an Owner
 * who must open Tasks one at a time to discover that reminders died has to already suspect which
 * Task to open. This is the cross-Task discovery surface — the place where a stopped schedule
 * announces itself without being looked for.
 *
 * It is discovery only. Acting on what is found here means opening the Task, and the Task-level
 * status and repair controls are A8.6b. D108 is not satisfied by this page.
 *
 * ## The second section (A8.6c)
 *
 * A8.5 tells the Owner about notable events by email, once. When that email is never sent the
 * event becomes invisible, because nothing else in the product says "something happened and we
 * could not reach you". Section two is that backstop, and it is on this page rather than a route
 * of its own because both sections answer one Owner question; splitting them would mean checking
 * two places for one answer.
 *
 * The two sections never describe the same thing. Reminder-stop notifications are excluded from
 * the second read in SQL, because section one already shows that condition and — unlike a
 * terminal notification intent — stops showing it once the Owner repairs the schedule.
 *
 * Section two is **not** a D108 requirement. D108 is about the Owner seeing the reminder
 * automation acting for them, which is section one and A8.6b. This is Owner visibility for the
 * A8.5 notification engine, and it neither satisfies nor advances D108.
 *
 * ## What replaced the P1.4 placeholder
 *
 * Until now this route rendered a deliberately empty page that stated it read nothing and watched
 * nothing, which was true and was the honest thing to show while A8 was being built. It now reads.
 * The constraint it was written under has not been relaxed, only narrowed: the page still claims no
 * monitoring, no queue, and no automatic updating, because it still does none of those things. It
 * renders one bounded query per navigation and nothing refreshes it.
 *
 * ## Reads directly, and fails loudly
 *
 * A server component reading the repository, matching the Task surfaces rather than introducing an
 * API endpoint for a page that already runs on the server. No API client, no server action, and no
 * caching: a cached attention list is a page that can tell an Owner their automation is healthy
 * using a snapshot from before it broke.
 *
 * A database failure propagates to the segment error boundary untouched. `/attention` depends on
 * the A8.3a migration chain, those migrations are unapplied in production, and a deployment that
 * reached this page without them **should** break visibly. Catching the error and rendering the
 * empty state instead would turn a missing migration into the reassuring sentence "nothing needs
 * your attention", which is the single worst thing this page could say while wrong.
 */

export default async function AttentionPage() {
  return runWithRequestContext(
    {
      requestId: createRequestId(),
      routeTemplate: '/attention',
      operation: 'owner_attention_page',
      correlationId: null,
    },
    async () => {
      const started = monotonicNowMs();
      try {
        const authStarted = monotonicNowMs();
        const authenticated = await requireOwnerPage('/attention');
        emitOperationalLog({
          event: 'operation_timing',
          level: 'info',
          operation: 'owner_authentication',
          routeTemplate: '/attention',
          durationMs: elapsedMs(authStarted),
          outcome: 'ok',
        });

        const loadStarted = monotonicNowMs();
        const db = await getDb();
        const organizationId = authenticated.actor.organizationId;
        /*
         * One instant for the whole render. The notification window is computed from it above
         * `packages/db`, which reads no clock (D103), and taking it once means every row on a
         * page was judged against the same moment.
         */
        const now = new Date();
        // Organization comes from the authenticated session, never from the request. The two reads
        // are independent, so they run together rather than making the page pay for both in turn;
        // `owner_attention_load` times the pair.
        const [view, missedView] = await Promise.all([
          loadOwnerAttentionView({ db, organizationId }),
          loadOwnerMissedNotificationsView({ db, organizationId, now }),
        ]);
        emitOperationalLog({
          event: 'operation_timing',
          level: 'info',
          operation: 'owner_attention_load',
          routeTemplate: '/attention',
          durationMs: elapsedMs(loadStarted),
          outcome: 'ok',
        });

        emitOperationalLog({
          event: 'operation_timing',
          level: 'info',
          operation: 'owner_attention_page',
          routeTemplate: '/attention',
          durationMs: elapsedMs(started),
          outcome: 'ok',
        });

        return (
          // The Owner shell layout supplies the container, landmark, and navigation. The page owns
          // the single `<h1>`; each section owns an `<h2>` beneath it, so the two lists are
          // navigable as headings rather than as one undifferentiated run of content.
          <>
            <PageHeader
              title="Attention"
              description="Reminder schedules that stopped, and recent events Rocket could not email you about. This page shows what was true when it loaded."
            />
            <AttentionList view={view} />
            <MissedNotificationList view={missedView} />
          </>
        );
      } catch (error) {
        // A login redirect is expected control flow, not an operational failure.
        if (isNextControlFlowError(error)) {
          throw error;
        }
        emitOperationalLog({
          event: 'operation_timing',
          level: 'error',
          operation: 'owner_attention_page',
          routeTemplate: '/attention',
          durationMs: elapsedMs(started),
          outcome: 'error',
        });
        throw error;
      }
    },
  );
}
