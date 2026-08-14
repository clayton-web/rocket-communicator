import { jsonErrorResponseWithDetails } from '@/lib/http/errors';
import { canonicalizeInterpretationInstant } from '@/lib/interpretation/validate';
import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';

type ErrorResponse = components['schemas']['ErrorResponse'];

const MAX_SOURCE_OCCURRENCE_ID = 128;
/** Matches TemporaryCommunicationExcerpt.content / byte cap. */
const MAX_SELECTED_TEXT_BYTES = 8_192;
const CONTROL_OR_DEL = /[\u0000-\u001F\u007F]/;

export interface ParsedMessagesReviewBody {
  sourceOccurrenceId: string;
  selectedText: string;
  observedAt: string;
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

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Strictly parse the contracted CreateMessagesReviewRequest body (D181).
 *
 * Only the minimum Owner-selected occurrence fields are accepted. Clients cannot send
 * `sourceKind`, `organizationId`, `rawInput`, `capturedAt`, sender, phone, or title.
 */
export function parseMessagesReviewBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: ParsedMessagesReviewBody }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  const allowed = new Set(['sourceOccurrenceId', 'selectedText', 'observedAt']);
  const unknownKeys = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    return fail(
      'Request body contains unsupported fields.',
      unknownKeys.map((field) => ({ field, message: 'Unsupported field.' })),
    );
  }

  if (!has(body, 'sourceOccurrenceId') || typeof body.sourceOccurrenceId !== 'string') {
    return fail('sourceOccurrenceId is required.', [
      { field: 'sourceOccurrenceId', message: 'sourceOccurrenceId is required.' },
    ]);
  }
  const sourceOccurrenceId = body.sourceOccurrenceId;
  if (sourceOccurrenceId.length === 0) {
    return fail('sourceOccurrenceId must not be empty.', [
      { field: 'sourceOccurrenceId', message: 'sourceOccurrenceId must not be empty.' },
    ]);
  }
  if (sourceOccurrenceId.length > MAX_SOURCE_OCCURRENCE_ID) {
    return fail(`sourceOccurrenceId must be at most ${MAX_SOURCE_OCCURRENCE_ID} characters.`, [
      {
        field: 'sourceOccurrenceId',
        message: `sourceOccurrenceId must be at most ${MAX_SOURCE_OCCURRENCE_ID} characters.`,
      },
    ]);
  }
  if (CONTROL_OR_DEL.test(sourceOccurrenceId)) {
    return fail('sourceOccurrenceId contains unsupported characters.', [
      {
        field: 'sourceOccurrenceId',
        message: 'sourceOccurrenceId contains unsupported characters.',
      },
    ]);
  }

  if (!has(body, 'selectedText') || typeof body.selectedText !== 'string') {
    return fail('selectedText is required.', [
      { field: 'selectedText', message: 'selectedText is required.' },
    ]);
  }
  const selectedText = body.selectedText;
  if (selectedText.trim().length === 0) {
    return fail('selectedText must not be empty.', [
      { field: 'selectedText', message: 'selectedText must not be empty.' },
    ]);
  }
  if (byteLength(selectedText) > MAX_SELECTED_TEXT_BYTES) {
    return fail(`selectedText must be at most ${MAX_SELECTED_TEXT_BYTES} bytes.`, [
      {
        field: 'selectedText',
        message: `selectedText must be at most ${MAX_SELECTED_TEXT_BYTES} bytes.`,
      },
    ]);
  }

  if (!has(body, 'observedAt') || typeof body.observedAt !== 'string') {
    return fail('observedAt is required.', [
      { field: 'observedAt', message: 'observedAt is required.' },
    ]);
  }
  if (body.observedAt.length === 0) {
    return fail('observedAt must not be empty.', [
      { field: 'observedAt', message: 'observedAt must not be empty.' },
    ]);
  }
  const observedAt = canonicalizeInterpretationInstant(body.observedAt);
  if (!observedAt.ok) {
    const message =
      observedAt.reason === 'invalid'
        ? 'observedAt must be a valid timestamp.'
        : 'observedAt must be an ISO-8601 timestamp with an explicit UTC offset.';
    return fail(message, [{ field: 'observedAt', message }]);
  }

  return {
    ok: true,
    value: {
      sourceOccurrenceId,
      selectedText,
      observedAt: body.observedAt,
    },
  };
}
