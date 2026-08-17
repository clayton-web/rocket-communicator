import 'server-only';
import { jsonErrorResponse } from '@/lib/auth/http';

/**
 * S7 Gmail Review release gate.
 *
 * This is a one-off release switch for the Gmail Review application surfaces, not a permanent
 * capability-configuration platform. It is mechanically independent of A5 Gmail OAuth, connection,
 * and sync configuration: this module imports none of those, reads no Gmail secrets, and opens no
 * database connection.
 *
 * Exact string match only. Absent, empty, or anything other than `"true"` means the S7 routes are
 * unavailable. `"1"`, `"TRUE"`, `"yes"`, quoted values, and whitespace variants all stay off,
 * because a release gate that guesses what somebody meant is a gate that turns itself on by
 * accident.
 */

/** Environment flag. Absent, empty, or anything other than `"true"` means disabled. */
export const ENABLE_GMAIL_REVIEW_ENV = 'ENABLE_GMAIL_REVIEW' as const;

/**
 * Whether the Gmail Review / intake / sender-exclusion application surfaces may run.
 *
 * Opt-in by exact string match, following `ENABLE_REMINDER_DELIVERY` and the Owner-event flags.
 * Call this at the S7 route-module boundary before entering `runOwnerGmailRoute` or
 * `runOwnerInterpretationRoute`, so a disabled request never reaches authentication, the database
 * runtime, S7 validation, or interpretation.
 */
export function isGmailReviewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ENABLE_GMAIL_REVIEW_ENV] === 'true';
}

/**
 * Privacy-safe 404 for an unreleased S7 surface.
 *
 * Uses the contracted `ErrorResponse` envelope. The message does not name the flag, the
 * environment, or any Gmail item: it only says the application surface is unavailable.
 */
export function gmailReviewUnavailableResponse() {
  const response = jsonErrorResponse('NOT_FOUND', 'This application surface is unavailable.', 404);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
