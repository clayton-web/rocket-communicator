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

/**
 * The organization reminders are delivered for, or null when it is not configured (A8.4b.1).
 *
 * Reminder processing scans globally, but Gmail authorization is per-organization: a token belongs to
 * one Owner's connected account and must never carry another Owner's mail. `OWNER_ORGANIZATION_ID` is
 * the established name for the single Owner organization — `lib/auth/config.ts` requires it and
 * `poll-service.ts` reads it exactly this way for exactly this reason — so authorization can be
 * resolved once per invocation rather than once per organization discovered mid-scan.
 *
 * Read directly rather than through `getAuthConfig()`, which also requires the Supabase and app-URL
 * variables a cron-only invocation has no use for. Null means no transport is composed at all, so the
 * invocation fails closed exactly as it does with no transport configured.
 */
export function getReminderDeliveryOrganizationId(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env.OWNER_ORGANIZATION_ID;
  return typeof value === 'string' && value.length > 0 ? value : null;
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
 * H-2 closed. The terminal row is also the durable evidence D129's consecutive-ambiguous threshold
 * will count in A8.4b.2.
 */
export const MAX_OCCURRENCE_ATTEMPTS = 3;

/** Identifies this worker in claim ownership. Not a user, and never an audit actor. */
export const REMINDER_PROCESS_SYSTEM_ID = 'reminder_process';
