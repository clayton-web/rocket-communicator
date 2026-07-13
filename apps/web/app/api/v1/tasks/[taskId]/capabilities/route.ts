import {
  buildCapabilityPath,
  getCapabilityTokenConfig,
  issueCapabilityForTask,
} from '@/lib/capability';
import { runOwnerTaskRoute } from '@/lib/tasks/route-context';
import { parseIssueCapabilityBody } from '@/lib/tasks/validate-body';
import { parseTaskIfMatch } from '@/lib/http/etag';
import { assertTaskId, readJsonBody, requireObjectBody } from '@/lib/http/request';
import { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';

type IssuedCapabilityLink = components['schemas']['IssuedCapabilityLink'];
type IssueTaskCapabilityRequest = components['schemas']['IssueTaskCapabilityRequest'];

/**
 * Optional request body (OpenAPI IssueTaskCapabilityRequest).
 * No Content-Type / no body → accepted.
 * application/json → parsed; malformed JSON → 400.
 */
async function readOptionalIssueBody(
  request: Request,
): Promise<{ ok: true; value: IssueTaskCapabilityRequest } | { ok: false; response: Response }> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return { ok: true, value: {} };
  }
  const json = await readJsonBody(request);
  if (!json.ok) {
    return json;
  }
  if (json.body === null || json.body === undefined) {
    return { ok: true, value: {} };
  }
  const object = requireObjectBody(json.body);
  if (!object.ok) {
    return object;
  }
  return parseIssueCapabilityBody(object.value);
}

/**
 * POST /api/v1/tasks/{taskId}/capabilities
 * Thin Owner-authenticated wrapper around Phase 3 issueCapabilityForTask (D055–D063).
 */
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

    const optional = await readOptionalIssueBody(request);
    if (!optional.ok) {
      return optional.response;
    }

    // Config load fails closed with generic 500 (pepper / TTL never exposed).
    const config = getCapabilityTokenConfig();

    const result = await issueCapabilityForTask({
      db: ctx.db,
      owner: ctx.owner,
      taskId,
      now: ctx.now,
      expectedVersion: ifMatch.expectedVersion,
      requestId: ctx.requestId,
      ttlMs: config.ttlMs,
      pepper: config.pepper,
      appUrl: config.appUrl,
      scope: optional.value.scope,
    });

    const body: IssuedCapabilityLink = {
      capabilityId: result.capability.id,
      taskId: result.capability.taskId,
      assignmentId: result.capability.assignmentId,
      expiresAt: result.capability.expiresAt,
      token: result.rawToken,
      capabilityPath: buildCapabilityPath(result.rawToken),
    };

    // OpenAPI issueTaskCapability 201: IssuedCapabilityLink body only — no HTTP ETag header.
    return NextResponse.json(body, { status: 201 });
  });
}
