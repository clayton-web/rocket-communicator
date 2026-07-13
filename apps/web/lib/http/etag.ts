import { NextResponse } from 'next/server';
import { parseETag } from '@aicaa/domain';
import { jsonErrorResponse } from '@/lib/auth/http';
import type { components } from '@aicaa/contracts/schema';

type ErrorResponse = components['schemas']['ErrorResponse'];

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
    return {
      ok: false,
      response: jsonErrorResponse(
        'PRECONDITION_REQUIRED',
        'If-Match header is required for this mutation.',
        428,
      ),
    };
  }

  const parsed = parseETag(raw.trim());
  if (!parsed || parsed.kind !== 'task') {
    return {
      ok: false,
      response: jsonErrorResponse(
        'PRECONDITION_FAILED',
        'If-Match header is not a valid strong ETag.',
        412,
      ),
    };
  }

  if (parsed.resourceId !== taskId) {
    return {
      ok: false,
      response: jsonErrorResponse(
        'PRECONDITION_FAILED',
        'The resource has changed since the provided ETag.',
        412,
      ),
    };
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
