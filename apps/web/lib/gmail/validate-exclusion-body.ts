import { jsonErrorResponse } from '@/lib/auth/http';
import { jsonErrorResponseWithDetails } from '@/lib/http/errors';
import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';

type ErrorResponse = components['schemas']['ErrorResponse'];

const MAX_COMMUNICATION_EVENT_ID = 64;
const MAX_EXCLUSION_ID = 64;

export interface ParsedCreateGmailSenderExclusionBody {
  communicationEventId: string;
}

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
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

/**
 * Strictly parse CreateGmailSenderExclusionRequest (D180 / S7).
 *
 * Only `communicationEventId` is accepted. The server resolves the Gmail sender from existing A5
 * data; clients do not send a raw address, organization, or source kind.
 */
export function parseCreateGmailSenderExclusionBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: ParsedCreateGmailSenderExclusionBody }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  const allowed = new Set(['communicationEventId']);
  const unknownKeys = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    return fail(
      'Request body contains unsupported fields.',
      unknownKeys.map((field) => ({ field, message: 'Unsupported field.' })),
    );
  }

  if (!has(body, 'communicationEventId') || typeof body.communicationEventId !== 'string') {
    return fail('communicationEventId is required.', [
      { field: 'communicationEventId', message: 'communicationEventId is required.' },
    ]);
  }
  const communicationEventId = body.communicationEventId;
  if (communicationEventId.trim().length === 0) {
    return fail('communicationEventId must not be empty.', [
      { field: 'communicationEventId', message: 'communicationEventId must not be empty.' },
    ]);
  }
  if (communicationEventId.length > MAX_COMMUNICATION_EVENT_ID) {
    return fail(`communicationEventId must be at most ${MAX_COMMUNICATION_EVENT_ID} characters.`, [
      {
        field: 'communicationEventId',
        message: `communicationEventId must be at most ${MAX_COMMUNICATION_EVENT_ID} characters.`,
      },
    ]);
  }

  return { ok: true, value: { communicationEventId } };
}

export function assertGmailSenderExclusionId(
  exclusionId: string,
): { ok: true } | { ok: false; response: NextResponse<ErrorResponse> } {
  if (!exclusionId || exclusionId.length > MAX_EXCLUSION_ID) {
    return {
      ok: false,
      response: jsonErrorResponse('VALIDATION_ERROR', 'exclusionId is invalid.', 400),
    };
  }
  return { ok: true };
}
