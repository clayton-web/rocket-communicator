import 'server-only';
import { randomUUID } from 'node:crypto';
import { getAuthenticatedOwner, type AuthenticatedOwner } from '@/lib/auth/require-owner';
import { logDatabaseRuntimeFailure } from '@/lib/db/diagnostics';
import { getDb } from '@/lib/db/server';
import { mapOwnerRecipientRouteError, unauthorizedResponse } from '@/lib/http/errors';
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
      requestId: randomUUID(),
      authenticated,
    },
  };
}

export async function runOwnerRecipientRoute(
  request: Request,
  handler: (context: OwnerRecipientRouteContext) => Promise<Response>,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  let requestId: string | undefined;
  try {
    const auth = await requireOwnerRecipientContext(request);
    if (!auth.ok) {
      return auth.response;
    }
    requestId = auth.context.requestId;
    return await handler(auth.context);
  } catch (error) {
    logDatabaseRuntimeFailure(error, { routePathname: pathname, requestId });
    return mapOwnerRecipientRouteError(error);
  }
}
