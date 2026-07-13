import {
  addTaskNote as domainAddTaskNote,
  completeTask as domainCompleteTask,
  dismissTask as domainDismissTask,
  markTaskWaiting as domainMarkTaskWaiting,
  requestClarification as domainRequestClarification,
  resumeTask as domainResumeTask,
  returnTaskToOwner as domainReturnTaskToOwner,
  snoozeTask as domainSnoozeTask,
  startTask as domainStartTask,
  type OwnerActor,
  type TaskNote,
  type TaskOutcomeType,
  type UtcInstant,
} from '@aicaa/domain';
import {
  persistOwnerTaskMutation,
  persistReturnToOwner,
  type AuditEventRecord,
  type DbClient,
} from '@aicaa/db';
import {
  buildOwnerAudit,
  ifMatchFromExpectedVersion,
  loadOwnerTask,
  mapDomainOrPersistenceError,
  newEntityId,
  requireOwnerActor,
} from './internal';
import { mapTaskToDto, type TaskDto } from './map-to-dto';
import { taskServiceError } from './errors';

export type OwnerTaskMutationResult = {
  task: TaskDto;
  audit: AuditEventRecord;
};
export interface OwnerTaskMutationBase {
  db: DbClient;
  owner: OwnerActor;
  taskId: string;
  now: UtcInstant;
  /**
   * Mandatory concurrency token for mutations (maps from If-Match at the route layer).
   * Omit / undefined → PRECONDITION_REQUIRED (HTTP 428 later).
   */
  expectedVersion?: number;
  requestId?: string;
  correlationId?: string | null;
  auditId?: string;
  noteId?: string;
}

async function runOwnerMutation(
  command: OwnerTaskMutationBase,
  action: string,
  mutate: (
    task: Awaited<ReturnType<typeof loadOwnerTask>>,
    ifMatch: string | undefined,
  ) => {
    task: Awaited<ReturnType<typeof loadOwnerTask>>;
    note?: TaskNote;
    auditNote?: string;
  },
): Promise<OwnerTaskMutationResult> {
  const owner = requireOwnerActor(command.owner);
  try {
    const current = await loadOwnerTask(command.db, owner, command.taskId);
    const ifMatch = ifMatchFromExpectedVersion(command.taskId, command.expectedVersion);
    const result = mutate(current, ifMatch);
    const newNote =
      result.note && !current.notes.some((n) => n.id === result.note!.id) ? result.note : undefined;

    const persisted = await persistOwnerTaskMutation({
      db: command.db,
      organizationId: owner.organizationId,
      expectedVersion: current.version,
      task: result.task,
      note: newNote,
      audit: buildOwnerAudit({
        id: command.auditId ?? newEntityId('audit'),
        owner,
        action,
        taskId: result.task.id,
        now: command.now,
        resourceVersion: result.task.version,
        taskStatus: result.task.status,
        assignmentId: result.task.assignment?.id ?? current.assignment?.id,
        requestId: command.requestId,
        correlationId: command.correlationId,
        note: result.auditNote,
      }),
    });

    return {
      task: mapTaskToDto(persisted.task, command.now),
      audit: persisted.audit,
    };
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}

export async function startOwnerTask(
  command: OwnerTaskMutationBase,
): Promise<OwnerTaskMutationResult> {
  return runOwnerMutation(command, 'start_task', (task, ifMatch) => ({
    task: domainStartTask(task, {
      actor: requireOwnerActor(command.owner),
      ifMatch,
      now: command.now,
      requestId: command.requestId,
    }),
  }));
}

export async function markOwnerTaskWaiting(
  command: OwnerTaskMutationBase & { waitingUntil: UtcInstant; reason?: string },
): Promise<OwnerTaskMutationResult> {
  return runOwnerMutation(command, 'mark_task_waiting', (task, ifMatch) => ({
    task: domainMarkTaskWaiting(task, {
      actor: requireOwnerActor(command.owner),
      ifMatch,
      now: command.now,
      requestId: command.requestId,
      waitingUntil: command.waitingUntil,
    }),
    auditNote: command.reason,
  }));
}

export async function resumeOwnerTask(
  command: OwnerTaskMutationBase,
): Promise<OwnerTaskMutationResult> {
  return runOwnerMutation(command, 'resume_task', (task, ifMatch) => ({
    task: domainResumeTask(task, {
      actor: requireOwnerActor(command.owner),
      ifMatch,
      now: command.now,
      requestId: command.requestId,
    }),
  }));
}

export async function completeOwnerTask(
  command: OwnerTaskMutationBase & {
    outcomeType: TaskOutcomeType;
    note?: string;
    summaryPoints?: import('@aicaa/domain').TaskOutcome['summaryPoints'];
    followUpProposal?: import('@aicaa/domain').TaskOutcome['followUpProposal'];
  },
): Promise<OwnerTaskMutationResult> {
  return runOwnerMutation(command, 'complete_task', (task, ifMatch) => ({
    task: domainCompleteTask(task, {
      actor: requireOwnerActor(command.owner),
      ifMatch,
      now: command.now,
      requestId: command.requestId,
      outcomeType: command.outcomeType,
      note: command.note,
      summaryPoints: command.summaryPoints,
      followUpProposal: command.followUpProposal,
    }),
    auditNote: command.note,
  }));
}

export async function addOwnerTaskNote(
  command: OwnerTaskMutationBase & { body: string },
): Promise<OwnerTaskMutationResult> {
  const noteId = command.noteId ?? newEntityId('note');
  return runOwnerMutation(command, 'add_task_note', (task, ifMatch) => {
    const next = domainAddTaskNote(task, {
      actor: requireOwnerActor(command.owner),
      ifMatch,
      now: command.now,
      requestId: command.requestId,
      noteId,
      body: command.body,
    });
    const note = next.notes[next.notes.length - 1];
    return { task: next, note, auditNote: command.body };
  });
}

export async function snoozeOwnerTask(
  command: OwnerTaskMutationBase & { nextReminderAt: UtcInstant; reason?: string },
): Promise<OwnerTaskMutationResult> {
  return runOwnerMutation(command, 'snooze_task', (task, ifMatch) => ({
    task: domainSnoozeTask(
      task,
      {
        actor: requireOwnerActor(command.owner),
        ifMatch,
        now: command.now,
        requestId: command.requestId,
      },
      command.nextReminderAt,
    ),
    auditNote: command.reason,
  }));
}

export async function dismissOwnerTask(
  command: OwnerTaskMutationBase & { reason?: string },
): Promise<OwnerTaskMutationResult> {
  return runOwnerMutation(command, 'dismiss_task', (task, ifMatch) => ({
    task: domainDismissTask(task, {
      actor: requireOwnerActor(command.owner),
      ifMatch,
      now: command.now,
      requestId: command.requestId,
    }),
    auditNote: command.reason,
  }));
}

export async function requestOwnerClarification(
  command: OwnerTaskMutationBase & { message: string },
): Promise<OwnerTaskMutationResult> {
  const noteId = command.noteId ?? newEntityId('note');
  return runOwnerMutation(command, 'request_clarification', (task, ifMatch) => {
    const next = domainRequestClarification(task, {
      actor: requireOwnerActor(command.owner),
      ifMatch,
      now: command.now,
      requestId: command.requestId,
      noteId,
      message: command.message,
    });
    const note = next.notes[next.notes.length - 1];
    return { task: next, note, auditNote: command.message };
  });
}

/**
 * Atomic return-to-Owner: domain transition + clear assignment + optional note +
 * revoke bound capability + Owner audit (historical rows retained).
 */
export async function returnOwnerTaskToOwner(
  command: OwnerTaskMutationBase & { note?: string },
): Promise<{ task: import('./map-to-dto').TaskDto; audit: AuditEventRecord }> {
  const owner = requireOwnerActor(command.owner);
  try {
    const current = await loadOwnerTask(command.db, owner, command.taskId);
    if (!current.assignment) {
      throw taskServiceError(
        'ASSIGNMENT_PRECONDITION',
        'Task must have an active assignment before returning to Owner.',
      );
    }

    const ifMatch = ifMatchFromExpectedVersion(command.taskId, command.expectedVersion);
    const noteId = command.note ? (command.noteId ?? newEntityId('note')) : undefined;
    const domainResult = domainReturnTaskToOwner(current, {
      actor: owner,
      ifMatch,
      now: command.now,
      requestId: command.requestId,
      noteId,
      note: command.note,
    });

    const newNote =
      command.note && noteId ? domainResult.task.notes.find((n) => n.id === noteId) : undefined;

    const persisted = await persistReturnToOwner({
      db: command.db,
      organizationId: owner.organizationId,
      expectedVersion: current.version,
      task: domainResult.task,
      note: newNote,
      capabilityId: domainResult.capabilityInvalidation.capabilityId,
      revokedAt: command.now,
      audit: buildOwnerAudit({
        id: command.auditId ?? newEntityId('audit'),
        owner,
        action: 'return_task_to_owner',
        taskId: domainResult.task.id,
        now: command.now,
        resourceVersion: domainResult.task.version,
        taskStatus: domainResult.task.status,
        assignmentId: domainResult.capabilityInvalidation.assignmentId,
        requestId: command.requestId,
        correlationId: command.correlationId,
        note: command.note,
      }),
    });

    return {
      task: mapTaskToDto(persisted.task, command.now),
      audit: persisted.audit,
    };
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}
