import type { components } from '@aicaa/contracts/schema';

type TaskDto = components['schemas']['Task'];

/**
 * Durable Owner recovery eligibility for a permanent / non-retryable failed delivery.
 *
 * Retryable handoff failure is a different surface: it lives on the in-browser pending
 * operation (`showRetryHandoff`) while the Task is still unassigned. A current assignment
 * with `deliveryStatus=failed` is the persisted terminal delivery outcome. The backend
 * retry path requires `pending`, not `failed`, so this control must not replace Retry.
 *
 * `task.assignment` is the current assignment only. Cleared history is not present.
 */
export function canReturnFailedAssignmentToOwner(task: TaskDto): boolean {
  if (task.status === 'completed' || task.status === 'dismissed') {
    return false;
  }
  return task.assignment?.deliveryStatus === 'failed';
}
