import {
  DomainError,
  assertCapabilityActionInScope,
  assertCapabilityBelongsToTask,
  assertTaskAllowsCapabilityMutation,
  type CapabilityAction,
  type CapabilityActor,
  type Task,
  type TaskCapability,
  type UtcInstant,
} from '@aicaa/domain';
import type { DbClient, PersistedCapability } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { assertValidCapabilityPepper } from './config';
import { capabilityTokenError, type CapabilityTokenErrorCode } from './errors';
import { hashCapabilityToken } from './token';

export type CapabilityValidationMode = 'get' | 'mutation';

export interface ValidateCapabilityCommand {
  db: DbClient;
  rawToken: string;
  pepper: string;
  now: UtcInstant;
  action: CapabilityAction;
  /**
   * `get` — view-only / prefetch safe; never mutates.
   * `mutation` — still non-mutating here; later POST handlers use the returned actor.
   */
  mode: CapabilityValidationMode;
  /** Required task binding for capability task APIs; optional for pure token probe. */
  taskId?: string;
  /** Optional exact assignment binding check. */
  assignmentId?: string;
}

export interface ValidatedCapabilityContext {
  actor: CapabilityActor;
  capability: TaskCapability;
  task: Task;
  organizationId: string;
}

/**
 * Validate a raw capability token for a requested action.
 * Never mutates database state and never transitions status to `used` (D056).
 */
export async function validateCapabilityToken(
  command: ValidateCapabilityCommand,
): Promise<ValidatedCapabilityContext> {
  const pepper = assertValidCapabilityPepper(command.pepper, 'pepper');
  if (!command.rawToken.trim()) {
    throw capabilityTokenError('INVALID_CAPABILITY', 'Capability token is invalid.');
  }

  const tokenHash = hashCapabilityToken(command.rawToken, pepper);
  const { findCapabilityByTokenHash, getTaskById } = await loadDbRuntime();
  const found = await findCapabilityByTokenHash(command.db, tokenHash);
  if (!found) {
    throw capabilityTokenError('INVALID_CAPABILITY', 'Capability token is invalid.');
  }

  const { organizationId, tokenHash: _hash, ...capability } = found;
  void _hash;

  if (capability.status === 'used') {
    throw capabilityTokenError('INVALID_CAPABILITY', 'Capability token is invalid.');
  }

  const actor = toCapabilityActor(capability);

  if (actor.status === 'revoked') {
    throw capabilityTokenError('CAPABILITY_REVOKED', 'Capability token has been revoked.');
  }
  if (actor.status === 'expired' || actor.expiresAt <= command.now) {
    throw capabilityTokenError('CAPABILITY_EXPIRED', 'Capability token has expired.');
  }

  if (command.taskId && command.taskId !== capability.taskId) {
    throw capabilityTokenError('WRONG_RESOURCE', 'Capability token is invalid.', {
      reason: 'task_mismatch',
    });
  }

  const task = await getTaskById(command.db, organizationId, command.taskId ?? capability.taskId);

  try {
    assertCapabilityBelongsToTask(actor, task);
  } catch {
    throw capabilityTokenError('WRONG_RESOURCE', 'Capability token is invalid.', {
      reason: 'assignment_mismatch',
    });
  }

  if (command.assignmentId && command.assignmentId !== capability.assignmentId) {
    throw capabilityTokenError('WRONG_RESOURCE', 'Capability token is invalid.', {
      reason: 'assignment_mismatch',
    });
  }

  try {
    assertCapabilityActionInScope(actor, command.action);
  } catch {
    throw capabilityTokenError(
      'INSUFFICIENT_SCOPE',
      'Capability token does not authorize this action.',
    );
  }

  const requiresMutableTask =
    command.mode === 'mutation' || command.action !== 'view_assigned_task';
  if (requiresMutableTask) {
    try {
      assertTaskAllowsCapabilityMutation(task);
    } catch (error) {
      const message =
        error instanceof DomainError ? error.message : 'Capability action is not permitted.';
      throw capabilityTokenError('TERMINAL_TASK', message);
    }
  }

  return {
    actor,
    capability,
    task,
    organizationId,
  };
}

export function toCapabilityActor(capability: TaskCapability): CapabilityActor {
  return {
    kind: 'capability',
    capabilityId: capability.id,
    taskId: capability.taskId,
    assignmentId: capability.assignmentId,
    intendedRecipientEmail: capability.intendedRecipientEmail,
    allowedActions: capability.scope,
    status: capability.status,
    expiresAt: capability.expiresAt,
  };
}

/** Strip persistence-only fields before returning capability to callers. */
export function omitTokenHash(capability: PersistedCapability): TaskCapability {
  const { tokenHash: _omit, ...rest } = capability;
  void _omit;
  return rest;
}

export type { CapabilityTokenErrorCode };
