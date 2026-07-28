import { getAuthenticatedOwner, type AuthenticatedOwner } from '@/lib/auth/require-owner';
import { logDatabaseRuntimeFailure } from '@/lib/db/diagnostics';
import { getDb } from '@/lib/db/server';
import { mapOwnerTaskRouteError, unauthorizedResponse } from '@/lib/http/errors';
import {
  createRequestId,
  elapsedMs,
  emitOperationalLog,
  getRequestId,
  logOperationalFailure,
  monotonicNowMs,
  runWithRequestContext,
  toSafeRouteTemplate,
} from '@/lib/observability';
import type { DbClient } from '@aicaa/db';
import type { OwnerActor } from '@aicaa/domain';
import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';

type ErrorResponse = components['schemas']['ErrorResponse'];

export interface OwnerTaskRouteContext {
  owner: OwnerActor;
  db: DbClient;
  now: string;
  requestId: string;
  authenticated: AuthenticatedOwner;
}

/**
 * Authenticate Owner session and prepare task route context.
 * Capability tokens/headers are not an Owner authorization surface (D059).
 * Reuses the request-scoped requestId when present (P1.1 / D115).
 */
export async function requireOwnerTaskContext(
  request: Request,
): Promise<
  | { ok: true; context: OwnerTaskRouteContext }
  | { ok: false; response: NextResponse<ErrorResponse> }
> {
  void request.headers.get('x-capability-token');
  const authenticated = await getAuthenticatedOwner();
  if (!authenticated) {
    return { ok: false, response: unauthorizedResponse() };
  }
  const requestId = getRequestId() ?? createRequestId();
  return {
    ok: true,
    context: {
      owner: authenticated.actor,
      db: await getDb(),
      now: new Date().toISOString(),
      requestId,
      authenticated,
    },
  };
}

export async function runOwnerTaskRoute(
  request: Request,
  handler: (context: OwnerTaskRouteContext) => Promise<Response>,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const routeTemplate = toSafeRouteTemplate(pathname);

  return runWithRequestContext(
    {
      requestId: createRequestId(),
      routeTemplate,
      operation: 'owner_task_route',
      correlationId: null,
    },
    async () => {
      const started = monotonicNowMs();
      let requestId = getRequestId();

      try {
        const auth = await requireOwnerTaskContext(request);
        if (!auth.ok) {
          emitOperationalLog({
            event: 'operation_timing',
            level: 'info',
            operation: 'owner_task_route',
            routeTemplate,
            requestId,
            durationMs: elapsedMs(started),
            outcome: 'rejected',
          });
          return auth.response;
        }
        requestId = auth.context.requestId;
        const response = await handler(auth.context);
        emitOperationalLog({
          event: 'operation_timing',
          level: 'info',
          operation: 'owner_task_route',
          routeTemplate,
          requestId,
          durationMs: elapsedMs(started),
          outcome: 'ok',
        });
        return response;
      } catch (error) {
        logDatabaseRuntimeFailure(error, {
          routePathname: routeTemplate,
          requestId,
        });
        logOperationalFailure(error, {
          routePathname: routeTemplate,
          operation: 'owner_task_route',
          requestId,
        });
        emitOperationalLog({
          event: 'operation_timing',
          level: 'error',
          operation: 'owner_task_route',
          routeTemplate,
          requestId,
          durationMs: elapsedMs(started),
          outcome: 'error',
        });
        return mapOwnerTaskRouteError(error);
      }
    },
  );
}
