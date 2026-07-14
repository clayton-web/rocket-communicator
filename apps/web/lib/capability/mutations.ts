import {
  addTaskNote as domainAddTaskNote,
  asTaskSuggestionId,
  completeTask as domainCompleteTask,
  markTaskWaiting as domainMarkTaskWaiting,
  requestClarification as domainRequestClarification,
  resumeTask as domainResumeTask,
  returnTaskToOwner as domainReturnTaskToOwner,
  submitWorkRequest as domainSubmitWorkRequest,
  type CapabilityAction,
  type TaskNote,
  type TaskOutcomeType,
  type UtcInstant,
} from '@aicaa/domain';
import {
  persistCapabilityAction,
  persistWorkRequest,
  type AuditEventRecord,
  type DbClient,
} from '@aicaa/db';
import {
  buildCapabilityAudit,
  ifMatchFromExpectedVersion,
  mapRecipientServiceError,
  newEntityId,
  requireExpectedVersion,
  validateRecipientCapability,
} from './internal';
import { returnToOwnerWithCapabilityInvalidation } from './lifecycle';
import {
  mapTaskToDto,
  mapWorkRequestResponse,
  type SubmitWorkRequestResponseDto,
  type TaskDto,
} from './map-to-dto';
import { recipientCapabilityServiceError } from './recipient-errors';

export type RecipientCapabilityMutationResult = {
  task: TaskDto;
  audit: AuditEventRecord;
};

export interface RecipientCapabilityMutationBase {
  db: DbClient;
  rawToken: string;
  pepper: string;
  taskId: string;
  now: UtcInstant;
  /**
   * Mandatory concurrency token for mutations (maps from If-Match at the route layer).
   * Omit / undefined → PRECONDITION_REQUIRED.
   */
  expectedVersion?: number;
  requestId?: string;
  correlationId?: string | null;
  auditId?: string;
  noteId?: string;
}

async function runRecipientMutation(
  command: RecipientCapabilityMutationBase,
  action: CapabilityAction,
  auditAction: string,
  mutate: (
    ctx: Awaited<ReturnType<typeof validateRecipientCapability>>,
    ifMatch: string | undefined,
  ) => {
    task: Awaited<ReturnType<typeof validateRecipientCapability>>['task'];
    note?: TaskNote;
    auditNote?: string;
  },
): Promise<RecipientCapabilityMutationResult> {
  try {
    const expectedVersion = requireExpectedVersion(command.expectedVersion);
    const ctx = await validateRecipientCapability({
      db: command.db,
      rawToken: command.rawToken,
      pepper: command.pepper,
      now: command.now,
      taskId: command.taskId,
      action,
      mode: 'mutation',
    });

    if (ctx.task.version !== expectedVersion) {
      throw recipientCapabilityServiceError(
        'PRECONDITION_FAILED',
        'The resource has changed since the provided version.',
      );
    }

    const ifMatch = ifMatchFromExpectedVersion(command.taskId, expectedVersion);
    const result = mutate(ctx, ifMatch);
    const newNote =
      result.note && !ctx.task.notes.some((n) => n.id === result.note!.id)
        ? result.note
        : undefined;

    const persisted = await persistCapabilityAction({
      db: command.db,
      organizationId: ctx.organizationId,
      expectedVersion: ctx.task.version,
      task: result.task,
      note: newNote,
      audit: buildCapabilityAudit({
        id: command.auditId ?? newEntityId('audit'),
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        action: auditAction,
        taskId: result.task.id,
        now: command.now,
        resourceVersion: result.task.version,
        taskStatus: result.task.status,
        assignmentId: result.task.assignment?.id ?? ctx.capability.assignmentId,
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
    mapRecipientServiceError(error);
  }
}

export async function markCapabilityTaskWaiting(
  command: RecipientCapabilityMutationBase & { waitingUntil: UtcInstant; reason?: string },
): Promise<RecipientCapabilityMutationResult> {
  return runRecipientMutation(
    command,
    'mark_task_waiting',
    'mark_task_waiting',
    (ctx, ifMatch) => ({
      task: domainMarkTaskWaiting(ctx.task, {
        actor: ctx.actor,
        ifMatch,
        now: command.now,
        requestId: command.requestId,
        waitingUntil: command.waitingUntil,
      }),
      auditNote: command.reason,
    }),
  );
}

export async function resumeCapabilityTask(
  command: RecipientCapabilityMutationBase,
): Promise<RecipientCapabilityMutationResult> {
  return runRecipientMutation(command, 'mark_task_waiting', 'resume_task', (ctx, ifMatch) => ({
    task: domainResumeTask(ctx.task, {
      actor: ctx.actor,
      ifMatch,
      now: command.now,
      requestId: command.requestId,
    }),
  }));
}

export async function completeCapabilityTask(
  command: RecipientCapabilityMutationBase & {
    outcomeType: TaskOutcomeType;
    note?: string;
  },
): Promise<RecipientCapabilityMutationResult> {
  return runRecipientMutation(command, 'complete_task', 'complete_task', (ctx, ifMatch) => ({
    task: domainCompleteTask(ctx.task, {
      actor: ctx.actor,
      ifMatch,
      now: command.now,
      requestId: command.requestId,
      outcomeType: command.outcomeType,
      note: command.note,
    }),
    auditNote: command.note,
  }));
}

export async function addCapabilityTaskNote(
  command: RecipientCapabilityMutationBase & { body: string },
): Promise<RecipientCapabilityMutationResult> {
  const noteId = command.noteId ?? newEntityId('note');
  return runRecipientMutation(command, 'add_task_note', 'add_task_note', (ctx, ifMatch) => {
    const next = domainAddTaskNote(ctx.task, {
      actor: ctx.actor,
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

export async function requestCapabilityClarification(
  command: RecipientCapabilityMutationBase & { message: string },
): Promise<RecipientCapabilityMutationResult> {
  const noteId = command.noteId ?? newEntityId('note');
  return runRecipientMutation(
    command,
    'request_clarification',
    'request_clarification',
    (ctx, ifMatch) => {
      const next = domainRequestClarification(ctx.task, {
        actor: ctx.actor,
        ifMatch,
        now: command.now,
        requestId: command.requestId,
        noteId,
        message: command.message,
      });
      const note = next.notes[next.notes.length - 1];
      return { task: next, note, auditNote: command.message };
    },
  );
}

/**
 * Atomic return-to-Owner via existing persistReturnToOwner transaction.
 * Clears assignment, revokes capability, optional note, capability audit.
 */
export async function returnCapabilityTaskToOwner(
  command: RecipientCapabilityMutationBase & { note?: string },
): Promise<RecipientCapabilityMutationResult> {
  try {
    const expectedVersion = requireExpectedVersion(command.expectedVersion);
    const ctx = await validateRecipientCapability({
      db: command.db,
      rawToken: command.rawToken,
      pepper: command.pepper,
      now: command.now,
      taskId: command.taskId,
      action: 'return_task_to_owner',
      mode: 'mutation',
    });

    if (ctx.task.version !== expectedVersion) {
      throw recipientCapabilityServiceError(
        'PRECONDITION_FAILED',
        'The resource has changed since the provided version.',
      );
    }

    const ifMatch = ifMatchFromExpectedVersion(command.taskId, expectedVersion);
    const noteId = command.note ? (command.noteId ?? newEntityId('note')) : undefined;
    const domainResult = domainReturnTaskToOwner(ctx.task, {
      actor: ctx.actor,
      ifMatch,
      now: command.now,
      requestId: command.requestId,
      noteId,
      note: command.note,
    });

    const capabilityId = domainResult.capabilityInvalidation.capabilityId ?? ctx.capability.id;
    const newNote =
      command.note && noteId ? domainResult.task.notes.find((n) => n.id === noteId) : undefined;

    const persisted = await returnToOwnerWithCapabilityInvalidation({
      db: command.db,
      organizationId: ctx.organizationId,
      expectedVersion: ctx.task.version,
      task: domainResult.task,
      note: newNote,
      capabilityId,
      revokedAt: command.now,
      audit: buildCapabilityAudit({
        id: command.auditId ?? newEntityId('audit'),
        actor: ctx.actor,
        organizationId: ctx.organizationId,
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
    mapRecipientServiceError(error);
  }
}

/**
 * Recipient work request → pending Task Suggestion (D061). Does not create a Task.
 * Reuses domain submitWorkRequest + persistWorkRequest.
 */
export async function submitCapabilityWorkRequest(
  command: RecipientCapabilityMutationBase & {
    message: string;
    suggestionId?: string;
  },
): Promise<{
  response: SubmitWorkRequestResponseDto;
  audit: AuditEventRecord;
}> {
  try {
    const expectedVersion = requireExpectedVersion(command.expectedVersion);
    const ctx = await validateRecipientCapability({
      db: command.db,
      rawToken: command.rawToken,
      pepper: command.pepper,
      now: command.now,
      taskId: command.taskId,
      action: 'submit_work_request',
      mode: 'mutation',
    });

    if (ctx.task.version !== expectedVersion) {
      throw recipientCapabilityServiceError(
        'PRECONDITION_FAILED',
        'The resource has changed since the provided version.',
      );
    }

    const ifMatch = ifMatchFromExpectedVersion(command.taskId, expectedVersion);
    const noteId = command.noteId ?? newEntityId('note');
    const suggestionId = asTaskSuggestionId(command.suggestionId ?? newEntityId('sug'));
    const domainResult = domainSubmitWorkRequest(ctx.task, {
      actor: ctx.actor,
      ifMatch,
      now: command.now,
      requestId: command.requestId,
      suggestionId,
      noteId,
      message: command.message,
    });

    const note = domainResult.task.notes.find((n) => n.id === noteId);
    if (!note) {
      throw recipientCapabilityServiceError(
        'DOMAIN_CONFLICT',
        'Work request note was not produced by domain.',
      );
    }

    const persisted = await persistWorkRequest({
      db: command.db,
      organizationId: ctx.organizationId,
      expectedVersion: ctx.task.version,
      task: domainResult.task,
      note,
      suggestion: domainResult.suggestion,
      audit: buildCapabilityAudit({
        id: command.auditId ?? newEntityId('audit'),
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        action: 'submit_work_request',
        taskId: domainResult.task.id,
        now: command.now,
        resourceVersion: domainResult.task.version,
        taskStatus: domainResult.task.status,
        assignmentId: ctx.capability.assignmentId,
        suggestionId: domainResult.suggestion.id,
        requestId: command.requestId,
        correlationId: command.correlationId,
        note: command.message,
      }),
    });

    return {
      response: mapWorkRequestResponse({
        suggestion: persisted.suggestion,
        task: persisted.task,
        now: command.now,
      }),
      audit: persisted.audit,
    };
  } catch (error) {
    mapRecipientServiceError(error);
  }
}
