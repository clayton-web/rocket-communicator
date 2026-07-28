import type { DbClient } from '@aicaa/db';
import type { components } from '@aicaa/contracts/schema';
import type { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/server';
import { getCapabilityTokenConfig } from './config';
import { mapRecipientCapabilityRouteError } from '@/lib/http/errors';
import { jsonErrorResponse } from '@/lib/auth/http';
import { assertTaskId } from '@/lib/http/request';
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
import { logDatabaseRuntimeFailure } from '@/lib/db/diagnostics';

type ErrorResponse = components['schemas']['ErrorResponse'];

export interface RecipientCapabilityRouteContext {
  db: DbClient;
  pepper: string;
  now: string;
  requestId: string;
  rawToken: string;
  taskId: string;
}

/**
 * Prepare Recipient capability route context from path token only.
 * Does not require or consult Owner session (D049, D050, D059).
 * Does not read X-Capability-Token. Never logs the raw token.
 */
export async function requireRecipientCapabilityContext(
  request: Request,
  params: Promise<{ token: string; taskId: string }>,
): Promise<
  | { ok: true; context: RecipientCapabilityRouteContext }
  | { ok: false; response: NextResponse<ErrorResponse> }
> {
  // Explicitly ignore Owner session headers / alternate capability header surfaces.
  void request.headers.get('authorization');
  void request.headers.get('cookie');
  void request.headers.get('x-capability-token');

  const { token, taskId } = await params;
  const idCheck = assertTaskId(taskId);
  if (!idCheck.ok) {
    return idCheck;
  }

  const rawToken = typeof token === 'string' ? token : '';
  if (rawToken.length < 32 || rawToken.length > 256) {
    return {
      ok: false,
      response: jsonErrorResponse('UNAUTHORIZED', 'Capability token is invalid.', 401),
    };
  }

  try {
    const config = getCapabilityTokenConfig();
    return {
      ok: true,
      context: {
        db: await getDb(),
        pepper: config.pepper,
        now: new Date().toISOString(),
        requestId: getRequestId() ?? createRequestId(),
        rawToken,
        taskId,
      },
    };
  } catch (error) {
    return { ok: false, response: mapRecipientCapabilityRouteError(error) };
  }
}

export async function runRecipientCapabilityRoute(
  request: Request,
  params: Promise<{ token: string; taskId: string }>,
  handler: (context: RecipientCapabilityRouteContext) => Promise<Response>,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  // D114: never put the raw token-bearing path into diagnostics.
  const routeTemplate = toSafeRouteTemplate(pathname);

  return runWithRequestContext(
    {
      requestId: createRequestId(),
      routeTemplate,
      operation: 'recipient_capability_route',
      correlationId: null,
    },
    async () => {
      const started = monotonicNowMs();
      let requestId = getRequestId();
      try {
        const prepared = await requireRecipientCapabilityContext(request, params);
        if (!prepared.ok) {
          emitOperationalLog({
            event: 'operation_timing',
            level: 'info',
            operation: 'recipient_capability_route',
            routeTemplate,
            requestId,
            durationMs: elapsedMs(started),
            outcome: 'rejected',
          });
          return prepared.response;
        }
        requestId = prepared.context.requestId;
        const response = await handler(prepared.context);
        emitOperationalLog({
          event: 'operation_timing',
          level: 'info',
          operation: 'recipient_capability_route',
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
          operation: 'recipient_capability_route',
          requestId,
        });
        emitOperationalLog({
          event: 'operation_timing',
          level: 'error',
          operation: 'recipient_capability_route',
          routeTemplate,
          requestId,
          durationMs: elapsedMs(started),
          outcome: 'error',
        });
        return mapRecipientCapabilityRouteError(error);
      }
    },
  );
}
