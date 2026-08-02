import 'server-only';

/**
 * A8.5b Owner Event Notification delivery configuration (D135).
 *
 * Every number here is a policy decision expressed as a constant rather than derived at a call site,
 * and every one is passed into persistence as an argument — `packages/db` invents no durations and
 * reads no clock (D103).
 *
 * These are deliberately **not** the reminder constants imported from somewhere else. An Owner
 * notification is a one-shot delivery of a single event and a reminder is a repeating series
 * addressed to a Recipient; the two happen to share a wake-up cadence and share no policy. Reusing
 * one module for both would make a later change to either silently change both, which is the
 * failure D135 was written to prevent.
 */

/** Environment flag. Absent, empty, or anything other than `"true"` means disabled. */
export const ENABLE_OWNER_EVENT_DELIVERY_ENV = 'ENABLE_OWNER_EVENT_DELIVERY' as const;

/**
 * Whether notification processing may claim, write, or invoke a transport (D135).
 *
 * Opt-in by exact string, matching `ENABLE_OWNER_EVENT_CAPTURE` and `ENABLE_REMINDER_DELIVERY`: a
 * missing variable, a `"1"`, a `"TRUE"`, a `"yes"`, or a stray space all leave delivery off, because
 * the failure mode of guessing wrong is sending mail nobody approved.
 *
 * This is the **delivery** half of the two independent flags. Capture may record intents while this
 * stays off — that is the intended shape, and the 24-hour horizon below is what stops the resulting
 * backlog from ever flushing.
 */
export function isOwnerEventDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ENABLE_OWNER_EVENT_DELIVERY_ENV] === 'true';
}

/** Intents examined per invocation. Bounded so one wake-up cannot fan out without limit. */
export const MAX_NOTIFICATIONS_PER_PROCESS = 25;

/** Abandoned claims recovered per invocation, before any new work is claimed. */
export const MAX_NOTIFICATION_RECOVERIES_PER_PROCESS = 25;

/** Matches the route's `maxDuration`; the service stops well before the platform kills it. */
export const NOTIFICATION_PROCESS_MAX_DURATION_MS = 60_000;

/**
 * Soft-deadline margin. Work stops this far from the deadline so a delivery in progress can settle
 * rather than being killed mid-flight and recovered as ambiguous.
 */
export const NOTIFICATION_PROCESS_STOP_MARGIN_MS = 15_000;

/**
 * How long a notification claim is held.
 *
 * Comfortably longer than any single transport call and comfortably shorter than the five-minute
 * wake-up cadence, so a worker that dies is recovered on the next invocation rather than several
 * later, and a live worker is never reclaimed out from under itself. The same reasoning and the same
 * value as the reminder occurrence lease, arrived at independently because the constraint is the
 * cadence rather than the payload.
 */
export const NOTIFICATION_CLAIM_LEASE_MS = 2 * 60_000;

/**
 * Total provider calls permitted for one notification before retrying stops (D135).
 *
 * Three, and then the intent is terminal and requires Owner attention. This is a **budget of
 * attempts against one event**, not a delivery series: D106's fourteen-successful-delivery ceiling
 * and D129's three-consecutive-ambiguity stop govern a repeating Recipient reminder and do not
 * apply here. That the number is also three is a coincidence of scale, not a shared rule.
 */
export const MAX_NOTIFICATION_ATTEMPTS = 3;

/**
 * The delivery staleness horizon (D135).
 *
 * An intent older than this is never delivered. It is terminalized `suppressed` with reason `stale`,
 * having contacted nothing, and it is never eligible again.
 *
 * This is the mechanism that makes capture safe to enable before delivery. Without it, every intent
 * recorded while delivery was off would still be pending on the day delivery was switched on, and
 * the first invocation would mail the Owner about weeks of events at once — the backlog flush D135
 * names and forbids. With it, the backlog is not drained, it expires, and the record says truthfully
 * why the Owner was never told.
 */
export const NOTIFICATION_STALENESS_HORIZON_MS = 24 * 60 * 60_000;

/**
 * Identifies this worker in claim ownership and in the audit events it appends.
 *
 * Unlike `REMINDER_PROCESS_SYSTEM_ID`, this one **is** an audit actor: D133 requires terminal
 * notification outcomes to append concise system-attributed audit events, so the worker needs a
 * truthful name to sign them with. It is not a user, and it is never the actor of the event that
 * caused the notification — that attribution lives on the intent row and is not overwritten here.
 */
export const NOTIFICATION_PROCESS_SYSTEM_ID = 'owner_notification_process';

/** Audit `action` strings for terminal outcomes (D133), namespaced like `suggestion.process.*`. */
export const NOTIFICATION_AUDIT_ACTIONS = {
  sent: 'owner_notification.sent',
  failedPermanent: 'owner_notification.failed_permanent',
  ambiguous: 'owner_notification.ambiguous',
  retryExhausted: 'owner_notification.retry_exhausted',
  suppressedStale: 'owner_notification.suppressed_stale',
} as const;

/** Failure codes this worker originates. A closed set: never a provider string or an exception. */
export const NOTIFICATION_FAILURE_CODES = {
  retryBudgetExhausted: 'retry_budget_exhausted',
  leaseExpiredInFlight: 'lease_expired_in_flight',
  transportThrew: 'transport_error',
} as const;
