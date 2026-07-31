import { NextResponse } from 'next/server';
import { runOwnerTaskRoute } from '@/lib/tasks/route-context';
import { parseReminderIfMatch } from '@/lib/http/etag';
import { assertTaskId, readJsonBody, requireObjectBody } from '@/lib/http/request';
import {
  getOwnerTaskReminder,
  parseSetReminderBody,
  removeOwnerTaskReminder,
  setOwnerTaskReminder,
  type TaskReminderState,
} from '@/lib/reminders';

/**
 * Owner reminder schedule surface (A8.3b).
 *
 *   GET    /api/v1/tasks/{taskId}/reminder  → current reminder state
 *   PUT    /api/v1/tasks/{taskId}/reminder  → establish or change the canonical due date
 *   DELETE /api/v1/tasks/{taskId}/reminder  → remove the due date and stop reminders
 *
 * Thin by construction: authentication, Task-ID validation, `If-Match` parsing, body validation,
 * one service call, and a response. All reminder law lives in the A8.2 domain and all writes in the
 * A8.3a-backed transactions; no Prisma, date arithmetic, or scheduling decision appears here.
 *
 * A8.3b exposes configuration only. Nothing in this slice scans, claims, sends, retries, or delivers
 * a reminder.
 *
 * ## Concurrency
 *
 * `PUT` and `DELETE` require the *reminder* `If-Match`, which `GET` supplies (A8.3b audit F5). A Task
 * ETag is refused: reminder writes deliberately do not bump `Task.version`, so a Task token stays
 * valid across a reminder change it cannot describe.
 *
 * ## Caching
 *
 * Every response is `no-store`, including errors. Reminder state has its own ETag but changes without
 * bumping the Task's version, and the audit found error branches escaping without the header at all
 * — so it is applied once, to whatever the route produces, rather than at each `return`.
 */

/**
 * Apply `Cache-Control: no-store` to everything this route emits (A8.3b audit F6).
 *
 * Wrapping the result of `runOwnerTaskRoute` rather than each success path is the point: it covers
 * the 401 the wrapper produces before the handler runs, every error the service throws, and any
 * future branch nobody remembers to annotate.
 */
async function reminderRoute(
  request: Request,
  handler: Parameters<typeof runOwnerTaskRoute>[1],
): Promise<Response> {
  const response = await runOwnerTaskRoute(request, handler);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/** Success responses carry the reminder ETag the next mutation will have to present. */
function reminderResponse(state: TaskReminderState): Response {
  return NextResponse.json(state, { status: 200, headers: { ETag: state.etag } });
}

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  return reminderRoute(request, async (ctx) => {
    const { taskId } = await context.params;
    const idCheck = assertTaskId(taskId);
    if (!idCheck.ok) {
      return idCheck.response;
    }

    const state = await getOwnerTaskReminder({
      db: ctx.db,
      owner: ctx.owner,
      taskId,
      now: ctx.now,
      requestId: ctx.requestId,
    });
    return reminderResponse(state);
  });
}

export async function PUT(request: Request, context: { params: Promise<{ taskId: string }> }) {
  return reminderRoute(request, async (ctx) => {
    const { taskId } = await context.params;
    const idCheck = assertTaskId(taskId);
    if (!idCheck.ok) {
      return idCheck.response;
    }
    const ifMatch = parseReminderIfMatch(request, taskId);
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
    const parsed = parseSetReminderBody(object.value);
    if (!parsed.ok) {
      return parsed.response;
    }

    const result = await setOwnerTaskReminder({
      db: ctx.db,
      owner: ctx.owner,
      taskId,
      now: ctx.now,
      expectedReminderVersion: ifMatch.expectedVersion,
      requestId: ctx.requestId,
      dueLocalDate: parsed.value.dueLocalDate,
    });
    return reminderResponse(result.state);
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ taskId: string }> }) {
  return reminderRoute(request, async (ctx) => {
    const { taskId } = await context.params;
    const idCheck = assertTaskId(taskId);
    if (!idCheck.ok) {
      return idCheck.response;
    }
    const ifMatch = parseReminderIfMatch(request, taskId);
    if (!ifMatch.ok) {
      return ifMatch.response;
    }

    const result = await removeOwnerTaskReminder({
      db: ctx.db,
      owner: ctx.owner,
      taskId,
      now: ctx.now,
      expectedReminderVersion: ifMatch.expectedVersion,
      requestId: ctx.requestId,
    });
    return reminderResponse(result.state);
  });
}
