import { NextResponse } from 'next/server';
import { parseETag } from '@aicaa/domain';
import { jsonErrorResponse } from '@/lib/auth/http';
import type { components } from '@aicaa/contracts/schema';

type ErrorResponse = components['schemas']['ErrorResponse'];

function missingIfMatchResponse(): NextResponse<ErrorResponse> {
  return jsonErrorResponse(
    'PRECONDITION_REQUIRED',
    'If-Match header is required for this mutation.',
    428,
  );
}

function invalidStrongETagResponse(): NextResponse<ErrorResponse> {
  return jsonErrorResponse(
    'PRECONDITION_FAILED',
    'If-Match header is not a valid strong ETag.',
    412,
  );
}

function staleETagResponse(): NextResponse<ErrorResponse> {
  return jsonErrorResponse(
    'PRECONDITION_FAILED',
    'The resource has changed since the provided ETag.',
    412,
  );
}

/**
 * Parse mandatory If-Match for Owner task mutations.
 * Missing → PRECONDITION_REQUIRED (428).
 * Malformed or wrong kind/id → PRECONDITION_FAILED (412).
 */
export function parseTaskIfMatch(
  request: Request,
  taskId: string,
): { ok: true; expectedVersion: number } | { ok: false; response: NextResponse<ErrorResponse> } {
  const raw = request.headers.get('if-match');
  if (raw === null || raw.trim() === '') {
    return { ok: false, response: missingIfMatchResponse() };
  }

  const parsed = parseETag(raw.trim());
  if (!parsed || parsed.kind !== 'task') {
    return { ok: false, response: invalidStrongETagResponse() };
  }

  if (parsed.resourceId !== taskId) {
    return { ok: false, response: staleETagResponse() };
  }

  return { ok: true, expectedVersion: parsed.version };
}

/**
 * Parse mandatory If-Match for Owner task-suggestion mutations.
 * Missing → PRECONDITION_REQUIRED (428).
 * Malformed, weak, or wrong kind/id → PRECONDITION_FAILED (412).
 */
export function parseSuggestionIfMatch(
  request: Request,
  suggestionId: string,
): { ok: true; expectedVersion: number } | { ok: false; response: NextResponse<ErrorResponse> } {
  const raw = request.headers.get('if-match');
  if (raw === null || raw.trim() === '') {
    return { ok: false, response: missingIfMatchResponse() };
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('W/')) {
    return { ok: false, response: invalidStrongETagResponse() };
  }

  const parsed = parseETag(trimmed);
  if (!parsed || parsed.kind !== 'task-suggestion') {
    return { ok: false, response: invalidStrongETagResponse() };
  }

  if (parsed.resourceId !== suggestionId) {
    return { ok: false, response: staleETagResponse() };
  }

  return { ok: true, expectedVersion: parsed.version };
}

/**
 * Parse mandatory If-Match for Owner reminder mutations (A8.3b audit F5).
 *
 * A reminder token, not a Task token. The audit proved a Task ETag cannot protect reminder state:
 * reminder writes deliberately leave `Task.version` alone, so a Task token stays valid across a
 * change it cannot describe, and two Owners could each hold a "current" token for a schedule only one
 * of them had actually read. A `task` token presented here is refused as the wrong kind rather than
 * quietly accepted.
 *
 * Missing → PRECONDITION_REQUIRED (428).
 * Weak, malformed, wildcard, multiple, or wrong kind → PRECONDITION_FAILED (412).
 * Right kind but a different Task → PRECONDITION_FAILED (412).
 */
export function parseReminderIfMatch(
  request: Request,
  taskId: string,
): { ok: true; expectedVersion: number } | { ok: false; response: NextResponse<ErrorResponse> } {
  const raw = request.headers.get('if-match');
  if (raw === null || raw.trim() === '') {
    return { ok: false, response: missingIfMatchResponse() };
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('W/')) {
    return { ok: false, response: invalidStrongETagResponse() };
  }

  // `*` and comma-separated lists both fail to parse, so they land here as malformed rather than
  // being treated as "matches anything" — a wildcard would defeat the precondition entirely.
  const parsed = parseETag(trimmed);
  if (!parsed || parsed.kind !== 'task-reminder') {
    return { ok: false, response: invalidStrongETagResponse() };
  }

  if (parsed.resourceId !== taskId) {
    return { ok: false, response: staleETagResponse() };
  }

  return { ok: true, expectedVersion: parsed.version };
}

/**
 * Parse merge body `targetTaskIfMatch` (D083).
 * Missing/empty → PRECONDITION_REQUIRED (428).
 * Malformed or wrong kind/id → PRECONDITION_FAILED (412).
 */
export function parseTargetTaskIfMatch(
  raw: unknown,
  taskId: string,
): { ok: true; expectedVersion: number } | { ok: false; response: NextResponse<ErrorResponse> } {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return {
      ok: false,
      response: jsonErrorResponse(
        'PRECONDITION_REQUIRED',
        'targetTaskIfMatch is required for merge.',
        428,
      ),
    };
  }
  if (typeof raw !== 'string') {
    return { ok: false, response: invalidStrongETagResponse() };
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith('W/')) {
    return { ok: false, response: invalidStrongETagResponse() };
  }
  const parsed = parseETag(trimmed);
  if (!parsed || parsed.kind !== 'task') {
    return { ok: false, response: invalidStrongETagResponse() };
  }
  if (parsed.resourceId !== taskId) {
    return { ok: false, response: staleETagResponse() };
  }
  return { ok: true, expectedVersion: parsed.version };
}

export function jsonWithEtag<T>(body: T, etag: string, status = 200): NextResponse<T> {
  return NextResponse.json(body, {
    status,
    headers: {
      ETag: etag,
    },
  });
}
