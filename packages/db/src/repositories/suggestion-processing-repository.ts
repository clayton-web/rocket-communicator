import {
  DEFAULT_SUGGESTION_PROCESSING_MAX_ATTEMPTS,
  type CommunicationEvent,
  type SuggestionProcessingStatus,
} from '../../../domain/dist/index.js';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { fromIso, mapCommunicationEvent } from '../mappers/domain-mappers.js';
import { notFound, optimisticConcurrency } from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

export interface ClaimSuggestionProcessingBatchInput {
  /** Opaque claim owner (process run / request id). */
  claimOwner: string;
  /** Absolute claim lease expiry (ISO). */
  claimUntil: string;
  /** Current time (ISO). */
  now: string;
  /** Max events to claim in this batch. */
  limit: number;
  /**
   * Max processing attempts inclusive eligibility for `failed_retryable`.
   * Defaults to {@link DEFAULT_SUGGESTION_PROCESSING_MAX_ATTEMPTS}.
   */
  maxAttempts?: number;
  /** Optional organization scope. When omitted, claims across orgs (cron). */
  organizationId?: string;
}

/**
 * Claim a bounded batch of eligible CommunicationEvents for suggestion processing (D081).
 *
 * Eligible when:
 * - status is `unprocessed`, or `failed_retryable` with attempts < maxAttempts
 * - claim is absent or expired
 * - event lifecycle status is `active`
 *
 * On successful claim: sets claim owner/expiry and increments `suggestionProcessingAttempts`
 * exactly once per successful claim.
 *
 * **Contract B (refill):** attempts to acquire up to `limit` claims. Under contention it
 * re-selects eligible candidates and continues until `limit` is reached or no eligible
 * unclaimed rows remain. May return fewer than `limit` when the eligible pool is exhausted.
 * Never returns an event as claimed unless this worker’s conditional update succeeded.
 * Concurrent workers cannot both successfully claim the same event; an active lease cannot
 * be overwritten before expiry.
 */
export async function claimSuggestionProcessingBatch(
  db: Client,
  input: ClaimSuggestionProcessingBatchInput,
): Promise<CommunicationEvent[]> {
  const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 100);
  const maxAttempts = input.maxAttempts ?? DEFAULT_SUGGESTION_PROCESSING_MAX_ATTEMPTS;
  const nowDate = fromIso(input.now)!;
  const claimUntil = fromIso(input.claimUntil)!;

  const eligibilityWhere = {
    status: 'active' as const,
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    AND: [
      {
        OR: [{ suggestionClaimUntil: null }, { suggestionClaimUntil: { lt: nowDate } }],
      },
      {
        OR: [
          { suggestionProcessingStatus: 'unprocessed' as const },
          {
            suggestionProcessingStatus: 'failed_retryable' as const,
            suggestionProcessingAttempts: { lt: maxAttempts },
          },
        ],
      },
    ],
  };

  const claimed: CommunicationEvent[] = [];
  const claimedIds = new Set<string>();

  // Refill until limit or no remaining eligible work (Contract B).
  while (claimed.length < limit) {
    const need = limit - claimed.length;
    const candidates = await db.communicationEvent.findMany({
      where: {
        ...eligibilityWhere,
        ...(claimedIds.size > 0 ? { id: { notIn: [...claimedIds] } } : {}),
      },
      orderBy: [{ internalDate: 'asc' }, { id: 'asc' }],
      take: Math.max(need * 3, need),
      select: { id: true, organizationId: true },
    });

    if (candidates.length === 0) {
      break;
    }

    let progressed = false;
    for (const candidate of candidates) {
      if (claimed.length >= limit) {
        break;
      }
      if (claimedIds.has(candidate.id)) {
        continue;
      }

      const result = await db.communicationEvent.updateMany({
        where: {
          id: candidate.id,
          organizationId: candidate.organizationId,
          ...eligibilityWhere,
        },
        data: {
          suggestionClaimOwner: input.claimOwner,
          suggestionClaimUntil: claimUntil,
          suggestionProcessingAttempts: { increment: 1 },
        },
      });

      if (result.count !== 1) {
        continue;
      }

      const row = await db.communicationEvent.findFirst({
        where: { id: candidate.id, organizationId: candidate.organizationId },
      });
      if (!row || row.suggestionClaimOwner !== input.claimOwner) {
        continue;
      }

      claimed.push(mapCommunicationEvent(row));
      claimedIds.add(candidate.id);
      progressed = true;
    }

    // Entire candidate set lost to contention or became ineligible — stop to avoid spinning.
    if (!progressed) {
      break;
    }
  }

  return claimed;
}

export interface CompleteSuggestionProcessingOutcomeInput {
  organizationId: string;
  eventId: string;
  claimOwner: string;
  status: Exclude<SuggestionProcessingStatus, 'unprocessed' | 'suggestion_created'>;
  processedAt: string;
  policyVersion: string;
  /** Stable error/reason code only — never raw content, prompts, or stack traces. */
  lastErrorCode?: string | null;
}

/**
 * Persist a non-create processing outcome and clear the claim (D081).
 * Audit-neutral primitive — exported A6 outcome transactions always wrap with required audit.
 */
export async function completeSuggestionProcessingOutcome(
  db: Client,
  input: CompleteSuggestionProcessingOutcomeInput,
): Promise<CommunicationEvent> {
  const result = await db.communicationEvent.updateMany({
    where: {
      id: input.eventId,
      organizationId: input.organizationId,
      suggestionClaimOwner: input.claimOwner,
    },
    data: {
      suggestionProcessingStatus: input.status,
      suggestionProcessedAt: fromIso(input.processedAt)!,
      suggestionPolicyVersion: input.policyVersion,
      suggestionLastErrorCode: input.lastErrorCode ?? null,
      suggestionClaimOwner: null,
      suggestionClaimUntil: null,
    },
  });

  if (result.count !== 1) {
    throw optimisticConcurrency(
      `CommunicationEvent ${input.eventId} claim owner ${input.claimOwner} was not current.`,
    );
  }

  const row = await db.communicationEvent.findFirst({
    where: { id: input.eventId, organizationId: input.organizationId },
  });
  if (!row) {
    throw notFound(`CommunicationEvent ${input.eventId} not found for organization.`);
  }
  return mapCommunicationEvent(row);
}

/**
 * Release a claim without recording a processing outcome (soft deadline / global config abort).
 * Clears the lease and refunds the attempt that was incremented at claim time so time-budget
 * or deployment-config aborts cannot starve otherwise healthy events toward the attempt ceiling.
 */
export async function releaseSuggestionProcessingClaim(
  db: Client,
  input: {
    organizationId: string;
    eventId: string;
    claimOwner: string;
    /** When true (default), decrement suggestionProcessingAttempts by one (floor 0). */
    refundAttempt?: boolean;
  },
): Promise<CommunicationEvent> {
  const refundAttempt = input.refundAttempt !== false;
  const row = await db.communicationEvent.findFirst({
    where: {
      id: input.eventId,
      organizationId: input.organizationId,
      suggestionClaimOwner: input.claimOwner,
    },
  });
  if (!row) {
    throw optimisticConcurrency(
      `CommunicationEvent ${input.eventId} claim owner ${input.claimOwner} was not current.`,
    );
  }

  const nextAttempts = refundAttempt
    ? Math.max(0, row.suggestionProcessingAttempts - 1)
    : row.suggestionProcessingAttempts;

  const result = await db.communicationEvent.updateMany({
    where: {
      id: input.eventId,
      organizationId: input.organizationId,
      suggestionClaimOwner: input.claimOwner,
    },
    data: {
      suggestionClaimOwner: null,
      suggestionClaimUntil: null,
      suggestionProcessingAttempts: nextAttempts,
    },
  });

  if (result.count !== 1) {
    throw optimisticConcurrency(
      `CommunicationEvent ${input.eventId} claim owner ${input.claimOwner} was not current.`,
    );
  }

  const updated = await db.communicationEvent.findFirst({
    where: { id: input.eventId, organizationId: input.organizationId },
  });
  if (!updated) {
    throw notFound(`CommunicationEvent ${input.eventId} not found for organization.`);
  }
  return mapCommunicationEvent(updated);
}
