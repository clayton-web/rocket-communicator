import 'server-only';
import { getAuthenticatedOwner } from '@/lib/auth/require-owner';

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
 * Resolve the shell's view of the Owner.
 *
 * Performs no database work and emits no timing event. The absence of a timing event is
 * intentional: P1.1 diagnostics treat `owner_authentication` as one event per Owner page
 * request, and emitting a second one here would make the shell look like duplicate
 * authentication in exactly the diagnostic that P1.3 used to prove it had been eliminated.
 *
 * This never redirects. An expired session mid-navigation must be handled by the page's
 * `requireOwnerPage`, which knows the return path and can send the Owner back to where they
 * were; a redirect from the shell would lose that and could fight the page's own redirect.
 * The shell simply renders chrome without an identity, and the page's gate decides.
 */
export async function loadOwnerShellIdentity(): Promise<OwnerShellIdentity> {
  const owner = await getAuthenticatedOwner();

  return { displayName: owner?.session.displayName ?? null };
}
