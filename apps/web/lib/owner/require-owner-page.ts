import 'server-only';
import { redirect } from 'next/navigation';
import { getAuthenticatedOwner, type AuthenticatedOwner } from '@/lib/auth/require-owner';
import { resolveSafeNextPath } from '@/lib/auth/safe-next-path';

/**
 * Hard Owner gate for RSC pages. Never renders protected content when unauthenticated.
 */
export async function requireOwnerPage(returnPath: string): Promise<AuthenticatedOwner> {
  const owner = await getAuthenticatedOwner();
  if (!owner) {
    const safe = resolveSafeNextPath(returnPath, '/tasks');
    redirect(`/login?next=${encodeURIComponent(safe)}`);
  }
  return owner;
}
