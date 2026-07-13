import type { components } from '@aicaa/contracts/schema';
import { asOrganizationId, asOwnerId, ownerActor, type OwnerActor } from '@aicaa/domain';
import type { User } from '@supabase/supabase-js';

export type SessionDto = components['schemas']['Session'];

export function mapDisplayName(user: Pick<User, 'email' | 'user_metadata'>): string {
  const fullName = user.user_metadata?.full_name;
  if (typeof fullName === 'string' && fullName.trim()) {
    return fullName.trim();
  }

  if (user.email) {
    const localPart = user.email.split('@')[0]?.trim();
    if (localPart) {
      return localPart;
    }
    return user.email;
  }

  return 'Owner';
}

export function mapSupabaseUserToSession(user: User, organizationId: string): SessionDto {
  return {
    ownerId: user.id,
    organizationId,
    role: 'owner',
    displayName: mapDisplayName(user),
  };
}

export function mapSupabaseUserToOwnerActor(user: User, organizationId: string): OwnerActor {
  return ownerActor(asOwnerId(user.id), asOrganizationId(organizationId));
}
