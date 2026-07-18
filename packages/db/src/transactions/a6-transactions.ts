import type { CommunicationEvent, TaskSuggestion } from '@aicaa/domain';
import type { DbClient } from '../client/create-prisma-client.js';
import { createAuditEvent, type CreateAuditEventInput } from '../repositories/audit-repository.js';
import {
  getCommunicationEventById,
  updateExcerptPurgeAtIfPresent,
} from '../repositories/communication-event-repository.js';
import {
  createTaskSuggestion,
  getTaskSuggestionBySourceEventId,
} from '../repositories/suggestion-repository.js';
import {
  completeSuggestionProcessingOutcome,
  releaseSuggestionProcessingClaim,
} from '../repositories/suggestion-processing-repository.js';
import { fromIso, type AuditEventRecord } from '../mappers/domain-mappers.js';
import {
  optimisticConcurrency,
  organizationMismatch,
  persistenceValidation,
} from '../errors/persistence-errors.js';

/**
 * Atomic AI extraction result persistence (D081, D082).
 * Requires system audit in the same transaction (D074 pattern).
 * A6.3 processing surface — exported from production runtime.ts for the process route.
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
 * Success-equivalent resolution when a unique suggestion already exists for the event.
 * Verifies the suggestion row, then marks the claim `suggestion_created` and clears the lease.
 * Does not create a second suggestion or invent content.
 */
export async function persistClaimResolvedForExistingSuggestion(input: {
  db: DbClient;
  organizationId: string;
  eventId: string;
  claimOwner: string;
  processedAt: string;
  policyVersion: string;
  audit: CreateAuditEventInput;
}): Promise<{
  suggestion: TaskSuggestion;
  event: CommunicationEvent;
  audit: AuditEventRecord;
}> {
  return input.db.$transaction(async (tx) => {
    const existing = await getTaskSuggestionBySourceEventId(
      tx,
      input.organizationId,
      input.eventId,
    );
    if (!existing) {
      throw persistenceValidation(
        `No existing TaskSuggestion for CommunicationEvent ${input.eventId}.`,
      );
    }

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

    const audit = await createAuditEvent(tx, {
      ...input.audit,
      suggestionId: existing.id,
      communicationEventId: input.eventId,
    });
    const event = await getCommunicationEventById(tx, input.organizationId, input.eventId);
    return { suggestion: existing, event, audit };
  });
}

/**
 * Soft-deadline / global-config abort: clear the claim, refund the claim attempt, keep prior
 * processing status. Requires system audit (stable reason code only).
 */
export async function persistClaimReleasedWithoutOutcome(input: {
  db: DbClient;
  organizationId: string;
  eventId: string;
  claimOwner: string;
  reasonCode: string;
  audit: CreateAuditEventInput;
}): Promise<{ event: CommunicationEvent; audit: AuditEventRecord }> {
  return input.db.$transaction(async (tx) => {
    const event = await releaseSuggestionProcessingClaim(tx, {
      organizationId: input.organizationId,
      eventId: input.eventId,
      claimOwner: input.claimOwner,
      refundAttempt: true,
    });
    const audit = await createAuditEvent(tx, {
      ...input.audit,
      communicationEventId: input.eventId,
      note: input.audit.note ?? input.reasonCode,
    });
    return { event, audit };
  });
}
