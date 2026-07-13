import type { CapabilityAction, CapabilityStatus } from '../value-objects/capability.js';
import type { AssignmentId, CapabilityId, OrganizationId, OwnerId, TaskId } from './ids.js';
import type { UtcInstant } from './timestamps.js';

export type AuthenticatedRole = 'owner';

export interface OwnerActor {
  kind: 'owner';
  ownerId: OwnerId;
  organizationId: OrganizationId;
}

export interface CapabilityActor {
  kind: 'capability';
  capabilityId: CapabilityId;
  taskId: TaskId;
  assignmentId: AssignmentId;
  intendedRecipientEmail: string;
  allowedActions: CapabilityAction[];
  status: CapabilityStatus;
  expiresAt: UtcInstant;
}

export interface SystemActor {
  kind: 'system';
  systemId: string;
}

export type Actor = OwnerActor | CapabilityActor | SystemActor;

export function isOwner(actor: Actor): actor is OwnerActor {
  return actor.kind === 'owner';
}

export function isCapability(actor: Actor): actor is CapabilityActor {
  return actor.kind === 'capability';
}

export function isSystem(actor: Actor): actor is SystemActor {
  return actor.kind === 'system';
}

export function ownerActor(ownerId: OwnerId, organizationId: OrganizationId): OwnerActor {
  return { kind: 'owner', ownerId, organizationId };
}
