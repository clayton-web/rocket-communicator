import type { AssignmentId, CapabilityId, RecipientId, TaskId } from '../types/ids.js';
import type { UtcInstant } from '../types/timestamps.js';

export type CapabilityAction =
  | 'view_assigned_task'
  | 'complete_task'
  | 'mark_task_waiting'
  | 'add_task_note'
  | 'record_completion_outcome'
  | 'return_task_to_owner'
  | 'request_clarification';

export type CapabilityStatus = 'active' | 'revoked' | 'expired' | 'used';

export type CapabilityScope = CapabilityAction[];

export type AssignmentDeliveryStatus = 'pending' | 'sent' | 'failed';

export interface TaskCapability {
  id: CapabilityId;
  taskId: TaskId;
  assignmentId: AssignmentId;
  recipientId?: RecipientId;
  intendedRecipientEmail: string;
  scope: CapabilityScope;
  status: CapabilityStatus;
  issuedAt: UtcInstant;
  expiresAt: UtcInstant;
  revokedAt?: UtcInstant | null;
  lastUsedAt?: UtcInstant | null;
}

export interface CapabilityAuditContext {
  capabilityId: CapabilityId;
  assignmentId: AssignmentId;
  taskId: TaskId;
  intendedRecipientEmail: string;
  action: CapabilityAction;
  recordedAt: UtcInstant;
  note?: string;
  requestId?: string;
  correlationId?: string | null;
  attributionLabel?: string;
}

export interface OwnerAuditContext {
  ownerId: string;
  recordedAt: UtcInstant;
  requestId?: string;
  correlationId?: string | null;
}

export type ActionAttribution =
  | { kind: 'owner'; owner: OwnerAuditContext }
  | { kind: 'capability'; capability: CapabilityAuditContext };

export function capabilityAttributionLabel(email: string, action: CapabilityAction): string {
  return `Action submitted through link sent to ${email} (${action.replaceAll('_', ' ')})`;
}

export function formatCapabilityAuditContext(
  actor: CapabilityActorContext,
  action: CapabilityAction,
  recordedAt: UtcInstant,
): CapabilityAuditContext {
  return {
    capabilityId: actor.capabilityId,
    assignmentId: actor.assignmentId,
    taskId: actor.taskId,
    intendedRecipientEmail: actor.intendedRecipientEmail,
    action,
    recordedAt,
    attributionLabel: capabilityAttributionLabel(actor.intendedRecipientEmail, action),
  };
}

export interface CapabilityActorContext {
  capabilityId: CapabilityId;
  taskId: TaskId;
  assignmentId: AssignmentId;
  intendedRecipientEmail: string;
}
