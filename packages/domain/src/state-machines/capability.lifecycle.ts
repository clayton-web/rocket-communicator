import type { Actor } from '../types/actor.js';
import { assertCan, assertOwner } from '../policies/capabilities.js';
import { invalidTransition, validationError } from '../errors/domain-errors.js';
import type { Task } from '../entities/task.js';
import type {
  TaskCapability,
  CapabilityScope,
  CapabilityRevocationReason,
} from '../value-objects/capability.js';
import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  computeCapabilityExpiresAt,
} from '../value-objects/capability.js';
import type { CapabilityId, RecipientId } from '../types/ids.js';
import type { UtcInstant } from '../types/timestamps.js';

export interface IssueCapabilityContext {
  actor: Actor;
  now: UtcInstant;
  capabilityId: CapabilityId;
  /**
   * TTL must be injected by configuration / application layer (D055).
   * Domain exposes `DEFAULT_CAPABILITY_TTL_MS` as the documented seven-day default
   * for callers to pass; it is not applied unless explicitly supplied.
   */
  ttlMs: number;
  scope?: CapabilityScope;
  recipientId?: RecipientId;
}

/**
 * Issue an active task capability bound to the current assignment (D055, D056, D063 domain rules).
 * Does not generate, hash, or return raw secrets — those belong to runtime (out of Phase 1).
 */
export function issueTaskCapability(
  task: Task,
  context: IssueCapabilityContext,
): { task: Task; capability: TaskCapability } {
  assertOwner(context.actor);
  assertCan(context.actor, 'issue_task_capability', task, context.now);

  if (!task.assignment) {
    throw invalidTransition('Task must be assigned before issuing a capability.');
  }

  const ttlMs = context.ttlMs;
  if (ttlMs <= 0) {
    throw validationError('Capability TTL must be a positive duration.');
  }

  const baseScope =
    context.scope && context.scope.length > 0
      ? context.scope
      : task.assignment.allowedCapabilityActions.length > 0
        ? task.assignment.allowedCapabilityActions
        : DEFAULT_RECIPIENT_CAPABILITY_SCOPE;

  // View is required for GET /c/[token] non-mutating access (D050, D059).
  const scope: CapabilityScope = baseScope.includes('view_assigned_task')
    ? baseScope
    : ['view_assigned_task', ...baseScope];

  const capability: TaskCapability = {
    id: context.capabilityId,
    taskId: task.id,
    assignmentId: task.assignment.id,
    recipientId: context.recipientId ?? task.assignment.recipientId,
    intendedRecipientEmail: task.assignment.intendedRecipientEmail,
    scope,
    status: 'active',
    issuedAt: context.now,
    expiresAt: computeCapabilityExpiresAt(context.now, ttlMs),
    revokedAt: null,
  };

  const updatedTask: Task = {
    ...task,
    assignment: {
      ...task.assignment,
      allowedCapabilityActions: scope,
      capabilityStatus: 'active',
      activeCapabilityId: capability.id,
    },
    version: task.version + 1,
    updatedAt: context.now,
  };

  return { task: updatedTask, capability };
}

/**
 * Revoke an active (or expire-pending) capability. Does not invent `used` semantics (D056).
 * Pass `superseded` for reassignment / explicit re-forward (D086); `manual` for admin revoke;
 * `assignment_ended` when the assignment relationship ends (e.g. return to Owner).
 */
export function revokeCapability(
  capability: TaskCapability,
  now: UtcInstant,
  reason: CapabilityRevocationReason = 'manual',
): TaskCapability {
  if (capability.status === 'revoked') {
    return capability.revocationReason != null
      ? capability
      : { ...capability, revocationReason: reason };
  }
  return {
    ...capability,
    status: 'revoked',
    revokedAt: now,
    revocationReason: reason,
  };
}

/**
 * Persist expired status when wall-clock has passed expiresAt.
 * Callers that only gate access may rely on isCapabilityActive without this transition.
 */
export function markCapabilityExpired(capability: TaskCapability, now: UtcInstant): TaskCapability {
  if (capability.status === 'revoked' || capability.status === 'expired') {
    return capability;
  }
  if (capability.expiresAt > now) {
    throw invalidTransition('Capability has not reached expiresAt.');
  }
  return {
    ...capability,
    status: 'expired',
    revocationReason: 'expired',
  };
}

/**
 * Invalidate capability when assignment is removed or replaced (D056).
 * Application/persistence (Phase 2) must call this in the same unit of work as
 * `returnTaskToOwner` using `capabilityInvalidation` from that result.
 * Uses `assignment_ended` — distinct from D086 supersession on re-forward/reassign.
 */
export function invalidateCapabilityOnAssignmentChange(
  capability: TaskCapability,
  now: UtcInstant,
): TaskCapability {
  return revokeCapability(capability, now, 'assignment_ended');
}
