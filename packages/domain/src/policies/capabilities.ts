import type { ActorContext } from '../types/actor.js';
import { forbiddenError } from '../errors/domain-errors.js';
import type { Task } from '../entities/task.js';
import { isPrimary } from '../types/actor.js';

export type CapabilityAction =
  | 'view_assigned_task'
  | 'approve_task_suggestion'
  | 'edit_task_suggestion'
  | 'dismiss_task_suggestion'
  | 'merge_task_suggestion'
  | 'confirm_assignment'
  | 'create_standalone_task'
  | 'create_task_from_voice'
  | 'start_task'
  | 'snooze_task'
  | 'dismiss_task'
  | 'complete_task'
  | 'mark_task_waiting'
  | 'add_task_note'
  | 'return_task_to_primary'
  | 'request_clarification'
  | 'approve_learning'
  | 'manage_workflow_rules'
  | 'manage_reminder_policies'
  | 'create_automation'
  | 'assign_unrelated_user';

const PRIMARY_ACTIONS = new Set<CapabilityAction>([
  'approve_task_suggestion',
  'edit_task_suggestion',
  'dismiss_task_suggestion',
  'merge_task_suggestion',
  'confirm_assignment',
  'create_standalone_task',
  'start_task',
  'snooze_task',
  'dismiss_task',
  'complete_task',
  'mark_task_waiting',
  'add_task_note',
  'return_task_to_primary',
  'request_clarification',
  'approve_learning',
  'manage_workflow_rules',
  'manage_reminder_policies',
  'create_automation',
]);

const ADMIN_ACTIONS = new Set<CapabilityAction>([
  'view_assigned_task',
  'complete_task',
  'mark_task_waiting',
  'add_task_note',
  'return_task_to_primary',
  'request_clarification',
]);

export function can(actor: ActorContext, action: CapabilityAction, task?: Task): boolean {
  if (action === 'create_task_from_voice') {
    return false;
  }

  if (actor.role === 'primary') {
    return PRIMARY_ACTIONS.has(action);
  }

  if (!ADMIN_ACTIONS.has(action)) {
    return false;
  }

  if (!task?.assignment || task.assignment.assigneeUserId !== actor.userId) {
    return false;
  }

  return true;
}

export function assertCan(actor: ActorContext, action: CapabilityAction, task?: Task): void {
  if (!can(actor, action, task)) {
    throw forbiddenError(`Actor is not permitted to ${action}.`);
  }
}

export function assertPrimary(actor: ActorContext): void {
  if (!isPrimary(actor)) {
    throw forbiddenError('Primary user required.');
  }
}
