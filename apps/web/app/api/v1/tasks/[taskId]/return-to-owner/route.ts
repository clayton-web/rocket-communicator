import { returnOwnerTaskToOwner } from '@/lib/tasks';
import { runOwnerTaskRoute } from '@/lib/tasks/route-context';
import { parseOptionalNoteBody } from '@/lib/tasks/validate-body';
import { parseTaskIfMatch } from '@/lib/http/etag';
import { assertTaskId, readJsonBody, requireObjectBody } from '@/lib/http/request';
import { NextResponse } from 'next/server';

/**
 * Optional request body (OpenAPI ReturnTaskToOwnerRequest).
 * No Content-Type / no body → accepted.
 * application/json → parsed; malformed JSON → 400.
 */
async function readOptionalReturnNote(
  request: Request,
): Promise<{ ok: true; note?: string } | { ok: false; response: Response }> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return { ok: true };
  }
  const json = await readJsonBody(request);
  if (!json.ok) {
    return json;
  }
  if (json.body === null || json.body === undefined) {
    return { ok: true };
  }
  const object = requireObjectBody(json.body);
  if (!object.ok) {
    return object;
  }
  const parsed = parseOptionalNoteBody(object.value);
  if (!parsed.ok) {
    return parsed;
  }
  return {
    ok: true,
    note: 'note' in parsed.value ? parsed.value.note : undefined,
  };
}

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

    const optional = await readOptionalReturnNote(request);
    if (!optional.ok) {
      return optional.response;
    }

    const result = await returnOwnerTaskToOwner({
      db: ctx.db,
      owner: ctx.owner,
      taskId,
      now: ctx.now,
      expectedVersion: ifMatch.expectedVersion,
      requestId: ctx.requestId,
      note: optional.note,
    });
    return NextResponse.json(result.task);
  });
}
