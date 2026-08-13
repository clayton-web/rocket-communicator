import type { components } from '@aicaa/contracts/schema';
import {
  OVERDUE_SUCCESSFUL_DELIVERY_CEILING,
  decideReminderScheduling,
  type TaskStatus,
} from '@aicaa/domain';
import type { StatusTone } from '@/lib/presentation/task-status';
import { formatOwnerLocalDate } from '@/lib/presentation/datetime';
import { ATTENTION_STOP_REASON_COPY, type ReminderStopReason } from './stop-reason-copy';

type TaskReminderState = components['schemas']['TaskReminderState'];
type AdvanceDisposition = components['schemas']['TaskReminderAdvanceDisposition'];

/**
 * Owner-facing projection of `TaskReminderState` for the Task detail panel (A8.6b; D104, D107, D108).
 *
 * Sentences in, nothing computed. Whether reminders are running, when the next one is owed, how many
 * have gone out, and why a schedule stopped were all decided by the domain and written to the row
 * the API projected. Re-deriving any of that here is how a page and a worker come to disagree about
 * the same schedule (D103, D127) — the same discipline `state.ts` and `attention.ts` already keep.
 *
 * ## Vocabulary boundary
 *
 * `generation` is present on the contract and deliberately absent from this view model. It is the
 * word the schema uses for a reminder cycle, and it is not a word an Owner should have to learn; the
 * panel says "reminder cycle" and shows no number, because the number answers no question an Owner
 * has. Claim leases, worker identifiers, retry counters, fencing, and the reminder version never
 * reach the API projection at all, so there is nothing here to strip.
 *
 * The overdue count and the fourteen-delivery limit *are* shown. Those are policy facts an Owner can
 * act on — they explain why reminders will end, and later why they ended (D106).
 */

/** The most a Task's reminders can be described as doing, in one word for a badge. */
export type ReminderTone = StatusTone;

export interface ReminderFact {
  readonly term: string;
  readonly value: string;
}

/**
 * Why the due-date controls are or are not available.
 *
 * `editable: false` is never a bare disabled button. The Owner is told which Task state forbids the
 * change, because a control that predictably returns `409 DOMAIN_CONFLICT` is worse than no control.
 */
export interface ReminderEditability {
  readonly editable: boolean;
  /** Present exactly when `editable` is false. */
  readonly lockedReason: string | null;
  /**
   * Removal survives states that forbid editing.
   *
   * `DELETE` is allowed on every Task status, including completed and dismissed, because removing a
   * due date only ever reduces activity. It is still only offered when there is something to remove.
   */
  readonly removable: boolean;
}

export interface OwnerReminderView {
  readonly badge: string;
  readonly badgeTone: ReminderTone;
  readonly headline: string;
  readonly explanation: string;
  /** The Owner's canonical due date, formatted, or null when there is none. */
  readonly dueDateText: string | null;
  /** The raw `YYYY-MM-DD` the date input must start from, or '' when there is none. */
  readonly dueDateValue: string;
  readonly facts: readonly ReminderFact[];
  readonly editability: ReminderEditability;
  /** True only when the schedule itself is flagged; drives the Attention cross-reference. */
  readonly requiresOwnerAttention: boolean;
}

/**
 * The panel's own date is named apart from the Task's.
 *
 * A Task carries two independent dates and this is not a naming accident. `Task.dueAt` is the
 * A2-era instant that drives the urgency badge and arrives with a Task from suggestion approval;
 * `dueLocalDate` is the Owner-selected calendar date reminders are computed from, and it is the only
 * one reminders read (D102, D109). Nothing keeps them equal, and D109 deliberately did not backfill
 * one from the other, so a Task really can show a due date at the top of the page and have no
 * reminder due date at all. Two rows both labelled "Due date" would present that as a contradiction
 * or, worse, let an Owner assume the date they can see is the one being reminded about.
 */
export const REMINDER_DUE_DATE_TERM = 'Reminder due date';

const NOT_YET_SCHEDULED_EXPLANATION =
  'Reminders begin only after you set a reminder due date here. Any other due date shown on this Task does not schedule reminders on its own.';

/**
 * How an advance reminder ended up, in Owner words.
 *
 * `scheduled` is the only disposition reachable today, because nothing delivers. The rest are
 * written by the A8.4b worker and are unreachable while `ENABLE_REMINDER_DELIVERY` is unset, but
 * they are contracted values that a future environment will produce, and a panel that rendered a
 * raw enum name — or nothing at all — the first time one appeared would be a defect discovered by
 * an Owner rather than by a test.
 */
const ADVANCE_DISPOSITION_TEXT: Record<AdvanceDisposition, string> = {
  scheduled: 'Scheduled',
  not_enabled: 'Off — the automatic advance reminder is not scheduled',
  delivered: 'Sent',
  skipped_window_elapsed: 'Not sent — the due date was already close when the reminder was set up',
  skipped_waiting_elapsed: 'Not sent — the Task was Waiting when it was due to go out',
  skipped_not_eligible: 'Not sent — the Task was not eligible for reminders at the time',
  failed_permanent: 'Could not be delivered',
  ambiguous: 'Delivery could not be confirmed',
};

/**
 * Stops that are ordinary endings rather than conditions needing a decision.
 *
 * These never raise attention, and unlike the Attention list — which cannot explain a schedule that
 * should not be on it — the Task page knows exactly what happened and says so.
 */
const ORDINARY_STOP_COPY: Record<
  'task_completed' | 'task_dismissed' | 'due_date_removed',
  { badge: string; headline: string; explanation: string }
> = {
  task_completed: {
    badge: 'Reminders ended',
    headline: 'Reminders ended when this Task was completed.',
    explanation:
      'Nothing further will be sent. Completing a Task stops its reminders; this is the normal ending, not a problem.',
  },
  task_dismissed: {
    badge: 'Reminders ended',
    headline: 'Reminders ended when this Task was dismissed.',
    explanation:
      'Nothing further will be sent. Dismissing a Task stops its reminders; this is the normal ending, not a problem.',
  },
  due_date_removed: {
    badge: 'Reminders ended',
    headline: 'Reminders ended when the due date was removed.',
    explanation:
      'Nothing further will be sent. Set a due date again to start a new reminder cycle.',
  },
};

function editability(taskStatus: TaskStatus, hasSomethingToRemove: boolean): ReminderEditability {
  const disposition = decideReminderScheduling(taskStatus);
  if (disposition.kind === 'schedule_active' || disposition.kind === 'schedule_suspended') {
    return { editable: true, lockedReason: null, removable: hasSomethingToRemove };
  }

  /*
   * Terminal Tasks refuse the write, so the panel refuses the control (D104 eligibility).
   *
   * The rule is read from the same domain function the API route enforces, rather than restated
   * here, so the button and the server can never disagree about which statuses are writable.
   */
  const lockedReason =
    taskStatus === 'completed'
      ? 'This Task is completed, so its due date can no longer be changed.'
      : taskStatus === 'dismissed'
        ? 'This Task is dismissed, so its due date can no longer be changed.'
        : 'This Task’s current state does not allow its due date to be changed.';

  return { editable: false, lockedReason, removable: hasSomethingToRemove };
}

function overdueProgressText(delivered: number): string {
  return `${delivered} of ${OVERDUE_SUCCESSFUL_DELIVERY_CEILING} daily reminders sent`;
}

function activeFacts(state: TaskReminderState): ReminderFact[] {
  const facts: ReminderFact[] = [];

  const advance = state.advance;
  if (advance) {
    const when = advance.occurrence
      ? `${formatOwnerLocalDate(advance.occurrence.localDate)} — ${ADVANCE_DISPOSITION_TEXT[advance.disposition]}`
      : ADVANCE_DISPOSITION_TEXT[advance.disposition];
    facts.push({ term: 'Reminder before the due date', value: when });
  }

  if (state.nextOverdueOccurrence) {
    facts.push({
      term: 'Next overdue reminder',
      value: formatOwnerLocalDate(state.nextOverdueOccurrence.localDate),
    });
  }

  if (typeof state.overdueDeliveredCount === 'number') {
    facts.push({
      term: 'Overdue reminders',
      value: overdueProgressText(state.overdueDeliveredCount),
    });
  }

  return facts;
}

/**
 * Facts worth keeping after a stop.
 *
 * A stopped schedule's advance and next-overdue values are history rather than intent, so showing
 * "Next overdue reminder: 12 Aug" beside "reminders stopped" would contradict itself. What survives
 * is the count, because after the ceiling it is the explanation.
 */
function stoppedFacts(state: TaskReminderState): ReminderFact[] {
  if (typeof state.overdueDeliveredCount !== 'number') {
    return [];
  }
  return [{ term: 'Overdue reminders', value: overdueProgressText(state.overdueDeliveredCount) }];
}

function stoppedView(
  state: TaskReminderState,
  taskStatus: TaskStatus,
  dueDateText: string | null,
  dueDateValue: string,
): OwnerReminderView {
  const reason = state.stopReason as ReminderStopReason | null;
  const attention =
    reason === 'overdue_ceiling_reached' ||
    reason === 'permanent_delivery_failure' ||
    reason === 'repeated_ambiguous_outcomes'
      ? ATTENTION_STOP_REASON_COPY[reason]
      : null;

  if (attention) {
    return {
      badge: attention.badge,
      badgeTone: attention.badgeTone,
      headline: attention.headline,
      explanation: `${attention.explanation} Setting a due date starts a new reminder cycle.`,
      dueDateText,
      dueDateValue,
      facts: stoppedFacts(state),
      editability: editability(taskStatus, dueDateText !== null),
      requiresOwnerAttention: state.requiresOwnerAttention,
    };
  }

  const ordinary =
    reason === null
      ? null
      : (ORDINARY_STOP_COPY[reason as keyof typeof ORDINARY_STOP_COPY] ?? null);

  return {
    badge: ordinary?.badge ?? 'Reminders stopped',
    badgeTone: 'neutral',
    headline: ordinary?.headline ?? 'Reminders have stopped for this Task.',
    explanation:
      ordinary?.explanation ??
      'Nothing further will be sent. Setting a due date starts a new reminder cycle.',
    dueDateText,
    dueDateValue,
    facts: stoppedFacts(state),
    editability: editability(taskStatus, dueDateText !== null),
    requiresOwnerAttention: state.requiresOwnerAttention,
  };
}

/**
 * Project reminder state plus the Task's status into everything the panel renders.
 *
 * Task status is a required input rather than an inference from reminder state, because the two
 * answer different questions. Reminder state says what the schedule is doing; Task status decides
 * whether the Owner may change it, and only the second one predicts a `409`.
 */
export function toOwnerReminderView(
  state: TaskReminderState,
  taskStatus: TaskStatus,
): OwnerReminderView {
  const dueLocalDate = state.dueLocalDate ?? null;
  const dueDateText = dueLocalDate === null ? null : formatOwnerLocalDate(dueLocalDate);
  const dueDateValue = dueLocalDate ?? '';
  const canEdit = editability(taskStatus, dueLocalDate !== null);

  switch (state.state) {
    case 'no_due_date':
      return {
        badge: 'No due date',
        badgeTone: 'neutral',
        headline: 'No reminders are scheduled for this Task.',
        explanation: NOT_YET_SCHEDULED_EXPLANATION,
        dueDateText: null,
        dueDateValue: '',
        facts: [],
        editability: { ...canEdit, removable: false },
        requiresOwnerAttention: false,
      };

    /*
     * A due date with no schedule behind it.
     *
     * No write path produces this: establishing the due date and the schedule is one transaction, so
     * reaching it would mean a row the application did not write. It is handled rather than treated
     * as impossible because the alternative — a blank panel, or copy claiming reminders are running —
     * is the worst possible response to a state nobody understands. Re-saving the date establishes a
     * schedule through the ordinary path, which is also the repair.
     */
    case 'not_scheduled':
      return {
        badge: 'Not scheduled',
        badgeTone: 'caution',
        headline: 'This Task has a due date, but no reminders are scheduled.',
        explanation:
          'Rocket does not expect this combination, and it will not send reminders in it. Saving the due date again sets up the schedule.',
        dueDateText,
        dueDateValue,
        facts: [],
        editability: canEdit,
        requiresOwnerAttention: state.requiresOwnerAttention,
      };

    case 'active':
      return {
        badge: 'Reminders on',
        badgeTone: 'positive',
        headline: 'Reminders are scheduled for this Task.',
        explanation:
          'Rocket reminds the assigned Recipient once before the due date, then once a day while the Task is overdue, up to fourteen daily reminders.',
        dueDateText,
        dueDateValue,
        facts: activeFacts(state),
        editability: canEdit,
        requiresOwnerAttention: state.requiresOwnerAttention,
      };

    /*
     * Waiting suspension (D107). No resume control is offered, and that is a product rule rather
     * than an omission: suspension follows Task state, so the way to resume reminders is to take the
     * Task out of Waiting. A "resume reminders" button would either lie or silently change the Task.
     */
    case 'suspended_waiting':
      return {
        badge: 'Reminders paused',
        badgeTone: 'caution',
        headline: 'Reminders are paused because this Task is Waiting.',
        explanation:
          'Nothing will be sent while the Task is Waiting, and Rocket will not send the missed reminders afterwards. Reminders resume on their normal schedule once the Task is no longer Waiting.',
        dueDateText,
        dueDateValue,
        facts: [],
        editability: canEdit,
        requiresOwnerAttention: state.requiresOwnerAttention,
      };

    case 'stopped':
      return stoppedView(state, taskStatus, dueDateText, dueDateValue);
  }
}

/**
 * Whether saving `nextDueLocalDate` restarts the reminder cycle, and therefore needs disclosure.
 *
 * Mirrors what the server will actually do (D104), which is narrower than "the date changed":
 *
 * - First due date — nothing to restart, so no disclosure.
 * - No schedule behind the date (`not_scheduled`) — saving establishes the first cycle rather than
 *   replacing one, and there is no delivered count to reset.
 * - Same date on a live schedule — the server treats it as a no-op and writes nothing, so promising
 *   a restart would be a lie the Owner could disprove by reloading.
 * - Same date on a *stopped* schedule — this is reactivation (D109) and really does open a new
 *   cycle, which is exactly the repair path from `/attention`. It must be disclosed.
 * - Different date on any live or stopped schedule — a real material change.
 */
export function restartsReminderCycle(state: TaskReminderState, nextDueLocalDate: string): boolean {
  if (state.state === 'no_due_date' || state.state === 'not_scheduled') {
    return false;
  }
  const current = state.dueLocalDate ?? null;
  if (current === null) {
    return false;
  }
  if (state.state === 'stopped') {
    return true;
  }
  return current !== nextDueLocalDate;
}
