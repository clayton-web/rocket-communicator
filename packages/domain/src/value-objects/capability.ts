import type { AssignmentId, CapabilityId, RecipientId, TaskId } from '../types/ids.js';
import type { UtcInstant } from '../types/timestamps.js';
import { addMilliseconds, MS_PER_DAY } from '../types/timestamps.js';
import { validationError } from '../errors/domain-errors.js';

export type CapabilityAction =
  | 'view_assigned_task'
  | 'complete_task'
  | 'mark_task_waiting'
  | 'add_task_note'
  | 'record_completion_outcome'
  | 'return_task_to_owner'
  | 'request_clarification'
  | 'submit_work_request';

/** Lifecycle status. A4 must not invent transitions into `used` (D056). */
export type CapabilityStatus = 'active' | 'revoked' | 'expired' | 'used';

/**
 * Why a capability became unusable (D086). Persistence (A7.3+) must retain enough
 * information to distinguish `superseded` from other revocation reasons.
 * Public mapping: only matched `superseded` → `CAPABILITY_NO_LONGER_ACTIVE`;
 * all other unusable cases → generic `UNAUTHORIZED` (reasons are not generally exposed).
 */
export type CapabilityRevocationReason = 'superseded' | 'manual' | 'assignment_ended' | 'expired';

export type CapabilityScope = CapabilityAction[];

export type AssignmentDeliveryStatus = 'pending' | 'sent' | 'failed';
/** Default Recipient scope for issued capabilities (STATE_MACHINE / D050 / D061). */
export const DEFAULT_RECIPIENT_CAPABILITY_SCOPE: CapabilityScope = [
  'view_assigned_task',
  'complete_task',
  'mark_task_waiting',
  'add_task_note',
  'return_task_to_owner',
  'request_clarification',
  'submit_work_request',
];

/**
 * Documented seven-day default TTL (D055). Callers/config must inject this (or another
 * positive duration) into `issueTaskCapability`; the domain does not silently apply it.
 */
export const DEFAULT_CAPABILITY_TTL_MS = 7 * MS_PER_DAY;

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
  /**
   * Domain revocation reason (D086). Optional until A7.3 persistence stores it.
   * Do not expose raw internal reason strings on public API error envelopes.
   */
  revocationReason?: CapabilityRevocationReason | null;
}

export interface CapabilityAuditContext {
  capabilityId: CapabilityId;
  assignmentId: AssignmentId;
  taskId: TaskId;
  intendedRecipientEmail: string;
  action: CapabilityAction;
  recordedAt: UtcInstant;
  outcome: 'succeeded' | 'denied' | 'failed';
  resourceVersion?: number;
  taskStatus?: string;
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

export interface CapabilityActorContext {
  capabilityId: CapabilityId;
  taskId: TaskId;
  assignmentId: AssignmentId;
  intendedRecipientEmail: string;
}

export interface CapabilityAuditOptions {
  outcome?: CapabilityAuditContext['outcome'];
  resourceVersion?: number;
  taskStatus?: string;
  requestId?: string;
  correlationId?: string | null;
  note?: string;
}

export function capabilityAttributionLabel(email: string, action: CapabilityAction): string {
  return `Action performed through capability link assigned to ${email} (${action.replaceAll('_', ' ')})`;
}

export function formatCapabilityAuditContext(
  actor: CapabilityActorContext,
  action: CapabilityAction,
  recordedAt: UtcInstant,
  options: CapabilityAuditOptions = {},
): CapabilityAuditContext {
  return {
    capabilityId: actor.capabilityId,
    assignmentId: actor.assignmentId,
    taskId: actor.taskId,
    intendedRecipientEmail: actor.intendedRecipientEmail,
    action,
    recordedAt,
    outcome: options.outcome ?? 'succeeded',
    resourceVersion: options.resourceVersion,
    taskStatus: options.taskStatus,
    note: options.note,
    requestId: options.requestId,
    correlationId: options.correlationId,
    attributionLabel: capabilityAttributionLabel(actor.intendedRecipientEmail, action),
  };
}

export function computeCapabilityExpiresAt(
  issuedAt: UtcInstant,
  ttlMs: number = DEFAULT_CAPABILITY_TTL_MS,
): UtcInstant {
  if (ttlMs <= 0) {
    throw validationError('Capability TTL must be a positive duration.');
  }
  return addMilliseconds(issuedAt, ttlMs);
}
