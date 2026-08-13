import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';
import { jsonErrorResponse } from '@/lib/auth/http';

type ErrorResponse = components['schemas']['ErrorResponse'];
type SetTaskReminderRequest = components['schemas']['SetTaskReminderRequest'];

/**
 * The complete set of properties a due-date change request may contain (A8.3b audit F3).
 *
 * An allowlist, replacing the denylist the original A8.3b implementation shipped. The audit showed
 * why the distinction matters: a denylist can only refuse the fields somebody thought to enumerate,
 * so `reminderTime`, `presetInterval`, and `totallyUnknown` were all silently accepted and dropped,
 * while the OpenAPI schema declared `additionalProperties: false`. A client reading the contract
 * would have been told its typo was invalid; the runtime told it the request had succeeded.
 *
 * Everything else about a schedule — the generation, the occurrence dates and instants, the advance
 * disposition, the status, the delivered count, the stop reason, the scheduling timezone — is derived
 * from the Task, the organization timezone, and the A8.2 domain (D103, D104, D128). The D178
 * advance-enablement preference is the one additional Owner-selectable input.
 */
const ALLOWED_FIELDS = new Set<string>(['dueLocalDate', 'advanceEnabled']);

const CANONICAL_LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message: string): { ok: false; response: NextResponse<ErrorResponse> } {
  return { ok: false, response: jsonErrorResponse('VALIDATION_ERROR', message, 400) };
}

/**
 * Parse a due-date change request.
 *
 * Only the canonical text shape of the date is checked here. Whether it is a real Gregorian day is
 * the domain parser's decision, so `2026-02-30` is rejected by `parseLocalDate` in the service and
 * this validator does not duplicate calendar rules.
 *
 * Duplicate JSON keys are left to the standard parser's last-wins behaviour. `JSON.parse` has already
 * collapsed them before this function sees an object, and both values would have to pass the same
 * validation anyway, so there is nothing a custom defence could protect.
 */
export function parseSetReminderBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: SetTaskReminderRequest }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  // `Object.keys` rather than `for...in`: only the request's own properties are considered, so a
  // prototype-polluted payload cannot smuggle a property past the allowlist or into the result.
  for (const field of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(field)) {
      return fail(`${field} is not an accepted property of this request.`);
    }
  }

  const dueLocalDate = body.dueLocalDate;
  if (typeof dueLocalDate !== 'string') {
    return fail('dueLocalDate is required and must be a string.');
  }
  if (!CANONICAL_LOCAL_DATE.test(dueLocalDate)) {
    return fail('dueLocalDate must be a canonical organization-local date in YYYY-MM-DD form.');
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'advanceEnabled')) {
    return { ok: true, value: { dueLocalDate } };
  }
  if (typeof body.advanceEnabled !== 'boolean') {
    return fail('advanceEnabled must be a boolean.');
  }

  return { ok: true, value: { dueLocalDate, advanceEnabled: body.advanceEnabled } };
}
