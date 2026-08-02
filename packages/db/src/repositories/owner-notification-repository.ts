import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../client/create-prisma-client.js';
import { persistenceValidation, uniqueViolation } from '../errors/persistence-errors.js';
import { fromIso } from '../mappers/domain-mappers.js';
import {
  mapOwnerNotificationAttempt,
  mapOwnerNotificationIntent,
  type OwnerNotificationActor,
  type OwnerNotificationAttemptRecord,
  type OwnerNotificationEventTypeValue,
  type OwnerNotificationIntentRecord,
  type OwnerNotificationSubjectKindValue,
} from '../mappers/owner-notification-mappers.js';

type Client = DbClient | DbTransaction;

/**
 * Persistence for Owner Event Notification intent (A8.5a) and its delivery workflow (A8.5b, D133,
 * D135).
 *
 * ## What this module deliberately does not do
 *
 * It does not decide **whether** an event is notifiable, read a feature flag, read a clock, resolve
 * a destination, or know that Gmail exists. Those are policy, and policy lives above persistence —
 * the same boundary the reminder tables keep, and for the same reason: a rule that lives in two
 * places eventually disagrees with itself. This module stores a fact it is handed and enforces the
 * invariants the database can enforce.
 *
 * Every instant arrives as an ISO-8601 argument. Nothing here reads a clock, so "is this intent
 * stale" and "has this lease expired" are decided once, above, against one instant, rather than
 * separately by each statement against whatever `now()` happened to be (D103).
 *
 * ## The claim protocol (A8.5b)
 *
 * Claiming is compare-and-set on the intent row, following A8.4a rather than `FOR UPDATE SKIP
 * LOCKED`: every transition is an `updateMany` whose `where` states the exact row version it expects
 * and whose affected-row count is the answer. Zero rows means someone else moved first, and that is
 * a normal outcome rather than an error.
 *
 * `claimSequence` is the fence. It only ever increases, a claim increments it, and every later write
 * by that claim holder repeats it in the `where`. A worker whose lease expired and was reclaimed
 * therefore cannot terminalize what it no longer holds, because the sequence it remembers no longer
 * matches the row.
 */

export interface CreateOwnerNotificationIntentInput extends OwnerNotificationActor {
  id: string;
  organizationId: string;
  eventType: OwnerNotificationEventTypeValue;
  subjectKind: OwnerNotificationSubjectKindValue;
  subjectId: string;
  occurrenceKey: string;
  /** The triggering mutation's own instant, ISO-8601. Not when the event was noticed. */
  occurredAt: string;
  /** The audit row written beside this intent. A reference, not a foreign key. */
  auditEventId?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
}

/**
 * Insert one notification intent.
 *
 * **Call this inside the transaction that commits the triggering mutation.** Written anywhere else,
 * the two facts can diverge: a mutation could commit without its intent, or an intent could outlive
 * a mutation that rolled back. Passing a `DbTransaction` is what makes that structural rather than a
 * convention somebody has to remember.
 *
 * A duplicate identity surfaces as `UNIQUE_VIOLATION` rather than being swallowed. The identity is
 * server-derived (D133), so a collision means two writers genuinely raced the same event occurrence
 * — the caller decides whether that is benign, and A8.5a's only caller sits inside a transaction
 * that optimistic concurrency has already made single-winner.
 */
export async function createOwnerNotificationIntent(
  db: Client,
  input: CreateOwnerNotificationIntentInput,
): Promise<OwnerNotificationIntentRecord> {
  if (input.subjectId.length === 0 || input.occurrenceKey.length === 0) {
    throw persistenceValidation(
      'Owner notification intent requires a non-empty subjectId and occurrenceKey.',
    );
  }

  try {
    const row = await db.ownerNotificationIntent.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        eventType: input.eventType,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        occurrenceKey: input.occurrenceKey,
        state: 'pending',
        occurredAt: fromIso(input.occurredAt)!,
        actorKind: input.actorKind,
        ownerId: input.ownerId,
        capabilityId: input.capabilityId,
        systemId: input.systemId,
        assignmentId: input.assignmentId,
        attributionLabel: input.attributionLabel,
        auditEventId: input.auditEventId ?? null,
        requestId: input.requestId ?? null,
        correlationId: input.correlationId ?? null,
      },
    });
    return mapOwnerNotificationIntent(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw uniqueViolation(
        'An Owner notification intent already exists for this event occurrence (D133).',
      );
    }
    throw error;
  }
}

/** Read one intent by its identity. Used by tests and by the A8.6 Owner surface. */
export async function findOwnerNotificationIntentByIdentity(
  db: Client,
  identity: {
    organizationId: string;
    eventType: OwnerNotificationEventTypeValue;
    subjectKind: OwnerNotificationSubjectKindValue;
    subjectId: string;
    occurrenceKey: string;
  },
): Promise<OwnerNotificationIntentRecord | null> {
  const row = await db.ownerNotificationIntent.findUnique({
    where: {
      organizationId_eventType_subjectKind_subjectId_occurrenceKey: identity,
    },
  });
  return row ? mapOwnerNotificationIntent(row) : null;
}

/** Every intent recorded about one subject, oldest first. Subject history for A8.6. */
export async function listOwnerNotificationIntentsForSubject(
  db: Client,
  organizationId: string,
  subjectKind: OwnerNotificationSubjectKindValue,
  subjectId: string,
): Promise<OwnerNotificationIntentRecord[]> {
  const rows = await db.ownerNotificationIntent.findMany({
    where: { organizationId, subjectKind, subjectId },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(mapOwnerNotificationIntent);
}

// ---------------------------------------------------------------------------
// A8.5b delivery workflow
// ---------------------------------------------------------------------------

function assertScanLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw persistenceValidation(
      'Owner notification scan limit must be an integer between 1 and 500.',
    );
  }
  return limit;
}

/**
 * Claimable work, oldest event first.
 *
 * Matches `owner_notification_intents_pending_idx` exactly — the same `state = 'pending'` predicate
 * and the same `(occurred_at, id)` ordering — so a bounded batch is a real bound rather than a sort
 * over the table, and two workers waking together see the same candidates in the same order.
 *
 * Deliberately global across organizations, like the reminder due-scan: an intent belongs to an
 * organization but the wake-up does not, and scanning per organization would make one busy Owner
 * able to starve another.
 *
 * `pending` is the only claimable state. A retryable failure returns the intent here rather than
 * resting in `failed_retryable`, which is what keeps this partial index the single scan path.
 */
export async function listClaimableOwnerNotificationIntents(
  db: Client,
  input: { readonly limit: number },
): Promise<OwnerNotificationIntentRecord[]> {
  const rows = await db.ownerNotificationIntent.findMany({
    where: { state: 'pending' },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    take: assertScanLimit(input.limit),
  });
  return rows.map(mapOwnerNotificationIntent);
}

/**
 * Leases that have lapsed, oldest expiry first.
 *
 * Whether each one may be reclaimed or must be terminalized ambiguous is not decided here: it
 * depends on whether a provider call had already started, which is a fact about the attempt rows.
 * `recoverExpiredOwnerNotificationClaim` answers it atomically rather than making the caller read
 * and then act on what it read.
 */
export async function listExpiredOwnerNotificationClaims(
  db: Client,
  input: { readonly now: string; readonly limit: number },
): Promise<OwnerNotificationIntentRecord[]> {
  const rows = await db.ownerNotificationIntent.findMany({
    where: { state: 'claimed', claimExpiresAt: { lte: fromIso(input.now)! } },
    orderBy: [{ claimExpiresAt: 'asc' }, { id: 'asc' }],
    take: assertScanLimit(input.limit),
  });
  return rows.map(mapOwnerNotificationIntent);
}

export type ClaimOwnerNotificationResult =
  | { readonly claimed: true; readonly claimSequence: number }
  | { readonly claimed: false; readonly reason: 'lost' };

export interface ClaimOwnerNotificationIntentInput {
  readonly id: string;
  readonly organizationId: string;
  /** The sequence observed during the scan. The fence: a row that moved since is not ours. */
  readonly expectedClaimSequence: number;
  readonly claimedBy: string;
  readonly claimedAt: string;
  readonly claimExpiresAt: string;
}

/**
 * Take the lease on a pending intent, or lose the race.
 *
 * The `where` is the whole safety argument. `state: 'pending'` excludes anything claimed, terminal,
 * or already delivered; `claimSequence` excludes a row that was claimed and released since the scan
 * read it. Two workers issuing this against the same row are serialized by PostgreSQL on the row
 * itself, so the second one re-evaluates the predicate against the first one's committed result and
 * matches nothing.
 *
 * Losing is not an error. It is the expected outcome for every worker but one.
 */
export async function claimOwnerNotificationIntent(
  db: Client,
  input: ClaimOwnerNotificationIntentInput,
): Promise<ClaimOwnerNotificationResult> {
  const nextSequence = input.expectedClaimSequence + 1;
  const claimed = await db.ownerNotificationIntent.updateMany({
    where: {
      id: input.id,
      organizationId: input.organizationId,
      state: 'pending',
      claimSequence: input.expectedClaimSequence,
    },
    data: {
      state: 'claimed',
      claimedBy: input.claimedBy,
      claimedAt: fromIso(input.claimedAt)!,
      claimExpiresAt: fromIso(input.claimExpiresAt)!,
      claimSequence: nextSequence,
    },
  });

  return claimed.count === 1
    ? { claimed: true, claimSequence: nextSequence }
    : { claimed: false, reason: 'lost' };
}

export interface BeginOwnerNotificationAttemptInput {
  readonly attemptId: string;
  readonly intentId: string;
  readonly organizationId: string;
  readonly claimSequence: number;
  /**
   * The attempt count observed before this call. The second half of the fence.
   *
   * `claimSequence` alone is not enough here, because opening an attempt does not advance it: one
   * holder calling twice would pass the same fence twice and contact the provider twice about one
   * event. The count does advance, so naming the expected value makes "one provider call per claim"
   * a compare-and-set rather than a promise the caller has to keep.
   */
  readonly expectedAttemptCount: number;
  readonly startedAt: string;
}

export type BeginOwnerNotificationAttemptResult =
  | { readonly began: true; readonly attempt: OwnerNotificationAttemptRecord }
  | { readonly began: false; readonly reason: 'lost' };

/**
 * Record that a provider call is about to happen, before it happens (A8.5b crash boundary).
 *
 * This is the marker that makes a crash recoverable *truthfully*. Without it, a worker that dies
 * mid-call is indistinguishable from one that died before calling, and the recovery has to choose
 * between never delivering and delivering twice. With it, the choice is made by evidence: an attempt
 * row left `in_flight` means a provider was contacted and the answer is unknown, which is exactly
 * `ambiguous`.
 *
 * The intent update and the attempt insert commit together, and the update is issued **first** so
 * this transaction holds the intent row lock before anything reads the attempt rows. A concurrent
 * recovery therefore cannot observe "no call started", have this commit underneath it, and release a
 * lease whose provider call is already in flight.
 *
 * `attemptCount` is incremented here rather than at outcome time, so it counts provider calls
 * *started*. A call that never returns still consumed a retry, which is the only reading that keeps
 * the three-attempt budget honest under crashes.
 *
 * The attempt number follows from the fenced count rather than from a read, so it needs no second
 * query to be deterministic, and `owner_notification_attempts_intent_attempt_key` refuses a
 * duplicate even if that reasoning is ever wrong.
 */
export async function beginOwnerNotificationAttempt(
  db: DbClient,
  input: BeginOwnerNotificationAttemptInput,
): Promise<BeginOwnerNotificationAttemptResult> {
  const attemptNumber = input.expectedAttemptCount + 1;

  return db.$transaction(async (tx) => {
    const advanced = await tx.ownerNotificationIntent.updateMany({
      where: {
        id: input.intentId,
        organizationId: input.organizationId,
        state: 'claimed',
        claimSequence: input.claimSequence,
        attemptCount: input.expectedAttemptCount,
      },
      data: { attemptCount: attemptNumber },
    });
    if (advanced.count !== 1) {
      return { began: false, reason: 'lost' } as const;
    }

    const row = await tx.ownerNotificationAttempt.create({
      data: {
        id: input.attemptId,
        organizationId: input.organizationId,
        intentId: input.intentId,
        attemptNumber,
        outcome: 'in_flight',
        providerCallStartedAt: fromIso(input.startedAt)!,
      },
    });

    return { began: true, attempt: mapOwnerNotificationAttempt(row) } as const;
  });
}

/** Attempts left `in_flight`: a provider call that started and whose answer never arrived. */
export async function listInFlightOwnerNotificationAttempts(
  db: Client,
  intentId: string,
): Promise<OwnerNotificationAttemptRecord[]> {
  const rows = await db.ownerNotificationAttempt.findMany({
    where: { intentId, outcome: 'in_flight' },
    orderBy: [{ attemptNumber: 'asc' }],
  });
  return rows.map(mapOwnerNotificationAttempt);
}

export type RecoverExpiredClaimResult =
  | { readonly outcome: 'released' }
  | { readonly outcome: 'in_flight'; readonly attempt: OwnerNotificationAttemptRecord }
  | { readonly outcome: 'lost' };

/** Internal sentinel: unwinds the release when a provider call turns out to have started. */
const IN_FLIGHT_ABORT = Symbol('owner-notification-in-flight');

/**
 * Recover a lapsed lease, without ever resending.
 *
 * The two cases are not the caller's to distinguish by reading first and acting second, because
 * between the read and the act the dead worker's own transaction may still commit. So both happen
 * here, in one transaction, in an order that makes the race impossible:
 *
 *  1. Release the lease with the fenced conditional update. This takes the intent row lock.
 *  2. Only then look for an `in_flight` attempt. Any concurrent `beginOwnerNotificationAttempt` is
 *     either already committed — in which case its row is visible now — or blocked on the lock we
 *     hold and will fail its own fence once we commit.
 *  3. If a call had started, abort. The release is rolled back and the intent stays `claimed` for
 *     the caller to terminalize as `ambiguous`, which is the only truthful reading of a provider
 *     call with no answer.
 *
 * A released intent returns to `pending` rather than to a distinct recovered state: it is claimable
 * work again, and the attempt history already says what happened to it.
 */
export async function recoverExpiredOwnerNotificationClaim(
  db: DbClient,
  input: {
    readonly id: string;
    readonly organizationId: string;
    readonly claimSequence: number;
  },
): Promise<RecoverExpiredClaimResult> {
  try {
    return await db.$transaction(async (tx) => {
      const released = await tx.ownerNotificationIntent.updateMany({
        where: {
          id: input.id,
          organizationId: input.organizationId,
          state: 'claimed',
          claimSequence: input.claimSequence,
        },
        data: { state: 'pending', claimedBy: null, claimedAt: null, claimExpiresAt: null },
      });
      if (released.count !== 1) {
        return { outcome: 'lost' } as const;
      }

      const inFlight = await tx.ownerNotificationAttempt.findFirst({
        where: { intentId: input.id, outcome: 'in_flight' },
        orderBy: [{ attemptNumber: 'desc' }],
      });
      if (inFlight) {
        throw Object.assign(new Error('provider call in flight'), {
          [IN_FLIGHT_ABORT]: mapOwnerNotificationAttempt(inFlight),
        });
      }

      return { outcome: 'released' } as const;
    });
  } catch (error) {
    const attempt = (error as Record<symbol, OwnerNotificationAttemptRecord | undefined>)[
      IN_FLIGHT_ABORT
    ];
    if (attempt) {
      return { outcome: 'in_flight', attempt };
    }
    throw error;
  }
}

/**
 * Read one intent by id. Used to confirm a settlement and by the A8.6 Owner surface.
 *
 * Terminalizing without a delivery — the staleness horizon and the defensive budget check — is not
 * here but in `transactions/a8-5b-notification-transactions.ts`, because both must append their
 * audit event in the same transaction as the state change. A second path that could terminalize
 * without one is a path that eventually will.
 */
export async function findOwnerNotificationIntentById(
  db: Client,
  organizationId: string,
  id: string,
): Promise<OwnerNotificationIntentRecord | null> {
  const row = await db.ownerNotificationIntent.findFirst({ where: { id, organizationId } });
  return row ? mapOwnerNotificationIntent(row) : null;
}

/** Every attempt against one intent, oldest first. Provider history for A8.6. */
export async function listOwnerNotificationAttempts(
  db: Client,
  intentId: string,
): Promise<OwnerNotificationAttemptRecord[]> {
  const rows = await db.ownerNotificationAttempt.findMany({
    where: { intentId },
    orderBy: [{ attemptNumber: 'asc' }],
  });
  return rows.map(mapOwnerNotificationAttempt);
}
