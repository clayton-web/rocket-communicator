import type { ActionAttribution, Task, TaskNote, TaskSuggestion } from '@aicaa/domain';
import { computeExcerptPurgeAt } from '../../../domain/dist/index.js';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { createAuditEvent, type CreateAuditEventInput } from '../repositories/audit-repository.js';
import { revokeCapabilityRecord } from '../repositories/capability-repository.js';
import { createTaskSuggestion } from '../repositories/suggestion-repository.js';
import { updateExcerptPurgeAtIfPresent } from '../repositories/communication-event-repository.js';
import {
  appendTaskNote,
  applyTaskUpdateWithExpectedVersion,
  clearAssignment,
  getTaskById,
} from '../repositories/task-repository.js';
import type { AuditEventRecord } from '../mappers/domain-mappers.js';
import {
  buildReminderLifecycleAudit,
  reconcileReminderScheduleForTaskStatus,
  type ReminderLifecycleEffect,
} from './a8-lifecycle-reminder-effects.js';

type Client = DbClient | DbTransaction;

/**
 * D082 automatic terminal retention path:
 * Task → TaskSuggestion.approvedTaskId → sourceCommunicationEventId → TemporaryCommunicationExcerpt
 *
 * Applies only when the persisted Task status is completed or dismissed.
 * Missing / purged excerpts do not fail the Task transition.
 */
export async function applyApprovedSuggestionTerminalExcerptRetention(
  db: Client,
  organizationId: string,
  task: Task,
): Promise<boolean> {
  if (task.status !== 'completed' && task.status !== 'dismissed') {
    return false;
  }

  const suggestion = await db.taskSuggestion.findFirst({
    where: {
      organizationId,
      approvedTaskId: task.id,
      status: 'approved',
      sourceCommunicationEventId: { not: null },
    },
    select: { sourceCommunicationEventId: true },
  });

  if (!suggestion?.sourceCommunicationEventId) {
    return false;
  }

  return updateExcerptPurgeAtIfPresent(
    db,
    organizationId,
    suggestion.sourceCommunicationEventId,
    computeExcerptPurgeAt(task.updatedAt),
  );
}

/**
 * Atomic return-to-Owner unit of work (Phase 2 invariant for Phase 3 orchestration):
 * update task (no assignment), optional note, revoke capability, audit event.
 */
export async function persistReturnToOwner(input: {
  db: DbClient;
  organizationId: string;
  expectedVersion: number;
  task: Task;
  note?: TaskNote;
  capabilityId: string | null;
  revokedAt: string;
  audit: CreateAuditEventInput;
}): Promise<{ task: Task; audit: AuditEventRecord }> {
  return input.db.$transaction(async (tx) => {
    await applyTaskUpdateWithExpectedVersion(
      tx,
      input.organizationId,
      input.expectedVersion,
      input.task,
    );
    await clearAssignment(tx, input.organizationId, input.task.id, input.revokedAt);

    if (input.note) {
      await appendTaskNote(tx, input.organizationId, input.task.id, input.note);
    }

    if (input.capabilityId) {
      await revokeCapabilityRecord(
        tx,
        input.organizationId,
        input.capabilityId,
        input.revokedAt,
        'assignment_ended',
      );
    }

    const audit = await createAuditEvent(tx, input.audit);
    const reloaded = await getTaskById(tx, input.organizationId, input.task.id);
    return { task: reloaded, audit };
  });
}

/**
 * Atomic capability action: task transition (+ optional note) + required audit.
 * When the Task becomes completed/dismissed, automatically applies D082 excerpt retention
 * via TaskSuggestion.approvedTaskId → sourceCommunicationEventId (no caller wiring required).
 *
 * ## Reminder lifecycle wiring (A8, D107)
 *
 * This is also where a Task's reminder schedule is brought into agreement with its new status. Every
 * authoritative status transition in the system — Owner start, waiting, resume, complete, dismiss, and
 * the Recipient capability waiting, resume, and complete — converges on this function, so wiring it
 * here covers all of them and cannot be forgotten by a caller.
 *
 * It is wired here rather than in the route services for the reason the A8.3b audit gave: the
 * reminder transition has to commit with the status, not after it. A completion whose reminder stop
 * lived in a second transaction could commit a terminal Task still holding a claimable occurrence,
 * which is exactly the state a worker must never be able to find.
 *
 * The reconciler is called unconditionally rather than only for the statuses that matter. It closes a
 * gap between Task status and schedule state or does nothing, so callers that leave the status alone —
 * adding a note, requesting clarification — pay one indexed read and change nothing. That is worth
 * the read: it makes "the schedule agrees with the Task status" true after *every* Task write instead
 * of true only where someone remembered to ask.
 */
export async function persistCapabilityAction(input: {
  db: DbClient;
  organizationId: string;
  expectedVersion: number;
  task: Task;
  note?: TaskNote;
  audit: CreateAuditEventInput;
  /**
   * The instant to record on a derived reminder transition. Defaults to the causing audit event's
   * `recordedAt`, so the lifecycle event and the reminder event it caused agree on when it happened.
   */
  reminderTransitionAt?: string;
}): Promise<{
  task: Task;
  audit: AuditEventRecord;
  excerptUpdated: boolean;
  reminderEffect: ReminderLifecycleEffect | null;
}> {
  return input.db.$transaction(async (tx) => {
    await applyTaskUpdateWithExpectedVersion(
      tx,
      input.organizationId,
      input.expectedVersion,
      input.task,
    );
    if (input.note) {
      await appendTaskNote(tx, input.organizationId, input.task.id, input.note);
    }

    const excerptUpdated = await applyApprovedSuggestionTerminalExcerptRetention(
      tx,
      input.organizationId,
      input.task,
    );

    const recordedAt = input.reminderTransitionAt ?? input.audit.recordedAt;
    const reminderEffect = await reconcileReminderScheduleForTaskStatus(tx, {
      organizationId: input.organizationId,
      taskId: input.task.id,
      taskStatus: input.task.status,
      now: recordedAt,
    });

    // The causing event first, so commit order in `audit_events` matches causal order.
    const audit = await createAuditEvent(tx, input.audit);
    if (reminderEffect !== null) {
      await createAuditEvent(
        tx,
        buildReminderLifecycleAudit(
          { ...input.audit, correlationId: input.audit.correlationId ?? null },
          reminderEffect,
          recordedAt,
        ),
      );
    }

    const task = await getTaskById(tx, input.organizationId, input.task.id);
    return { task, audit, excerptUpdated, reminderEffect };
  });
}

/**
 * Owner session mutation unit of work (task + optional new note + audit).
 * Same persistence shape as capability-driven mutations; named for Owner task services.
 */
export async function persistOwnerTaskMutation(
  input: Parameters<typeof persistCapabilityAction>[0],
): Promise<Awaited<ReturnType<typeof persistCapabilityAction>>> {
  return persistCapabilityAction(input);
}

/**
 * Atomic work-request: attributed note + pending suggestion + audit (D061).
 */
export async function persistWorkRequest(input: {
  db: DbClient;
  organizationId: string;
  expectedVersion: number;
  task: Task;
  note: TaskNote;
  suggestion: TaskSuggestion;
  audit: CreateAuditEventInput;
}): Promise<{ task: Task; suggestion: TaskSuggestion; audit: AuditEventRecord }> {
  return input.db.$transaction(async (tx) => {
    await applyTaskUpdateWithExpectedVersion(
      tx,
      input.organizationId,
      input.expectedVersion,
      input.task,
    );
    await appendTaskNote(tx, input.organizationId, input.task.id, input.note);
    const suggestion = await createTaskSuggestion(
      tx,
      input.organizationId,
      input.suggestion,
      input.task.id,
    );
    const audit = await createAuditEvent(tx, input.audit);
    const task = await getTaskById(tx, input.organizationId, input.task.id);
    return { task, suggestion, audit };
  });
}

export type { ActionAttribution };
