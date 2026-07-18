import {
  approveTaskSuggestion as domainApprove,
  asTaskId,
  computeExcerptPurgeAt,
  computeWorkflowSafetyCeilingPurgeAt,
  createStandaloneTask,
  dismissTaskSuggestion as domainDismiss,
  editTaskSuggestion as domainEdit,
  formatETag,
  mergeTaskSuggestion as domainMerge,
  type OwnerActor,
  type TaskSuggestion,
  type TaskSummaryPoint,
  type UtcInstant,
} from '@aicaa/domain';
import type { AuditEventRecord, DbClient } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import {
  buildOwnerAudit,
  mapDomainOrPersistenceError,
  newEntityId,
  requireOwnerActor,
} from '@/lib/tasks/internal';
import { taskServiceError } from '@/lib/tasks/errors';
import {
  mapSuggestionToDto,
  mapTaskToDto,
  type TaskDto,
  type TaskSuggestionDto,
} from '@/lib/capability/map-to-dto';

export interface SuggestionMutationBase {
  db: DbClient;
  owner: OwnerActor;
  suggestionId: string;
  now: UtcInstant;
  expectedVersion?: number;
  requestId?: string;
  correlationId?: string | null;
  auditId?: string;
}

function ifMatchFromSuggestionVersion(
  suggestionId: string,
  expectedVersion: number | undefined,
): string | undefined {
  if (expectedVersion === undefined) {
    return undefined;
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw taskServiceError('VALIDATION_ERROR', 'expectedVersion must be a positive integer.', [
      { field: 'expectedVersion', message: 'Invalid concurrency version.' },
    ]);
  }
  return formatETag('task-suggestion', suggestionId, expectedVersion);
}

async function loadSuggestion(
  db: DbClient,
  owner: OwnerActor,
  suggestionId: string,
): Promise<TaskSuggestion> {
  try {
    const { getTaskSuggestionById } = await loadDbRuntime();
    return await getTaskSuggestionById(db, owner.organizationId, suggestionId);
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}

export type SuggestionMutationResult = {
  suggestion: TaskSuggestionDto;
  audit: AuditEventRecord;
};

export async function editOwnerSuggestion(
  command: SuggestionMutationBase & {
    summaryPoints?: TaskSummaryPoint[];
    proposedRecipientId?: string | null;
    proposedDueAt?: UtcInstant | null;
    proposedPriority?: TaskSuggestion['proposedPriority'];
  },
): Promise<SuggestionMutationResult> {
  const owner = requireOwnerActor(command.owner);
  try {
    const dbRuntime = await loadDbRuntime();
    const current = await loadSuggestion(command.db, owner, command.suggestionId);
    const ifMatch = ifMatchFromSuggestionVersion(command.suggestionId, command.expectedVersion);
    const next = domainEdit(current, {
      actor: owner,
      now: command.now,
      ifMatch,
      summaryPoints: command.summaryPoints,
      proposedRecipientId: command.proposedRecipientId,
      proposedDueAt: command.proposedDueAt,
      proposedPriority: command.proposedPriority,
    });
    const persisted = await dbRuntime.persistEditTaskSuggestion({
      db: command.db,
      organizationId: owner.organizationId,
      expectedSuggestionVersion: current.version,
      suggestion: next,
      audit: buildOwnerAudit({
        id: command.auditId ?? newEntityId('audit'),
        owner,
        action: 'suggestion.edit',
        suggestionId: next.id,
        now: command.now,
        resourceVersion: next.version,
        requestId: command.requestId,
        correlationId: command.correlationId,
      }),
    });
    return {
      suggestion: mapSuggestionToDto(persisted.suggestion),
      audit: persisted.audit,
    };
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}

export async function dismissOwnerSuggestion(
  command: SuggestionMutationBase & { reason?: string },
): Promise<SuggestionMutationResult> {
  const owner = requireOwnerActor(command.owner);
  try {
    const dbRuntime = await loadDbRuntime();
    const current = await loadSuggestion(command.db, owner, command.suggestionId);
    const ifMatch = ifMatchFromSuggestionVersion(command.suggestionId, command.expectedVersion);
    const next = domainDismiss(current, {
      actor: owner,
      now: command.now,
      ifMatch,
    });
    const persisted = await dbRuntime.persistDismissTaskSuggestion({
      db: command.db,
      organizationId: owner.organizationId,
      expectedSuggestionVersion: current.version,
      suggestion: next,
      excerptPurgeAt: computeExcerptPurgeAt(command.now),
      audit: buildOwnerAudit({
        id: command.auditId ?? newEntityId('audit'),
        owner,
        action: 'suggestion.dismiss',
        suggestionId: next.id,
        now: command.now,
        resourceVersion: next.version,
        requestId: command.requestId,
        correlationId: command.correlationId,
        note: command.reason,
        communicationEventId: next.sourceCommunicationEventId ?? undefined,
      }),
    });
    return {
      suggestion: mapSuggestionToDto(persisted.suggestion),
      audit: persisted.audit,
    };
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}

export type ApproveSuggestionResult = {
  suggestion: TaskSuggestionDto;
  task: TaskDto;
  audit: AuditEventRecord;
};

export async function approveOwnerSuggestion(
  command: SuggestionMutationBase & {
    summaryPoints?: TaskSummaryPoint[];
    recipientId?: string | null;
    priority?: TaskSuggestion['proposedPriority'];
    dueAt?: UtcInstant | null;
  },
): Promise<ApproveSuggestionResult> {
  const owner = requireOwnerActor(command.owner);
  if (command.recipientId != null && command.recipientId !== '') {
    throw taskServiceError(
      'RECIPIENT_HANDOFF_NOT_AVAILABLE',
      'Recipient handoff is not available when approving a suggestion.',
    );
  }
  try {
    const dbRuntime = await loadDbRuntime();
    const current = await loadSuggestion(command.db, owner, command.suggestionId);
    const ifMatch = ifMatchFromSuggestionVersion(command.suggestionId, command.expectedVersion);
    const approvedSuggestion = domainApprove(current, {
      actor: owner,
      now: command.now,
      ifMatch,
    });
    const taskId = asTaskId(newEntityId('task'));
    const summaryPoints = command.summaryPoints ?? current.summaryPoints;
    const task = createStandaloneTask({
      actor: owner,
      now: command.now,
      id: taskId,
      organizationId: owner.organizationId,
      summaryPoints,
      dueAt: command.dueAt ?? current.proposedDueAt ?? null,
      priority: command.priority ?? current.proposedPriority,
      sourceReference: current.sourceReference,
    });
    const persisted = await dbRuntime.persistApproveTaskSuggestion({
      db: command.db,
      organizationId: owner.organizationId,
      expectedSuggestionVersion: current.version,
      suggestion: approvedSuggestion,
      task,
      recipientId: command.recipientId,
      excerptPurgeAt: computeWorkflowSafetyCeilingPurgeAt(command.now),
      audit: buildOwnerAudit({
        id: command.auditId ?? newEntityId('audit'),
        owner,
        action: 'suggestion.approve',
        suggestionId: approvedSuggestion.id,
        taskId: task.id,
        now: command.now,
        resourceVersion: approvedSuggestion.version,
        taskStatus: task.status,
        requestId: command.requestId,
        correlationId: command.correlationId,
        communicationEventId: approvedSuggestion.sourceCommunicationEventId ?? undefined,
      }),
    });
    return {
      suggestion: mapSuggestionToDto(persisted.suggestion),
      task: mapTaskToDto(persisted.task, command.now),
      audit: persisted.audit,
    };
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}

export type MergeSuggestionResult = {
  suggestion: TaskSuggestionDto;
  task: TaskDto;
  audit: AuditEventRecord;
};

export async function mergeOwnerSuggestion(
  command: SuggestionMutationBase & {
    targetTaskId: string;
    targetTaskExpectedVersion?: number;
    appendSummaryPoints?: boolean;
  },
): Promise<MergeSuggestionResult> {
  const owner = requireOwnerActor(command.owner);
  if (command.targetTaskExpectedVersion === undefined) {
    throw taskServiceError('PRECONDITION_REQUIRED', 'targetTaskIfMatch is required for merge.');
  }
  try {
    const dbRuntime = await loadDbRuntime();
    const current = await loadSuggestion(command.db, owner, command.suggestionId);
    const targetTask = await dbRuntime.getTaskById(
      command.db,
      owner.organizationId,
      command.targetTaskId,
    );
    const ifMatch = ifMatchFromSuggestionVersion(command.suggestionId, command.expectedVersion);
    const targetTaskIfMatch = formatETag(
      'task',
      command.targetTaskId,
      command.targetTaskExpectedVersion,
    );
    const merged = domainMerge(current, targetTask, {
      actor: owner,
      now: command.now,
      ifMatch,
      targetTaskId: asTaskId(command.targetTaskId),
      targetTaskIfMatch,
      appendSummaryPoints: command.appendSummaryPoints,
    });
    const persisted = await dbRuntime.persistMergeTaskSuggestion({
      db: command.db,
      organizationId: owner.organizationId,
      expectedSuggestionVersion: current.version,
      expectedTaskVersion: targetTask.version,
      suggestion: merged.suggestion,
      task: merged.task,
      excerptPurgeAt: computeExcerptPurgeAt(command.now),
      audit: buildOwnerAudit({
        id: command.auditId ?? newEntityId('audit'),
        owner,
        action: 'suggestion.merge',
        suggestionId: merged.suggestion.id,
        taskId: merged.task.id,
        now: command.now,
        resourceVersion: merged.suggestion.version,
        taskStatus: merged.task.status,
        requestId: command.requestId,
        correlationId: command.correlationId,
        communicationEventId: merged.suggestion.sourceCommunicationEventId ?? undefined,
      }),
    });
    return {
      suggestion: mapSuggestionToDto(persisted.suggestion),
      task: mapTaskToDto(persisted.task, command.now),
      audit: persisted.audit,
    };
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}
