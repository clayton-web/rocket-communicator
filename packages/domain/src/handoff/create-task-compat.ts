import { categoryForHandoffCode, handoffFail, handoffOk, type HandoffResult } from './failures.js';

/**
 * D091 compatibility policy: Task creation and handoff are separate.
 * Once A7 ships, create-with-recipientId must be rejected at the implementation boundary.
 * This pure rule does not modify create-task handlers.
 *
 * Suggestion approval remains unassigned (D080) — out of scope here.
 */
export function assertCreateTaskRejectsRecipientId(
  recipientId: string | null | undefined,
): HandoffResult<void> {
  if (recipientId === undefined || recipientId === null || recipientId === '') {
    return handoffOk(undefined);
  }
  return handoffFail(
    'RECIPIENT_HANDOFF_NOT_AVAILABLE',
    categoryForHandoffCode('RECIPIENT_HANDOFF_NOT_AVAILABLE'),
    'Create Task must remain unassigned; use POST /api/v1/tasks/{taskId}/handoff for Recipient handoff.',
    [{ field: 'recipientId', message: 'Not allowed on Task create (D091)' }],
  );
}

/**
 * Whether a create-task body is eligible under the future A7 path (unassigned only).
 */
export function isUnassignedCreateTaskPath(recipientId: string | null | undefined): boolean {
  return recipientId === undefined || recipientId === null || recipientId === '';
}
