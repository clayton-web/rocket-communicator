import 'server-only';
import { randomBytes } from 'node:crypto';
import type { CreateAuditEventInput, DbClient, OwnerNotificationIntentRecord } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import {
  isOwnerEventDeliveryEnabled,
  MAX_NOTIFICATION_ATTEMPTS,
  MAX_NOTIFICATION_RECOVERIES_PER_PROCESS,
  MAX_NOTIFICATIONS_PER_PROCESS,
  NOTIFICATION_AUDIT_ACTIONS,
  NOTIFICATION_CLAIM_LEASE_MS,
  NOTIFICATION_FAILURE_CODES,
  NOTIFICATION_PROCESS_MAX_DURATION_MS,
  NOTIFICATION_PROCESS_STOP_MARGIN_MS,
  NOTIFICATION_PROCESS_SYSTEM_ID,
  NOTIFICATION_STALENESS_HORIZON_MS,
} from './process-config';
import type { OwnerNotificationTransport, OwnerNotificationTransportResult } from './transport';

/**
 * A8.5b Owner Event Notification processing (D133, D135).
 *
 * One invocation: recover what a dead worker abandoned, then deliver what is owed, bounded by a
 * batch size and a soft deadline. The database is the source of truth for what is owed; a scheduler
 * contributes a cadence and no decision, and in A8.5b there is no scheduler at all.
 *
 * ## The order of operations is the safety argument
 *
 * For each notification:
 *
 *   1. Claim it, compare-and-set, taking a fencing token.
 *   2. Record that a provider call is starting, and commit that.
 *   3. Call the transport, **outside every database transaction**.
 *   4. Settle, in one transaction, fenced on the token from step 1.
 *
 * Step 2 before step 3 is what makes a crash recoverable truthfully: an attempt row left `in_flight`
 * is durable evidence that a provider was contacted and the answer is unknown, which is exactly
 * `ambiguous`. Without it, a worker that died mid-call would be indistinguishable from one that died
 * before calling, and recovery would have to choose between never delivering and delivering twice.
 *
 * Step 3 outside a transaction is not a performance choice. A transaction held open across a network
 * call to a third party holds row locks for as long as that third party takes to answer, and a
 * provider that hangs would take the table with it.
 *
 * ## What this service does not do
 *
 * It does not render an email, resolve a destination address, or know that Gmail exists. A8.5b's
 * only transport is the fail-closed fake, and the seam it depends on carries identity rather than
 * content. A8.5c adds the real adapter behind the same interface.
 */

/** Bounded aggregate. Counts and flags only — never an address, subject, actor, or row identifier. */
export interface NotificationProcessAggregate {
  readonly deliveryEnabled: boolean;
  readonly transportConfigured: boolean;
  /** Intents examined, including those terminalized without a delivery. */
  readonly scanned: number;
  readonly claimed: number;
  readonly sent: number;
  /** Retryable failures that returned the intent to claimable work, budget remaining. */
  readonly failedRetryable: number;
  readonly failedPermanent: number;
  readonly ambiguous: number;
  readonly staleSuppressed: number;
  readonly retryExhausted: number;
  /** Lapsed leases returned to claimable work, no provider call having started. */
  readonly recoveredClaims: number;
  /** Compare-and-set refusals: another worker moved first. Expected, not an error. */
  readonly lostClaims: number;
  /**
   * Whether the scan filled its batch, so more work probably remains.
   *
   * Deliberately not a count of what is left: that would need an unbounded `COUNT` over every
   * pending row, and a number that expensive to produce is not one an aggregate should promise.
   */
  readonly batchFilled: boolean;
  readonly deadlineStopped: boolean;
  readonly requestId: string;
}

const ZERO_AGGREGATE = {
  scanned: 0,
  claimed: 0,
  sent: 0,
  failedRetryable: 0,
  failedPermanent: 0,
  ambiguous: 0,
  staleSuppressed: 0,
  retryExhausted: 0,
  recoveredClaims: 0,
  lostClaims: 0,
  batchFilled: false,
  deadlineStopped: false,
};

export interface RunNotificationProcessInput {
  readonly db: DbClient;
  readonly requestId: string;
  /**
   * The transport to deliver through.
   *
   * Absent means nothing is delivered and nothing is claimed, exactly as a disabled flag does. In
   * A8.5b the production route never supplies one, because the only implementation is a fake and a
   * fake must not be able to reach a real invocation by being the default.
   */
  readonly transport?: OwnerNotificationTransport;
  readonly now?: string;
  readonly startedAtMs?: number;
  readonly deadlineMs?: number;
  readonly maxNotifications?: number;
  readonly env?: NodeJS.ProcessEnv;
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

function claimOwnerFromRequestId(requestId: string): string {
  return `notification_process:${requestId}`;
}

function plusMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

/**
 * A concise, system-attributed record that the Owner's notification reached a terminal outcome
 * (D133).
 *
 * `system` and nothing else. The intent carries the triggering actor — a Recipient completing a Task
 * stays capability-attributed — and copying that here would say the Recipient sent the Owner an
 * email, which is not what happened. The two records answer different questions and are not merged.
 *
 * `taskId` is set only when the subject genuinely is a Task, so the Owner's Task history shows the
 * notification about that Task and nothing borrows a Task it does not belong to.
 *
 * `note` carries a failure code from a closed set defined in `process-config.ts` and never a
 * provider response, an exception message, an address, or Recipient text.
 */
function terminalAudit(input: {
  readonly intent: OwnerNotificationIntentRecord;
  readonly action: string;
  readonly outcome: 'succeeded' | 'denied' | 'failed';
  readonly failureCode?: string;
  readonly now: string;
  readonly requestId: string;
}): CreateAuditEventInput {
  return {
    id: newId('audit'),
    organizationId: input.intent.organizationId,
    actorKind: 'system',
    systemId: NOTIFICATION_PROCESS_SYSTEM_ID,
    taskId: input.intent.subjectKind === 'task' ? input.intent.subjectId : undefined,
    action: input.action,
    outcome: input.outcome,
    note: input.failureCode,
    requestId: input.requestId,
    correlationId: input.intent.correlationId,
    recordedAt: input.now,
  };
}

/**
 * Classify what the transport said, given how much budget the attempt just consumed (D135).
 *
 * The one-shot policy lives here rather than in persistence: `packages/db` is handed a conclusion,
 * not the number three. `ambiguous` and `permanent` are terminal on first occurrence, and only
 * `retryable` consults the budget.
 */
function settlementFor(
  result: OwnerNotificationTransportResult,
  attemptNumber: number,
  now: string,
) {
  switch (result.kind) {
    case 'accepted':
      return {
        kind: 'sent' as const,
        providerMessageRef: result.providerMessageRef,
        providerAcceptedAt: now,
      };
    case 'permanent':
      return { kind: 'failed_permanent' as const, failureCode: result.failureCode };
    case 'ambiguous':
      return { kind: 'ambiguous' as const, failureCode: result.failureCode };
    case 'retryable':
      return attemptNumber >= MAX_NOTIFICATION_ATTEMPTS
        ? {
            kind: 'exhausted' as const,
            failureCode: NOTIFICATION_FAILURE_CODES.retryBudgetExhausted,
          }
        : { kind: 'retry' as const, failureCode: result.failureCode };
  }
}

export async function runInternalNotificationProcess(
  input: RunNotificationProcessInput,
): Promise<{ response: NotificationProcessAggregate }> {
  const env = input.env ?? process.env;
  const deliveryEnabled = isOwnerEventDeliveryEnabled(env);
  const transport = input.transport;
  const transportConfigured = transport !== undefined;

  // Ahead of `loadDbRuntime`, which is the point (D135). With the flag unset, this invocation opens
  // no database connection, issues no statement against either A8.5 table, claims nothing, writes no
  // attempt row, and constructs no transport. "Delivery disabled implies no A8.5 database access" is
  // a property of the control flow rather than a promise made by code further down.
  if (!deliveryEnabled || !transportConfigured) {
    return {
      response: {
        deliveryEnabled,
        transportConfigured,
        ...ZERO_AGGREGATE,
        requestId: input.requestId,
      },
    };
  }

  const startedAtMs = input.startedAtMs ?? Date.now();
  const deadlineMs = input.deadlineMs ?? startedAtMs + NOTIFICATION_PROCESS_MAX_DURATION_MS;
  const now = input.now ?? new Date(startedAtMs).toISOString();
  const limit = input.maxNotifications ?? MAX_NOTIFICATIONS_PER_PROCESS;
  const runtime = await loadDbRuntime();
  const counters = { ...ZERO_AGGREGATE };

  const outOfTime = () => {
    if (Date.now() > deadlineMs - NOTIFICATION_PROCESS_STOP_MARGIN_MS) {
      counters.deadlineStopped = true;
      return true;
    }
    return false;
  };

  // -------------------------------------------------------------------------
  // Recovery, before any new work is claimed
  // -------------------------------------------------------------------------
  //
  // A lapsed lease is either a worker that died before contacting the provider — reclaimable — or
  // one that died after, which is unknowable and therefore `ambiguous`. The repository decides
  // which atomically rather than letting this loop read and then act on what it read.
  const expired = await runtime.listExpiredOwnerNotificationClaims(input.db, {
    now,
    limit: MAX_NOTIFICATION_RECOVERIES_PER_PROCESS,
  });

  for (const stale of expired) {
    if (outOfTime()) {
      break;
    }

    const recovery = await runtime.recoverExpiredOwnerNotificationClaim(input.db, {
      id: stale.id,
      organizationId: stale.organizationId,
      claimSequence: stale.claimSequence,
    });

    if (recovery.outcome === 'released') {
      counters.recoveredClaims += 1;
      continue;
    }
    if (recovery.outcome === 'lost') {
      counters.lostClaims += 1;
      continue;
    }

    // A provider call had started. The transport is never invoked again for it.
    const settled = await runtime.settleOwnerNotificationAttempt({
      db: input.db,
      intentId: stale.id,
      organizationId: stale.organizationId,
      attemptId: recovery.attempt.id,
      claimSequence: stale.claimSequence,
      settlement: {
        kind: 'ambiguous',
        failureCode: NOTIFICATION_FAILURE_CODES.leaseExpiredInFlight,
      },
      settledAt: now,
      audit: terminalAudit({
        intent: stale,
        action: NOTIFICATION_AUDIT_ACTIONS.ambiguous,
        outcome: 'failed',
        failureCode: NOTIFICATION_FAILURE_CODES.leaseExpiredInFlight,
        now,
        requestId: input.requestId,
      }),
    });
    if (settled.settled) {
      counters.ambiguous += 1;
    } else {
      counters.lostClaims += 1;
    }
  }

  // -------------------------------------------------------------------------
  // Delivery
  // -------------------------------------------------------------------------
  if (!counters.deadlineStopped) {
    const claimable = await runtime.listClaimableOwnerNotificationIntents(input.db, { limit });
    counters.batchFilled = claimable.length === limit;

    for (const intent of claimable) {
      if (outOfTime()) {
        break;
      }
      counters.scanned += 1;

      // The staleness horizon, before anything is claimed and without contacting anything (D135).
      // The intent is terminal from here: it is not delivered now and it is never eligible again,
      // which is what stops a backlog accumulated while delivery was disabled from ever flushing.
      const ageMs = new Date(now).getTime() - new Date(intent.occurredAt).getTime();
      if (ageMs > NOTIFICATION_STALENESS_HORIZON_MS) {
        const suppressed = await runtime.terminalizeOwnerNotificationWithoutDelivery({
          db: input.db,
          intentId: intent.id,
          organizationId: intent.organizationId,
          expectedClaimSequence: intent.claimSequence,
          disposition: { kind: 'suppressed', reason: 'stale' },
          settledAt: now,
          audit: terminalAudit({
            intent,
            action: NOTIFICATION_AUDIT_ACTIONS.suppressedStale,
            // Nothing failed and nothing succeeded: the horizon refused it. `denied` is the only one
            // of the three that does not assert an error the system did not encounter.
            outcome: 'denied',
            now,
            requestId: input.requestId,
          }),
        });
        suppressed.settled ? (counters.staleSuppressed += 1) : (counters.lostClaims += 1);
        continue;
      }

      // Defence in depth. The ordinary path terminalizes the moment the last attempt fails, so a
      // pending intent at the budget should be unreachable; a crash between incrementing the count
      // and settling could still leave one, and it must not be scanned forever and claimed never.
      if (intent.attemptCount >= MAX_NOTIFICATION_ATTEMPTS) {
        const ended = await runtime.terminalizeOwnerNotificationWithoutDelivery({
          db: input.db,
          intentId: intent.id,
          organizationId: intent.organizationId,
          expectedClaimSequence: intent.claimSequence,
          disposition: {
            kind: 'exhausted',
            failureCode: NOTIFICATION_FAILURE_CODES.retryBudgetExhausted,
          },
          settledAt: now,
          audit: terminalAudit({
            intent,
            action: NOTIFICATION_AUDIT_ACTIONS.retryExhausted,
            outcome: 'failed',
            failureCode: NOTIFICATION_FAILURE_CODES.retryBudgetExhausted,
            now,
            requestId: input.requestId,
          }),
        });
        ended.settled ? (counters.retryExhausted += 1) : (counters.lostClaims += 1);
        continue;
      }

      const claim = await runtime.claimOwnerNotificationIntent(input.db, {
        id: intent.id,
        organizationId: intent.organizationId,
        expectedClaimSequence: intent.claimSequence,
        claimedBy: claimOwnerFromRequestId(input.requestId),
        claimedAt: now,
        claimExpiresAt: plusMs(now, NOTIFICATION_CLAIM_LEASE_MS),
      });
      if (!claim.claimed) {
        counters.lostClaims += 1;
        continue;
      }
      counters.claimed += 1;

      // Durable before the call, so a crash during it is recoverable as `ambiguous` rather than
      // guessed at. Its own transaction: the one below must not still be open when the transport
      // is invoked.
      const began = await runtime.beginOwnerNotificationAttempt(input.db, {
        attemptId: newId('onatt'),
        intentId: intent.id,
        organizationId: intent.organizationId,
        claimSequence: claim.claimSequence,
        expectedAttemptCount: intent.attemptCount,
        startedAt: now,
      });
      if (!began.began) {
        counters.lostClaims += 1;
        continue;
      }
      const attemptNumber = began.attempt.attemptNumber;

      // No transaction is open here, and none may be.
      let result: OwnerNotificationTransportResult;
      try {
        result = await transport.send({
          intentId: intent.id,
          organizationId: intent.organizationId,
          eventType: intent.eventType,
          subjectKind: intent.subjectKind,
          subjectId: intent.subjectId,
          attemptNumber,
        });
      } catch {
        // The in-flight marker is already durable, so an exception cannot prove the provider was
        // never reached — the throw may have happened after the request left. That is the
        // definition of ambiguous, and D135 makes ambiguous terminal rather than retried. The
        // exception itself is discarded: `note` carries a code from a closed set, never a message.
        result = {
          kind: 'ambiguous',
          failureCode: NOTIFICATION_FAILURE_CODES.transportThrew,
        };
      }

      const settlement = settlementFor(result, attemptNumber, now);
      const audit =
        settlement.kind === 'retry'
          ? undefined
          : terminalAudit({
              intent,
              action:
                settlement.kind === 'sent'
                  ? NOTIFICATION_AUDIT_ACTIONS.sent
                  : settlement.kind === 'exhausted'
                    ? NOTIFICATION_AUDIT_ACTIONS.retryExhausted
                    : settlement.kind === 'ambiguous'
                      ? NOTIFICATION_AUDIT_ACTIONS.ambiguous
                      : NOTIFICATION_AUDIT_ACTIONS.failedPermanent,
              outcome: settlement.kind === 'sent' ? 'succeeded' : 'failed',
              failureCode: settlement.kind === 'sent' ? undefined : settlement.failureCode,
              now,
              requestId: input.requestId,
            });

      const settled = await runtime.settleOwnerNotificationAttempt({
        db: input.db,
        intentId: intent.id,
        organizationId: intent.organizationId,
        attemptId: began.attempt.id,
        claimSequence: claim.claimSequence,
        settlement,
        settledAt: now,
        audit,
      });
      if (!settled.settled) {
        counters.lostClaims += 1;
        continue;
      }

      switch (settlement.kind) {
        case 'sent':
          counters.sent += 1;
          break;
        case 'retry':
          counters.failedRetryable += 1;
          break;
        case 'exhausted':
          counters.retryExhausted += 1;
          break;
        case 'failed_permanent':
          counters.failedPermanent += 1;
          break;
        case 'ambiguous':
          counters.ambiguous += 1;
          break;
      }
    }
  }

  return {
    response: {
      deliveryEnabled,
      transportConfigured,
      ...counters,
      requestId: input.requestId,
    },
  };
}
