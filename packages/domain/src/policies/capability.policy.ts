import type { CapabilityActor } from '../types/actor.js';
import { forbiddenError } from '../errors/domain-errors.js';
import type { Task } from '../entities/task.js';
import { isTerminalTaskStatus } from '../entities/task.js';
import type { CapabilityAction } from '../value-objects/capability.js';

export function isCapabilityActive(actor: CapabilityActor, now: string): boolean {
  if (actor.status !== 'active') {
    return false;
  }
  return actor.expiresAt > now;
}

export function assertCapabilityActive(actor: CapabilityActor, now: string): void {
  if (actor.status === 'revoked') {
    throw forbiddenError('Capability link has been revoked.');
  }
  if (actor.status === 'expired' || actor.expiresAt <= now) {
    throw forbiddenError('Capability link has expired.');
  }
  if (actor.status === 'used') {
    throw forbiddenError('Capability link is no longer active.');
  }
  if (actor.status !== 'active') {
    throw forbiddenError('Capability link is not active.');
  }
}

export function assertCapabilityBelongsToTask(actor: CapabilityActor, task: Task): void {
  if (actor.taskId !== task.id) {
    throw forbiddenError('Capability link does not belong to this task.');
  }
  if (!task.assignment) {
    throw forbiddenError('Task is not assigned.');
  }
  if (actor.assignmentId !== task.assignment.id) {
    throw forbiddenError('Capability link does not belong to this assignment.');
  }
}

export function assertCapabilityActionInScope(
  actor: CapabilityActor,
  action: CapabilityAction,
): void {
  if (!actor.allowedActions.includes(action)) {
    throw forbiddenError(`Capability link does not authorize ${action}.`);
  }
}

export function assertTaskAllowsCapabilityMutation(task: Task): void {
  if (isTerminalTaskStatus(task.status)) {
    throw forbiddenError(
      `Task in status ${task.status} cannot be mutated through a capability link.`,
    );
  }
}

export function assertCapabilityPermitsAction(
  actor: CapabilityActor,
  action: CapabilityAction,
  task: Task,
  now: string,
): void {
  assertCapabilityActive(actor, now);
  assertCapabilityBelongsToTask(actor, task);
  assertCapabilityActionInScope(actor, action);
  assertTaskAllowsCapabilityMutation(task);
}
