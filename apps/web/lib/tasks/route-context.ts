import { randomUUID } from 'node:crypto';
import { getAuthenticatedOwner, type AuthenticatedOwner } from '@/lib/auth/require-owner';
import { logDatabaseRuntimeFailure } from '@/lib/db/diagnostics';
import { getDb } from '@/lib/db/server';
import { mapOwnerTaskRouteError, unauthorizedResponse } from '@/lib/http/errors';
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
  return {
    ok: true,
    context: {
      owner: authenticated.actor,
      db: getDb(),
      now: new Date().toISOString(),
      requestId: randomUUID(),
      authenticated,
    },
  };
}

function routePathname(request: Request): string {
  return new URL(request.url).pathname;
}

export async function runOwnerTaskRoute(
  request: Request,
  handler: (context: OwnerTaskRouteContext) => Promise<Response>,
): Promise<Response> {
  const pathname = routePathname(request);
  let requestId: string | undefined;

  try {
    const auth = await requireOwnerTaskContext(request);
    if (!auth.ok) {
      return auth.response;
    }
    requestId = auth.context.requestId;
    return await handler(auth.context);
  } catch (error) {
    logDatabaseRuntimeFailure(error, {
      routePathname: pathname,
      requestId,
    });
    return mapOwnerTaskRouteError(error);
  }
}
