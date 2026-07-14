import { resumeCapabilityTask } from '@/lib/capability';
import { requireCapabilityConfirmation } from '@/lib/capability/confirm';
import { runRecipientCapabilityRoute } from '@/lib/capability/route-context';
import { parseTaskIfMatch } from '@/lib/http/etag';
import { readJsonBody, requireObjectBody } from '@/lib/http/request';
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
    const result = await resumeCapabilityTask({
      db: ctx.db,
      rawToken: ctx.rawToken,
      pepper: ctx.pepper,
      taskId: ctx.taskId,
      now: ctx.now,
      expectedVersion: ifMatch.expectedVersion,
      requestId: ctx.requestId,
    });
    return NextResponse.json(result.task);
  });
}
