import { jsonErrorResponse } from '@/lib/auth/http';
import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';

type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * Shared Recipient POST confirmation gate (D050).
 * Must run at the HTTP boundary before any mutation service call.
 * Domain/application services remain unaware of confirmation semantics.
 */
export function requireCapabilityConfirmation(
  body: Record<string, unknown>,
): { ok: true } | { ok: false; response: NextResponse<ErrorResponse> } {
  if (!('confirmation' in body) || body.confirmation === undefined || body.confirmation === null) {
    return {
      ok: false,
      response: jsonErrorResponse(
        'VALIDATION_ERROR',
        'confirmation is required and must be "confirmed".',
        400,
      ),
    };
  }
  if (body.confirmation !== 'confirmed') {
    return {
      ok: false,
      response: jsonErrorResponse(
        'VALIDATION_ERROR',
        'confirmation is required and must be "confirmed".',
        400,
      ),
    };
  }
  return { ok: true };
}
