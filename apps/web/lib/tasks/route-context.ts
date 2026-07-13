import { randomUUID } from 'node:crypto';
import { getAuthenticatedOwner, type AuthenticatedOwner } from '@/lib/auth/require-owner';
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

export async function runOwnerTaskRoute(
  request: Request,
  handler: (context: OwnerTaskRouteContext) => Promise<Response>,
): Promise<Response> {
  try {
    const auth = await requireOwnerTaskContext(request);
    if (!auth.ok) {
      return auth.response;
    }
    return await handler(auth.context);
  } catch (error) {
    return mapOwnerTaskRouteError(error);
  }
}
