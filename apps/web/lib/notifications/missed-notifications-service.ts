import 'server-only';
import type { DbClient } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import {
  toOwnerMissedNotificationsView,
  type OwnerMissedNotificationsView,
} from './missed-notifications';

/**
 * The undelivered-notification read behind `/attention` section two (A8.6c).
 *
 * Thin on purpose, and shaped exactly like the A8.6a attention read beside it: resolve the
 * repository function through the traced runtime, apply the two bounds the surface has, hand the
 * rows to the projection. The page never sees a repository row and the projection never sees a
 * database client.
 *
 * The clock is read here rather than in `packages/db`, which reads no clock at all (D103). One
 * instant is taken per navigation and turned into one cutoff, so every row in a rendered list was
 * judged against the same moment instead of against whatever `now()` each statement happened to
 * observe.
 *
 * No flag is consulted. This is a read of durable state, and gating it on
 * `ENABLE_OWNER_EVENT_CAPTURE` or `ENABLE_OWNER_EVENT_DELIVERY` would hide rows that genuinely
 * exist — a flag turned off after capture had run would erase history the Owner is entitled to
 * see. With both flags unset no intent has ever been written, so the surface is empty because the
 * table is, which is the truthful reason.
 */

/**
 * Ratified recency window, in calendar days.
 *
 * This is the only mechanism by which an item leaves the surface: A8.6c has no acknowledgement and
 * no dismissal, so an undelivered notification is shown until it ages out and then never again.
 * Thirty days is long enough that an Owner returning from a month away still sees what they
 * missed, and short enough that the list cannot accumulate into a permanent backlog.
 *
 * It is also what keeps the query cheap. The common answer is "nothing", and proving a negative
 * without a date predicate costs a scan of the whole table; with one, PostgreSQL walks the
 * existing `occurred_at` index over thirty days of rows and stops.
 */
export const MISSED_NOTIFICATION_WINDOW_DAYS = 30;

/**
 * Largest batch this surface will read, and the ceiling the repository enforces.
 *
 * An Owner-facing read whose cost grows with how badly delivery has gone is a page that gets
 * slowest exactly when it matters most. Fifty is far above any plausible number of undelivered
 * notifications in thirty days for one organization, and a filled batch is disclosed to the Owner
 * rather than silently truncated.
 */
export const MISSED_NOTIFICATION_LIMIT = 50;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The start of the visibility window, as an ISO instant.
 *
 * Exported for tests, which is why it takes `now` rather than reading the clock: a window function
 * that calls `Date.now()` internally can only be tested against the real calendar, and would drift
 * across the daylight-saving boundaries this arithmetic has to survive. Fixed-length days are
 * correct here because the cutoff is compared against a UTC instant column, not against an
 * organization-local calendar date.
 */
export function missedNotificationWindowStart(now: Date): string {
  return new Date(
    now.getTime() - MISSED_NOTIFICATION_WINDOW_DAYS * MILLISECONDS_PER_DAY,
  ).toISOString();
}

export async function loadOwnerMissedNotificationsView(input: {
  readonly db: DbClient;
  readonly organizationId: string;
  readonly now: Date;
}): Promise<OwnerMissedNotificationsView> {
  const { listUndeliveredOwnerNotifications } = await loadDbRuntime();
  const rows = await listUndeliveredOwnerNotifications(input.db, {
    organizationId: input.organizationId,
    occurredAtOrAfter: missedNotificationWindowStart(input.now),
    limit: MISSED_NOTIFICATION_LIMIT,
  });
  return toOwnerMissedNotificationsView(
    rows,
    MISSED_NOTIFICATION_LIMIT,
    MISSED_NOTIFICATION_WINDOW_DAYS,
  );
}
