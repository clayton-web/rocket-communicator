/**
 * Reminder scheduling constants (A8.2, D103, D106).
 *
 * These are product law, not configuration. 09:00 is not Owner-selectable (there is no
 * reminder-time picker), the ceiling is a safety bound the Owner cannot raise, and the
 * scheduling timezone is the organization's — never the browser's, the device's, or the
 * server's.
 *
 * Deliberately not environment variables: an env-var timezone or hour can differ between the
 * worker that computes an occurrence and the operator reading the audit trail, and a typo
 * would silently change when every reminder is sent.
 */

/**
 * The organization timezone that is the sole scheduling authority (D034, D103).
 *
 * Intentionally a separate symbol from `OWNER_DISPLAY_TIME_ZONE` in
 * `apps/web/lib/presentation/datetime.ts` even though both currently hold the same IANA zone.
 * The two answer different questions — "when does this reminder fire" versus "what string does
 * the Owner read" — and they have different blast radii: changing this constant moves real
 * sends, while changing the presentation constant only re-renders text. Collapsing them into
 * one shared symbol would let a display tweak silently reschedule production reminders, and
 * would also pull a scheduling authority into the web application layer, which D117 forbids.
 */
export const REMINDER_SCHEDULING_TIME_ZONE = 'America/Vancouver';

/** Organization-local hour of every reminder occurrence — 09:00 (D103). */
export const REMINDER_LOCAL_HOUR = 9;

/** Organization-local minute of every reminder occurrence — 09:00 on the hour (D103). */
export const REMINDER_LOCAL_MINUTE = 0;

/**
 * Overdue reminders stop permanently after this many **successfully delivered** overdue
 * reminders in one schedule generation (D106). Failures, ambiguous outcomes, skips, scheduler
 * claims, and the advance reminder never count toward it.
 */
export const OVERDUE_SUCCESSFUL_DELIVERY_CEILING = 14;
