import { requestCapabilityClarification } from '@/lib/capability';
import { requireCapabilityConfirmation } from '@/lib/capability/confirm';
import { runRecipientCapabilityRoute } from '@/lib/capability/route-context';
import { parseTaskIfMatch } from '@/lib/http/etag';
import { readJsonBody, requireObjectBody } from '@/lib/http/request';
import { parseClarificationBody } from '@/lib/tasks/validate-body';
import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string; taskId: string }> },
) {
  return runRecipientCapabilityRoute(request, context.params, async (ctx) => {
    const ifMatch = parseTaskIfMatch(request, ctx.taskId);
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
    const confirmation = requireCapabilityConfirmation(object.value);
    if (!confirmation.ok) {
      return confirmation.response;
    }
    const parsed = parseClarificationBody(object.value);
    if (!parsed.ok) {
      return parsed.response;
    }
    const result = await requestCapabilityClarification({
      db: ctx.db,
      rawToken: ctx.rawToken,
      pepper: ctx.pepper,
      taskId: ctx.taskId,
      now: ctx.now,
      expectedVersion: ifMatch.expectedVersion,
      requestId: ctx.requestId,
      message: parsed.value.message,
    });
    return NextResponse.json(result.task);
  });
}
