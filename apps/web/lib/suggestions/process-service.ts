import 'server-only';
import { randomBytes } from 'node:crypto';
import type { components } from '@aicaa/contracts/schema';
import {
  assertSuggestionAiConfigured,
  createSuggestionExtractionProvider,
  isAiProviderError,
  readSuggestionAiEnvConfig,
  type SuggestionExtractionProvider,
  type SuggestionExtractionResult,
  DEFAULT_SUGGESTION_POLICY_VERSION,
} from '@aicaa/ai';
import {
  asCommunicationEventId,
  asOrganizationId,
  asTaskSuggestionId,
  asTemporaryCommunicationExcerptId,
  computeWorkflowSafetyCeilingPurgeAt,
  DEFAULT_SUGGESTION_PROCESSING_MAX_ATTEMPTS,
  type CommunicationEvent,
  type TaskSuggestion,
} from '@aicaa/domain';
import type { CreateAuditEventInput, DbClient } from '@aicaa/db';
import { PersistenceError } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { evaluateSuggestionRelevance } from './heuristic';

export const MAX_EVENTS_PER_PROCESS = 5;
export const PROCESS_MAX_DURATION_MS = 60_000;
export const PROCESS_STOP_MARGIN_MS = 15_000;
export const CLAIM_LEASE_MS = 5 * 60_000;
export const SUGGESTION_PROCESS_SYSTEM_ID = 'suggestion_process';

export type SuggestionProcessResponse = components['schemas']['SuggestionProcessResponse'];

export class SuggestionProcessConfigurationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SuggestionProcessConfigurationError';
    this.code = code;
  }
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

function claimOwnerFromRequestId(requestId: string): string {
  return `suggestion_process:${requestId}`;
}

function addMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

function isPersistenceError(error: unknown): error is PersistenceError {
  return error instanceof PersistenceError;
}

function systemAudit(input: {
  organizationId: string;
  now: string;
  requestId: string;
  action: string;
  note?: string;
}): CreateAuditEventInput {
  return {
    id: newId('audit'),
    organizationId: input.organizationId,
    actorKind: 'system',
    systemId: SUGGESTION_PROCESS_SYSTEM_ID,
    action: input.action,
    outcome: 'succeeded',
    requestId: input.requestId,
    recordedAt: input.now,
    note: input.note,
  };
}

function buildPendingSuggestion(input: {
  organizationId: string;
  event: CommunicationEvent;
  extraction: SuggestionExtractionResult;
  excerptId: string | null;
  now: string;
}): TaskSuggestion {
  const sourceReference = {
    id: newId('src'),
    sourceType: 'gmail' as const,
    dedupeKey: input.event.dedupeKey,
    title: input.event.subject ?? undefined,
    capturedAt: input.event.internalDate,
    contactHint: input.event.fromAddress,
    externalIds: [
      {
        provider: 'gmail',
        idType: 'message_id',
        id: input.event.providerMessageId,
      },
    ],
    ...(input.excerptId
      ? {
          excerptRef: {
            excerptId: asTemporaryCommunicationExcerptId(input.excerptId),
            contentClassification: 'temporary_communication' as const,
          },
        }
      : {}),
  };

  return {
    id: asTaskSuggestionId(newId('sug')),
    organizationId: asOrganizationId(input.organizationId),
    status: 'pending',
    summaryPoints: input.extraction.summaryPoints,
    sourceReference,
    proposedDueAt: input.extraction.proposedDueAt ?? undefined,
    proposedPriority: input.extraction.proposedPriority ?? undefined,
    voiceOriginated: false,
    sourceCommunicationEventId: asCommunicationEventId(input.event.id),
    retention: {},
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

async function releaseRemainingClaims(input: {
  runtime: Awaited<ReturnType<typeof loadDbRuntime>>;
  db: DbClient;
  events: CommunicationEvent[];
  claimOwner: string;
  requestId: string;
  reasonCode: string;
}): Promise<void> {
  for (const event of input.events) {
    const releasedAt = new Date().toISOString();
    await input.runtime.persistClaimReleasedWithoutOutcome({
      db: input.db,
      organizationId: event.organizationId,
      eventId: event.id,
      claimOwner: input.claimOwner,
      reasonCode: input.reasonCode,
      audit: systemAudit({
        organizationId: event.organizationId,
        now: releasedAt,
        requestId: input.requestId,
        action: 'suggestion.process.claim_released',
        note: input.reasonCode,
      }),
    });
  }
}

export interface ProcessSuggestionsDeps {
  provider?: SuggestionExtractionProvider;
  /** Skip AI config assert (tests with injected provider). */
  skipConfigAssert?: boolean;
  policyVersion?: string;
}

/**
 * Bounded Application Suggestion Engine invocation (D081, D084, D085).
 * Independent of Gmail History sync. Soft deadline stops new claims/AI work.
 */
export async function runInternalSuggestionProcess(input: {
  db: DbClient;
  requestId: string;
  now?: string;
  startedAtMs?: number;
  deadlineMs?: number;
  maxEvents?: number;
  deps?: ProcessSuggestionsDeps;
}): Promise<{ response: SuggestionProcessResponse }> {
  const runtime = await loadDbRuntime();
  const now = input.now ?? new Date().toISOString();
  const startedAtMs = input.startedAtMs ?? Date.now();
  const deadlineMs = input.deadlineMs ?? startedAtMs + PROCESS_MAX_DURATION_MS;
  const maxEvents = input.maxEvents ?? MAX_EVENTS_PER_PROCESS;
  const claimOwner = claimOwnerFromRequestId(input.requestId);
  const claimUntil = addMs(now, CLAIM_LEASE_MS);

  const envConfig = readSuggestionAiEnvConfig();
  const policyVersion =
    input.deps?.policyVersion ?? envConfig.policyVersion ?? DEFAULT_SUGGESTION_POLICY_VERSION;

  if (!input.deps?.skipConfigAssert) {
    try {
      assertSuggestionAiConfigured(envConfig);
    } catch (error) {
      if (isAiProviderError(error) && error.kind === 'configuration') {
        throw new SuggestionProcessConfigurationError(error.code, error.message);
      }
      throw error;
    }
  }

  const provider = input.deps?.provider ?? createSuggestionExtractionProvider(envConfig);

  // Soft deadline before claiming — do not begin new work.
  if (Date.now() > deadlineMs - PROCESS_STOP_MARGIN_MS) {
    return {
      response: {
        claimed: 0,
        skippedIrrelevant: 0,
        suggestionsCreated: 0,
        failedRetryable: 0,
        failedPermanent: 0,
        requestId: input.requestId,
      },
    };
  }

  const claimed = await runtime.claimSuggestionProcessingBatch(input.db, {
    claimOwner,
    claimUntil,
    now,
    limit: maxEvents,
    maxAttempts: DEFAULT_SUGGESTION_PROCESSING_MAX_ATTEMPTS,
  });

  let skippedIrrelevant = 0;
  let suggestionsCreated = 0;
  let failedRetryable = 0;
  let failedPermanent = 0;
  let releasedWithoutOutcome = 0;

  for (let index = 0; index < claimed.length; index += 1) {
    const claimedEvent = claimed[index]!;

    // Soft deadline: release remaining claims (refund attempts) — do not burn the attempt ceiling.
    if (Date.now() > deadlineMs - PROCESS_STOP_MARGIN_MS) {
      const remaining = claimed.slice(index);
      await releaseRemainingClaims({
        runtime,
        db: input.db,
        events: remaining,
        claimOwner,
        requestId: input.requestId,
        reasonCode: 'SOFT_DEADLINE_REACHED',
      });
      releasedWithoutOutcome += remaining.length;
      break;
    }

    const event = await runtime.getCommunicationEventById(
      input.db,
      claimedEvent.organizationId,
      claimedEvent.id,
    );
    const excerpt = await runtime.getTemporaryCommunicationExcerptByEventId(
      input.db,
      event.organizationId,
      event.id,
    );
    const excerptContent = excerpt && excerpt.purgedAt == null ? excerpt.content : null;
    const excerptId = excerpt && excerpt.purgedAt == null ? excerpt.id : null;

    const heuristic = evaluateSuggestionRelevance({
      subject: event.subject,
      snippet: event.snippet,
      fromAddress: event.fromAddress,
      excerptContent,
    });

    const processedAt = now;

    if (!heuristic.relevant) {
      await runtime.persistSkippedIrrelevantOutcome({
        db: input.db,
        organizationId: event.organizationId,
        eventId: event.id,
        claimOwner,
        processedAt,
        policyVersion,
        reasonCode: heuristic.reasonCode,
        audit: systemAudit({
          organizationId: event.organizationId,
          now: processedAt,
          requestId: input.requestId,
          action: 'suggestion.process.skipped_irrelevant',
          note: heuristic.reasonCode,
        }),
      });
      skippedIrrelevant += 1;
      continue;
    }

    // Soft deadline after heuristic: do not start AI; release this and later claims.
    if (Date.now() > deadlineMs - PROCESS_STOP_MARGIN_MS) {
      const remaining = claimed.slice(index);
      await releaseRemainingClaims({
        runtime,
        db: input.db,
        events: remaining,
        claimOwner,
        requestId: input.requestId,
        reasonCode: 'SOFT_DEADLINE_REACHED',
      });
      releasedWithoutOutcome += remaining.length;
      break;
    }

    try {
      const extraction = await provider.extract({
        organizationId: event.organizationId,
        eventId: event.id,
        subject: event.subject,
        snippet: event.snippet,
        fromAddress: event.fromAddress,
        toAddresses: event.toAddresses,
        internalDate: event.internalDate,
        excerptContent,
        excerptId,
      });

      const suggestion = buildPendingSuggestion({
        organizationId: event.organizationId,
        event,
        extraction,
        excerptId,
        now: processedAt,
      });

      try {
        await runtime.persistSuggestionFromClaimedEvent({
          db: input.db,
          organizationId: event.organizationId,
          eventId: event.id,
          claimOwner,
          suggestion,
          policyVersion: extraction.policyVersion || policyVersion,
          processedAt,
          excerptPurgeAt: computeWorkflowSafetyCeilingPurgeAt(processedAt),
          audit: systemAudit({
            organizationId: event.organizationId,
            now: processedAt,
            requestId: input.requestId,
            action: 'suggestion.process.created',
            note: extraction.modelVersion,
          }),
        });
        suggestionsCreated += 1;
      } catch (persistError) {
        if (isPersistenceError(persistError) && persistError.code === 'UNIQUE_VIOLATION') {
          const existing = await runtime.getTaskSuggestionBySourceEventId(
            input.db,
            event.organizationId,
            event.id,
          );
          if (existing) {
            await runtime.persistClaimResolvedForExistingSuggestion({
              db: input.db,
              organizationId: event.organizationId,
              eventId: event.id,
              claimOwner,
              processedAt,
              policyVersion: extraction.policyVersion || policyVersion,
              audit: systemAudit({
                organizationId: event.organizationId,
                now: processedAt,
                requestId: input.requestId,
                action: 'suggestion.process.existing',
              }),
            });
            suggestionsCreated += 1;
            continue;
          }
        }
        throw persistError;
      }
    } catch (error) {
      const failAt = new Date().toISOString();
      if (isAiProviderError(error) && error.kind === 'configuration') {
        // Global misconfiguration after claim: release without permanent poison; refund attempts.
        const remaining = claimed.slice(index);
        await releaseRemainingClaims({
          runtime,
          db: input.db,
          events: remaining,
          claimOwner,
          requestId: input.requestId,
          reasonCode: error.code,
        });
        releasedWithoutOutcome += remaining.length;
        throw new SuggestionProcessConfigurationError(error.code, error.message);
      }

      if (isAiProviderError(error) && error.kind === 'permanent') {
        const permanentNote = error.diagnosticFingerprint
          ? `${error.code}|${error.diagnosticFingerprint}`
          : error.code;
        await runtime.persistFailedPermanentOutcome({
          db: input.db,
          organizationId: event.organizationId,
          eventId: event.id,
          claimOwner,
          processedAt: failAt,
          policyVersion,
          errorCode: error.code,
          audit: systemAudit({
            organizationId: event.organizationId,
            now: failAt,
            requestId: input.requestId,
            action: 'suggestion.process.failed_permanent',
            note: permanentNote,
          }),
        });
        failedPermanent += 1;
        continue;
      }

      const errorCode = isAiProviderError(error)
        ? error.code
        : isPersistenceError(error)
          ? error.code
          : 'AI_UNKNOWN_RETRYABLE';
      const retryNote =
        isAiProviderError(error) && error.diagnosticFingerprint
          ? `${errorCode}|${error.diagnosticFingerprint}`
          : errorCode;

      await runtime.persistFailedRetryableOutcome({
        db: input.db,
        organizationId: event.organizationId,
        eventId: event.id,
        claimOwner,
        processedAt: failAt,
        policyVersion,
        errorCode,
        audit: systemAudit({
          organizationId: event.organizationId,
          now: failAt,
          requestId: input.requestId,
          action: 'suggestion.process.failed_retryable',
          note: retryNote,
        }),
      });
      failedRetryable += 1;
    }
  }

  // Aggregate response remains OpenAPI-shaped; released claims are not failedRetryable.
  void releasedWithoutOutcome;

  return {
    response: {
      claimed: claimed.length,
      skippedIrrelevant,
      suggestionsCreated,
      failedRetryable,
      failedPermanent,
      requestId: input.requestId,
    },
  };
}
