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

/**
 * Who the system was, for the events nobody performed (A8.5d, D133).
 *
 * Six of the ten ratified events are observations rather than actions — a provider refusing a
 * handoff, a mail grant lapsing, a reminder schedule reaching its ceiling, a capability's time
 * running out — and their intents are `system`-attributed rather than attributed to whoever happened
 * to be holding the request.
 *
 * The identifiers themselves are declared by the subsystems that observe those events, not here.
 * That is deliberate and the A8.5a boundary guard depends on it: this module is on the capture path
 * of every Task mutation in Production, and a central registry naming every subsystem would make the
 * capture path import — or at least mention — parts of the system it must stay ignorant of.
 *
 * All four are distinct from `REMINDER_PROCESS_SYSTEM_ID` and its siblings, which identify *claim
 * holders* and are documented as never being actors. A lease owner and an actor are different
 * things, and one shared constant would eventually make them look like the same thing.
 */
export type OwnerEventSystemId = string;
