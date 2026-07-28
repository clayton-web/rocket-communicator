import 'server-only';
import { getAuthenticatedOwner, type AuthenticatedOwner } from '@/lib/auth/require-owner';
import { logDatabaseRuntimeFailure } from '@/lib/db/diagnostics';
import { getDb } from '@/lib/db/server';
import { mapOwnerRecipientRouteError, unauthorizedResponse } from '@/lib/http/errors';
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

export interface OwnerRecipientRouteContext {
  owner: OwnerActor;
  db: DbClient;
  now: string;
  requestId: string;
  authenticated: AuthenticatedOwner;
}

/**
 * Authenticate the Owner session and prepare Recipient route context (A7.6).
 * Organization and Owner identity come only from the trusted session; capability tokens are
 * never an Owner authorization surface (D059).
 * Reuses the request-scoped requestId when present (P1.1 / D115).
 */
export async function requireOwnerRecipientContext(
  request: Request,
): Promise<
  | { ok: true; context: OwnerRecipientRouteContext }
  | { ok: false; response: NextResponse<ErrorResponse> }
> {
  void request.headers.get('x-capability-token');
  const authenticated = await getAuthenticatedOwner();
  if (!authenticated) {
    return { ok: false, response: unauthorizedResponse() };
  }
  return {
    ok: true,
    context: {
      owner: authenticated.actor,
      db: await getDb(),
      now: new Date().toISOString(),
      requestId: getRequestId() ?? createRequestId(),
      authenticated,
    },
  };
}

export async function runOwnerRecipientRoute(
  request: Request,
  handler: (context: OwnerRecipientRouteContext) => Promise<Response>,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const routeTemplate = toSafeRouteTemplate(pathname);

  return runWithRequestContext(
    {
      requestId: createRequestId(),
      routeTemplate,
      operation: 'owner_recipient_route',
      correlationId: null,
    },
    async () => {
      const started = monotonicNowMs();
      let requestId = getRequestId();
      try {
        const auth = await requireOwnerRecipientContext(request);
        if (!auth.ok) {
          emitOperationalLog({
            event: 'operation_timing',
            level: 'info',
            operation: 'owner_recipient_route',
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
          operation: 'owner_recipient_route',
          routeTemplate,
          requestId,
          durationMs: elapsedMs(started),
          outcome: 'ok',
        });
        return response;
      } catch (error) {
        logDatabaseRuntimeFailure(error, { routePathname: routeTemplate, requestId });
        logOperationalFailure(error, {
          routePathname: routeTemplate,
          operation: 'owner_recipient_route',
          requestId,
        });
        emitOperationalLog({
          event: 'operation_timing',
          level: 'error',
          operation: 'owner_recipient_route',
          routeTemplate,
          requestId,
          durationMs: elapsedMs(started),
          outcome: 'error',
        });
        return mapOwnerRecipientRouteError(error);
      }
    },
  );
}
