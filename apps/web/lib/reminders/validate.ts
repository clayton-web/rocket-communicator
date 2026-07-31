import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';
import { jsonErrorResponse } from '@/lib/auth/http';

type ErrorResponse = components['schemas']['ErrorResponse'];
type SetTaskReminderRequest = components['schemas']['SetTaskReminderRequest'];

/**
 * Fields a client may never choose. Occurrence dates and instants, the generation, the schedule
 * status, the delivered count, and the stop reason are all derived from the Task, the organization
 * timezone, and the A8.2 domain (D103, D104, D128).
 *
 * These are rejected rather than ignored. Silently dropping `generation` from a request body would
 * let a client believe it had pinned a generation, and would let a future refactor start honouring a
 * field no contract ever promised.
 */
const DERIVED_FIELDS = [
  'organizationId',
  'generation',
  'occurrenceKind',
  'occurrenceLocalDate',
  'occurrenceAt',
  'advanceOccurrenceLocalDate',
  'advanceOccurrenceAt',
  'nextOverdueOccurrenceLocalDate',
  'nextOverdueOccurrenceAt',
  'advanceDisposition',
  'state',
  'status',
  'schedulingTimeZone',
  'timeZone',
  'overdueDeliveredCount',
  'stopReason',
  'requiresOwnerAttention',
  'claimedBy',
  'claimExpiresAt',
  'dueAt',
] as const;

const CANONICAL_LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message: string): { ok: false; response: NextResponse<ErrorResponse> } {
  return { ok: false, response: jsonErrorResponse('VALIDATION_ERROR', message, 400) };
}

/**
 * Parse a due-date change request.
 *
 * Only the canonical text shape is checked here. Whether the date is a real Gregorian day is the
 * domain parser's decision, so `2026-02-30` is rejected by `parseLocalDate` in the service and this
 * validator does not duplicate calendar rules.
 */
export function parseSetReminderBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: SetTaskReminderRequest }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  for (const field of DERIVED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      return fail(`${field} is derived by the server and must not be supplied.`);
    }
  }

  const dueLocalDate = body.dueLocalDate;
  if (typeof dueLocalDate !== 'string') {
    return fail('dueLocalDate is required and must be a string.');
  }
  if (!CANONICAL_LOCAL_DATE.test(dueLocalDate)) {
    return fail('dueLocalDate must be a canonical organization-local date in YYYY-MM-DD form.');
  }

  return { ok: true, value: { dueLocalDate } };
}
