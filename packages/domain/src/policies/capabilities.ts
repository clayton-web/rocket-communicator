import type { Actor, CapabilityActor, OwnerActor } from '../types/actor.js';
import { isCapability, isOwner } from '../types/actor.js';
import { forbiddenError } from '../errors/domain-errors.js';
import type { Task } from '../entities/task.js';
import type { CapabilityAction } from '../value-objects/capability.js';
import { assertCapabilityPermitsAction, isCapabilityActive } from './capability.policy.js';

export type OwnerAction =
  | 'approve_task_suggestion'
  | 'edit_task_suggestion'
  | 'dismiss_task_suggestion'
  | 'merge_task_suggestion'
  | 'confirm_assignment'
  | 'create_standalone_task'
  | 'create_task_from_voice'
  | 'issue_task_capability'
  | 'start_task'
  | 'snooze_task'
  | 'dismiss_task'
  | 'complete_task'
  | 'mark_task_waiting'
  | 'add_task_note'
  | 'return_task_to_owner'
  | 'request_clarification'
  | 'submit_work_request'
  | 'approve_learning'
  | 'manage_workflow_rules'
  | 'manage_reminder_policies'
  | 'create_automation'
  | 'assign_unrelated_recipient';

const OWNER_ACTIONS = new Set<OwnerAction>([
  'approve_task_suggestion',
  'edit_task_suggestion',
  'dismiss_task_suggestion',
  'merge_task_suggestion',
  'confirm_assignment',
  'create_standalone_task',
  'issue_task_capability',
  'start_task',
  'snooze_task',
  'dismiss_task',
  'complete_task',
  'mark_task_waiting',
  'add_task_note',
  'return_task_to_owner',
  'request_clarification',
  'approve_learning',
  'manage_workflow_rules',
  'manage_reminder_policies',
  'create_automation',
]);

const CAPABILITY_ACTION_MAP: Partial<Record<OwnerAction, CapabilityAction>> = {
  complete_task: 'complete_task',
  mark_task_waiting: 'mark_task_waiting',
  add_task_note: 'add_task_note',
  return_task_to_owner: 'return_task_to_owner',
  request_clarification: 'request_clarification',
  submit_work_request: 'submit_work_request',
};

export function canOwner(actor: OwnerActor, action: OwnerAction): boolean {
  if (action === 'create_task_from_voice') {
    return false;
  }
  if (action === 'submit_work_request') {
    return false;
  }
  return OWNER_ACTIONS.has(action);
}

export function canCapability(
  actor: CapabilityActor,
  action: CapabilityAction,
  task: Task,
  now: string,
): boolean {
  try {
    assertCapabilityPermitsAction(actor, action, task, now);
    return true;
  } catch {
    return false;
  }
}

export function can(actor: Actor, action: OwnerAction, task?: Task, now?: string): boolean {
  if (isOwner(actor)) {
    return canOwner(actor, action);
  }

  if (isCapability(actor) && task && now) {
    const capabilityAction = ownerActionToCapabilityAction(action);
    if (!capabilityAction) {
      return false;
    }
    return canCapability(actor, capabilityAction, task, now);
  }

  return false;
}

export function assertCan(actor: Actor, action: OwnerAction, task?: Task, now?: string): void {
  if (isOwner(actor)) {
    if (!canOwner(actor, action)) {
      throw forbiddenError(`Owner is not permitted to ${action}.`);
    }
    return;
  }

  if (isCapability(actor)) {
    const capabilityAction = ownerActionToCapabilityAction(action);
    if (!capabilityAction) {
      throw forbiddenError(`Capability links cannot authorize ${action}.`);
    }
    if (!task || !now) {
      throw forbiddenError('Task context is required for capability authorization.');
    }
    assertCapabilityPermitsAction(actor, capabilityAction, task, now);
    return;
  }

  throw forbiddenError('System actors have no broad implicit authority in A2.');
}

export function assertOwner(actor: Actor): asserts actor is OwnerActor {
  if (!isOwner(actor)) {
    throw forbiddenError('Owner required.');
  }
}

function ownerActionToCapabilityAction(action: OwnerAction): CapabilityAction | null {
  return CAPABILITY_ACTION_MAP[action] ?? null;
}

export function assertGetDoesNotMutate(method: string): void {
  if (method.toUpperCase() !== 'GET') {
    return;
  }
  // Policy marker: opening a capability link via GET must never mutate task state.
}

export function isCapabilityActiveForTask(
  actor: CapabilityActor,
  task: Task,
  now: string,
): boolean {
  return isCapabilityActive(actor, now) && actor.taskId === task.id;
}

export { CAPABILITY_ACTION_MAP };
