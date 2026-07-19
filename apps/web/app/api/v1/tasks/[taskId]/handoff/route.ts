import { NextResponse } from 'next/server';
import { runOwnerTaskRoute } from '@/lib/tasks/route-context';
import { parseTaskIfMatch } from '@/lib/http/etag';
import {
  assertTaskId,
  readJsonBody,
  requireJsonContentType,
  requireObjectBody,
} from '@/lib/http/request';
import { jsonErrorResponse } from '@/lib/auth/http';
import { runHandoffService } from '@/lib/handoff/service';
import { parseHandoffBody, parseIdempotencyKey } from '@/lib/handoff/validate';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * POST /api/v1/tasks/{taskId}/handoff
 *
 * Thin Owner-authenticated wrapper around the A7.7 route-facing handoff service (D037, D090, D094).
 * Performs only: auth, Task-ID validation, content-type, If-Match parse, Idempotency-Key parse,
 * body validation, service call, and public response/error mapping. No Prisma, Gmail, token, or
 * lifecycle logic lives here.
 *
 * Idempotency-first semantics (including successful replay with the original post-bump If-Match)
 * are entirely owned by the service — this route only extracts a syntactically valid Task ETag
 * version; it never compares that version to the current Task.
 */
export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  return runOwnerTaskRoute(request, async (ctx) => {
    const { taskId } = await context.params;
    const idCheck = assertTaskId(taskId);
    if (!idCheck.ok) {
      return withNoStore(idCheck.response);
    }

    const contentType = requireJsonContentType(request);
    if (!contentType.ok) {
      return withNoStore(contentType.response);
    }

    // Syntactic If-Match only: same Task ID + strong ETag. Version comparison for a *new* handoff
    // happens inside the service after idempotency classification (replays/retries ignore version).
    const ifMatch = parseTaskIfMatch(request, taskId);
    if (!ifMatch.ok) {
      return withNoStore(ifMatch.response);
    }

    const idempotency = parseIdempotencyKey(request);
    if (!idempotency.ok) {
      return withNoStore(idempotency.response);
    }

    const json = await readJsonBody(request);
    if (!json.ok) {
      return withNoStore(json.response);
    }
    const object = requireObjectBody(json.body);
    if (!object.ok) {
      return withNoStore(object.response);
    }
    const body = parseHandoffBody(object.value);
    if (!body.ok) {
      return withNoStore(body.response);
    }

    const result = await runHandoffService({
      db: ctx.db,
      owner: ctx.owner,
      requestId: ctx.requestId,
      taskId,
      expectedVersion: ifMatch.expectedVersion,
      idempotencyKey: idempotency.value,
      recipientId: body.value.recipientId,
      acknowledgement: body.value.acknowledgement,
    });

    if (!result.ok) {
      return withNoStore(jsonErrorResponse(result.code, result.message, result.status));
    }

    return NextResponse.json(result.body, {
      status: 200,
      headers: {
        ...NO_STORE,
        ETag: result.etag,
      },
    });
  });
}

function withNoStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
