import type { components } from '@aicaa/contracts/schema';

type TaskStatus = components['schemas']['TaskStatus'];
type DerivedTaskUrgency = components['schemas']['DerivedTaskUrgency'];
type AssignmentDeliveryStatus = components['schemas']['AssignmentDeliveryStatus'];

/**
 * Task status presentation (P1.4).
 *
 * Visual only. Every function here maps an existing contract enum to a human label and
 * nothing else: no new state is derived, no rule is evaluated, and no ordering, grouping, or
 * filtering decision is made. The Owner surfaces previously rendered raw enum values
 * (`in_progress`), which read as database internals rather than as a status.
 *
 * Total mappings by construction: each uses an exhaustive `Record` keyed by the contract
 * enum, so adding a state to the contract fails the build here instead of silently rendering
 * an unlabelled value. `p1-4-presentation.test.ts` asserts coverage against the enum.
 */

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting',
  completed: 'Completed',
  dismissed: 'Dismissed',
};

/**
 * Urgency labels.
 *
 * `due_soon` and `overdue` are derived at read time from `dueLocalDate` and are never persisted.
 * They describe the due date only. They must not be worded as though a reminder had fired or
 * a schedule were being tracked, because no reminder automation is wired to them
 * (STATE_MACHINE.md, D089).
 */
const URGENCY_LABELS: Record<DerivedTaskUrgency, string> = {
  due_soon: 'Due soon',
  overdue: 'Overdue',
};

/**
 * Delivery labels for an assignment's handoff email.
 *
 * `pending` deliberately reads "Delivery pending" rather than "Sending": nothing is
 * necessarily in flight, and the truthful claim is only that delivery has not been confirmed.
 */
const DELIVERY_LABELS: Record<AssignmentDeliveryStatus, string> = {
  pending: 'Delivery pending',
  sent: 'Sent',
  failed: 'Delivery failed',
};

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status];
}

export function taskUrgencyLabel(urgency: DerivedTaskUrgency | null | undefined): string | null {
  return urgency ? URGENCY_LABELS[urgency] : null;
}

export function deliveryStatusLabel(
  status: AssignmentDeliveryStatus | null | undefined,
): string | null {
  return status ? DELIVERY_LABELS[status] : null;
}

/**
 * Whether a Task currently has a Recipient assignment.
 *
 * Presence of the assignment object is the whole test; this asserts nothing about delivery,
 * capability validity, or whether the Recipient has acted.
 */
export function assignmentLabel(hasAssignment: boolean): string {
  return hasAssignment ? 'Assigned' : 'Unassigned';
}

/** Emphasis for a badge. Never the only carrier of meaning — the label always states it. */
export type StatusTone = 'neutral' | 'positive' | 'caution' | 'critical';

/**
 * Tone for a Task status.
 *
 * `completed` and `dismissed` are both settled outcomes and both read as neutral: dismissing
 * a Task is a legitimate resolution, not a failure, and colouring it as one would editorialize
 * about the Owner's decision.
 */
export function taskStatusTone(status: TaskStatus): StatusTone {
  return status === 'completed' ? 'positive' : 'neutral';
}

export function urgencyTone(urgency: DerivedTaskUrgency): StatusTone {
  return urgency === 'overdue' ? 'critical' : 'caution';
}

export function deliveryTone(status: AssignmentDeliveryStatus): StatusTone {
  if (status === 'failed') {
    return 'critical';
  }
  return status === 'sent' ? 'positive' : 'caution';
}
