import type { OrganizationId, UserId } from './ids.js';

export type UserRole = 'primary' | 'administrator';

export interface ActorContext {
  userId: UserId;
  organizationId: OrganizationId;
  role: UserRole;
}

export function isPrimary(actor: ActorContext): boolean {
  return actor.role === 'primary';
}

export function isAdministrator(actor: ActorContext): boolean {
  return actor.role === 'administrator';
}
