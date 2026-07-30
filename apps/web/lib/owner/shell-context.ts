import 'server-only';
import type { AuthenticatedOwner } from '@/lib/auth/require-owner';

/**
 * Owner identity for the application shell (P1.4).
 *
 * Deliberately narrow: the shell shows who is signed in, so it needs a display name and
 * nothing else. It must not receive the Owner actor, organization id, or user record —
 * chrome has no business carrying identifiers it does not render, and keeping the surface
 * this small is what makes "no protected Task data appears in chrome" assertable.
 */
export interface OwnerShellIdentity {
  /** `null` when no valid Owner session resolved; the shell then renders no identity. */
  displayName: string | null;
}

/**
 * Narrow an already-resolved Owner down to what the shell may render.
 *
 * Takes the Owner rather than resolving one (P1.5). The shell layout now gates the request
 * itself, so it already holds the authenticated Owner by the time it renders chrome, and
 * resolving again here — even through the render-pass memo, which would return the same
 * promise — would state in code that the shell is an independent identity consumer when it
 * is not. Passing the value in makes the single resolution visible at the call site.
 *
 * Performs no database work and emits no timing event. The absence of a timing event is
 * intentional: P1.1 diagnostics treat `owner_authentication` as one event per Owner page
 * request, and emitting a second one here would make the shell look like duplicate
 * authentication in exactly the diagnostic that P1.3 used to prove it had been eliminated.
 */
export function ownerShellIdentity(owner: AuthenticatedOwner | null): OwnerShellIdentity {
  return { displayName: owner?.session.displayName ?? null };
}
