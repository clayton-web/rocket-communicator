import {
  REMINDER_SCHEDULING_TIME_ZONE,
  decideAdvanceReminder,
  isDueDateChangeMaterial,
  parseLocalDate,
  selectNextOverdueOccurrence,
  type AdvanceReminderDisposition,
  type LocalDate,
  type OwnerActor,
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
 * (`parseLocalDate`, `decideAdvanceReminder`, `selectNextOverdueOccurrence`,
 * `isDueDateChangeMaterial`) and every write goes through an A8.3a-backed transaction. What lives
 * here is orchestration: authorize, ask the domain, hand the answer to persistence, project the
 * result.
 *
 * No scheduling, claiming, sending, retrying, or delivering happens in A8.3b. A schedule row is
 * created and kept truthful; nothing consumes it yet.
 */

/** Audit actions for reminder mutations, namespaced like the A6/A7 conventions. */
export const REMINDER_AUDIT_ACTIONS = {
  established: 'reminder.schedule.established',
  changed: 'reminder.schedule.changed',
  removed: 'reminder.due_date.removed',
} as const;

export interface OwnerReminderCommand {
  readonly db: DbClient;
  readonly owner: OwnerActor;
  readonly taskId: string;
  readonly now: string;
  readonly expectedVersion?: number;
  readonly requestId?: string;
}

export interface SetOwnerReminderCommand extends OwnerReminderCommand {
  readonly dueLocalDate: string;
}

/**
 * Reject a stale `If-Match` before any reminder write.
 *
 * The A8 contract inventory requires due-date mutation to run under the existing Task `If-Match`
 * concurrency (D045, D104), and the Task is loaded here anyway for authorization, so the comparison
 * is free. Note that the reminder write intentionally does not bump the Task's version: nothing the
 * Task ETag describes changes, so bumping it would invalidate a client's ETag for a change that
 * client cannot observe.
 */
function assertExpectedVersion(taskVersion: number, expectedVersion: number | undefined): void {
  if (expectedVersion === undefined) {
    return;
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw taskServiceError('VALIDATION_ERROR', 'expectedVersion must be a positive integer.');
  }
  if (expectedVersion !== taskVersion) {
    throw taskServiceError(
      'PRECONDITION_FAILED',
      'The resource has changed since the provided ETag.',
    );
  }
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
 */
export async function setOwnerTaskReminder(
  command: SetOwnerReminderCommand,
): Promise<SetOwnerReminderResult> {
  const owner = requireOwnerActor(command.owner);
  const dueLocalDate = requireDueLocalDate(command.dueLocalDate);
  const task = await loadOwnerTask(command.db, owner, command.taskId);
  assertExpectedVersion(task.version, command.expectedVersion);

  try {
    const runtime = await loadDbRuntime();
    const existing = await findSchedule(command.db, owner.organizationId, task.id);

    if (existing && existing.status !== 'stopped') {
      if (!isDueDateChangeMaterial(existing.dueLocalDate, dueLocalDate)) {
        const canonical = await readCanonicalDueLocalDate(
          command.db,
          owner.organizationId,
          task.id,
        );
        return { state: toTaskReminderState(existing, canonical), changed: false };
      }

      // Unreachable in A8.3b: nothing suspends a schedule until Waiting integration lands, so no
      // row can be in this state. Guarded rather than assumed, because `openNextReminderGeneration`
      // returns a schedule to `active`, and silently resuming reminders for a Task the Owner had
      // paused would violate D107's rule that Waiting is the only pause mechanism.
      if (existing.status === 'suspended_waiting') {
        throw taskServiceError(
          'DOMAIN_CONFLICT',
          'Reminders for a waiting task cannot be rescheduled yet.',
        );
      }
    }

    const derived = deriveSchedule(dueLocalDate, command.now);
    const skipped = skippedAdvanceAttempt(derived.advance, command.now);

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
        },
        skippedAdvanceAttempt: skipped,
        audit: buildOwnerAudit({
          id: newEntityId('audit'),
          owner,
          action: REMINDER_AUDIT_ACTIONS.established,
          taskId: task.id,
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
        dueLocalDate,
        schedulingTimeZone: REMINDER_SCHEDULING_TIME_ZONE,
        establishedAt: command.now,
        advanceDisposition:
          derived.advance.kind === 'skipped' ? 'skipped_window_elapsed' : 'scheduled',
        advanceOccurrence: advanceOccurrenceInput(derived.advance),
        nextOverdueOccurrence: nextOverdueInput(derived),
      },
      skippedAdvanceAttempt: skipped,
      audit: buildOwnerAudit({
        id: newEntityId('audit'),
        owner,
        action: REMINDER_AUDIT_ACTIONS.changed,
        taskId: task.id,
        now: command.now as UtcInstant,
        requestId: command.requestId,
      }),
    });
    return {
      state: toTaskReminderState(result.schedule, result.schedule.dueLocalDate),
      changed: true,
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
 * reached.
 */
export async function removeOwnerTaskReminder(
  command: OwnerReminderCommand,
): Promise<SetOwnerReminderResult> {
  const owner = requireOwnerActor(command.owner);
  const task = await loadOwnerTask(command.db, owner, command.taskId);
  assertExpectedVersion(task.version, command.expectedVersion);

  try {
    const runtime = await loadDbRuntime();
    const [existing, canonical] = await Promise.all([
      findSchedule(command.db, owner.organizationId, task.id),
      readCanonicalDueLocalDate(command.db, owner.organizationId, task.id),
    ]);

    const scheduleIsLive = existing !== null && existing.status !== 'stopped';
    if (canonical === null && !scheduleIsLive) {
      return {
        state: existing ? toTaskReminderState(existing, null) : noDueDateState(task.id),
        changed: false,
      };
    }

    const result = await runtime.persistOwnerReminderDueDateRemoval({
      db: command.db,
      organizationId: owner.organizationId,
      taskId: task.id,
      scheduleId: scheduleIsLive ? existing.id : null,
      stoppedAt: command.now,
      audit: buildOwnerAudit({
        id: newEntityId('audit'),
        owner,
        action: REMINDER_AUDIT_ACTIONS.removed,
        taskId: task.id,
        now: command.now as UtcInstant,
        requestId: command.requestId,
      }),
    });

    return {
      state: result.schedule ? toTaskReminderState(result.schedule, null) : noDueDateState(task.id),
      changed: true,
    };
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}
