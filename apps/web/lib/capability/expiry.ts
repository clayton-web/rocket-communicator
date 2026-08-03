import 'server-only';
import type { CreateAuditEventInput, DbClient } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import {
  isOwnerEventCaptureEnabled,
  OWNER_NOTIFICATION_INTENT_ID_PREFIX,
} from '@/lib/notifications/capture-config';
import { newEntityId } from './internal';

/**
 * Who observed a capability's time running out (A8.5d, D133). The same identifier whether a sweep
 * or a Recipient's click was what noticed, because the event is the clock arriving either way.
 */
export const CAPABILITY_EXPIRY_SYSTEM_ID = 'capability_expiry' as const;

/**
 * A8.5d capability expiry observation (D133).
 *
 * ## The gap this closes
 *
 * A capability's `expiresAt` passing is not a write. Every reader — the validator, the reminder
 * pre-send check, the handoff resolver — treated a lapsed capability as expired, and the row went on
 * saying `active` forever. So the ratified `capability.expired` event had nothing to fire from: there
 * was no transition, only a growing disagreement between the clock and the database.
 *
 * Two things can notice a lapse, and now both come through here:
 *
 *  1. **A Recipient presenting the token.** Already persisted expiry best-effort before A8.5d, with
 *     no audit row and a read-then-write that could overwrite a revocation.
 *  2. **The sweep.** Goes looking, so an untouched capability is still observed.
 *
 * They converge on one transaction on purpose. A Recipient clicking a dead link at the same moment a
 * worker scans it is an ordinary race, and the answer has to be one transition, one audit row, and
 * one notification — which is a property of the compare-and-set in `observeCapabilityExpiry`, not of
 * these callers being careful.
 *
 * ## What invokes the sweep (A8.5e)
 *
 * {@link runCapabilityExpirySweep} is the capture phase of the Owner notification worker, and it runs
 * only when `ENABLE_OWNER_EVENT_CAPTURE` is exactly `"true"` — which it is nowhere. A8.5d left it
 * unwired because invoking it would have contradicted A8.5b's "delivery disabled means zero database
 * access"; A8.5e replaced that with the invariant that actually holds now, that **both** flags off
 * means zero database access, and wired the phase behind the capture flag alone.
 *
 * Still nothing schedules it: no cron job invokes the endpoint. The Recipient-triggered path remains
 * live and is what observes expiry today.
 */

/** The audit row for an expiry, identical whichever path observed it. */
export function buildCapabilityExpiryAudit(input: {
  readonly auditId: string;
  readonly organizationId: string;
  readonly capabilityId: string;
  readonly assignmentId?: string | null;
  readonly taskId: string;
  /** The capability's own `expiresAt`. When it expired, not when anybody noticed. */
  readonly expiredAt: string;
  readonly requestId?: string | null;
  readonly correlationId?: string | null;
}): CreateAuditEventInput {
  return {
    id: input.auditId,
    organizationId: input.organizationId,
    // Not the Recipient, even when a Recipient's click is what triggered the observation. They
    // presented a link; the clock is what ended it. Attributing this to a capability would put a
    // Recipient's name on a lapse they had no part in (D133).
    actorKind: 'system',
    systemId: CAPABILITY_EXPIRY_SYSTEM_ID,
    capabilityId: input.capabilityId,
    assignmentId: input.assignmentId ?? undefined,
    taskId: input.taskId,
    action: 'capability_expired',
    outcome: 'succeeded',
    recordedAt: input.expiredAt,
    requestId: input.requestId ?? undefined,
    correlationId: input.correlationId ?? null,
  };
}

export interface ObserveExpiryInput {
  readonly db: DbClient;
  readonly organizationId: string;
  readonly capabilityId: string;
  readonly taskId: string;
  /** The capability's `expiresAt`, which is both the CAS bound and the event instant. */
  readonly expiredAt: string;
  /** The observation instant. Must be at or after `expiredAt` for the transition to apply. */
  readonly observedAt: string;
  readonly assignmentId?: string | null;
  readonly requestId?: string | null;
  readonly correlationId?: string | null;
  /**
   * The environment the capture decision is read from. Defaults to the process environment, which
   * is what the Recipient-triggered path uses; the A8.5e worker passes the one it already resolved,
   * so a single invocation cannot decide capture twice and disagree with itself.
   */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Observe one capability's expiry, at most once.
 *
 * The capture decision is taken here, before the transaction opens, so a Production deployment with
 * the A8.5 migration unapplied issues no statement against an A8.5 table — the same rule every other
 * producer follows, and the reason `packages/db` reads no environment.
 */
export async function observeCapabilityExpiryForOrganization(
  input: ObserveExpiryInput,
): Promise<{ readonly expired: boolean }> {
  const runtime = await loadDbRuntime();
  const capture = isOwnerEventCaptureEnabled(input.env)
    ? { id: newEntityId(OWNER_NOTIFICATION_INTENT_ID_PREFIX) }
    : undefined;

  const result = await runtime.observeCapabilityExpiry({
    db: input.db,
    organizationId: input.organizationId,
    capabilityId: input.capabilityId,
    at: input.observedAt,
    audit: buildCapabilityExpiryAudit({
      auditId: newEntityId('audit'),
      organizationId: input.organizationId,
      capabilityId: input.capabilityId,
      assignmentId: input.assignmentId,
      taskId: input.taskId,
      expiredAt: input.expiredAt,
      requestId: input.requestId,
      correlationId: input.correlationId,
    }),
    ownerNotification: capture,
  });

  return { expired: result.expired };
}

/**
 * How many capabilities one sweep invocation may observe.
 *
 * Modest on purpose. The sweep shares its invocation with notification delivery, and a phase that
 * can run for a minute is a phase that can starve the one after it. Fifty small transactions cost a
 * few tens of milliseconds; what is left over is picked up by the next wake-up, which is exactly how
 * the delivery scan's own bound behaves.
 */
export const MAX_CAPABILITY_EXPIRIES_PER_SWEEP = 50;

export interface CapabilityExpirySweepResult {
  /** Capabilities this invocation attempted, which is at most what the bounded scan returned. */
  readonly scanned: number;
  /** Transitions this invocation won. A concurrent sweep's wins are somebody else's count. */
  readonly observed: number;
  /** Attempts another observer had already completed. Expected under overlap, and not an error. */
  readonly lostRaces: number;
  /** Whether the scan came back full, so more expiries probably remain for the next invocation. */
  readonly batchFilled: boolean;
  /** Whether the sweep stopped starting transitions to leave the invocation's budget intact. */
  readonly deadlineStopped: boolean;
}

/**
 * Observe every capability whose expiry has passed, up to a bounded batch.
 *
 * One transaction per capability rather than one for the batch: a scan held open across fifty
 * transactions would block anybody presenting any of those tokens, and a single failure would
 * discard forty-nine good transitions. Losing a race is not an error, so a loser is counted and the
 * sweep keeps going.
 *
 * The instant is supplied by the caller and used for the whole batch, so the sweep cannot expire one
 * capability against a clock a millisecond ahead of the next.
 *
 * `stopAtMs` is a wall-clock instant after which no *new* transition is started. A transition already
 * underway finishes — abandoning it would leave the capability `active` with the audit row written,
 * which is the one outcome worse than being slow. The margin is the caller's to choose, because the
 * budget being protected belongs to the invocation rather than to this scan.
 */
export async function runCapabilityExpirySweep(input: {
  readonly db: DbClient;
  readonly now: string;
  readonly limit?: number;
  readonly stopAtMs?: number;
  readonly requestId?: string | null;
  readonly correlationId?: string | null;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<CapabilityExpirySweepResult> {
  const limit = input.limit ?? MAX_CAPABILITY_EXPIRIES_PER_SWEEP;
  const runtime = await loadDbRuntime();
  const due = await runtime.listExpirableCapabilities(input.db, {
    expiresAtOrBefore: input.now,
    limit,
  });

  let scanned = 0;
  let observed = 0;
  let deadlineStopped = false;

  for (const capability of due) {
    if (input.stopAtMs !== undefined && Date.now() > input.stopAtMs) {
      deadlineStopped = true;
      break;
    }
    scanned += 1;
    const outcome = await observeCapabilityExpiryForOrganization({
      db: input.db,
      organizationId: capability.organizationId,
      capabilityId: capability.id,
      taskId: capability.taskId,
      expiredAt: capability.expiresAt,
      observedAt: input.now,
      requestId: input.requestId,
      correlationId: input.correlationId,
      env: input.env,
    });
    if (outcome.expired) {
      observed += 1;
    }
  }

  return {
    scanned,
    observed,
    lostRaces: scanned - observed,
    batchFilled: due.length === limit,
    deadlineStopped,
  };
}
