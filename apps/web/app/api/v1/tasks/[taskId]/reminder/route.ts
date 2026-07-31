import { NextResponse } from 'next/server';
import { runOwnerTaskRoute } from '@/lib/tasks/route-context';
import { parseTaskIfMatch } from '@/lib/http/etag';
import { assertTaskId, readJsonBody, requireObjectBody } from '@/lib/http/request';
import {
  getOwnerTaskReminder,
  parseSetReminderBody,
  removeOwnerTaskReminder,
  setOwnerTaskReminder,
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
 * Responses are `no-store`. Reminder state changes without bumping the Task's `version` — the due
 * date is not part of the Task contract — so there is no ETag a cache could validate against, and a
 * cached reminder state could outlive the schedule it describes.
 */

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function withNoStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function reminderResponse(body: unknown): Response {
  return NextResponse.json(body, { status: 200, headers: NO_STORE });
}

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  return runOwnerTaskRoute(request, async (ctx) => {
    const { taskId } = await context.params;
    const idCheck = assertTaskId(taskId);
    if (!idCheck.ok) {
      return withNoStore(idCheck.response);
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
  return runOwnerTaskRoute(request, async (ctx) => {
    const { taskId } = await context.params;
    const idCheck = assertTaskId(taskId);
    if (!idCheck.ok) {
      return withNoStore(idCheck.response);
    }
    const ifMatch = parseTaskIfMatch(request, taskId);
    if (!ifMatch.ok) {
      return withNoStore(ifMatch.response);
    }
    const json = await readJsonBody(request);
    if (!json.ok) {
      return withNoStore(json.response);
    }
    const object = requireObjectBody(json.body);
    if (!object.ok) {
      return withNoStore(object.response);
    }
    const parsed = parseSetReminderBody(object.value);
    if (!parsed.ok) {
      return withNoStore(parsed.response);
    }

    const result = await setOwnerTaskReminder({
      db: ctx.db,
      owner: ctx.owner,
      taskId,
      now: ctx.now,
      expectedVersion: ifMatch.expectedVersion,
      requestId: ctx.requestId,
      dueLocalDate: parsed.value.dueLocalDate,
    });
    return reminderResponse(result.state);
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ taskId: string }> }) {
  return runOwnerTaskRoute(request, async (ctx) => {
    const { taskId } = await context.params;
    const idCheck = assertTaskId(taskId);
    if (!idCheck.ok) {
      return withNoStore(idCheck.response);
    }
    const ifMatch = parseTaskIfMatch(request, taskId);
    if (!ifMatch.ok) {
      return withNoStore(ifMatch.response);
    }

    const result = await removeOwnerTaskReminder({
      db: ctx.db,
      owner: ctx.owner,
      taskId,
      now: ctx.now,
      expectedVersion: ifMatch.expectedVersion,
      requestId: ctx.requestId,
    });
    return reminderResponse(result.state);
  });
}
