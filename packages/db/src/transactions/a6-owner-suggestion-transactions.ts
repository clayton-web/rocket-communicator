import type { Task, TaskSuggestion } from '@aicaa/domain';
import type { DbClient } from '../client/create-prisma-client.js';
import { createAuditEvent, type CreateAuditEventInput } from '../repositories/audit-repository.js';
import { updateExcerptPurgeAtIfPresent } from '../repositories/communication-event-repository.js';
import { updateTaskSuggestionWithExpectedVersion } from '../repositories/suggestion-repository.js';
import { createTask, updateTaskWithExpectedVersion } from '../repositories/task-repository.js';
import type { AuditEventRecord } from '../mappers/domain-mappers.js';
import {
  organizationMismatch,
  persistenceValidation,
  recipientHandoffNotAvailable,
} from '../errors/persistence-errors.js';

/**
 * Approve pending suggestion → unassigned Task only (D080, D082).
 * Sets TaskSuggestion.approvedTaskId for durable terminal retention.
 * Rejects non-null recipientId with structured RECIPIENT_HANDOFF_NOT_AVAILABLE.
 * Requires Owner audit.
 */
export async function persistApproveTaskSuggestion(input: {
  db: DbClient;
  organizationId: string;
  expectedSuggestionVersion: number;
  suggestion: TaskSuggestion;
  task: Task;
  /** Must be absent/undefined/null in A6 (D080). */
  recipientId?: string | null;
  /** D082 approve ceiling: approvedAt + 30 days. */
  excerptPurgeAt: string;
  audit: CreateAuditEventInput;
}): Promise<{
  suggestion: TaskSuggestion;
  task: Task;
  excerptUpdated: boolean;
  audit: AuditEventRecord;
}> {
  if (input.recipientId != null && input.recipientId !== '') {
    throw recipientHandoffNotAvailable();
  }
  if (input.suggestion.status !== 'approved') {
    throw persistenceValidation('Approve persistence requires an approved suggestion snapshot.');
  }
  if (input.task.assignment) {
    throw persistenceValidation('Approve must create an unassigned Task only (D080).');
  }
  if (input.task.organizationId !== input.organizationId) {
    throw organizationMismatch('Task organizationId must match the persistence scope.');
  }

  return input.db.$transaction(async (tx) => {
    const task = await createTask(tx, input.organizationId, input.task);

    const suggestion = await updateTaskSuggestionWithExpectedVersion(
      tx,
      input.organizationId,
      input.expectedSuggestionVersion,
      {
        ...input.suggestion,
        approvedTaskId: task.id,
      },
    );

    let excerptUpdated = false;
    if (suggestion.sourceCommunicationEventId) {
      excerptUpdated = await updateExcerptPurgeAtIfPresent(
        tx,
        input.organizationId,
        suggestion.sourceCommunicationEventId,
        input.excerptPurgeAt,
      );
    }

    const audit = await createAuditEvent(tx, {
      ...input.audit,
      suggestionId: suggestion.id,
      taskId: task.id,
      communicationEventId:
        suggestion.sourceCommunicationEventId ?? input.audit.communicationEventId,
    });

    return { suggestion, task, excerptUpdated, audit };
  });
}

export async function persistEditTaskSuggestion(input: {
  db: DbClient;
  organizationId: string;
  expectedSuggestionVersion: number;
  suggestion: TaskSuggestion;
  audit: CreateAuditEventInput;
}): Promise<{ suggestion: TaskSuggestion; audit: AuditEventRecord }> {
  if (input.suggestion.status !== 'pending') {
    throw persistenceValidation('Only pending suggestions may be edited.');
  }
  return input.db.$transaction(async (tx) => {
    const suggestion = await updateTaskSuggestionWithExpectedVersion(
      tx,
      input.organizationId,
      input.expectedSuggestionVersion,
      input.suggestion,
    );
    const audit = await createAuditEvent(tx, {
      ...input.audit,
      suggestionId: suggestion.id,
    });
    return { suggestion, audit };
  });
}

/**
 * Dismiss pending suggestion; set excerpt purgeAt = dismissedAt + 7 days when present (D082).
 * Requires Owner audit.
 */
export async function persistDismissTaskSuggestion(input: {
  db: DbClient;
  organizationId: string;
  expectedSuggestionVersion: number;
  suggestion: TaskSuggestion;
  excerptPurgeAt: string;
  audit: CreateAuditEventInput;
}): Promise<{
  suggestion: TaskSuggestion;
  excerptUpdated: boolean;
  audit: AuditEventRecord;
}> {
  if (input.suggestion.status !== 'dismissed') {
    throw persistenceValidation('Dismiss persistence requires a dismissed suggestion snapshot.');
  }

  return input.db.$transaction(async (tx) => {
    const suggestion = await updateTaskSuggestionWithExpectedVersion(
      tx,
      input.organizationId,
      input.expectedSuggestionVersion,
      input.suggestion,
    );

    let excerptUpdated = false;
    if (suggestion.sourceCommunicationEventId) {
      excerptUpdated = await updateExcerptPurgeAtIfPresent(
        tx,
        input.organizationId,
        suggestion.sourceCommunicationEventId,
        input.excerptPurgeAt,
      );
    }

    const audit = await createAuditEvent(tx, {
      ...input.audit,
      suggestionId: suggestion.id,
      communicationEventId:
        suggestion.sourceCommunicationEventId ?? input.audit.communicationEventId,
    });

    return { suggestion, excerptUpdated, audit };
  });
}

/**
 * Merge pending suggestion into target Task with dual-version checks (D083, D082).
 * Requires Owner audit.
 */
export async function persistMergeTaskSuggestion(input: {
  db: DbClient;
  organizationId: string;
  expectedSuggestionVersion: number;
  expectedTaskVersion: number;
  suggestion: TaskSuggestion;
  task: Task;
  excerptPurgeAt: string;
  audit: CreateAuditEventInput;
}): Promise<{
  suggestion: TaskSuggestion;
  task: Task;
  excerptUpdated: boolean;
  audit: AuditEventRecord;
}> {
  if (input.suggestion.status !== 'merged') {
    throw persistenceValidation('Merge persistence requires a merged suggestion snapshot.');
  }
  if (input.suggestion.mergedIntoTaskId !== input.task.id) {
    throw persistenceValidation('mergedIntoTaskId must match the target Task.');
  }

  return input.db.$transaction(async (tx) => {
    const suggestion = await updateTaskSuggestionWithExpectedVersion(
      tx,
      input.organizationId,
      input.expectedSuggestionVersion,
      input.suggestion,
    );
    const task = await updateTaskWithExpectedVersion(
      tx,
      input.organizationId,
      input.expectedTaskVersion,
      input.task,
    );

    let excerptUpdated = false;
    if (suggestion.sourceCommunicationEventId) {
      excerptUpdated = await updateExcerptPurgeAtIfPresent(
        tx,
        input.organizationId,
        suggestion.sourceCommunicationEventId,
        input.excerptPurgeAt,
      );
    }

    const audit = await createAuditEvent(tx, {
      ...input.audit,
      suggestionId: suggestion.id,
      taskId: task.id,
      communicationEventId:
        suggestion.sourceCommunicationEventId ?? input.audit.communicationEventId,
    });

    return { suggestion, task, excerptUpdated, audit };
  });
}
