import { HANDOFF_ACKNOWLEDGEMENT_V1 } from '@aicaa/domain';
import { jsonErrorResponse } from '@/lib/auth/http';
import { jsonErrorResponseWithDetails } from '@/lib/http/errors';
import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';

type ErrorResponse = components['schemas']['ErrorResponse'];

const MAX_RECIPIENT_ID = 64;

// Contracted Idempotency-Key shape: 8–128 chars from the safe URL-token alphabet.
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]+$/;
const IDEMPOTENCY_KEY_MIN = 8;
const IDEMPOTENCY_KEY_MAX = 128;

export interface ParsedHandoffBody {
  recipientId: string;
  acknowledgement: typeof HANDOFF_ACKNOWLEDGEMENT_V1;
}

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/**
 * Parse the mandatory Idempotency-Key header (A7.7 / D094).
 * Absent → 428 PRECONDITION_REQUIRED. Malformed (length/charset) → 400 VALIDATION_ERROR.
 * The full key value is never logged by callers.
 */
export function parseIdempotencyKey(
  request: Request,
): { ok: true; value: string } | { ok: false; response: NextResponse<ErrorResponse> } {
  const raw = request.headers.get('idempotency-key');
  if (raw === null || raw.trim() === '') {
    return {
      ok: false,
      response: jsonErrorResponse(
        'PRECONDITION_REQUIRED',
        'Idempotency-Key header is required for this mutation.',
        428,
      ),
    };
  }
  const value = raw.trim();
  if (
    value.length < IDEMPOTENCY_KEY_MIN ||
    value.length > IDEMPOTENCY_KEY_MAX ||
    !IDEMPOTENCY_KEY_PATTERN.test(value)
  ) {
    return {
      ok: false,
      response: jsonErrorResponse(
        'VALIDATION_ERROR',
        'Idempotency-Key must be 8–128 characters using A–Z, a–z, 0–9, and . _ ~ -',
        400,
      ),
    };
  }
  return { ok: true, value };
}

/**
 * Strictly parse the contracted HandoffTaskRequest body (A7.7).
 *
 * Only `recipientId` and `acknowledgement` are accepted. Any additional property (including
 * `proposedRecipientId`, `proposedRecipientHint`, `deliveryPath`, or a raw email) is rejected with
 * 400 VALIDATION_ERROR — the contract is strict (`additionalProperties: false`) and proposed
 * Recipient hints are not part of A7.7.
 */
export function parseHandoffBody(
  body: Record<string, unknown>,
): { ok: true; value: ParsedHandoffBody } | { ok: false; response: NextResponse<ErrorResponse> } {
  const allowed = new Set(['recipientId', 'acknowledgement']);
  const unknownKeys = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    return fail(
      'Request body contains unsupported fields.',
      unknownKeys.map((field) => ({ field, message: 'Unsupported field.' })),
    );
  }

  if (!has(body, 'recipientId') || typeof body.recipientId !== 'string') {
    return fail('recipientId is required.', [
      { field: 'recipientId', message: 'recipientId is required.' },
    ]);
  }
  const recipientId = body.recipientId.trim();
  if (recipientId.length < 1 || recipientId.length > MAX_RECIPIENT_ID) {
    return fail('recipientId is invalid.', [
      { field: 'recipientId', message: 'recipientId is invalid.' },
    ]);
  }

  if (body.acknowledgement !== HANDOFF_ACKNOWLEDGEMENT_V1) {
    return fail('acknowledgement must confirm the handoff disclosure.', [
      {
        field: 'acknowledgement',
        message: `acknowledgement must be "${HANDOFF_ACKNOWLEDGEMENT_V1}".`,
      },
    ]);
  }

  return { ok: true, value: { recipientId, acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1 } };
}

function fail(
  message: string,
  details?: ReadonlyArray<{ field: string; message: string }>,
): { ok: false; response: NextResponse<ErrorResponse> } {
  return {
    ok: false,
    response: jsonErrorResponseWithDetails('VALIDATION_ERROR', message, 400, details),
  };
}
