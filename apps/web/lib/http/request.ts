import { jsonErrorResponse } from '@/lib/auth/http';
import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';

type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * Require `Content-Type: application/json` for requests carrying a JSON body (A7.6).
 * Accepts media-type parameters such as `application/json; charset=utf-8`. Returns HTTP 415
 * (with the shared privacy-safe envelope) when the media type is absent or unsupported.
 */
export function requireJsonContentType(
  request: Request,
): { ok: true } | { ok: false; response: NextResponse<ErrorResponse> } {
  const header = request.headers.get('content-type');
  const mediaType = header?.split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return {
      ok: false,
      response: jsonErrorResponse(
        'VALIDATION_ERROR',
        'Content-Type must be application/json.',
        415,
      ),
    };
  }
  return { ok: true };
}

export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse<ErrorResponse> }> {
  try {
    const body = await request.json();
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: jsonErrorResponse('VALIDATION_ERROR', 'Request body must be valid JSON.', 400),
    };
  }
}

export function requireObjectBody(
  body: unknown,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      response: jsonErrorResponse('VALIDATION_ERROR', 'Request body must be a JSON object.', 400),
    };
  }
  return { ok: true, value: body as Record<string, unknown> };
}

export function parseLimitQuery(
  raw: string | null,
): { ok: true; limit: number } | { ok: false; response: NextResponse<ErrorResponse> } {
  if (raw === null || raw === '') {
    return { ok: true, limit: 25 };
  }
  if (!/^\d+$/.test(raw)) {
    return {
      ok: false,
      response: jsonErrorResponse(
        'VALIDATION_ERROR',
        'limit must be an integer from 1 to 100.',
        400,
      ),
    };
  }
  const limit = Number.parseInt(raw, 10);
  if (limit < 1 || limit > 100) {
    return {
      ok: false,
      response: jsonErrorResponse(
        'VALIDATION_ERROR',
        'limit must be an integer from 1 to 100.',
        400,
      ),
    };
  }
  return { ok: true, limit };
}

export function assertTaskId(
  taskId: string,
): { ok: true } | { ok: false; response: NextResponse<ErrorResponse> } {
  if (!taskId || taskId.length > 64) {
    return {
      ok: false,
      response: jsonErrorResponse('VALIDATION_ERROR', 'taskId is invalid.', 400),
    };
  }
  return { ok: true };
}

export function assertSuggestionId(
  suggestionId: string,
): { ok: true } | { ok: false; response: NextResponse<ErrorResponse> } {
  if (!suggestionId || suggestionId.length > 64) {
    return {
      ok: false,
      response: jsonErrorResponse('VALIDATION_ERROR', 'suggestionId is invalid.', 400),
    };
  }
  return { ok: true };
}
