import { dismissOwnerSuggestion, parseDismissSuggestionBody } from '@/lib/suggestions';
import { runOwnerTaskRoute } from '@/lib/tasks/route-context';
import { parseSuggestionIfMatch } from '@/lib/http/etag';
import { assertSuggestionId, readJsonBody, requireObjectBody } from '@/lib/http/request';
import { NextResponse } from 'next/server';

/**
 * Optional request body (OpenAPI DismissTaskSuggestionRequest).
 * No Content-Type / no body → accepted.
 */
async function readOptionalDismissBody(
  request: Request,
): Promise<{ ok: true; reason?: string } | { ok: false; response: Response }> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return { ok: true };
  }
  const json = await readJsonBody(request);
  if (!json.ok) {
    return json;
  }
  if (json.body === null || json.body === undefined) {
    return { ok: true };
  }
  const object = requireObjectBody(json.body);
  if (!object.ok) {
    return object;
  }
  const parsed = parseDismissSuggestionBody(object.value);
  if (!parsed.ok) {
    return parsed;
  }
  return { ok: true, reason: parsed.value.reason };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ suggestionId: string }> },
) {
  return runOwnerTaskRoute(request, async (ctx) => {
    const { suggestionId } = await context.params;
    const idCheck = assertSuggestionId(suggestionId);
    if (!idCheck.ok) {
      return idCheck.response;
    }
    const ifMatch = parseSuggestionIfMatch(request, suggestionId);
    if (!ifMatch.ok) {
      return ifMatch.response;
    }
    const optional = await readOptionalDismissBody(request);
    if (!optional.ok) {
      return optional.response;
    }
    const result = await dismissOwnerSuggestion({
      db: ctx.db,
      owner: ctx.owner,
      suggestionId,
      now: ctx.now,
      expectedVersion: ifMatch.expectedVersion,
      requestId: ctx.requestId,
      reason: optional.reason,
    });
    return NextResponse.json(result.suggestion);
  });
}
