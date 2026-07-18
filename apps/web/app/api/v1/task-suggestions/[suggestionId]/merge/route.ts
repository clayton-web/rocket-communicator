import { mergeOwnerSuggestion, parseMergeSuggestionBody } from '@/lib/suggestions';
import { runOwnerTaskRoute } from '@/lib/tasks/route-context';
import { parseSuggestionIfMatch, parseTargetTaskIfMatch } from '@/lib/http/etag';
import { assertSuggestionId, readJsonBody, requireObjectBody } from '@/lib/http/request';
import { NextResponse } from 'next/server';

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
    const json = await readJsonBody(request);
    if (!json.ok) {
      return json.response;
    }
    const object = requireObjectBody(json.body);
    if (!object.ok) {
      return object.response;
    }
    const parsed = parseMergeSuggestionBody(object.value);
    if (!parsed.ok) {
      return parsed.response;
    }
    const targetIfMatch = parseTargetTaskIfMatch(
      object.value.targetTaskIfMatch,
      parsed.value.targetTaskId,
    );
    if (!targetIfMatch.ok) {
      return targetIfMatch.response;
    }
    const result = await mergeOwnerSuggestion({
      db: ctx.db,
      owner: ctx.owner,
      suggestionId,
      now: ctx.now,
      expectedVersion: ifMatch.expectedVersion,
      requestId: ctx.requestId,
      targetTaskId: parsed.value.targetTaskId,
      targetTaskExpectedVersion: targetIfMatch.expectedVersion,
      appendSummaryPoints: parsed.value.appendSummaryPoints,
    });
    return NextResponse.json(result.suggestion);
  });
}
