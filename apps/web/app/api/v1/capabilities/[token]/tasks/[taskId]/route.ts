import { getCapabilityTask } from '@/lib/capability';
import { runRecipientCapabilityRoute } from '@/lib/capability/route-context';
import { jsonWithEtag } from '@/lib/http/etag';

/**
 * GET /api/v1/capabilities/{token}/tasks/{taskId}
 * Non-mutating Recipient task view (D050, D059). Authorization = path capability only.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string; taskId: string }> },
) {
  return runRecipientCapabilityRoute(request, context.params, async (ctx) => {
    const task = await getCapabilityTask({
      db: ctx.db,
      rawToken: ctx.rawToken,
      pepper: ctx.pepper,
      taskId: ctx.taskId,
      now: ctx.now,
    });
    return jsonWithEtag(task, task.etag);
  });
}
