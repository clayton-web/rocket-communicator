import 'server-only';

/**
 * A8.4a reminder processing configuration.
 *
 * Every number here is a policy decision expressed as a constant rather than derived at a call
 * site, and every one is passed into persistence as an argument — `packages/db` invents no
 * durations and reads no clock (D103).
 */

/** Environment flag. Absent, empty, or anything other than `"true"` means disabled. */
export const ENABLE_REMINDER_DELIVERY_ENV = 'ENABLE_REMINDER_DELIVERY' as const;

/**
 * Whether reminder processing may claim, write, or invoke a transport.
 *
 * Opt-in rather than opt-out, and by exact string match. The A8.4a authorization deploys this
 * endpoint dark: a missing variable, a typo, a `"1"`, or a `"TRUE"` all leave delivery off, because
 * the failure mode of guessing wrong is sending mail nobody approved. `SUGGESTION_AI_ENABLED` uses
 * the opposite default and is deliberately not the pattern copied here — that feature was already
 * approved to run.
 */
export function isReminderDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ENABLE_REMINDER_DELIVERY_ENV] === 'true';
}

/** Schedules examined per invocation. Bounded so one wake-up cannot fan out without limit. */
export const MAX_SCHEDULES_PER_PROCESS = 25;

/** Abandoned occurrence claims recovered per invocation, before any new work is claimed. */
export const MAX_RECOVERIES_PER_PROCESS = 25;

/** Matches the route's `maxDuration`; the service stops well before the platform kills it. */
export const PROCESS_MAX_DURATION_MS = 60_000;

/**
 * Soft-deadline margin. Work stops this far from the deadline so an occurrence in progress can
 * finalize rather than being killed mid-flight and recovered as ambiguous.
 */
export const PROCESS_STOP_MARGIN_MS = 15_000;

/**
 * How long an occurrence claim is held.
 *
 * Comfortably longer than any single transport call and comfortably shorter than the five-minute
 * wake-up cadence, so a worker that dies is recovered on the next invocation rather than several
 * later, and a live worker is never reclaimed out from under itself.
 */
export const OCCURRENCE_CLAIM_LEASE_MS = 2 * 60_000;

/** Schedule scan lease. Advisory only — see the occurrence row for duplicate prevention. */
export const SCHEDULE_CLAIM_LEASE_MS = 60_000;

/**
 * Attempts permitted against one occurrence before retrying stops.
 *
 * Three, and then the occurrence is finalized `permanent_failure` with `retry_budget_exhausted`.
 * Leaving it retryable forever would let one unreachable Recipient monopolize every batch; leaving
 * it unsettled would let an elapsed occurrence sit `scheduled` indefinitely, which is the state
 * H-2 closed. The terminal row is also the durable evidence a future Owner-attention threshold
 * (Q8) will count.
 */
export const MAX_OCCURRENCE_ATTEMPTS = 3;

/** Identifies this worker in claim ownership. Not a user, and never an audit actor. */
export const REMINDER_PROCESS_SYSTEM_ID = 'reminder_process';
