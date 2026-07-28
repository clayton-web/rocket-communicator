import 'server-only';
import { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';
import type { DbClient } from '@aicaa/db';
import type { OwnerActor } from '@aicaa/domain';
import { getAuthenticatedOwner, type AuthenticatedOwner } from '@/lib/auth/require-owner';
import { jsonErrorResponse, unauthorizedResponse } from '@/lib/auth/http';
import { logDatabaseRuntimeFailure } from '@/lib/db/diagnostics';
import { getDb } from '@/lib/db/server';
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
import { GmailConfigError } from './config';
import { GmailRequestError } from './errors';
import { GmailSyncError } from './sync-errors';

type ErrorResponse = components['schemas']['ErrorResponse'];

export interface OwnerGmailRouteContext {
  owner: OwnerActor;
  db: DbClient;
  now: string;
  requestId: string;
  authenticated: AuthenticatedOwner;
}

export async function requireOwnerGmailContext(
  request: Request,
): Promise<
  | { ok: true; context: OwnerGmailRouteContext }
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

export function mapGmailRequestError(error: unknown): NextResponse<ErrorResponse> {
  if (error instanceof GmailSyncError) {
    if (error.code === 'lock_conflict') {
      return jsonErrorResponse('DOMAIN_CONFLICT', error.message, 409);
    }
    if (error.code === 'configuration_error') {
      return jsonErrorResponse('INTERNAL_ERROR', 'Gmail is not configured.', 500);
    }
    return jsonErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
  }
  if (error instanceof GmailRequestError) {
    switch (error.code) {
      case 'unauthorized':
        return unauthorizedResponse(error.message);
      case 'validation':
        return jsonErrorResponse('VALIDATION_ERROR', error.message, 400);
      case 'not_found':
        return jsonErrorResponse('NOT_FOUND', error.message, 404);
      case 'conflict':
      case 'lock_conflict':
        return jsonErrorResponse('DOMAIN_CONFLICT', error.message, 409);
      case 'configuration_error':
        return jsonErrorResponse('INTERNAL_ERROR', 'Gmail is not configured.', 500);
      default:
        return jsonErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
    }
  }
  if (error instanceof GmailConfigError) {
    return jsonErrorResponse('INTERNAL_ERROR', 'Gmail is not configured.', 500);
  }
  return jsonErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
}

export async function runOwnerGmailRoute(
  request: Request,
  handler: (context: OwnerGmailRouteContext) => Promise<Response>,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const routeTemplate = toSafeRouteTemplate(pathname);

  return runWithRequestContext(
    {
      requestId: createRequestId(),
      routeTemplate,
      operation: 'owner_gmail_route',
      correlationId: null,
    },
    async () => {
      const started = monotonicNowMs();
      let requestId = getRequestId();
      try {
        const auth = await requireOwnerGmailContext(request);
        if (!auth.ok) {
          emitOperationalLog({
            event: 'operation_timing',
            level: 'info',
            operation: 'owner_gmail_route',
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
          operation: 'owner_gmail_route',
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
          operation: 'owner_gmail_route',
          requestId,
        });
        emitOperationalLog({
          event: 'operation_timing',
          level: 'error',
          operation: 'owner_gmail_route',
          routeTemplate,
          requestId,
          durationMs: elapsedMs(started),
          outcome: 'error',
        });
        return mapGmailRequestError(error);
      }
    },
  );
}
