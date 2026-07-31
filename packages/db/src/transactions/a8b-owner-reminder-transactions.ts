import type { DbClient } from '../client/create-prisma-client.js';
import type { AuditEventRecord } from '../mappers/domain-mappers.js';
import { createAuditEvent, type CreateAuditEventInput } from '../repositories/audit-repository.js';
import { recordSkippedReminderOccurrence } from '../repositories/reminder-delivery-attempt-repository.js';
import type {
  PersistedReminderDeliveryAttempt,
  PersistedReminderSchedule,
  ReminderSkipReason,
} from '../mappers/reminder-mappers.js';
import {
  createReminderSchedule,
  openNextReminderGeneration,
  stopReminderSchedule,
  type CreateReminderScheduleInput,
  type OpenNextReminderGenerationInput,
} from '../repositories/reminder-schedule-repository.js';
import { requireTaskScope } from '../repositories/reminder-scope-guard.js';

/**
 * A8.3b Owner-facing reminder units of work.
 *
 * A8.3a supplied the persistence primitives and the transactions a future worker needs. These are
 * the transactions the *Owner API* needs, and they differ in one respect that matters: each one
 * writes an audit event in the same transaction as the state it describes. That is the whole reason
 * they exist as a separate layer rather than as sequential calls from the route service — an audit
 * row claiming a schedule was established, committed independently of the schedule itself, is
 * exactly the untruthful history D100 forbids. If the schedule write fails, the event must not
 * exist; if the event write fails, neither must the schedule.
 *
 * The A8.3a transactions are deliberately not modified. They were independently audited as the
 * persistence foundation, and composing on top of them keeps that surface intact.
 *
 * These transactions still compute nothing. Occurrences, dispositions, and the current instant all
 * arrive as arguments from the A8.2 domain by way of the route service (D103, D127).
 */

/** The advance occurrence that had already elapsed when the Owner chose the date (D105). */
export interface SkippedAdvanceAttemptInput {
  readonly id: string;
  readonly skipReason: Extract<ReminderSkipReason, 'advance_window_elapsed'>;
  readonly recordedAt: string;
}

export interface OwnerReminderMutationResult {
  readonly schedule: PersistedReminderSchedule;
  readonly skippedAdvanceAttempt: PersistedReminderDeliveryAttempt | null;
  readonly audit: AuditEventRecord;
}

async function recordSkippedAdvance(
  tx: Parameters<Parameters<DbClient['$transaction']>[0]>[0],
  schedule: PersistedReminderSchedule,
  skipped: SkippedAdvanceAttemptInput,
): Promise<PersistedReminderDeliveryAttempt> {
  return recordSkippedReminderOccurrence(tx, {
    id: skipped.id,
    organizationId: schedule.organizationId,
    scheduleId: schedule.id,
    generation: schedule.generation,
    occurrenceKind: 'advance',
    occurrenceLocalDate: schedule.advanceOccurrenceLocalDate,
    occurrenceAt: schedule.advanceOccurrenceAt,
    skipReason: skipped.skipReason,
    recordedAt: skipped.recordedAt,
  });
}

/**
 * Establish a Task's first Reminder Schedule, its canonical due date, and the audit event.
 *
 * Mirrors A8.3a's `persistEstablishedReminderSchedule` and adds the audit row. The Task's `version`
 * is deliberately not bumped: `due_local_date` is not part of the Task contract, so nothing an ETag
 * describes has changed, and bumping it would invalidate a client's Task ETag for a change that
 * client cannot see.
 */
export async function persistOwnerReminderEstablishment(input: {
  readonly db: DbClient;
  readonly schedule: CreateReminderScheduleInput;
  readonly skippedAdvanceAttempt?: SkippedAdvanceAttemptInput;
  readonly audit: CreateAuditEventInput;
}): Promise<OwnerReminderMutationResult> {
  return input.db.$transaction(async (tx) => {
    const schedule = await createReminderSchedule(tx, input.schedule);

    await tx.task.update({
      where: { id: schedule.taskId },
      data: { dueLocalDate: schedule.dueLocalDate },
    });

    const skippedAdvanceAttempt = input.skippedAdvanceAttempt
      ? await recordSkippedAdvance(tx, schedule, input.skippedAdvanceAttempt)
      : null;

    const audit = await createAuditEvent(tx, input.audit);
    return { schedule, skippedAdvanceAttempt, audit };
  });
}

/**
 * Close the current generation, open the next one, update the canonical due date, and audit it.
 *
 * Prior delivery attempts are untouched — history is superseded, never rewritten (D107, D109) — so
 * the new generation starts with a zero overdue count while every earlier attempt remains readable
 * against the generation it belonged to.
 *
 * `openNextReminderGeneration` matches on `expectedGeneration`, so two Owners changing the due date
 * concurrently cannot both succeed; the loser gets an optimistic-concurrency failure rather than a
 * silently discarded change.
 */
export async function persistOwnerReminderGenerationChange(input: {
  readonly db: DbClient;
  readonly generation: OpenNextReminderGenerationInput;
  readonly skippedAdvanceAttempt?: SkippedAdvanceAttemptInput;
  readonly audit: CreateAuditEventInput;
}): Promise<OwnerReminderMutationResult> {
  return input.db.$transaction(async (tx) => {
    const schedule = await openNextReminderGeneration(tx, input.generation);

    await tx.task.update({
      where: { id: schedule.taskId },
      data: { dueLocalDate: schedule.dueLocalDate },
    });

    const skippedAdvanceAttempt = input.skippedAdvanceAttempt
      ? await recordSkippedAdvance(tx, schedule, input.skippedAdvanceAttempt)
      : null;

    const audit = await createAuditEvent(tx, input.audit);
    return { schedule, skippedAdvanceAttempt, audit };
  });
}

export interface OwnerReminderRemovalResult {
  /** Null only when the Task had a canonical due date but never had a schedule. */
  readonly schedule: PersistedReminderSchedule | null;
  readonly audit: AuditEventRecord;
}

/**
 * Clear the canonical due date, stop the schedule, and audit the removal — atomically.
 *
 * `stopReminderSchedule` writes the `due_date_removed` reason and clears the next occurrence, so no
 * future morning survives the removal. It is idempotent against an already-stopped schedule, which
 * matters because completion and due-date removal can legitimately race.
 *
 * No reminder row is deleted. The Owner removing a due date is not the Owner erasing the record of
 * reminders that were already sent (D107, D109).
 */
export async function persistOwnerReminderDueDateRemoval(input: {
  readonly db: DbClient;
  readonly organizationId: string;
  readonly taskId: string;
  readonly scheduleId: string | null;
  readonly stoppedAt: string;
  readonly audit: CreateAuditEventInput;
}): Promise<OwnerReminderRemovalResult> {
  return input.db.$transaction(async (tx) => {
    const scope = await requireTaskScope(tx, input.organizationId, input.taskId);

    await tx.task.update({
      where: { id: scope.taskId },
      data: { dueLocalDate: null },
    });

    const schedule = input.scheduleId
      ? await stopReminderSchedule(tx, {
          organizationId: scope.organizationId,
          scheduleId: input.scheduleId,
          reason: 'due_date_removed',
          stoppedAt: input.stoppedAt,
        })
      : null;

    const audit = await createAuditEvent(tx, input.audit);
    return { schedule, audit };
  });
}
