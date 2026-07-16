import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';
import type { DbClient } from '@aicaa/db';
import type { OwnerActor } from '@aicaa/domain';
import { getAuthenticatedOwner, type AuthenticatedOwner } from '@/lib/auth/require-owner';
import { jsonErrorResponse, unauthorizedResponse } from '@/lib/auth/http';
import { logDatabaseRuntimeFailure } from '@/lib/db/diagnostics';
import { getDb } from '@/lib/db/server';
import { GmailConfigError } from './config';
import { GmailRequestError } from './errors';

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
  const requestId = randomUUID();
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
  if (error instanceof GmailRequestError) {
    switch (error.code) {
      case 'unauthorized':
        return unauthorizedResponse(error.message);
      case 'validation':
        return jsonErrorResponse('VALIDATION_ERROR', error.message, 400);
      case 'not_found':
        return jsonErrorResponse('NOT_FOUND', error.message, 404);
      case 'conflict':
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
  let requestId: string | undefined;
  try {
    const auth = await requireOwnerGmailContext(request);
    if (!auth.ok) {
      return auth.response;
    }
    requestId = auth.context.requestId;
    return await handler(auth.context);
  } catch (error) {
    logDatabaseRuntimeFailure(error, { routePathname: pathname, requestId });
    return mapGmailRequestError(error);
  }
}
