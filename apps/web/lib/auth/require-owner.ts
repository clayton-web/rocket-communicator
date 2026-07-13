import { AuthConfigError } from '@/lib/auth/errors';
import { getAuthConfig } from '@/lib/auth/config';
import { isWorkspaceDomainPermitted, workspaceIdentityFromUser } from '@/lib/auth/domain-allowlist';
import { mapSupabaseUserToOwnerActor, mapSupabaseUserToSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import type { OwnerActor } from '@aicaa/domain';
import type { SessionDto } from '@/lib/auth/session';
import type { User } from '@supabase/supabase-js';

export interface AuthenticatedOwner {
  user: User;
  actor: OwnerActor;
  session: SessionDto;
}

export async function getAuthenticatedOwner(): Promise<AuthenticatedOwner | null> {
  let config;
  try {
    config = getAuthConfig();
  } catch {
    return null;
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
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
