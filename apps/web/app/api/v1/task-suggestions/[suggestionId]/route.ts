import { getOwnerSuggestion } from '@/lib/suggestions';
import { runOwnerTaskRoute } from '@/lib/tasks/route-context';
import { jsonWithEtag } from '@/lib/http/etag';
import { assertSuggestionId } from '@/lib/http/request';

export async function GET(
  request: Request,
  context: { params: Promise<{ suggestionId: string }> },
) {
  return runOwnerTaskRoute(request, async (ctx) => {
    const { suggestionId } = await context.params;
    const idCheck = assertSuggestionId(suggestionId);
    if (!idCheck.ok) {
      return idCheck.response;
    }
    const suggestion = await getOwnerSuggestion({
      db: ctx.db,
      owner: ctx.owner,
      suggestionId,
      now: ctx.now,
    });
    return jsonWithEtag(suggestion, suggestion.etag);
  });
}
