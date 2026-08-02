import type { DbClient } from '../client/create-prisma-client.js';
import { fromIso } from '../mappers/domain-mappers.js';
import {
  mapOwnerNotificationAttempt,
  mapOwnerNotificationIntent,
  type OwnerNotificationAttemptRecord,
  type OwnerNotificationIntentRecord,
} from '../mappers/owner-notification-mappers.js';
import { createAuditEvent, type CreateAuditEventInput } from '../repositories/audit-repository.js';

/**
 * A8.5b settlement — the only way an Owner notification delivery attempt is allowed to end (D133,
 * D135).
 *
 * Three facts have to become true together or not at all: what the intent now is, what the provider
 * call returned, and what the Owner-facing history says happened. Splitting them would let the
 * system reach the states that are hardest to reason about later — an intent reading `sent` with no
 * attempt recording acceptance, or an audit row announcing a delivery the operational tables have no
 * evidence for. One transaction, fenced on the claim, settles all three.
 *
 * ## Why the policy decision arrives already made
 *
 * This module does not know that three attempts is the budget. The caller resolves a transport
 * result plus an attempt number into a `settlement` and hands the conclusion down, the same way the
 * reminder transactions receive an occurrence rather than computing one. The number lives in
 * `apps/web/lib/notifications/process-config.ts` with the other delivery policy, so there is exactly
 * one place to read it and exactly one place to change it.
 *
 * ## Why `retry` is `pending` again
 *
 * A retryable failure returns the intent to `pending` rather than resting it in `failed_retryable`.
 * That keeps `owner_notification_intents_pending_idx` the single scan path — a row parked in another
 * state would be invisible to the partial index and would need a second scan to find. Nothing is
 * lost by it: `attempt_count` carries the budget and the append-only attempt row carries the
 * failure, so the intent's own columns do not have to remember a history that is already durable
 * beside them.
 */

/** What the caller concluded, after applying delivery policy to a transport result. */
export type OwnerNotificationSettlement =
  | {
      readonly kind: 'sent';
      readonly providerMessageRef: string;
      readonly providerAcceptedAt: string;
    }
  /** Retryable, budget remaining. Returns to claimable work; not terminal, so not audited. */
  | { readonly kind: 'retry'; readonly failureCode: string }
  /** Retryable, budget spent. Terminal and requiring Owner attention (D135). */
  | { readonly kind: 'exhausted'; readonly failureCode: string }
  | { readonly kind: 'failed_permanent'; readonly failureCode: string }
  | { readonly kind: 'ambiguous'; readonly failureCode: string };

export interface SettleOwnerNotificationAttemptInput {
  readonly db: DbClient;
  readonly intentId: string;
  readonly organizationId: string;
  /** The attempt row opened by `beginOwnerNotificationAttempt`, still `in_flight`. */
  readonly attemptId: string;
  /** The fence taken at claim time. A superseded holder settles nothing. */
  readonly claimSequence: number;
  readonly settlement: OwnerNotificationSettlement;
  readonly settledAt: string;
  /**
   * System-attributed record of the terminal outcome (D133), or absent for a non-terminal retry.
   *
   * Required for every terminal settlement. The delivery is a `system` action: the intent keeps the
   * triggering actor, and attributing a worker's send to the Owner or the Recipient who caused the
   * event would be the untruth this separation exists to prevent.
   */
  readonly audit?: CreateAuditEventInput;
}

export type SettleOwnerNotificationAttemptResult =
  | {
      readonly settled: true;
      readonly intent: OwnerNotificationIntentRecord;
      readonly attempt: OwnerNotificationAttemptRecord;
    }
  /** The fence moved: this worker was superseded and must change nothing. */
  | { readonly settled: false; readonly reason: 'lost' };

interface IntentTransition {
  readonly state:
    'pending' | 'sent' | 'failed_permanent' | 'ambiguous' | 'requires_owner_attention';
  readonly failureCode: string | null;
  readonly terminal: boolean;
}

/**
 * How each settlement lands on the intent row.
 *
 * `pending` carries no failure code because `owner_notification_intents_failure_code_matches_state`
 * refuses one, and rightly: a row offered as claimable work should not also be asserting that it
 * failed. `ambiguous` stays its own state rather than collapsing into `sent` — the deliberate
 * divergence from the reminder rule, where D106's ceiling made a possible duplicate the worse
 * outcome. Here nothing is capped, and telling the Owner something was delivered when it may not
 * have been is the worse untruth (D135).
 */
function intentTransitionFor(settlement: OwnerNotificationSettlement): IntentTransition {
  switch (settlement.kind) {
    case 'sent':
      return { state: 'sent', failureCode: null, terminal: true };
    case 'retry':
      return { state: 'pending', failureCode: null, terminal: false };
    case 'exhausted':
      return {
        state: 'requires_owner_attention',
        failureCode: settlement.failureCode,
        terminal: true,
      };
    case 'failed_permanent':
      return { state: 'failed_permanent', failureCode: settlement.failureCode, terminal: true };
    case 'ambiguous':
      return { state: 'ambiguous', failureCode: settlement.failureCode, terminal: true };
  }
}

/** How each settlement lands on the append-only attempt row. */
function attemptOutcomeFor(
  settlement: OwnerNotificationSettlement,
): 'sent' | 'failed_retryable' | 'failed_permanent' | 'ambiguous' {
  switch (settlement.kind) {
    case 'sent':
      return 'sent';
    // Both describe the same provider answer. What differs is whether any budget remained, which
    // is the intent's business and not this row's.
    case 'retry':
    case 'exhausted':
      return 'failed_retryable';
    case 'failed_permanent':
      return 'failed_permanent';
    case 'ambiguous':
      return 'ambiguous';
  }
}

/**
 * Close out one provider call: intent state, attempt outcome, and audit, atomically and fenced.
 *
 * Every write repeats `claimSequence` in its `where`, so a worker whose lease expired and was
 * reclaimed while its call was in flight changes nothing here. It learns that from a zero-row count
 * rather than from an exception, because being superseded is a normal thing to discover.
 */
export async function settleOwnerNotificationAttempt(
  input: SettleOwnerNotificationAttemptInput,
): Promise<SettleOwnerNotificationAttemptResult> {
  const transition = intentTransitionFor(input.settlement);
  if (transition.terminal && !input.audit) {
    throw new Error('A terminal Owner notification settlement requires an audit event (D133).');
  }

  return input.db.$transaction(async (tx) => {
    const updated = await tx.ownerNotificationIntent.updateMany({
      where: {
        id: input.intentId,
        organizationId: input.organizationId,
        state: 'claimed',
        claimSequence: input.claimSequence,
      },
      data: {
        state: transition.state,
        failureCode: transition.failureCode,
        settledAt: transition.terminal ? fromIso(input.settledAt)! : null,
        // The lease ends with the attempt either way.
        // `owner_notification_intents_claim_only_when_claimed` requires it: any state but `claimed`
        // must carry no holder, so releasing is not tidiness, it is the constraint.
        claimedBy: null,
        claimedAt: null,
        claimExpiresAt: null,
      },
    });
    if (updated.count !== 1) {
      return { settled: false, reason: 'lost' } as const;
    }

    // Fenced on `in_flight` so a settlement cannot be applied twice to the same provider call.
    const attemptOutcome = attemptOutcomeFor(input.settlement);
    const settledAttempt = await tx.ownerNotificationAttempt.updateMany({
      where: {
        id: input.attemptId,
        organizationId: input.organizationId,
        intentId: input.intentId,
        outcome: 'in_flight',
      },
      data: {
        outcome: attemptOutcome,
        failureCode: input.settlement.kind === 'sent' ? null : input.settlement.failureCode,
        providerAcceptedAt:
          input.settlement.kind === 'sent' ? fromIso(input.settlement.providerAcceptedAt)! : null,
        providerMessageRef:
          input.settlement.kind === 'sent' ? input.settlement.providerMessageRef : null,
      },
    });
    if (settledAttempt.count !== 1) {
      return { settled: false, reason: 'lost' } as const;
    }

    if (input.audit) {
      await createAuditEvent(tx, input.audit);
    }

    const [intent, attempt] = await Promise.all([
      tx.ownerNotificationIntent.findUniqueOrThrow({ where: { id: input.intentId } }),
      tx.ownerNotificationAttempt.findUniqueOrThrow({ where: { id: input.attemptId } }),
    ]);

    return {
      settled: true,
      intent: mapOwnerNotificationIntent(intent),
      attempt: mapOwnerNotificationAttempt(attempt),
    } as const;
  });
}

export interface TerminalizeWithoutDeliveryInput {
  readonly db: DbClient;
  readonly intentId: string;
  readonly organizationId: string;
  readonly expectedClaimSequence: number;
  readonly disposition:
    | { readonly kind: 'suppressed'; readonly reason: 'stale' | 'channel_unavailable' }
    | { readonly kind: 'exhausted'; readonly failureCode: string };
  readonly settledAt: string;
  readonly audit: CreateAuditEventInput;
}

/**
 * Terminalize a `pending` intent that was never handed to a transport, with its audit event.
 *
 * The staleness horizon (D135) and the defensive budget check both end here. No attempt row is
 * written by either, and that is the point: an attempt row asserts that a provider was contacted,
 * and inventing one to make the history look uniform would be the exact fiction
 * `owner_notification_attempts_provider_call_recorded` exists to prevent. Why the Owner never heard
 * is answered by the intent's `suppression_reason` and by the audit event, both of which are true.
 */
export async function terminalizeOwnerNotificationWithoutDelivery(
  input: TerminalizeWithoutDeliveryInput,
): Promise<{ readonly settled: boolean }> {
  return input.db.$transaction(async (tx) => {
    const data =
      input.disposition.kind === 'suppressed'
        ? {
            state: 'suppressed' as const,
            suppressionReason: input.disposition.reason,
            settledAt: fromIso(input.settledAt)!,
          }
        : {
            state: 'requires_owner_attention' as const,
            failureCode: input.disposition.failureCode,
            settledAt: fromIso(input.settledAt)!,
          };

    const updated = await tx.ownerNotificationIntent.updateMany({
      where: {
        id: input.intentId,
        organizationId: input.organizationId,
        state: 'pending',
        claimSequence: input.expectedClaimSequence,
      },
      data,
    });
    if (updated.count !== 1) {
      return { settled: false };
    }

    await createAuditEvent(tx, input.audit);
    return { settled: true };
  });
}
