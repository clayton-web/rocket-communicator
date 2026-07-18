import type { CommunicationEvent, Task, TaskSuggestion } from '@aicaa/domain';
import type { DbClient } from '../client/create-prisma-client.js';
import { createAuditEvent, type CreateAuditEventInput } from '../repositories/audit-repository.js';
import {
  getCommunicationEventById,
  updateExcerptPurgeAtIfPresent,
} from '../repositories/communication-event-repository.js';
import {
  createTaskSuggestion,
  updateTaskSuggestionWithExpectedVersion,
} from '../repositories/suggestion-repository.js';
import { completeSuggestionProcessingOutcome } from '../repositories/suggestion-processing-repository.js';
import { createTask, updateTaskWithExpectedVersion } from '../repositories/task-repository.js';
import { fromIso, type AuditEventRecord } from '../mappers/domain-mappers.js';
import {
  optimisticConcurrency,
  organizationMismatch,
  persistenceValidation,
  recipientHandoffNotAvailable,
} from '../errors/persistence-errors.js';

/**
 * Atomic AI extraction result persistence (D081, D082).
 * Requires system audit in the same transaction (D074 pattern).
 */
export async function persistSuggestionFromClaimedEvent(input: {
  db: DbClient;
  organizationId: string;
  eventId: string;
  claimOwner: string;
  suggestion: TaskSuggestion;
  policyVersion: string;
  processedAt: string;
  /** D082 pending association ceiling: associatedAt + 30 days. */
  excerptPurgeAt: string;
  audit: CreateAuditEventInput;
}): Promise<{
  suggestion: TaskSuggestion;
  event: CommunicationEvent;
  excerptUpdated: boolean;
  audit: AuditEventRecord;
}> {
  if (input.suggestion.organizationId !== input.organizationId) {
    throw organizationMismatch('Suggestion organizationId must match the persistence scope.');
  }
  if (input.suggestion.sourceCommunicationEventId !== input.eventId) {
    throw persistenceValidation(
      'Suggestion sourceCommunicationEventId must match the claimed CommunicationEvent.',
    );
  }
  if (input.suggestion.status !== 'pending') {
    throw persistenceValidation('Created Gmail-origin suggestions must be pending.');
  }

  return input.db.$transaction(async (tx) => {
    const claimResult = await tx.communicationEvent.updateMany({
      where: {
        id: input.eventId,
        organizationId: input.organizationId,
        suggestionClaimOwner: input.claimOwner,
        suggestionProcessingStatus: {
          in: ['unprocessed', 'failed_retryable'],
        },
      },
      data: {
        suggestionProcessingStatus: 'suggestion_created',
        suggestionProcessedAt: fromIso(input.processedAt)!,
        suggestionPolicyVersion: input.policyVersion,
        suggestionLastErrorCode: null,
        suggestionClaimOwner: null,
        suggestionClaimUntil: null,
      },
    });

    if (claimResult.count !== 1) {
      throw optimisticConcurrency(
        `CommunicationEvent ${input.eventId} is not claimed by ${input.claimOwner}.`,
      );
    }

    const suggestion = await createTaskSuggestion(tx, input.organizationId, input.suggestion);

    const excerptUpdated = await updateExcerptPurgeAtIfPresent(
      tx,
      input.organizationId,
      input.eventId,
      input.excerptPurgeAt,
    );

    const audit = await createAuditEvent(tx, {
      ...input.audit,
      suggestionId: suggestion.id,
      communicationEventId: input.eventId,
    });
    const event = await getCommunicationEventById(tx, input.organizationId, input.eventId);
    return { suggestion, event, excerptUpdated, audit };
  });
}

/** Skip irrelevant: no suggestion; excerpt retention unchanged. Requires system audit. */
export async function persistSkippedIrrelevantOutcome(input: {
  db: DbClient;
  organizationId: string;
  eventId: string;
  claimOwner: string;
  processedAt: string;
  policyVersion: string;
  reasonCode?: string | null;
  audit: CreateAuditEventInput;
}): Promise<{ event: CommunicationEvent; audit: AuditEventRecord }> {
  return input.db.$transaction(async (tx) => {
    const event = await completeSuggestionProcessingOutcome(tx, {
      organizationId: input.organizationId,
      eventId: input.eventId,
      claimOwner: input.claimOwner,
      status: 'skipped_irrelevant',
      processedAt: input.processedAt,
      policyVersion: input.policyVersion,
      lastErrorCode: input.reasonCode ?? null,
    });
    const audit = await createAuditEvent(tx, {
      ...input.audit,
      communicationEventId: input.eventId,
    });
    return { event, audit };
  });
}

/** Retryable failure: no suggestion; no excerpt extension. Requires system audit. */
export async function persistFailedRetryableOutcome(input: {
  db: DbClient;
  organizationId: string;
  eventId: string;
  claimOwner: string;
  processedAt: string;
  policyVersion: string;
  errorCode: string;
  audit: CreateAuditEventInput;
}): Promise<{ event: CommunicationEvent; audit: AuditEventRecord }> {
  return input.db.$transaction(async (tx) => {
    const event = await completeSuggestionProcessingOutcome(tx, {
      organizationId: input.organizationId,
      eventId: input.eventId,
      claimOwner: input.claimOwner,
      status: 'failed_retryable',
      processedAt: input.processedAt,
      policyVersion: input.policyVersion,
      lastErrorCode: input.errorCode,
    });
    const audit = await createAuditEvent(tx, {
      ...input.audit,
      communicationEventId: input.eventId,
    });
    return { event, audit };
  });
}

/** Permanent failure: no suggestion; no excerpt extension. Requires system audit. */
export async function persistFailedPermanentOutcome(input: {
  db: DbClient;
  organizationId: string;
  eventId: string;
  claimOwner: string;
  processedAt: string;
  policyVersion: string;
  errorCode: string;
  audit: CreateAuditEventInput;
}): Promise<{ event: CommunicationEvent; audit: AuditEventRecord }> {
  return input.db.$transaction(async (tx) => {
    const event = await completeSuggestionProcessingOutcome(tx, {
      organizationId: input.organizationId,
      eventId: input.eventId,
      claimOwner: input.claimOwner,
      status: 'failed_permanent',
      processedAt: input.processedAt,
      policyVersion: input.policyVersion,
      lastErrorCode: input.errorCode,
    });
    const audit = await createAuditEvent(tx, {
      ...input.audit,
      communicationEventId: input.eventId,
    });
    return { event, audit };
  });
}

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
