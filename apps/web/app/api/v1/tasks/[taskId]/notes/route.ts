import { addOwnerTaskNote } from '@/lib/tasks';
import { runOwnerTaskRoute } from '@/lib/tasks/route-context';
import { parseNoteBody } from '@/lib/tasks/validate-body';
import { parseTaskIfMatch } from '@/lib/http/etag';
import { NextResponse } from 'next/server';
import { assertTaskId, readJsonBody, requireObjectBody } from '@/lib/http/request';

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  return runOwnerTaskRoute(request, async (ctx) => {
    const { taskId } = await context.params;
    const idCheck = assertTaskId(taskId);
    if (!idCheck.ok) {
      return idCheck.response;
    }
    const ifMatch = parseTaskIfMatch(request, taskId);
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
    const parsed = parseNoteBody(object.value);
    if (!parsed.ok) {
      return parsed.response;
    }
    const result = await addOwnerTaskNote({
      db: ctx.db,
      owner: ctx.owner,
      taskId,
      now: ctx.now,
      expectedVersion: ifMatch.expectedVersion,
      requestId: ctx.requestId,
      body: parsed.value.body,
    });
    return NextResponse.json(result.task);
  });
}
