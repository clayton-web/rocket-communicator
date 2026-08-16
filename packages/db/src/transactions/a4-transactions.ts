import type { ActionAttribution, Task, TaskNote, TaskSuggestion } from '@aicaa/domain';
import { computeExcerptPurgeAt } from '../../../domain/dist/index.js';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { createAuditEvent, type CreateAuditEventInput } from '../repositories/audit-repository.js';
import {
  createOwnerNotificationIntent,
  type OwnerNotificationCapture,
} from '../repositories/owner-notification-repository.js';
import type { OwnerNotificationEventTypeValue } from '../mappers/owner-notification-mappers.js';
import { revokeCapabilityRecord } from '../repositories/capability-repository.js';
import { createTaskSuggestion } from '../repositories/suggestion-repository.js';
import { applyD082ExcerptRetentionForSuggestion } from './d082-excerpt-retention.js';
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
 * Task → TaskSuggestion.approvedTaskId → its source excerpt → TemporaryCommunicationExcerpt
 *
 * The approving proposal reaches its excerpt through whichever linkage its source populated — A6's
 * CommunicationEvent, or the explicit Review excerpt linkage — and the shared resolver then keeps
 * the maximum entitlement across any sibling proposals of the same excerpt.
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
    },
    select: { id: true, sourceCommunicationEventId: true, sourceExcerptId: true },
  });

  if (!suggestion) {
    return false;
  }

  return applyD082ExcerptRetentionForSuggestion(
    db,
    organizationId,
    suggestion,
    computeExcerptPurgeAt(task.updatedAt),
  );
}

/**
 * Atomic return-to-Owner unit of work (Phase 2 invariant for Phase 3 orchestration):
 * update task (no assignment), optional note, revoke capability, audit event.
 *
 * ## A8.5d notification capture (D133)
 *
 * `task.returned_to_owner` is produced from here rather than from the service above, because this
 * is the transaction that makes the return durable: the assignment is cleared, the capability is
 * revoked, and the audit row is written in one commit, so the intent either joins all of that or
 * none of it.
 *
 * The event type is fixed by this function rather than chosen by its caller. A return is the only
 * notifiable thing this transaction does, and a parameter offering a choice would be a parameter
 * offering a wrong answer.
 *
 * Attribution is copied from the audit input, which is the *capability* that returned the work —
 * never the assignment, which this transaction has just cleared and which would read as null by the
 * time anybody asked.
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
  ownerNotification?: OwnerNotificationCapture;
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

    if (input.ownerNotification) {
      await createOwnerNotificationIntent(tx, {
        id: input.ownerNotification.id,
        organizationId: input.organizationId,
        eventType: 'task_returned_to_owner',
        subjectKind: 'task',
        subjectId: input.task.id,
        // The post-mutation version, as every Task-lifecycle event uses: a later return after a
        // fresh assignment cycle is a different version and a legitimate second notification, while
        // a retry of this same return is the same version and is refused by the unique index.
        occurrenceKey: String(input.task.version),
        occurredAt: input.audit.recordedAt,
        actorKind: input.audit.actorKind,
        ownerId: input.audit.ownerId ?? null,
        capabilityId: input.audit.capabilityId ?? null,
        systemId: input.audit.systemId ?? null,
        assignmentId: input.audit.assignmentId ?? null,
        attributionLabel: input.audit.attributionLabel ?? null,
        auditEventId: audit.id,
        requestId: input.audit.requestId ?? null,
        correlationId: input.audit.correlationId ?? null,
      });
    }

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
  /**
   * A8.5a Owner Event Notification capture (D133, D135).
   *
   * Present only when the caller has already decided this transition is notifiable **and** that
   * `ENABLE_OWNER_EVENT_CAPTURE` is on. Absent means absent: no statement is issued against either
   * A8.5 table, which is what lets this function keep running in Production while the A8.5 migration
   * is unapplied there.
   *
   * The caller supplies only the identifier and the event type. Everything that makes the intent
   * *coherent* — which organization, which subject, which occurrence, and who acted — is derived
   * here from state this transaction already holds, so a caller cannot name a different Task, a
   * different organization, or a stale version. Inside this function every notifiable event is about
   * the Task being mutated, at the version being written.
   */
  ownerNotification?: {
    id: string;
    eventType: OwnerNotificationEventTypeValue;
  };
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

    // A8.5a: the notification intent commits with the mutation that caused it, or not at all.
    //
    // Its attribution is copied from the audit input rather than rebuilt, so the intent and the
    // audit row can never disagree about who acted — a Recipient action stays capability-attributed
    // even though the Owner is who will be told about it (D133).
    if (input.ownerNotification) {
      await createOwnerNotificationIntent(tx, {
        id: input.ownerNotification.id,
        organizationId: input.organizationId,
        eventType: input.ownerNotification.eventType,
        subjectKind: 'task',
        subjectId: input.task.id,
        // The post-mutation version. The domain bumps it on every transition, so a retry of this
        // same transition collides and a genuine later event does not.
        occurrenceKey: String(input.task.version),
        occurredAt: input.audit.recordedAt,
        actorKind: input.audit.actorKind,
        ownerId: input.audit.ownerId ?? null,
        capabilityId: input.audit.capabilityId ?? null,
        systemId: input.audit.systemId ?? null,
        assignmentId: input.audit.assignmentId ?? null,
        attributionLabel: input.audit.attributionLabel ?? null,
        auditEventId: audit.id,
        requestId: input.audit.requestId ?? null,
        correlationId: input.audit.correlationId ?? null,
      });
    }

    const task = await getTaskById(tx, input.organizationId, input.task.id);
    return { task, audit, excerptUpdated, reminderEffect };
  });
}

/**
 * Owner session mutation unit of work (task + optional new note + audit).
 * Same persistence shape as capability-driven mutations; named for Owner task services.
 *
 * **`ownerNotification` is omitted from the parameter type on purpose (D133).** Owner-initiated
 * actions are excluded from the taxonomy — telling the Owner what the Owner just did is noise — so
 * the Owner path is not merely expected to pass no intent, it is unable to. That makes "an Owner
 * completion creates no notification" a property of the types rather than of a test, and it will
 * still hold when A8.5d adds the remaining producers.
 */
export async function persistOwnerTaskMutation(
  input: Omit<Parameters<typeof persistCapabilityAction>[0], 'ownerNotification'>,
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
