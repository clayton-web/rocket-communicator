import 'server-only';
import type { DbClient } from '@aicaa/db';
import {
  MAX_CAPABILITY_EXPIRIES_PER_SWEEP,
  runCapabilityExpirySweep,
  type CapabilityExpirySweepResult,
} from '@/lib/capability/expiry';
import { isOwnerEventCaptureEnabled } from './capture-config';
import {
  isOwnerEventDeliveryEnabled,
  NOTIFICATION_PROCESS_MAX_DURATION_MS,
  NOTIFICATION_PROCESS_STOP_MARGIN_MS,
} from './process-config';
import {
  runInternalNotificationProcess,
  zeroNotificationAggregate,
  type NotificationProcessAggregate,
} from './process-service';
import type { OwnerNotificationTransport } from './transport';

/**
 * A8.5e Owner Event Notification worker: the two phases of one invocation (D133, D135).
 *
 * The endpoint does two unrelated things behind two unrelated flags, and this module is the only
 * place that knows they share an invocation:
 *
 *  1. **Capture** — bounded capability-expiry observation, gated on `ENABLE_OWNER_EVENT_CAPTURE`.
 *     Writes durable transitions, audit rows, and notification intents. Contacts nothing.
 *  2. **Delivery** — the A8.5b state machine, gated on `ENABLE_OWNER_EVENT_DELIVERY`. Claims intents
 *     under a lease and sends through the transport it is handed.
 *
 * They are sequenced, not merged. No transaction spans them, neither reads the other's flag, and
 * either can be off while the other runs. Capture goes first so an expiry observed now is deliverable
 * in the same invocation rather than the next one.
 *
 * ## The invariant A8.5e replaced
 *
 * A8.5b promised that *delivery disabled means zero database access*, and that was true of an
 * endpoint whose only work was delivery. It is the wrong promise for an endpoint that also captures,
 * and quietly keeping it would have meant refusing to observe expiry unless mail was already
 * flowing. The final invariant is stronger where it matters and honest about the rest:
 *
 * > **Both flags off means zero database access and no transport.** Capture alone opens the database
 * > and constructs no transport. Delivery alone constructs a transport and observes no expiry.
 *
 * `openDb` and `composeTransport` are supplied as thunks so that both halves are provable by
 * observation rather than by reading the source: a test asserts the function was never called.
 *
 * ## Nothing invokes this
 *
 * No cron job exists and `vercel.json` is unchanged. Both flags are unset in every environment,
 * which is the both-off row: an invocation today authenticates, reads two strings, and returns.
 */

/** Bounded aggregate for one invocation. Counts and flags only, across both phases. */
export interface OwnerNotificationWorkerAggregate extends NotificationProcessAggregate {
  /** Whether `ENABLE_OWNER_EVENT_CAPTURE` was exactly `"true"`, independent of delivery. */
  readonly captureEnabled: boolean;
  /** Expired capabilities this invocation attempted to transition. */
  readonly expiryScanned: number;
  /** Transitions it won, each having written one audit row and, under capture, one intent. */
  readonly expiryObserved: number;
  /** Transitions another observer had already made. Expected under overlap, and not a failure. */
  readonly expiryLostRaces: number;
  /** Whether the expiry scan came back full, so more probably remain for the next invocation. */
  readonly expiryBatchFilled: boolean;
  /** Whether capture stopped early for time. When true, delivery was not started at all. */
  readonly expiryDeadlineStopped: boolean;
}

const ZERO_SWEEP: CapabilityExpirySweepResult = {
  scanned: 0,
  observed: 0,
  lostRaces: 0,
  batchFilled: false,
  deadlineStopped: false,
};

export interface OwnerNotificationWorkerInput {
  /**
   * Opens the database, and is **not called** when both flags are off.
   *
   * A thunk rather than a client because "did this invocation touch the database" should be a fact
   * about what ran, not an inference from where a flag is read.
   */
  readonly openDb: () => Promise<DbClient>;
  /**
   * Builds the delivery transport, and is **not called** unless delivery is enabled and capture left
   * time for it. Capture must never cause a Gmail credential to be resolved.
   */
  readonly composeTransport: (db: DbClient) => Promise<OwnerNotificationTransport | undefined>;
  readonly requestId: string;
  readonly now?: string;
  readonly startedAtMs?: number;
  readonly deadlineMs?: number;
  readonly maxExpiries?: number;
  readonly maxNotifications?: number;
  readonly env?: NodeJS.ProcessEnv;
  /** Test seam for the capture phase. Production passes nothing and gets the real sweep. */
  readonly sweep?: typeof runCapabilityExpirySweep;
}

export async function runOwnerNotificationWorker(
  input: OwnerNotificationWorkerInput,
): Promise<{ response: OwnerNotificationWorkerAggregate }> {
  const env = input.env ?? process.env;
  const captureEnabled = isOwnerEventCaptureEnabled(env);
  const deliveryEnabled = isOwnerEventDeliveryEnabled(env);

  // Both flags read before anything else can happen, and the refusal sits between reading them and
  // `openDb`. With both unset — which is every environment — this invocation opens no connection,
  // issues no statement, resolves no credential, and constructs nothing (D135).
  if (!captureEnabled && !deliveryEnabled) {
    return {
      response: {
        ...zeroNotificationAggregate({
          deliveryEnabled,
          transportConfigured: false,
          requestId: input.requestId,
        }),
        captureEnabled,
        expiryScanned: 0,
        expiryObserved: 0,
        expiryLostRaces: 0,
        expiryBatchFilled: false,
        expiryDeadlineStopped: false,
      },
    };
  }

  const startedAtMs = input.startedAtMs ?? Date.now();
  const deadlineMs = input.deadlineMs ?? startedAtMs + NOTIFICATION_PROCESS_MAX_DURATION_MS;
  const now = input.now ?? new Date(startedAtMs).toISOString();
  const db = await input.openDb();

  // -------------------------------------------------------------------------
  // Capture phase
  // -------------------------------------------------------------------------
  //
  // Gated on capture alone. Delivery being off is not a reason to let a capability go on claiming to
  // be active, and the 24-hour horizon is what keeps the resulting intents from ever flushing later.
  const sweep = input.sweep ?? runCapabilityExpirySweep;
  const expiry = captureEnabled
    ? await sweep({
        db,
        now,
        limit: input.maxExpiries ?? MAX_CAPABILITY_EXPIRIES_PER_SWEEP,
        stopAtMs: deadlineMs - NOTIFICATION_PROCESS_STOP_MARGIN_MS,
        requestId: input.requestId,
        // The decision already made above, handed down rather than read again. Two reads of one
        // variable can disagree; one read cannot.
        env,
      })
    : ZERO_SWEEP;

  // -------------------------------------------------------------------------
  // Delivery phase
  // -------------------------------------------------------------------------
  //
  // Out of time during capture means delivery does not begin: no transport is composed, so no Gmail
  // configuration is read and no credential is touched on the way to doing nothing. The work is not
  // lost — the intents are durable and the next invocation finds them.
  const transport =
    deliveryEnabled && !expiry.deadlineStopped ? await input.composeTransport(db) : undefined;

  const delivery = (
    await runInternalNotificationProcess({
      db,
      requestId: input.requestId,
      transport,
      now,
      startedAtMs,
      deadlineMs,
      maxNotifications: input.maxNotifications,
      env,
    })
  ).response;

  return {
    response: {
      ...delivery,
      captureEnabled,
      expiryScanned: expiry.scanned,
      expiryObserved: expiry.observed,
      expiryLostRaces: expiry.lostRaces,
      expiryBatchFilled: expiry.batchFilled,
      expiryDeadlineStopped: expiry.deadlineStopped,
      // Invocation-level, which is what the field has always meant: either phase running out of
      // budget is the invocation having stopped taking new work.
      deadlineStopped: delivery.deadlineStopped || expiry.deadlineStopped,
    },
  };
}
