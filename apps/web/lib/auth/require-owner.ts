import { cache } from 'react';
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
 * Render-pass resolution memo (P1.4).
 *
 * The P1.3 memo above is keyed by the request diagnostic context, which each page creates
 * inside its own `runWithRequestContext` call. The P1.4 Owner shell is a *layout*, and a
 * layout renders outside the page's context, so it would miss that memo entirely and spend
 * a second verified `getUser()` — breaking the D119 one-call-per-page-request gate.
 *
 * React's `cache` closes exactly that gap: its scope is one server render pass, which
 * spans the layout and the page of a single request and nothing else. It is deliberately
 * *not* a cache in the ordinary sense — there is no TTL, no key beyond the arguments, and
 * no way for an entry to outlive the render that created it, so no cross-request caching
 * is introduced. Outside a render (route handlers, the proxy, Vitest) React's `cache` is a
 * pass-through, which is why the request-context memo above remains the deduplication
 * mechanism there rather than being replaced by this one.
 *
 * Evidence: `apps/web/__tests__/p1-4-shell-auth.test.ts` for the composition and isolation
 * properties, and `apps/web/e2e/specs/owner-shell-auth.spec.ts`, which counts real
 * `GET /auth/v1/user` requests arriving at the Supabase Auth double while the real Next.js
 * runtime renders layout plus page.
 */
const resolveOwnerForRenderPass = cache(resolveAuthenticatedOwner);

/**
 * Resolve the Owner for the current request.
 *
 * Identity is always established by a server-verified `auth.getUser()` call; the cookie
 * session is never trusted on its own, and no caller-supplied identity is accepted.
 */
export async function getAuthenticatedOwner(): Promise<AuthenticatedOwner | null> {
  const requestContext = getRequestContext();
  if (!requestContext) {
    return resolveOwnerForRenderPass();
  }

  const memoized = ownerByRequest.get(requestContext);
  if (memoized) {
    return memoized;
  }

  // Routed through the render-pass memo as well, so a page running inside a request context
  // reuses whatever the surrounding shell layout already resolved instead of re-verifying.
  const pending = resolveOwnerForRenderPass();
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
