import { resumeOwnerTask } from '@/lib/tasks';
import { runOwnerTaskRoute } from '@/lib/tasks/route-context';
import { parseTaskIfMatch } from '@/lib/http/etag';
import { NextResponse } from 'next/server';
import { assertTaskId } from '@/lib/http/request';

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
    const result = await resumeOwnerTask({
      db: ctx.db,
      owner: ctx.owner,
      taskId,
      now: ctx.now,
      expectedVersion: ifMatch.expectedVersion,
      requestId: ctx.requestId,
    });
    return NextResponse.json(result.task);
  });
}
