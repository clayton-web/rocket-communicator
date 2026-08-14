import type { Task, TaskSuggestion } from '@aicaa/domain';
import type { DbClient } from '../client/create-prisma-client.js';
import { createAuditEvent, type CreateAuditEventInput } from '../repositories/audit-repository.js';
import { updateTaskSuggestionWithExpectedVersion } from '../repositories/suggestion-repository.js';
import { applyD082ExcerptRetentionForSuggestion } from './d082-excerpt-retention.js';
import { createTask, updateTaskWithExpectedVersion } from '../repositories/task-repository.js';
import { getRecipientById } from '../repositories/recipient-repository.js';
import {
  createResponsibilitySelection,
  type ResponsibilitySelectionPartyKindValue,
} from '../repositories/responsibility-selection-repository.js';
import type {
  AuditEventRecord,
  PersistedResponsibilitySelection,
} from '../mappers/domain-mappers.js';
import {
  organizationMismatch,
  persistenceValidation,
  recipientHandoffNotAvailable,
} from '../errors/persistence-errors.js';

/**
 * The Owner's affirmative acceptance-time responsibility selection (D168).
 *
 * A distinct approve concept, deliberately not the legacy/direct `recipientId` field, which keeps
 * rejecting with `RECIPIENT_HANDOFF_NOT_AVAILABLE` (D080). Supplying this records evidence only: it
 * creates no TaskAssignment, issues no capability, and sends no mail.
 */
export type ApproveResponsibilitySelectionInput = {
  id: string;
  partyKind: ResponsibilitySelectionPartyKindValue;
  /** Required when and only when `partyKind = 'recipient'`. */
  recipientId?: string | null;
  /** Authenticated Owner whose approval action made the selection. */
  selectedByOwnerId: string;
  selectedAt: string;
};

/**
 * Approve pending suggestion → unassigned Task only (D080, D082).
 * Sets TaskSuggestion.approvedTaskId for durable terminal retention.
 * Rejects non-null recipientId with structured RECIPIENT_HANDOFF_NOT_AVAILABLE.
 * Requires Owner audit.
 *
 * `responsibilitySelection` is **required** (D168). Every successful acceptance carries affirmative
 * evidence of the Owner's initial responsibility choice, recorded **inside this same transaction**
 * as the canonical Task create, the suggestion approval, and the `approvedTaskId` linkage. There is
 * no later best-effort write and no approval path that commits without it.
 *
 * There is deliberately no "omitted selection" path. Omission is rejected before the transaction
 * opens rather than defaulted to Owner, because inferring Owner responsibility from an absent field
 * is exactly what D155/D164 forbid: absence of a selection, of a Recipient, or of a TaskAssignment
 * is never evidence that the Owner selected Me.
 *
 * A Recipient selection is evidence, not delivery: this creates no TaskAssignment, no
 * TaskCapability, and no HandoffAttempt, and sends nothing. The existing handoff mutation still
 * owns every one of those effects.
 */
export async function persistApproveTaskSuggestion(input: {
  db: DbClient;
  organizationId: string;
  expectedSuggestionVersion: number;
  suggestion: TaskSuggestion;
  task: Task;
  /** Must be absent/undefined/null in A6 (D080). Never the responsibility-selection channel. */
  recipientId?: string | null;
  /** Owner's affirmative acceptance-time responsibility selection (D168). Required. */
  responsibilitySelection: ApproveResponsibilitySelectionInput;
  /** D082 approve ceiling: approvedAt + 30 days. */
  excerptPurgeAt: string;
  audit: CreateAuditEventInput;
}): Promise<{
  suggestion: TaskSuggestion;
  task: Task;
  excerptUpdated: boolean;
  audit: AuditEventRecord;
  responsibilitySelection: PersistedResponsibilitySelection;
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
  // Types make this required; the runtime check keeps the invariant true for untyped/JS callers,
  // so no approval can reach the transaction without an affirmative selection to record.
  const selection = input.responsibilitySelection;
  if (!selection) {
    throw persistenceValidation(
      'Approve requires an affirmative responsibility selection (D168). Omission is not Owner.',
    );
  }
  if (selection.selectedByOwnerId.trim() === '') {
    throw persistenceValidation(
      'Responsibility-selection evidence requires the approving Owner id (D168).',
    );
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

    if (selection.partyKind === 'recipient' && selection.recipientId) {
      // Organization-scoped Recipient validation, inside the transaction so a foreign or unknown
      // Recipient rolls the whole approval back rather than leaving a half-accepted proposal.
      // Throws NOT_FOUND for both unknown and cross-organization ids.
      await getRecipientById(tx, input.organizationId, selection.recipientId);
    }
    const responsibilitySelection = await createResponsibilitySelection(tx, {
      id: selection.id,
      organizationId: input.organizationId,
      suggestionId: suggestion.id,
      taskId: task.id,
      partyKind: selection.partyKind,
      recipientId: selection.recipientId ?? null,
      selectedByOwnerId: selection.selectedByOwnerId,
      selectedAt: selection.selectedAt,
    });

    // The approve ceiling is this proposal's entitlement, not the excerpt's deadline: a sibling
    // proposal of the same Review may still hold a longer one, and D082 keeps the maximum.
    const excerptUpdated = await applyD082ExcerptRetentionForSuggestion(
      tx,
      input.organizationId,
      suggestion,
      input.excerptPurgeAt,
    );

    const audit = await createAuditEvent(tx, {
      ...input.audit,
      suggestionId: suggestion.id,
      taskId: task.id,
      communicationEventId:
        suggestion.sourceCommunicationEventId ?? input.audit.communicationEventId,
    });

    return { suggestion, task, excerptUpdated, audit, responsibilitySelection };
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

    const excerptUpdated = await applyD082ExcerptRetentionForSuggestion(
      tx,
      input.organizationId,
      suggestion,
      input.excerptPurgeAt,
    );

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

    const excerptUpdated = await applyD082ExcerptRetentionForSuggestion(
      tx,
      input.organizationId,
      suggestion,
      input.excerptPurgeAt,
    );

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
