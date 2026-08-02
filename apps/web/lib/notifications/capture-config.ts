import 'server-only';

/**
 * A8.5a Owner Event Notification capture configuration (D135).
 *
 * Capture is the act of recording that a notifiable event happened. It is gated **separately** from
 * delivery, and this module is only the capture half; `ENABLE_OWNER_EVENT_DELIVERY` arrives with the
 * worker in A8.5b and is deliberately not declared here, so nothing in A8.5a can read a flag whose
 * behaviour does not exist yet.
 */

/** Environment flag. Absent, empty, or anything other than `"true"` means disabled. */
export const ENABLE_OWNER_EVENT_CAPTURE_ENV = 'ENABLE_OWNER_EVENT_CAPTURE' as const;

/**
 * Whether a Task mutation may record Owner notification intent.
 *
 * Opt-in by exact string match, following `ENABLE_REMINDER_DELIVERY`. `"1"`, `"TRUE"`, `"yes"`, and
 * a value with stray whitespace all leave capture off, because a flag that guesses what somebody
 * meant is a flag that turns itself on by accident.
 *
 * `SUGGESTION_AI_ENABLED` uses the opposite default and is deliberately not the pattern copied here:
 * that feature was already approved to run, and this one is not.
 *
 * **Call this before opening the mutation transaction.** The A8.5 migration is unapplied in
 * Production while `persistCapabilityAction` runs there on every Task mutation, so the disabled path
 * must issue no statement against an A8.5 table rather than issue one and handle the error. Deciding
 * first, then passing the decision into persistence, is what makes that true by construction —
 * `packages/db` reads no environment at all.
 */
export function isOwnerEventCaptureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ENABLE_OWNER_EVENT_CAPTURE_ENV] === 'true';
}

/** Identifier prefix for notification intent rows, matching the repository's `newEntityId` shape. */
export const OWNER_NOTIFICATION_INTENT_ID_PREFIX = 'onint' as const;
