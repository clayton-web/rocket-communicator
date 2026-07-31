import {
  REMINDER_SCHEDULING_TIME_ZONE,
  decideAdvanceReminder,
  decideReminderScheduling,
  parseLocalDate,
  selectNextOverdueOccurrence,
  type AdvanceReminderDisposition,
  type LocalDate,
  type OwnerActor,
  type Task,
  type UtcInstant,
} from '@aicaa/domain';
import type { DbClient, PersistedReminderSchedule } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { taskServiceError } from '@/lib/tasks/errors';
import {
  buildOwnerAudit,
  loadOwnerTask,
  mapDomainOrPersistenceError,
  newEntityId,
  requireOwnerActor,
} from '@/lib/tasks/internal';
import { currentReminderVersion } from './etag';
import {
  noDueDateState,
  toTaskReminderState,
  unscheduledDueDateState,
  type TaskReminderState,
} from './state';

/**
 * Owner reminder service (A8.3b).
 *
 * This module is the only place the reminder API decides anything, and it decides nothing about
 * reminder law. Every calendar and scheduling question is answered by the A8.2 domain
 * (`parseLocalDate`, `decideAdvanceReminder`, `selectNextOverdueOccurrence`) and every write goes
 * through an A8.3a-backed transaction — including the question of whether a save changes anything,
 * which the transaction answers with `isDueDateChangeMaterial` under the Task lock. What lives here
 * is orchestration: authorize, ask the domain, hand the answer to persistence, project the result.
 *
 * No scheduling, claiming, sending, retrying, or delivering happens in A8.3b. A schedule row is
 * created and kept truthful; nothing consumes it yet.
 */

/**
 * Audit actions for reminder mutations, namespaced like the A6/A7 conventions.
 *
 * `reactivated` is distinct from `changed` (A8.3b audit F4). Restarting reminders for a Task whose
 * schedule had stopped is a materially different Owner act from adjusting a live due date — it is the
 * only way stopped reminders resume (D109) — and recording both as `changed` left the history unable
 * to answer "when did reminders start again, and what had stopped them?".
 */
export const REMINDER_AUDIT_ACTIONS = {
  established: 'reminder.schedule.established',
  changed: 'reminder.schedule.changed',
  reactivated: 'reminder.schedule.reactivated',
  removed: 'reminder.due_date.removed',
} as const;

export interface OwnerReminderCommand {
  readonly db: DbClient;
  readonly owner: OwnerActor;
  readonly taskId: string;
  readonly now: string;
  /** The reminder version from the caller's `If-Match`. Required for every mutation. */
  readonly expectedReminderVersion?: number;
  readonly requestId?: string;
}

export interface SetOwnerReminderCommand extends OwnerReminderCommand {
  readonly dueLocalDate: string;
}

/**
 * Reject a stale reminder `If-Match` before any write (A8.3b audit F5).
 *
 * This is the preflight; the authoritative check is the compare-and-set inside the transaction,
 * which runs under the Task row lock and is what actually makes a race safe. The preflight exists so
 * a caller with an obviously stale token gets a clean 412 without a write attempt, and so
 * establishment — protected in the database by a unique index rather than a version — still refuses
 * a caller who thinks no schedule exists when one does.
 */
function assertExpectedReminderVersion(observed: number, expected: number | undefined): number {
  if (expected === undefined) {
    throw taskServiceError(
      'PRECONDITION_REQUIRED',
      'If-Match header is required for this mutation.',
    );
  }
  if (expected !== observed) {
    throw taskServiceError(
      'PRECONDITION_FAILED',
      'The reminder resource has changed since the provided ETag.',
    );
  }
  // Returned so a caller can pass the *caller's* version into the transaction's compare-and-set
  // rather than the version it happened to observe, keeping the preflight advisory.
  return expected;
}

/**
 * Decide what a due-date mutation may do to this Task, and in what state its schedule must sit
 * (A8.3b audit F1).
 *
 * The audit found no Task-state gate at all: a `PUT` established an *active* schedule on a completed,
 * dismissed, or Waiting Task, so a future worker would have found claimable occurrences for work that
 * was finished or explicitly paused. D107 already answers this — Waiting suspends reminder
 * scheduling and is the only pause mechanism; completion and dismissal stop reminders permanently —
 * so the rule is applied here rather than invented.
 *
 * The decision itself lives in the A8.2 domain (`decideReminderScheduling`), so the future worker and
 * the lifecycle wiring in A8.4a read the same policy rather than reimplementing it.
 */
function requireSchedulableTask(task: Task): 'active' | 'suspended_waiting' {
  const disposition = decideReminderScheduling(task.status);
  switch (disposition.kind) {
    case 'schedule_active':
      return 'active';
    case 'schedule_suspended':
      return 'suspended_waiting';
    default:
      throw taskServiceError(
        'DOMAIN_CONFLICT',
        disposition.reason === 'task_terminal'
          ? `Reminders cannot be scheduled for a ${task.status} task.`
          : `Reminders cannot be scheduled for a task with status ${task.status}.`,
      );
  }
}

/**
 * Build the privacy-safe audit note for a reminder mutation (A8.3b audit F4).
 *
 * The audit found the events recorded only their action and Task: a `reminder.schedule.changed` row
 * could not say which date changed to which, so the history proved that *something* happened without
 * proving *what*. Dates, generations, states, and stop reasons are all the Owner's own scheduling
 * choices, not Task or message content, so recording them leaks nothing — and deliberately nothing
 * else is recorded: no worker internals, no message body, no capability token, no provider id.
 */
function reminderAuditNote(fields: Record<string, string | number | null | undefined>): string {
  return Object.entries(fields)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
}

/** Parse an Owner-supplied due date through the canonical A8.2 boundary (D103). */
function requireDueLocalDate(value: string): LocalDate {
  try {
    return parseLocalDate(value);
  } catch {
    throw taskServiceError(
      'VALIDATION_ERROR',
      'dueLocalDate must be a real organization-local calendar date in YYYY-MM-DD form.',
    );
  }
}

interface DerivedSchedule {
  readonly advance: AdvanceReminderDisposition;
  readonly nextOverdueOccurrence: { occurrenceLocalDate: LocalDate; occurrenceAt: string } | null;
}

/**
 * Ask the A8.2 domain for everything a generation needs.
 *
 * `establishedAt` and `now` are the same instant on purpose: the advance decision's reference point
 * is the moment the Owner established this generation (D105), and the next overdue occurrence is
 * selected from that same moment, so the two cannot disagree about what "already elapsed" means.
 */
function deriveSchedule(dueLocalDate: LocalDate, now: string): DerivedSchedule {
  const at = now as UtcInstant;
  return {
    advance: decideAdvanceReminder({ dueLocalDate, establishedAt: at }),
    nextOverdueOccurrence: selectNextOverdueOccurrence({ dueLocalDate, now: at }),
  };
}

function advanceOccurrenceInput(advance: AdvanceReminderDisposition) {
  return {
    occurrenceLocalDate: advance.occurrenceLocalDate,
    occurrenceAt: advance.occurrenceAt as string,
  };
}

function nextOverdueInput(derived: DerivedSchedule) {
  if (!derived.nextOverdueOccurrence) {
    return null;
  }
  return {
    occurrenceLocalDate: derived.nextOverdueOccurrence.occurrenceLocalDate,
    occurrenceAt: derived.nextOverdueOccurrence.occurrenceAt as string,
  };
}

/**
 * The skipped-advance attempt to record alongside the schedule, when the advance window had already
 * elapsed at establishment (D105).
 */
function skippedAdvanceAttempt(advance: AdvanceReminderDisposition, now: string) {
  if (advance.kind !== 'skipped') {
    return undefined;
  }
  return {
    id: newEntityId('rda'),
    skipReason: advance.reason,
    recordedAt: now,
  } as const;
}

async function findSchedule(
  db: DbClient,
  organizationId: string,
  taskId: string,
): Promise<PersistedReminderSchedule | null> {
  const { findReminderScheduleByTaskId } = await loadDbRuntime();
  return findReminderScheduleByTaskId(db, organizationId, taskId);
}

async function readCanonicalDueLocalDate(
  db: DbClient,
  organizationId: string,
  taskId: string,
): Promise<string | null> {
  const { getTaskDueLocalDate } = await loadDbRuntime();
  return getTaskDueLocalDate(db, organizationId, taskId);
}

/**
 * Read reminder state for a Task the Owner may access.
 *
 * `loadOwnerTask` scopes by the Owner's organization and surfaces a foreign-organization Task as
 * not-found, which is the repository's established convention and keeps this route from confirming
 * that another organization's Task exists.
 */
export async function getOwnerTaskReminder(
  command: OwnerReminderCommand,
): Promise<TaskReminderState> {
  const owner = requireOwnerActor(command.owner);
  const task = await loadOwnerTask(command.db, owner, command.taskId);

  try {
    const [schedule, dueLocalDate] = await Promise.all([
      findSchedule(command.db, owner.organizationId, task.id),
      readCanonicalDueLocalDate(command.db, owner.organizationId, task.id),
    ]);

    if (schedule) {
      return toTaskReminderState(schedule, dueLocalDate);
    }
    return dueLocalDate === null
      ? noDueDateState(task.id)
      : unscheduledDueDateState(task.id, dueLocalDate);
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}

export interface SetOwnerReminderResult {
  readonly state: TaskReminderState;
  /** False when the request was an immaterial repeat, so no audit event was written. */
  readonly changed: boolean;
}

/**
 * Establish or materially change a Task's due date and reminder schedule.
 *
 * Three cases, and the distinction between the second and third is the subtle one:
 *
 * - **No schedule yet** — establish one, opening generation 1.
 * - **Live schedule, same effective date** — idempotent. Return current state, write nothing, and
 *   emit no audit event. Re-saving must not reset the delivered count, or repeated saves would
 *   defeat the D106 ceiling.
 * - **Live schedule, different date, or any stopped schedule** — open the next generation. A stopped
 *   schedule is *not* the same effective schedule as a live one, so re-setting even an identical date
 *   after a stop is a real change; D109 requires an explicit Owner re-save to reactivate reminders,
 *   and treating that as a no-op would silently refuse the Owner's request.
 *
 * Whether the resulting generation is live or suspended is not this function's decision — a Waiting
 * Task's schedule is born suspended (D107), and a completed or dismissed Task cannot acquire one at
 * all. See `requireSchedulableTask`.
 *
 * ## The immaterial-repeat decision belongs to the transaction (A8 lifecycle audit H-1)
 *
 * The second case above used to be decided here, from a schedule read and a canonical-due-date read
 * taken before any lock. Those are two snapshots, and under contention they could be paired into a
 * `200` describing an active schedule with a `NULL` due date and a stale ETag — a representation that
 * never existed. The read below is now advisory only: it routes between establishment and generation
 * change and produces a clean preflight `412`/`428`, but the authoritative decision — including
 * whether anything needs to change at all — is made by `persistOwnerReminderGenerationChange` under
 * the Task lock, from one snapshot, after the version precondition.
 */
export async function setOwnerTaskReminder(
  command: SetOwnerReminderCommand,
): Promise<SetOwnerReminderResult> {
  const owner = requireOwnerActor(command.owner);
  const dueLocalDate = requireDueLocalDate(command.dueLocalDate);
  const task = await loadOwnerTask(command.db, owner, command.taskId);

  try {
    const runtime = await loadDbRuntime();
    const existing = await findSchedule(command.db, owner.organizationId, task.id);
    const expectedReminderVersion = assertExpectedReminderVersion(
      currentReminderVersion(existing),
      command.expectedReminderVersion,
    );

    const targetStatus = requireSchedulableTask(task);
    const suspended = targetStatus === 'suspended_waiting';
    const derived = deriveSchedule(dueLocalDate, command.now);
    // A suspended generation records no skipped advance: skipping is a delivery outcome for an
    // occurrence that was owed, and a suspended schedule owes none (D105, D107).
    const skipped = suspended ? undefined : skippedAdvanceAttempt(derived.advance, command.now);

    if (!existing) {
      const result = await runtime.persistOwnerReminderEstablishment({
        db: command.db,
        schedule: {
          id: newEntityId('trs'),
          organizationId: owner.organizationId,
          taskId: task.id,
          dueLocalDate,
          schedulingTimeZone: REMINDER_SCHEDULING_TIME_ZONE,
          establishedAt: command.now,
          advanceDisposition:
            derived.advance.kind === 'skipped' ? 'skipped_window_elapsed' : 'scheduled',
          advanceOccurrence: advanceOccurrenceInput(derived.advance),
          nextOverdueOccurrence: nextOverdueInput(derived),
          status: targetStatus,
          suspendedAt: suspended ? command.now : undefined,
        },
        skippedAdvanceAttempt: skipped,
        audit: buildOwnerAudit({
          id: newEntityId('audit'),
          owner,
          action: REMINDER_AUDIT_ACTIONS.established,
          taskId: task.id,
          taskStatus: task.status,
          // The reminder version the mutation produces, not the Task's. Deterministic because the
          // event is only written if the same transaction's schedule write succeeded.
          resourceVersion: 1,
          note: reminderAuditNote({
            dueLocalDate,
            generation: 1,
            state: targetStatus,
          }),
          now: command.now as UtcInstant,
          requestId: command.requestId,
        }),
      });
      return {
        state: toTaskReminderState(result.schedule, result.schedule.dueLocalDate),
        changed: true,
      };
    }

    const result = await runtime.persistOwnerReminderGenerationChange({
      db: command.db,
      generation: {
        organizationId: owner.organizationId,
        taskId: task.id,
        expectedGeneration: existing.generation,
        expectedReminderVersion,
        dueLocalDate,
        schedulingTimeZone: REMINDER_SCHEDULING_TIME_ZONE,
        establishedAt: command.now,
        advanceDisposition:
          derived.advance.kind === 'skipped' ? 'skipped_window_elapsed' : 'scheduled',
        advanceOccurrence: advanceOccurrenceInput(derived.advance),
        nextOverdueOccurrence: nextOverdueInput(derived),
        status: targetStatus,
        suspendedAt: suspended ? command.now : undefined,
      },
      skippedAdvanceAttempt: skipped,
      audit: (outcome) =>
        buildOwnerAudit({
          id: newEntityId('audit'),
          owner,
          action: outcome.reactivating
            ? REMINDER_AUDIT_ACTIONS.reactivated
            : REMINDER_AUDIT_ACTIONS.changed,
          taskId: task.id,
          taskStatus: task.status,
          resourceVersion: outcome.schedule.reminderVersion,
          note: reminderAuditNote({
            priorDueLocalDate: outcome.priorSchedule.dueLocalDate,
            dueLocalDate: outcome.schedule.dueLocalDate,
            priorGeneration: outcome.priorSchedule.generation,
            generation: outcome.schedule.generation,
            priorStopReason: outcome.reactivating ? outcome.priorSchedule.stopReason : undefined,
            state: outcome.schedule.status,
          }),
          now: command.now as UtcInstant,
          requestId: command.requestId,
        }),
    });
    // Projected from the schedule alone. For a material change the transaction wrote both the
    // schedule and the canonical due date; for a no-op it proved the two already agree. Either way
    // this is one snapshot, which is the property the audit found missing.
    return {
      state: toTaskReminderState(result.schedule, result.schedule.dueLocalDate),
      changed: result.changed,
    };
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}

/**
 * Remove the canonical due date and stop reminders (D107).
 *
 * Idempotent when there is nothing left to remove: no due date and no live schedule means the
 * request already holds, so the current state is returned without a write or an audit event. An
 * audit trail should record removals that happened, not requests that asked for a state already
 * reached. That decision belongs to the transaction, under the Task lock — see below.
 *
 * Allowed for every Task status, including completed and dismissed. Removal can only ever reduce
 * reminder activity, so refusing it for a terminal Task would strand an active schedule with no way
 * to switch it off — the opposite of what D107 wants.
 *
 * ## The precondition is the transaction's, not this function's (A8.3b re-audit H1)
 *
 * The read below is a preflight only, kept so a caller with an obviously stale or missing token gets
 * a clean 412 or 428 without a write attempt. It cannot decide anything, because by the time the
 * transaction runs it may already be stale — and the re-audit reproduced exactly that: this service
 * observed no live schedule, so it told persistence to clear the due date with no precondition, and a
 * concurrent reactivation left an active schedule behind a `NULL` due date and a removal event.
 *
 * The caller's `If-Match` version is therefore what is passed down, not anything this function
 * observed, and the transaction re-reads and classifies the schedule under the Task lock. **Including
 * whether there is anything to remove at all**: this function used to answer that from its own two
 * reads, which are not one snapshot, so under contention it could pair a due date already cleared by
 * a winning removal with a schedule version from before that removal and answer 200 with a stale
 * ETag. The audit note is built from authoritative in-transaction state rather than from the
 * preflight, which is why it is a callback.
 */
export async function removeOwnerTaskReminder(
  command: OwnerReminderCommand,
): Promise<SetOwnerReminderResult> {
  const owner = requireOwnerActor(command.owner);
  const task = await loadOwnerTask(command.db, owner, command.taskId);

  try {
    const runtime = await loadDbRuntime();
    const existing = await findSchedule(command.db, owner.organizationId, task.id);
    const expectedReminderVersion = assertExpectedReminderVersion(
      currentReminderVersion(existing),
      command.expectedReminderVersion,
    );

    const result = await runtime.persistOwnerReminderDueDateRemoval({
      db: command.db,
      organizationId: owner.organizationId,
      taskId: task.id,
      stoppedAt: command.now,
      expectedReminderVersion,
      audit: (outcome) =>
        buildOwnerAudit({
          id: newEntityId('audit'),
          owner,
          action: REMINDER_AUDIT_ACTIONS.removed,
          taskId: task.id,
          taskStatus: task.status,
          resourceVersion: outcome.stoppedSchedule?.reminderVersion,
          note: reminderAuditNote({
            dueLocalDate: outcome.priorDueLocalDate ?? outcome.priorSchedule?.dueLocalDate,
            generation: outcome.priorSchedule?.generation,
            priorState: outcome.priorSchedule?.status,
            stopReason: outcome.stoppedSchedule ? 'due_date_removed' : undefined,
            state: outcome.stoppedSchedule ? 'stopped' : 'no_due_date',
          }),
          now: command.now as UtcInstant,
          requestId: command.requestId,
        }),
    });

    return {
      state: result.schedule ? toTaskReminderState(result.schedule, null) : noDueDateState(task.id),
      changed: result.changed,
    };
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}
