import type { LocalDate, TaskStatus, UtcInstant } from '@aicaa/domain';
import {
  decideReminderLifecycleIntent,
  OVERDUE_SUCCESSFUL_DELIVERY_CEILING,
  selectNextOverdueOccurrence,
} from '../../../domain/dist/index.js';
import type { DbTransaction } from '../client/create-prisma-client.js';
import type { CreateAuditEventInput } from '../repositories/audit-repository.js';
import type {
  PersistedReminderSchedule,
  ReminderScheduleStatus,
  ReminderScheduleStopReason,
} from '../mappers/reminder-mappers.js';
import {
  findReminderScheduleByTaskId,
  resumeReminderScheduleFromWaiting,
  stopReminderSchedule,
  suspendReminderScheduleForWaiting,
} from '../repositories/reminder-schedule-repository.js';
import { lockTaskScopeForReminderMutation } from '../repositories/reminder-scope-guard.js';

/**
 * Reminder schedule state follows Task lifecycle state, in the Task's own transaction (D107).
 *
 * A8.3b left this unwired on purpose: the Owner API could create and change a schedule, but nothing
 * reacted when the Task itself moved. A Task could be completed while its schedule stayed active,
 * holding a claimable occurrence — harmless only because no worker existed to claim it. This module
 * is the wiring, and it exists before A8.4 for exactly that reason.
 *
 * ## Why this is not a transaction
 *
 * Every function here takes a `DbTransaction`, never a `DbClient`. It cannot open a transaction of
 * its own, because the whole point is that it joins the one already committing the Task status. A
 * second transaction afterwards would produce precisely the state this wiring is meant to make
 * impossible: a committed terminal Task whose schedule is still armed, if the second transaction
 * failed or the process died between them. Suspension is not a compensating action to be retried
 * later; it is part of what it means for the Task to be Waiting.
 *
 * ## Reconciliation, not a transition list
 *
 * The reconciler is not told which transition happened. It reads the Task's new status, asks the
 * domain what that status requires of a schedule, reads the schedule's actual state, and closes any
 * gap. That makes every operation naturally idempotent — re-running it changes nothing, because the
 * gap is already closed — and means a Task status this module has never heard of still cannot end up
 * with a claimable occurrence it should not have. A transition-keyed switch would need a new case for
 * every future status and would silently do nothing if someone forgot to add one.
 *
 * ## Lock order (A8.3b re-audit M1)
 *
 * The Task row lock is taken first, as everywhere else. In practice the caller already holds it —
 * `applyTaskUpdateWithExpectedVersion` locks the row when it writes the status — and re-locking a row
 * the transaction already owns is free. It is taken explicitly anyway so this module's correctness
 * does not depend on a caller's write order that a later refactor could change.
 *
 * Nothing here sends, claims, or scans. It only ever *clears* claimable state.
 */

/** What the reconciler did. Deliberately no `'none'` member: no change means no effect and no event. */
export type ReminderLifecycleTransition =
  'suspended_for_waiting' | 'resumed_from_waiting' | 'stopped';

export interface ReminderLifecycleEffect {
  readonly transition: ReminderLifecycleTransition;
  /** The Task status that required this change, for the audit trail. */
  readonly taskStatus: TaskStatus;
  readonly scheduleId: string;
  readonly priorStatus: ReminderScheduleStatus;
  readonly priorReminderVersion: number;
  /** The schedule after the change. */
  readonly schedule: PersistedReminderSchedule;
  /** Present only for `'stopped'`. */
  readonly stopReason: ReminderScheduleStopReason | null;
  /**
   * The occurrence a resume armed, or null when it armed none. Always strictly after `now` — resume
   * computes forward and never replays what Waiting covered (D107).
   */
  readonly nextOverdueOccurrenceAt: string | null;
}

export interface ReconcileReminderScheduleInput {
  readonly organizationId: string;
  readonly taskId: string;
  /** The Task's status *after* the lifecycle transition this transaction is committing. */
  readonly taskStatus: TaskStatus;
  readonly now: string;
}

/**
 * Bring a Task's reminder schedule into agreement with the Task's new status.
 *
 * Returns the change that was made, or `null` when the schedule already agreed — including the very
 * common case of a Task that has no schedule at all. A `null` result means the caller must write no
 * reminder audit event, because nothing happened to describe.
 *
 * Terminally stopped schedules are never revived and never reinterpreted. A stopped schedule stays
 * stopped whatever the Task does next: it is not converted to a Waiting suspension when the Task
 * waits, and not resumed when the Task leaves Waiting. Reactivating a reminder is an Owner decision
 * (D107), and this reconciler is not empowered to make it — which is also why it is safe under the
 * reopen/restore rule, since it cannot resurrect anything a terminal transition stopped.
 */
export async function reconcileReminderScheduleForTaskStatus(
  tx: DbTransaction,
  input: ReconcileReminderScheduleInput,
): Promise<ReminderLifecycleEffect | null> {
  const scope = await lockTaskScopeForReminderMutation(tx, input.organizationId, input.taskId);
  const schedule = await findReminderScheduleByTaskId(tx, scope.organizationId, scope.taskId);
  if (schedule === null) {
    return null;
  }

  const intent = decideReminderLifecycleIntent(input.taskStatus);
  const base = {
    taskStatus: input.taskStatus,
    scheduleId: schedule.id,
    priorStatus: schedule.status,
    priorReminderVersion: schedule.reminderVersion,
  } as const;

  switch (intent.kind) {
    case 'ensure_suspended_for_waiting': {
      if (schedule.status !== 'active') {
        return null;
      }
      const suspended = await suspendReminderScheduleForWaiting(tx, {
        organizationId: scope.organizationId,
        scheduleId: schedule.id,
        suspendedAt: input.now,
      });
      return {
        ...base,
        transition: 'suspended_for_waiting',
        schedule: suspended,
        stopReason: null,
        nextOverdueOccurrenceAt: null,
      };
    }

    case 'ensure_active': {
      if (schedule.status !== 'suspended_waiting') {
        return null;
      }
      const occurrence = nextOccurrenceOnResume(schedule, input.now);
      const resumed = await resumeReminderScheduleFromWaiting(tx, {
        organizationId: scope.organizationId,
        scheduleId: schedule.id,
        nextOverdueOccurrence: occurrence,
      });
      return {
        ...base,
        transition: 'resumed_from_waiting',
        schedule: resumed,
        stopReason: null,
        nextOverdueOccurrenceAt: occurrence?.occurrenceAt ?? null,
      };
    }

    case 'ensure_stopped': {
      if (schedule.status === 'stopped') {
        return null;
      }
      const stopped = await stopReminderSchedule(tx, {
        organizationId: scope.organizationId,
        scheduleId: schedule.id,
        reason: intent.reason,
        stoppedAt: input.now,
      });
      return {
        ...base,
        transition: 'stopped',
        schedule: stopped,
        stopReason: intent.reason,
        nextOverdueOccurrenceAt: null,
      };
    }
  }
}

/**
 * Audit actions for lifecycle-derived reminder transitions.
 *
 * Namespaced under `reminder.schedule.` like the Owner actions in the reminder service, but distinct
 * from all of them: `reminder.schedule.stopped` is not `reminder.due_date.removed`, because a Task
 * being completed and an Owner deleting a due date are different events with different causes, and
 * the A8.3b audit already established that collapsing distinct reminder acts into one action name
 * leaves the history unable to answer why reminders ended.
 */
export const REMINDER_LIFECYCLE_AUDIT_ACTIONS: Record<ReminderLifecycleTransition, string> = {
  suspended_for_waiting: 'reminder.schedule.suspended',
  resumed_from_waiting: 'reminder.schedule.resumed',
  stopped: 'reminder.schedule.stopped',
};

/**
 * Describe a lifecycle-derived reminder transition as an audit event (D110).
 *
 * ## Attribution
 *
 * The actor is copied from the Task lifecycle event that caused the transition, so a suspension a
 * Recipient caused by marking a Task Waiting is attributed to that capability and never to the Owner.
 * D110's rule that an automated *send* must be attributed to `system` rather than the Owner is not in
 * tension with this: nothing was sent, and a state change that exists only because a human acted has
 * a human cause worth recording. Recording it as `system` would erase the one fact most worth
 * keeping — which of the two parties paused this Task's reminders.
 *
 * That the transition was *derived* rather than directly chosen is carried by the action name, which
 * no Owner reminder request can produce, and by the explicit `cause=` field naming the lifecycle
 * action. So the event answers both questions the audit trail needs: who acted, and what the system
 * concluded from it. No autonomous worker actor is introduced.
 *
 * ## What is recorded
 *
 * The lifecycle action, prior and resulting schedule state, generation, stop reason, and the armed
 * occurrence — all of them scheduling facts. `resourceVersion` carries the *reminder* version rather
 * than the Task version, matching the Owner reminder events.
 *
 * `intendedRecipientEmail` is deliberately **not** copied from the causing event even when present.
 * `capabilityId` already identifies the actor precisely, so the address would add no attribution and
 * duplicate an identifier into a second row for nothing.
 *
 * The id is derived from the causing event's id rather than randomly generated, which both records
 * the causal link in the identifier itself and keeps this module free of id generation. Budget: the
 * column holds 64 characters and audit ids are `audit_` plus 16, so the suffix fits with room spare.
 */
export function buildReminderLifecycleAudit(
  cause: {
    readonly id: string;
    readonly organizationId: string;
    readonly actorKind: 'owner' | 'capability' | 'system';
    readonly ownerId?: string;
    readonly capabilityId?: string;
    readonly systemId?: string;
    readonly assignmentId?: string;
    readonly action: string;
    readonly requestId?: string;
    readonly correlationId?: string | null;
  },
  effect: ReminderLifecycleEffect,
  recordedAt: string,
): CreateAuditEventInput {
  const note = [
    `cause=${cause.action}`,
    `transition=${effect.transition}`,
    `from=${effect.priorStatus}`,
    `to=${effect.schedule.status}`,
    `generation=${effect.schedule.generation}`,
    effect.stopReason === null ? null : `stop_reason=${effect.stopReason}`,
    effect.transition === 'resumed_from_waiting'
      ? `next_overdue_occurrence_at=${effect.nextOverdueOccurrenceAt ?? 'none'}`
      : null,
    `overdue_delivered_count=${effect.schedule.overdueDeliveredCount}`,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(' ');

  return {
    id: `${cause.id}.reminder`,
    organizationId: cause.organizationId,
    actorKind: cause.actorKind,
    ownerId: cause.ownerId,
    capabilityId: cause.capabilityId,
    systemId: cause.systemId,
    assignmentId: cause.assignmentId,
    taskId: effect.schedule.taskId,
    action: REMINDER_LIFECYCLE_AUDIT_ACTIONS[effect.transition],
    outcome: 'succeeded',
    resourceVersion: effect.schedule.reminderVersion,
    taskStatus: effect.taskStatus,
    note,
    requestId: cause.requestId,
    correlationId: cause.correlationId,
    recordedAt,
  };
}

/**
 * The occurrence to arm when leaving Waiting: the next future one, or none.
 *
 * `selectNextOverdueOccurrence` is the same domain function establishment uses, and it guarantees an
 * instant strictly after `now` while skipping every elapsed local day rather than accumulating them
 * (D107). Passing the resume instant as `now` is therefore the entire no-backlog rule: a Task that
 * waited three weeks arms tomorrow morning, not twenty-one missed mornings, and nothing is due the
 * moment the Task resumes merely because time passed.
 *
 * The anchor is the schedule generation's own `dueLocalDate` and `schedulingTimeZone`, not the Task's
 * current due date. They agree by construction — a material due-date change opens a new generation
 * (D104) — and using the generation's own values means resume cannot silently re-anchor a generation
 * to a date it was never established for.
 *
 * A generation that has already delivered its ceiling arms nothing. Resuming it with an occurrence
 * would let Waiting be used to buy overdue reminders past the D106 limit, and the count is preserved
 * across suspension precisely so that cannot happen.
 */
function nextOccurrenceOnResume(
  schedule: PersistedReminderSchedule,
  now: string,
): { occurrenceLocalDate: LocalDate; occurrenceAt: string } | null {
  if (schedule.overdueDeliveredCount >= OVERDUE_SUCCESSFUL_DELIVERY_CEILING) {
    return null;
  }
  const occurrence = selectNextOverdueOccurrence({
    dueLocalDate: schedule.dueLocalDate,
    now: now as UtcInstant,
    timeZone: schedule.schedulingTimeZone,
  });
  return {
    occurrenceLocalDate: occurrence.occurrenceLocalDate,
    occurrenceAt: occurrence.occurrenceAt,
  };
}
