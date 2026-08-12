import { HANDOFF_ACKNOWLEDGEMENT_V1 } from '@aicaa/domain';
import { jsonErrorResponseWithDetails } from '@/lib/http/errors';
import { parseIdempotencyKey } from '@/lib/http/request';
import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';

type ErrorResponse = components['schemas']['ErrorResponse'];

const MAX_RECIPIENT_ID = 64;

export interface ParsedHandoffBody {
  recipientId: string;
  acknowledgement: typeof HANDOFF_ACKNOWLEDGEMENT_V1;
}

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/**
 * The contracted Idempotency-Key parser now lives in the shared HTTP layer, because S3.2 gave it a
 * second Owner route (D170) and one header contract should have one parser. Re-exported here so the
 * handoff slice keeps its existing public surface.
 */
export { parseIdempotencyKey };

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
