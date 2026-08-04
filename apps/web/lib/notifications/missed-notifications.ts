import type { components } from '@aicaa/contracts/schema';
import type { OwnerMissedNotificationRow } from '@aicaa/db';
import type { StatusTone } from '@/lib/presentation/task-status';
import { ownerFacingActorLabel } from '@/lib/presentation/actor-label';
import { formatOwnerDateTime } from '@/lib/presentation/datetime';
import { deriveTaskTitle } from '@/lib/presentation/task-title';

type TaskSummaryPoint = components['schemas']['TaskSummaryPoint'];

/**
 * Owner projection for notifications Rocket could not deliver (A8.6c; D133–D135).
 *
 * A8.5 exists to email the Owner once when something notable happens to delegated work. Everything
 * downstream of that assumes the email arrived. This projection covers the case where it did not:
 * an event happened, the email was never sent, and without this surface the Owner would have no
 * way to learn either fact.
 *
 * ## Why this is not a notification inbox
 *
 * Successfully delivered notifications are absent, and that is the design rather than a first
 * iteration. The Owner already has those emails; reprinting them in the product would make this a
 * second inbox to keep up with, and the events themselves are already visible on the Tasks they
 * concern. What is *not* visible anywhere else is the silence — the event Rocket meant to tell the
 * Owner about and never did.
 *
 * It follows that there is nothing here to resolve. An item is a pointer to a Task worth looking
 * at, not a piece of work, so A8.6c adds no acknowledgement, dismissal, or read state, and items
 * leave the surface only by ageing out of the ratified window. Marking one "read" would require
 * persisting a fact about the Owner's attention that no ratified decision defines, and would turn
 * a bounded recent history into a to-do list that never empties.
 *
 * ## The vocabulary boundary
 *
 * The row this projects from carries no claim holder, lease, fencing sequence, attempt count,
 * provider message reference, failure code, request id, correlation id, occurrence key, or
 * attribution label — the repository never selects them. What survives is what an Owner can act
 * on: what happened, which Task, when, who caused it, and whether the message reached them.
 */

/** One undelivered notification, already reduced to the sentences the page renders. */
export interface OwnerMissedNotificationItem {
  /** What happened, in Owner-facing terms. Never quotes anyone (D134). */
  readonly headline: string;
  /** The Task this is about, or null when it names none or could not be resolved. */
  readonly taskTitle: string | null;
  /** Authenticated Owner route, or null. Non-null exactly when `taskTitle` is. */
  readonly href: string | null;
  readonly occurredAtText: string;
  /** Closed actor category, never a person's name. */
  readonly actorLabel: string;
  readonly outcomeBadge: string;
  readonly outcomeTone: StatusTone;
  readonly outcomeExplanation: string;
  /** When Rocket stopped trying, or null if the intent has no settlement instant. */
  readonly settledAtText: string | null;
  /**
   * What the Owner can do about it, which is always "go and look".
   *
   * Two sentences rather than one, because the linkable and unlinkable cases are different
   * answers: one points somewhere, the other admits it cannot. Deciding between them here keeps
   * the component from having to know why a Task link is missing.
   */
  readonly nextStep: string;
}

export interface OwnerMissedNotificationsView {
  readonly items: readonly OwnerMissedNotificationItem[];
  /**
   * Whether the bounded read came back full, so older undelivered notifications inside the window
   * may exist but are not shown. Disclosed rather than paginated, matching A8.6a.
   */
  readonly batchFilled: boolean;
  /** The ratified recency window, carried so the page states one number rather than two. */
  readonly windowDays: number;
}

/**
 * Event to Owner-facing sentence, exhaustive over the ratified D133 taxonomy.
 *
 * A closed record, so adding an eleventh event type fails the build here rather than rendering an
 * enum member to the Owner. Every sentence is fixed copy: nothing is interpolated from a Task, a
 * Recipient, a note, or a provider response, because a surface that says "Rocket could not tell
 * you about this" must not become the place where unquoted Recipient text reaches the Owner
 * instead (D134).
 *
 * The three `reminder_schedule_stopped_*` entries are unreachable. The repository excludes those
 * events from this read entirely, because the reminder attention section above already shows the
 * underlying condition and clears when the Owner repairs it, while an intent stays terminal
 * forever. They carry truthful copy anyway so that the record is exhaustive over the enum rather
 * than over today's filter, which is the part more likely to change.
 */
const EVENT_HEADLINES: Record<OwnerMissedNotificationRow['eventType'], string> = {
  task_completed_by_recipient: 'This Task was marked complete.',
  task_clarification_requested: 'A question was asked about this Task, and it is waiting on you.',
  task_returned_to_owner: 'This Task was returned to you, and nobody is assigned to it.',
  handoff_delivery_failed: 'The assignment message for this Task never reached its Recipient.',
  gmail_disconnected: 'Rocket lost access to your connected Gmail account.',
  capability_expired: 'The link for this Task expired, so the Recipient can no longer act on it.',
  reminder_schedule_stopped_ceiling_reached:
    'Reminders for this Task reached their limit and stopped.',
  reminder_schedule_stopped_permanent_failure:
    'Reminders for this Task stopped after one could not be delivered.',
  reminder_schedule_stopped_repeated_ambiguous:
    'Reminders for this Task stopped because delivery could not be confirmed.',
  reminder_no_active_assignment:
    'A reminder for this Task came due while nobody was assigned to it, so it was not sent.',
};

interface OutcomeCopy {
  readonly badge: string;
  readonly tone: StatusTone;
  readonly explanation: string;
}

const NOT_SENT_BADGE = 'Not sent';

/**
 * Persistence state to what actually happened to the email.
 *
 * Four states reach this surface and they collapse to two Owner-facing answers, because that is
 * how many outcomes the Owner can distinguish: the message did not arrive, or nobody can say
 * whether it did. The distinction is worth keeping — "not sent" is safe to act on, while
 * `ambiguous` means a duplicate may already be in the Owner's inbox, and flattening the two would
 * make one of those sentences a lie.
 *
 * Why each message was not sent is still shown, because the reasons are not interchangeable: a
 * stale suppression means Rocket chose not to send, a disconnected mailbox means it had nowhere to
 * send, and a permanent failure means the attempt was made and refused. The first two are
 * conditions the Owner can fix.
 */
function outcomeFor(
  state: OwnerMissedNotificationRow['state'],
  suppressionReason: OwnerMissedNotificationRow['suppressionReason'],
): OutcomeCopy {
  switch (state) {
    case 'suppressed':
      return {
        badge: NOT_SENT_BADGE,
        tone: 'caution',
        explanation: suppressionExplanation(suppressionReason),
      };
    case 'failed_permanent':
      return {
        badge: NOT_SENT_BADGE,
        tone: 'caution',
        explanation: 'Rocket tried to email you about this, and the message could not be sent.',
      };
    case 'requires_owner_attention':
      return {
        badge: NOT_SENT_BADGE,
        tone: 'caution',
        explanation:
          'Rocket tried several times to email you about this and could not get through, so it stopped trying.',
      };
    case 'ambiguous':
      return {
        badge: 'Delivery unknown',
        tone: 'neutral',
        explanation:
          'Rocket could not confirm whether this email was sent. You may have received it, or it may never have arrived.',
      };
    /*
     * The four states this surface does not show, kept here so the switch is total over the enum
     * rather than over the repository's current filter. None is reachable: `sent` means the Owner
     * has the email, and the other three mean delivery has not finished deciding, so the query
     * excludes all four. If one ever arrived, the only safe sentence is that this page cannot
     * account for it — a confident wrong outcome would tell the Owner an email did or did not
     * reach them on no evidence.
     */
    case 'sent':
    case 'pending':
    case 'claimed':
    case 'failed_retryable':
      return {
        badge: 'Status unclear',
        tone: 'neutral',
        explanation: 'Rocket cannot say what happened to this notification.',
      };
  }
}

/**
 * Why a suppressed notification was never attempted.
 *
 * The null branch is reachable only through a row the write path does not produce — the database
 * requires a reason for `suppressed` — so it exists to keep this total rather than to describe a
 * real state. Saying the reason was not recorded is the one answer that stays true whatever such a
 * row turned out to mean.
 */
function suppressionExplanation(reason: OwnerMissedNotificationRow['suppressionReason']): string {
  switch (reason) {
    case 'stale':
      return 'Rocket did not send this. By the time it tried, too much time had passed for the message to still be useful.';
    case 'channel_unavailable':
      return 'Rocket did not send this because no connected Gmail account was available to send from.';
    case null:
      return 'Rocket did not send this, and the reason was not recorded.';
  }
}

/**
 * Title the Task the way every other Owner surface titles it.
 *
 * `summaryPoints` is a `Json` column, so its runtime shape is whatever was stored rather than
 * whatever the type claims. `deriveTaskTitle` already falls back to an identifier prefix when no
 * point carries usable text; guaranteeing it receives an array is all that is needed for a
 * malformed row to degrade to that fallback instead of throwing inside a list render.
 */
function titleFor(taskId: string, summaryPoints: unknown): string {
  const points = Array.isArray(summaryPoints) ? (summaryPoints as TaskSummaryPoint[]) : [];
  return deriveTaskTitle({ id: taskId, summaryPoints: points });
}

export function toOwnerMissedNotificationItem(
  row: OwnerMissedNotificationRow,
): OwnerMissedNotificationItem {
  const outcome = outcomeFor(row.state, row.suppressionReason);
  // A row with no resolvable Task is still rendered. The event happened and the Owner was never
  // told; hiding the item because its subject was purged, or belongs somewhere this Owner cannot
  // see, would replace a partial truth with silence — the exact failure this surface exists for.
  const taskId = row.taskId;
  return {
    headline: EVENT_HEADLINES[row.eventType],
    taskTitle: taskId === null ? null : titleFor(taskId, row.taskSummaryPoints),
    href: taskId === null ? null : `/tasks/${taskId}`,
    occurredAtText: formatOwnerDateTime(row.occurredAt),
    actorLabel: ownerFacingActorLabel(row.actorKind),
    outcomeBadge: outcome.badge,
    outcomeTone: outcome.tone,
    outcomeExplanation: outcome.explanation,
    settledAtText: row.settledAt === null ? null : formatOwnerDateTime(row.settledAt),
    nextStep:
      taskId === null
        ? 'This notification is not linked to a Task you can open.'
        : 'Open the Task to see where it stands:',
  };
}

/**
 * Project a bounded batch, preserving the repository's order exactly.
 *
 * No sorting, grouping, or filtering happens here. The database chose the order — most recent
 * first — and the state and event filters are part of the query, so a second pass in the
 * presentation layer would let the page disagree with the bound that produced it.
 */
export function toOwnerMissedNotificationsView(
  rows: readonly OwnerMissedNotificationRow[],
  limit: number,
  windowDays: number,
): OwnerMissedNotificationsView {
  return {
    items: rows.map(toOwnerMissedNotificationItem),
    batchFilled: rows.length >= limit,
    windowDays,
  };
}
