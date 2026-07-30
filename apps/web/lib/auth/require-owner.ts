import { AuthConfigError } from '@/lib/auth/errors';
import { getAuthConfig } from '@/lib/auth/config';
import { isWorkspaceDomainPermitted, workspaceIdentityFromUser } from '@/lib/auth/domain-allowlist';
import { mapSupabaseUserToOwnerActor, mapSupabaseUserToSession } from '@/lib/auth/session';
import { getRequestContext, type RequestDiagnosticContext } from '@/lib/observability';
import { createClient } from '@/lib/supabase/server';
import type { OwnerActor } from '@aicaa/domain';
import type { SessionDto } from '@/lib/auth/session';
import type { User } from '@supabase/supabase-js';

export interface AuthenticatedOwner {
  user: User;
  actor: OwnerActor;
  session: SessionDto;
}

/**
 * Request-scoped resolution memo (P1.3).
 *
 * Keyed by the per-request context object, which `runWithRequestContext` creates fresh
 * for every request, so an entry cannot outlive or escape its request: when the context
 * is collected the entry goes with it, and a request that never entered a context is
 * simply not memoized. This coalesces repeated `getAuthenticatedOwner()` calls inside one
 * route or RSC execution; it does **not** and cannot span the proxy/route boundary, which
 * may run in a different runtime context.
 */
const ownerByRequest = new WeakMap<RequestDiagnosticContext, Promise<AuthenticatedOwner | null>>();

/**
 * Resolve the Owner for the current request.
 *
 * Identity is always established by a server-verified `auth.getUser()` call; the cookie
 * session is never trusted on its own, and no caller-supplied identity is accepted.
 */
export async function getAuthenticatedOwner(): Promise<AuthenticatedOwner | null> {
  const requestContext = getRequestContext();
  if (!requestContext) {
    return resolveAuthenticatedOwner();
  }

  const memoized = ownerByRequest.get(requestContext);
  if (memoized) {
    return memoized;
  }

  const pending = resolveAuthenticatedOwner();
  ownerByRequest.set(requestContext, pending);
  // A failed resolution must not poison the rest of the request.
  void pending.catch(() => {
    ownerByRequest.delete(requestContext);
  });
  return pending;
}

async function resolveAuthenticatedOwner(): Promise<AuthenticatedOwner | null> {
  let config;
  try {
    config = getAuthConfig();
  } catch {
    return null;
  }

  const supabase = await createClient();

  // A corrupted or foreign `sb-*-auth-token` cookie makes the Supabase cookie storage
  // throw while decoding rather than report an auth error, so an unreadable cookie must
  // be treated as "no session" here. Anything other than a verified user is a rejection,
  // and failing closed keeps a bad cookie from turning every Owner request into a 500 the
  // signed-out user cannot clear.
  let user: User | null = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.error ? null : result.data.user;
  } catch {
    return null;
  }

  if (!user) {
    return null;
  }

  const allowlist = isWorkspaceDomainPermitted(
    workspaceIdentityFromUser(user),
    config.ownerWorkspaceDomain,
  );
  if (!allowlist.permitted) {
    return null;
  }

  return {
    user,
    actor: mapSupabaseUserToOwnerActor(user, config.ownerOrganizationId),
    session: mapSupabaseUserToSession(user, config.ownerOrganizationId),
  };
}

export async function requireOwnerSession(): Promise<SessionDto | null> {
  const owner = await getAuthenticatedOwner();
  return owner?.session ?? null;
}

export { AuthConfigError };
