import { jsonErrorResponseWithDetails } from '@/lib/http/errors';
import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';

type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * Public `rawInput` ceiling (`CreateManualCaptureRequest`), enforced here at the HTTP boundary.
 *
 * The interpretation provider separately truncates its own input, but truncation is not a request
 * bound: it would silently interpret a different capture than the Owner sent and fingerprint it as
 * that shorter text, so an oversize capture must be refused before any of that happens. The
 * provider ceiling is deliberately left alone.
 */
const MAX_RAW_INPUT = 4000;

/** IANA timezone names fit comfortably; the bound only keeps an unbounded string out. */
const MAX_TIMEZONE = 64;

export interface ParsedManualCaptureBody {
  rawInput: string;
  capturedAt: string;
  timezone: string | null;
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
 * Strictly parse the contracted CreateManualCaptureRequest body (S3.2 / D170).
 *
 * Only `rawInput`, `capturedAt`, and `timezone` are accepted, matching the contract's
 * `additionalProperties: false`. A client that sends `sourceKind`, `organizationId`, or any other
 * provenance field is rejected rather than quietly ignored: those are decided by the server, and
 * accepting them would make it look like they were honoured.
 *
 * Values are validated but never rewritten. `rawInput` and `capturedAt` are fingerprinted request
 * identity, so normalizing them here would make two textually different retries resolve to one
 * occurrence — or make one capture's retry look like a different request. Emptiness is judged on
 * the trimmed text while the original string is what travels onward, and `capturedAt` instant
 * semantics stay with the S3.1 service that canonicalizes and fingerprints them.
 */
export function parseManualCaptureBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: ParsedManualCaptureBody }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  const allowed = new Set(['rawInput', 'capturedAt', 'timezone']);
  const unknownKeys = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    return fail(
      'Request body contains unsupported fields.',
      unknownKeys.map((field) => ({ field, message: 'Unsupported field.' })),
    );
  }

  if (!has(body, 'rawInput') || typeof body.rawInput !== 'string') {
    return fail('rawInput is required.', [{ field: 'rawInput', message: 'rawInput is required.' }]);
  }
  const rawInput = body.rawInput;
  if (rawInput.trim().length === 0) {
    return fail('rawInput must not be empty.', [
      { field: 'rawInput', message: 'rawInput must not be empty.' },
    ]);
  }
  if (rawInput.length > MAX_RAW_INPUT) {
    return fail(`rawInput must be at most ${MAX_RAW_INPUT} characters.`, [
      { field: 'rawInput', message: `rawInput must be at most ${MAX_RAW_INPUT} characters.` },
    ]);
  }

  if (!has(body, 'capturedAt') || typeof body.capturedAt !== 'string') {
    return fail('capturedAt is required.', [
      { field: 'capturedAt', message: 'capturedAt is required.' },
    ]);
  }

  let timezone: string | null = null;
  if (has(body, 'timezone') && body.timezone !== null && body.timezone !== undefined) {
    if (typeof body.timezone !== 'string' || body.timezone.length > MAX_TIMEZONE) {
      return fail('timezone is invalid.', [{ field: 'timezone', message: 'timezone is invalid.' }]);
    }
    timezone = body.timezone;
  }

  return { ok: true, value: { rawInput, capturedAt: body.capturedAt, timezone } };
}
