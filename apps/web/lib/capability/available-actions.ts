import { isTerminalTaskStatus, type CapabilityAction, type TaskStatus } from '@aicaa/domain';

/**
 * UI-facing capability actions. Resume shares the `mark_task_waiting` scope
 * but is only offered while the task is waiting.
 */
export type RecipientUiAction =
  | 'mark_task_waiting'
  | 'resume_task'
  | 'complete_task'
  | 'add_task_note'
  | 'request_clarification'
  | 'return_task_to_owner'
  | 'submit_work_request';

/**
 * Derive Recipient UI actions from issued capability scope + task status.
 * Never invents Owner-only actions. Terminal tasks offer none.
 */
export function deriveAvailableRecipientActions(
  permittedActions: ReadonlyArray<CapabilityAction>,
  status: TaskStatus,
): RecipientUiAction[] {
  if (isTerminalTaskStatus(status)) {
    return [];
  }

  const has = (action: CapabilityAction) => permittedActions.includes(action);
  const actions: RecipientUiAction[] = [];

  if (status === 'waiting') {
    if (has('mark_task_waiting')) {
      actions.push('resume_task');
    }
  } else if (status === 'open' || status === 'in_progress') {
    if (has('mark_task_waiting')) {
      actions.push('mark_task_waiting');
    }
  }

  if (has('complete_task')) {
    actions.push('complete_task');
  }
  if (has('add_task_note')) {
    actions.push('add_task_note');
  }
  if (has('request_clarification')) {
    actions.push('request_clarification');
  }
  if (has('return_task_to_owner')) {
    actions.push('return_task_to_owner');
  }
  if (has('submit_work_request')) {
    actions.push('submit_work_request');
  }

  return actions;
}
