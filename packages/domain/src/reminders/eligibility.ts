/**
 * Which Task states may carry reminder scheduling (D107, D109, D110).
 *
 * A pure lookup over the Task status, kept here rather than in the API layer for the same reason
 * every other reminder rule lives in this package: whether a Task may be reminded about is
 * scheduling law, and a future worker must reach the same answer as the Owner API. Nothing here
 * reads a clock, a database, or a request.
 *
 * The rules are not new. D107 makes Waiting a suspension of reminder scheduling and the only pause
 * mechanism, and makes completion and dismissal stop reminders permanently. This module states the
 * consequence for a Task that has no schedule yet: a Waiting Task's schedule must be born
 * suspended, and a completed or dismissed Task must not acquire one at all.
 */

import { isActionableTaskStatus, isTerminalTaskStatus, type TaskStatus } from '../entities/task.js';

/** What establishing or materially changing a due date should do, given the Task's state. */
export type ReminderSchedulingDisposition =
  /** Schedule normally: occurrences are live and a worker may eventually deliver them. */
  | { readonly kind: 'schedule_active' }
  /**
   * Record the schedule but suspend it: Waiting pauses reminder scheduling (D107), so the
   * generation exists and the due date is authoritative while no occurrence is claimable.
   */
  | { readonly kind: 'schedule_suspended' }
  /** Refuse the mutation. Reminders cannot be established or changed for this Task at all. */
  | { readonly kind: 'refused'; readonly reason: ReminderSchedulingRefusal };

export type ReminderSchedulingRefusal =
  /** Completed or dismissed: D107 stops reminders permanently for a terminal Task. */
  | 'task_terminal'
  /**
   * A status this policy has no decision for. Unreachable today — the switch below is exhaustive
   * over `TaskStatus` — but a new status must fail closed rather than inherit `schedule_active` by
   * omission, because the failure mode of guessing is a reminder sent about work nobody expected.
   */
  | 'task_status_not_authorized';

/**
 * Decide whether a due-date mutation may proceed, and in what state the schedule should sit.
 *
 * Written as an exhaustive switch on purpose: adding a `TaskStatus` without deciding its reminder
 * semantics is a compile error here, and falls back to refusal at runtime.
 */
export function decideReminderScheduling(status: TaskStatus): ReminderSchedulingDisposition {
  switch (status) {
    case 'open':
    case 'in_progress':
      return { kind: 'schedule_active' };
    case 'waiting':
      return { kind: 'schedule_suspended' };
    case 'completed':
    case 'dismissed':
      return { kind: 'refused', reason: 'task_terminal' };
    default:
      return { kind: 'refused', reason: 'task_status_not_authorized' };
  }
}

/**
 * What a Task's *current* status requires an existing schedule to look like.
 *
 * The mirror image of {@link ReminderSchedulingDisposition}. That type answers "may this Owner
 * establish or change a schedule now?"; this one answers "given the Task just moved to this status,
 * what state must its schedule already be in?" — the question the lifecycle wiring asks.
 *
 * Both are derived from the same switch, deliberately, so a Task status can never be schedulable one
 * way and reconciled another.
 */
export type ReminderLifecycleIntent =
  /** Reminders should be running: resume a Waiting suspension, otherwise leave the schedule alone. */
  | { readonly kind: 'ensure_active' }
  /** Waiting suspends reminder scheduling (D107): suspend a live schedule, otherwise leave it. */
  | { readonly kind: 'ensure_suspended_for_waiting' }
  /** Terminal: stop reminders permanently (D107), recording which terminal state stopped them. */
  | { readonly kind: 'ensure_stopped'; readonly reason: ReminderLifecycleStopReason };

export type ReminderLifecycleStopReason = 'task_completed' | 'task_dismissed';

/**
 * Decide what a Task's status requires of its schedule (D107).
 *
 * `open` and `in_progress` both mean "reminders should run", which is why resuming from Waiting does
 * not need to know which of the two the Task returned to: `resumeTask` restores
 * `priorActionableStatus`, and either answer maps to the same reminder intent.
 *
 * The fallback is a suspension rather than a stop. A status this policy has not been taught is a
 * reason to make nothing claimable, but not a reason to claim a Task was completed or dismissed —
 * a stop reason is a factual assertion about why reminders ended, and guessing it would put a
 * falsehood in the audit trail. Suspension is the only disposition that is both safe and truthful
 * about an unknown status. Unreachable today: the switch is exhaustive over `TaskStatus`.
 */
export function decideReminderLifecycleIntent(status: TaskStatus): ReminderLifecycleIntent {
  switch (status) {
    case 'open':
    case 'in_progress':
      return { kind: 'ensure_active' };
    case 'waiting':
      return { kind: 'ensure_suspended_for_waiting' };
    case 'completed':
      return { kind: 'ensure_stopped', reason: 'task_completed' };
    case 'dismissed':
      return { kind: 'ensure_stopped', reason: 'task_dismissed' };
    default:
      return { kind: 'ensure_suspended_for_waiting' };
  }
}

/**
 * Whether reminders may be *read* for a Task. Always true, including for terminal Tasks.
 *
 * Reading history is not scheduling. A completed Task's reminder record is exactly what an Owner
 * needs to see to understand what was sent before it completed, and hiding it would make the read
 * route lie by omission.
 */
export function mayReadReminderState(): boolean {
  return true;
}

/**
 * Whether reminders may be *stopped* for a Task. Always true, including for terminal Tasks.
 *
 * Removal only clears a due date and stops scheduling, so it can never create reminder activity.
 * Refusing it for a terminal Task would strand an active schedule with no way to turn it off, which
 * is the opposite of what D107 wants.
 */
export function mayRemoveReminderDueDate(): boolean {
  return true;
}

/** Convenience predicates, so callers need not restate the status sets. */
export function taskStatusAllowsActiveReminders(status: TaskStatus): boolean {
  return isActionableTaskStatus(status);
}

export function taskStatusStopsReminders(status: TaskStatus): boolean {
  return isTerminalTaskStatus(status);
}
