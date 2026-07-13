import { getOwnerTask } from '@/lib/tasks';
import { runOwnerTaskRoute } from '@/lib/tasks/route-context';
import { jsonWithEtag } from '@/lib/http/etag';
import { assertTaskId } from '@/lib/http/request';

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  return runOwnerTaskRoute(request, async (ctx) => {
    const { taskId } = await context.params;
    const idCheck = assertTaskId(taskId);
    if (!idCheck.ok) {
      return idCheck.response;
    }
    const task = await getOwnerTask({
      db: ctx.db,
      owner: ctx.owner,
      taskId,
      now: ctx.now,
    });
    return jsonWithEtag(task, task.etag);
  });
}
