import type { components } from '@aicaa/contracts/schema';
import type { OwnerAttentionReminderRow } from '@aicaa/db';
import type { StatusTone } from '@/lib/presentation/task-status';
import { formatOwnerLocalDate } from '@/lib/presentation/datetime';
import { deriveTaskTitle } from '@/lib/presentation/task-title';

type TaskSummaryPoint = components['schemas']['TaskSummaryPoint'];
type ReminderStopReason = NonNullable<components['schemas']['TaskReminderState']['stopReason']>;

/**
 * Owner attention projection for stopped reminder automation (A8.6a; D108, D112).
 *
 * The read side of the cross-Task discovery surface: rows in, sentences out. It computes nothing
 * about reminders. Whether a schedule needs the Owner was decided by the A8.4b settlement that set
 * `requiresOwnerAttention`, and re-deriving that judgement here from status and counts is how a
 * page and a worker come to disagree about the same schedule (D103, D127) — the same reason
 * `state.ts` refuses to recompute an occurrence at read time.
 *
 * ## The vocabulary boundary
 *
 * `generation`, `claimedBy`, `claimExpiresAt`, `reminderVersion`, and the schedule's row id are
 * absent from the output type, not merely unrendered. They are worker-coordination internals and
 * database identifiers; an Owner cannot act on any of them, and a field that exists on the
 * projection eventually reaches a template. The Task id survives because it is the link target the
 * Owner needs, and it is already the public identifier for a Task everywhere else.
 *
 * A stopped schedule also carries an `overdueDeliveredCount`, which is deliberately not shown. In
 * every current environment it is zero because reminder delivery has never been enabled, so
 * printing "0 reminders sent" beside "reminders stopped" would be arithmetic the Owner has to
 * reconcile rather than information.
 */

/** One row of the Attention list: a Task, why it needs a decision, and where to go. */
export interface OwnerAttentionItem {
  readonly taskId: string;
  readonly taskTitle: string;
  /** Always an authenticated Owner route. */
  readonly href: string;
  readonly badge: string;
  readonly badgeTone: StatusTone;
  readonly headline: string;
  readonly explanation: string;
  /** The Task's current due date, already formatted, or null when it no longer has one. */
  readonly dueDateText: string | null;
}

export interface OwnerAttentionView {
  readonly items: readonly OwnerAttentionItem[];
  /**
   * Whether the bounded read came back full, so the list may be incomplete.
   *
   * Reported rather than resolved. A8.6a adds no pagination control, and an exact remainder would
   * cost an unbounded `COUNT`; saying "there may be more" is both cheaper and the truth.
   */
  readonly batchFilled: boolean;
}

interface AttentionCopy {
  readonly badge: string;
  readonly badgeTone: StatusTone;
  readonly headline: string;
  readonly explanation: string;
}

/**
 * Copy for a schedule that is flagged but whose stop reason this surface cannot explain.
 *
 * Reachable only through states the write path does not currently produce: attention raised
 * alongside a non-attention stop reason, or with no stop reason at all. The schema permits both
 * combinations even though no code writes them, so the choice is between a truthful generic
 * sentence and inventing a fourth attention reason to cover the gap. Saying less is the only safe
 * option — a confident wrong cause would send the Owner to fix something that is not broken.
 */
const UNEXPLAINED: AttentionCopy = {
  badge: 'Needs attention',
  badgeTone: 'caution',
  headline: 'This Task’s reminders need your attention.',
  explanation:
    'Rocket flagged this reminder schedule, and the reason is not one this page can explain. Open the Task to see its current state.',
};

/**
 * Stop reason to Owner-facing meaning, exhaustive over the contracted enum.
 *
 * Three reasons raise attention and get a specific sentence. The other three are ordinary endings —
 * the Task finished, the Task was dismissed, the Owner removed the due date — and a schedule
 * carrying one of them should never appear on this list at all; each maps to the generic copy so
 * that if one ever did, the page says something true rather than nothing.
 *
 * The ambiguity wording is load-bearing (D129). Rocket does not know the reminder was missed; it
 * knows it could not confirm delivery, and those are different facts. "The Recipient did not
 * receive it" would send an Owner to re-send something that may already have arrived twice.
 */
const STOP_REASON_COPY: Record<ReminderStopReason, AttentionCopy> = {
  overdue_ceiling_reached: {
    badge: 'Reminders finished',
    badgeTone: 'caution',
    headline: 'Reminders have finished for this Task.',
    explanation:
      'Rocket sent every daily reminder it will send for this due date and stopped. It will not start again on its own.',
  },
  permanent_delivery_failure: {
    badge: 'Reminders stopped',
    badgeTone: 'critical',
    headline: 'Reminders stopped after a delivery failure.',
    explanation:
      'A reminder could not be delivered, so Rocket stopped rather than continuing to try. Nothing further will be sent for this Task.',
  },
  repeated_ambiguous_outcomes: {
    badge: 'Reminders stopped',
    badgeTone: 'critical',
    headline: 'Reminders stopped because delivery could not be confirmed.',
    explanation:
      'Rocket could not confirm that recent reminders were delivered, so it stopped. The Recipient may or may not have received them.',
  },
  task_completed: UNEXPLAINED,
  task_dismissed: UNEXPLAINED,
  due_date_removed: UNEXPLAINED,
};

function copyFor(stopReason: ReminderStopReason | null): AttentionCopy {
  return stopReason === null ? UNEXPLAINED : STOP_REASON_COPY[stopReason];
}

/**
 * Title the Task the way every other Owner surface titles it.
 *
 * `summaryPoints` arrives as a `Json` column, so its runtime shape is whatever was stored rather
 * than whatever the type claims. `deriveTaskTitle` already tolerates a point with no usable text
 * and falls back to an identifier prefix; this only has to guarantee it receives an array, so a
 * malformed row degrades to that same fallback instead of throwing inside a list render.
 */
function titleFor(row: OwnerAttentionReminderRow): string {
  const points = Array.isArray(row.taskSummaryPoints)
    ? (row.taskSummaryPoints as TaskSummaryPoint[])
    : [];
  return deriveTaskTitle({ id: row.taskId, summaryPoints: points });
}

export function toOwnerAttentionItem(row: OwnerAttentionReminderRow): OwnerAttentionItem {
  const copy = copyFor(row.stopReason);
  return {
    taskId: row.taskId,
    taskTitle: titleFor(row),
    href: `/tasks/${row.taskId}`,
    badge: copy.badge,
    badgeTone: copy.badgeTone,
    headline: copy.headline,
    explanation: copy.explanation,
    dueDateText: row.taskDueLocalDate === null ? null : formatOwnerLocalDate(row.taskDueLocalDate),
  };
}

/**
 * Project a bounded batch, preserving the repository's order exactly.
 *
 * No sorting, grouping, or filtering happens here. The database chose the order — longest-stuck
 * first — and a second ordering in the presentation layer would make the page disagree with the
 * query that produced it.
 */
export function toOwnerAttentionView(
  rows: readonly OwnerAttentionReminderRow[],
  limit: number,
): OwnerAttentionView {
  return {
    items: rows.map(toOwnerAttentionItem),
    batchFilled: rows.length >= limit,
  };
}
