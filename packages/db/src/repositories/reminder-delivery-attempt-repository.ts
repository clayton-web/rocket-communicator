import type { LocalDate } from '@aicaa/domain';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import {
  domainConflict,
  notFound,
  optimisticConcurrency,
  persistenceValidation,
  uniqueViolation,
  type PersistenceError,
} from '../errors/persistence-errors.js';
import { fromIso } from '../mappers/domain-mappers.js';
import {
  mapReminderDeliveryAttempt,
  toStorableLocalDate,
  type PersistedReminderDeliveryAttempt,
  type ReminderDeliveryOutcome,
  type ReminderOccurrenceKind,
  type ReminderSkipReason,
} from '../mappers/reminder-mappers.js';
import { requireScheduleScope } from './reminder-scope-guard.js';

/**
 * Reminder delivery attempt persistence (A8.3a; D100, D106, D109).
 *
 * **Append-only.** Rows are added and completed; they are never deleted, and a completed row is
 * never rewritten into a different occurrence. A new generation adds history rather than replacing
 * it (D107, D109).
 *
 * **Idempotency is the database's job, not this module's** (D109). There is deliberately no
 * caller-supplied idempotency key to validate: identity *is*
 * `(scheduleId, generation, occurrenceKind, occurrenceLocalDate)`, enforced by a unique index. A
 * duplicate scheduler invocation therefore loses a race it cannot detect its way out of, instead of
 * relying on a prior read that a concurrent transaction may not yet see.
 *
 * Nothing here computes an occurrence. Local dates and instants arrive as arguments from the A8.2
 * domain (D103).
 */

type Client = DbClient | DbTransaction;

/** Outcomes that terminate an occurrence. `claimed` is excluded: a lease is not a result. */
export type TerminalReminderDeliveryOutcome = Exclude<ReminderDeliveryOutcome, 'claimed'>;

/**
 * There is deliberately no `taskId`: an attempt belongs to whichever Task its schedule belongs to,
 * so it is derived rather than supplied and cannot be pointed at a Task in another organization
 * (A8.3a audit F3).
 */
export interface ClaimReminderOccurrenceInput {
  readonly id: string;
  readonly organizationId: string;
  readonly scheduleId: string;
  readonly generation: number;
  readonly occurrenceKind: ReminderOccurrenceKind;
  readonly occurrenceLocalDate: LocalDate;
  readonly occurrenceAt: string;
  readonly claimedBy: string;
  readonly claimedAt: string;
  /** Lease expiry supplied by the caller; this module never invents a duration. */
  readonly claimExpiresAt: string;
  /** Current instant, used only to decide whether an existing lease has expired. */
  readonly now: string;
  /**
   * How many times one occurrence may be attempted before retrying stops being permitted (A8.4a).
   * A policy number, so it arrives as an argument rather than being decided by storage.
   */
  readonly maxAttempts: number;
}

/**
 * Why a claim attempt did not yield a lease.
 *
 * `in_flight_unknown` is the one that matters most: the previous claimant's lease expired *after*
 * it had already started a transport call, so a provider may hold the message. Re-claiming would
 * risk a duplicate reminder to a real Recipient, so recovery finalizes the occurrence ambiguous
 * instead. The other refusals are ordinary contention or settled history.
 */
export type ClaimRefusalReason =
  'lease_held' | 'in_flight_unknown' | 'already_terminal' | 'retry_budget_exhausted';

export type ClaimReminderOccurrenceResult =
  | {
      readonly claimed: true;
      /** The fencing token this claimant must present to act on the occurrence. */
      readonly claimSequence: number;
      readonly attempt: PersistedReminderDeliveryAttempt;
    }
  | {
      readonly claimed: false;
      readonly reason: ClaimRefusalReason;
      readonly attempt: PersistedReminderDeliveryAttempt;
    };

export interface RecordTerminalOutcomeInput {
  readonly organizationId: string;
  readonly attemptId: string;
  readonly outcome: TerminalReminderDeliveryOutcome;
  readonly completedAt: string;
  /** The fencing token the claimant was granted. A reclaimed occurrence refuses its predecessor. */
  readonly claimSequence: number;
  /** Required when `outcome` is `skipped`; rejected otherwise by a database CHECK. */
  readonly skipReason?: ReminderSkipReason | null;
  /** Short normalized code only — never a provider body, address, or capability value (D109). */
  readonly failureCode?: string | null;
  /** Required for `success`: durable proof the provider accepted the message (A8.4a F1). */
  readonly providerAcceptedAt?: string | null;
  /** Short normalized provider reference. Never a body, address, subject, or capability value. */
  readonly providerMessageRef?: string | null;
}

/** As with a claim, the Task is derived from the schedule rather than supplied by the caller. */
export interface RecordSkippedOccurrenceInput {
  readonly id: string;
  readonly organizationId: string;
  readonly scheduleId: string;
  readonly generation: number;
  readonly occurrenceKind: ReminderOccurrenceKind;
  readonly occurrenceLocalDate: LocalDate;
  readonly occurrenceAt: string;
  readonly skipReason: ReminderSkipReason;
  readonly recordedAt: string;
}

async function requireAttemptById(
  db: Client,
  organizationId: string,
  attemptId: string,
): Promise<PersistedReminderDeliveryAttempt> {
  const row = await db.reminderDeliveryAttempt.findFirst({
    where: { id: attemptId, organizationId },
  });
  if (!row) {
    throw notFound(`Reminder delivery attempt ${attemptId} not found for organization.`);
  }
  return mapReminderDeliveryAttempt(row);
}

async function findByOccurrenceIdentity(
  db: Client,
  input: Pick<
    ClaimReminderOccurrenceInput,
    'scheduleId' | 'generation' | 'occurrenceKind' | 'occurrenceLocalDate'
  >,
): Promise<PersistedReminderDeliveryAttempt | null> {
  const row = await db.reminderDeliveryAttempt.findUnique({
    where: {
      scheduleId_generation_occurrenceKind_occurrenceLocalDate: {
        scheduleId: input.scheduleId,
        generation: input.generation,
        occurrenceKind: input.occurrenceKind,
        occurrenceLocalDate: input.occurrenceLocalDate,
      },
    },
  });
  return row ? mapReminderDeliveryAttempt(row) : null;
}

/**
 * Explain a unique violation that was *not* the occurrence identity (A8.3a audit F16).
 *
 * Reporting every collision as "occurrence identity is already taken" sent a reader looking for a
 * duplicate scheduler invocation when the real cause was a reused attempt id — a caller bug with an
 * entirely different fix. Callers check the occurrence identity first because that is the collision
 * expected in normal operation; anything left over is classified from what the database actually
 * holds rather than guessed from the constraint that happened to fire.
 */
async function classifyAttemptWriteCollision(
  db: Client,
  attemptId: string,
): Promise<PersistenceError> {
  const clash = await db.reminderDeliveryAttempt.findUnique({
    where: { id: attemptId },
    select: { id: true },
  });
  if (clash) {
    return uniqueViolation(
      `Reminder delivery attempt id ${attemptId} is already used by a different occurrence.`,
    );
  }
  return uniqueViolation(
    `Reminder delivery attempt ${attemptId} violated a unique constraint that is neither its id nor its occurrence identity.`,
  );
}

/**
 * Claim one occurrence for processing — creating its attempt row, or taking over an abandoned one.
 *
 * The insert is attempted first and the collision is caught, rather than checking for an existing
 * row and then inserting. Under overlapping scheduler invocations — which D106 explicitly
 * anticipates — a check-then-insert has a window in which both callers see nothing and both
 * proceed. Here the unique index decides, and the loser is told it did not claim.
 *
 * ## The occurrence row is the duplicate-prevention authority (A8.4a, A8.3a audit F2)
 *
 * A claim is now a bounded lease with a fencing token, not the indefinite marker A8.3a shipped.
 * The audit's objection was that nothing could distinguish a live claim from an abandoned one, so a
 * worker that died mid-occurrence froze it permanently — the unique identity refuses a second
 * claim, and only a `claimed` row can be completed, so the occurrence became unreachable by every
 * path. Four refusals are now distinguished, and only one of them is permanent.
 *
 * A retry reuses this row. D109's identity is the occurrence, not the attempt, so forging a second
 * row for a retry would be forging a second occurrence — and the one-success-per-local-day index
 * would then be guarding the wrong thing.
 *
 * Every takeover is a single conditional update fenced on the sequence the caller observed, so two
 * workers reclaiming the same expired lease produce one winner and one refusal rather than two
 * claimants who both believe they own it.
 */
export async function claimReminderOccurrence(
  db: Client,
  input: ClaimReminderOccurrenceInput,
): Promise<ClaimReminderOccurrenceResult> {
  const scope = await requireScheduleScope(db, input.organizationId, input.scheduleId);
  const occurrenceLocalDate = toStorableLocalDate(input.occurrenceLocalDate, 'occurrenceLocalDate');
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
    throw persistenceValidation('maxAttempts must be a positive integer.');
  }

  try {
    const row = await db.reminderDeliveryAttempt.create({
      data: {
        id: input.id,
        organizationId: scope.organizationId,
        scheduleId: scope.scheduleId,
        taskId: scope.taskId,
        generation: input.generation,
        occurrenceKind: input.occurrenceKind,
        occurrenceLocalDate,
        occurrenceAt: fromIso(input.occurrenceAt)!,
        outcome: 'claimed',
        claimedBy: input.claimedBy,
        claimedAt: fromIso(input.claimedAt)!,
        claimExpiresAt: fromIso(input.claimExpiresAt)!,
        claimSequence: 1,
      },
    });
    return { claimed: true, claimSequence: 1, attempt: mapReminderDeliveryAttempt(row) };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    const existing = await findByOccurrenceIdentity(db, { ...input, occurrenceLocalDate });
    if (!existing) {
      throw await classifyAttemptWriteCollision(db, input.id);
    }
    return takeOverOccurrence(db, existing, input);
  }
}

/**
 * Decide whether an existing occurrence row may be taken over, and do it under a fence.
 *
 * Separated from the insert path so the classification is stated once and can be read as the four
 * cases it is, rather than as nested conditions inside a catch block.
 */
async function takeOverOccurrence(
  db: Client,
  existing: PersistedReminderDeliveryAttempt,
  input: ClaimReminderOccurrenceInput,
): Promise<ClaimReminderOccurrenceResult> {
  const nowMs = new Date(input.now).getTime();

  if (existing.outcome === 'claimed') {
    const leaseLive =
      existing.claimExpiresAt !== null && new Date(existing.claimExpiresAt).getTime() > nowMs;
    if (leaseLive) {
      return { claimed: false, reason: 'lease_held', attempt: existing };
    }
    // Expired, but a transport call had already begun. Nobody can prove whether the provider
    // accepted it, and guessing wrong sends a second reminder for the same morning. Recovery
    // finalizes this ambiguous; claiming is refused permanently.
    if (existing.providerCallStartedAt !== null) {
      return { claimed: false, reason: 'in_flight_unknown', attempt: existing };
    }
  } else if (existing.outcome !== 'retryable_failure') {
    return { claimed: false, reason: 'already_terminal', attempt: existing };
  }

  if (existing.attemptCount >= input.maxAttempts) {
    return { claimed: false, reason: 'retry_budget_exhausted', attempt: existing };
  }

  const nextSequence = existing.claimSequence + 1;
  const taken = await db.reminderDeliveryAttempt.updateMany({
    where: {
      id: existing.id,
      organizationId: existing.organizationId,
      // The fence. A concurrent reclaimer that got here first has already moved the sequence, so
      // this update matches nothing and its caller is told the lease is held rather than being
      // handed a second copy of the same occurrence.
      claimSequence: existing.claimSequence,
      outcome: existing.outcome,
    },
    data: {
      outcome: 'claimed',
      completedAt: null,
      skipReason: null,
      failureCode: null,
      claimedBy: input.claimedBy,
      claimedAt: fromIso(input.claimedAt)!,
      claimExpiresAt: fromIso(input.claimExpiresAt)!,
      claimSequence: nextSequence,
      attemptCount: { increment: 1 },
    },
  });

  if (taken.count !== 1) {
    const current = await requireAttemptById(db, existing.organizationId, existing.id);
    return { claimed: false, reason: 'lease_held', attempt: current };
  }
  const attempt = await requireAttemptById(db, existing.organizationId, existing.id);
  return { claimed: true, claimSequence: nextSequence, attempt };
}

/**
 * Complete a claimed occurrence with its truthful outcome, under proof of claim ownership.
 *
 * **Not exported from `@aicaa/db` or `@aicaa/db/runtime`** (A8.3a audit F8). This writer can record
 * a `success` without counting it, without evaluating the D106 ceiling, without checking the
 * generation, and without settling an advance disposition — every one of which is required for a
 * success to be safe. `finalizeReminderOccurrence` is the only public success path, and
 * `packages/db/__tests__/a8-4a-worker-safety-boundary.test.ts` fails the build if this leaks into
 * either barrel. It stays exported at module scope only because the transaction that wraps it lives
 * in a sibling module.
 *
 * Only a `claimed` row may be completed, the transition is conditional, and it is fenced on
 * `claimSequence`, so neither a late duplicate nor a claimant whose lease was reclaimed can
 * overwrite a recorded result — in particular neither can turn a recorded failure into a success,
 * which is the outcome D106's ceiling counts.
 *
 * A `success` row additionally passes through a partial unique index enforcing D106's "at most one
 * delivery per local calendar day"; a second successful delivery on a day already delivered is
 * rejected by the database rather than by a caller remembering to check.
 */
export async function recordTerminalOccurrenceOutcomeUnsafe(
  db: Client,
  input: RecordTerminalOutcomeInput,
): Promise<PersistedReminderDeliveryAttempt> {
  if (input.outcome === 'success' && !input.providerAcceptedAt) {
    throw persistenceValidation(
      'A successful reminder occurrence must record when the provider accepted it (A8.4a F1).',
    );
  }
  try {
    const updated = await db.reminderDeliveryAttempt.updateMany({
      where: {
        id: input.attemptId,
        organizationId: input.organizationId,
        outcome: 'claimed',
        claimSequence: input.claimSequence,
      },
      data: {
        outcome: input.outcome,
        skipReason: input.skipReason ?? null,
        failureCode: input.failureCode ?? null,
        completedAt: fromIso(input.completedAt)!,
        providerAcceptedAt: fromIso(input.providerAcceptedAt ?? null),
        providerMessageRef: input.providerMessageRef ?? null,
        // The lease ends with the occurrence. `claimedBy` and `claimSequence` stay as provenance and
        // as the fence a resurrected predecessor is still measured against, but a settled row must
        // not advertise a countdown that is still running.
        claimExpiresAt: null,
      },
    });

    if (updated.count === 1) {
      return requireAttemptById(db, input.organizationId, input.attemptId);
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw uniqueViolation(
        'A reminder was already delivered for this schedule on this local calendar day (D106).',
      );
    }
    throw error;
  }

  const existing = await requireAttemptById(db, input.organizationId, input.attemptId);
  if (existing.outcome === 'claimed' && existing.claimSequence !== input.claimSequence) {
    throw optimisticConcurrency(
      `Reminder occurrence ${input.attemptId} was reclaimed: this claimant holds sequence ` +
        `${input.claimSequence} but the occurrence is now at ${existing.claimSequence}.`,
    );
  }
  throw domainConflict(
    `Reminder delivery attempt ${input.attemptId} is already ${existing.outcome} and cannot be completed again.`,
  );
}

/**
 * Record an occurrence that was never attempted, with its truthful reason (D105, D107).
 *
 * Used for `advance_window_elapsed` at establishment — the decision D105 requires to be made once
 * and persisted — and for occurrences skipped because there is no active assignment or the Task is
 * no longer eligible. A skip is written terminal in one insert because there is nothing to claim.
 *
 * A collision returns idempotently only when the stored row is *the same skip*. Previously any
 * existing row was returned, so recording a skip against an occurrence that had already succeeded,
 * failed, or was still claimed reported success and handed back a row describing something else
 * entirely — an untruthful history, which is exactly what D100 and D107 forbid (A8.3a audit F16).
 */
export async function recordSkippedReminderOccurrence(
  db: Client,
  input: RecordSkippedOccurrenceInput,
): Promise<PersistedReminderDeliveryAttempt> {
  const scope = await requireScheduleScope(db, input.organizationId, input.scheduleId);
  const occurrenceLocalDate = toStorableLocalDate(input.occurrenceLocalDate, 'occurrenceLocalDate');

  try {
    const row = await db.reminderDeliveryAttempt.create({
      data: {
        id: input.id,
        organizationId: scope.organizationId,
        scheduleId: scope.scheduleId,
        taskId: scope.taskId,
        generation: input.generation,
        occurrenceKind: input.occurrenceKind,
        occurrenceLocalDate,
        occurrenceAt: fromIso(input.occurrenceAt)!,
        outcome: 'skipped',
        skipReason: input.skipReason,
        completedAt: fromIso(input.recordedAt)!,
      },
    });
    return mapReminderDeliveryAttempt(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await findByOccurrenceIdentity(db, { ...input, occurrenceLocalDate });
      if (!existing) {
        throw await classifyAttemptWriteCollision(db, input.id);
      }
      if (existing.outcome === 'skipped' && existing.skipReason === input.skipReason) {
        return existing;
      }
      throw domainConflict(
        `Reminder occurrence ${input.occurrenceKind} on ${occurrenceLocalDate} is already recorded ` +
          `as ${existing.outcome}${existing.skipReason === null ? '' : ` (${existing.skipReason})`} ` +
          `and cannot be recorded as skipped (${input.skipReason}).`,
      );
    }
    throw error;
  }
}

/** Full processed-occurrence history for a Task, oldest first. Never filtered by generation. */
export async function listReminderDeliveryAttemptsForTask(
  db: Client,
  organizationId: string,
  taskId: string,
): Promise<PersistedReminderDeliveryAttempt[]> {
  const rows = await db.reminderDeliveryAttempt.findMany({
    where: { organizationId, taskId },
    orderBy: [{ occurrenceAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(mapReminderDeliveryAttempt);
}

/** Processed occurrences within one generation, oldest first. */
export async function listReminderDeliveryAttemptsForGeneration(
  db: Client,
  organizationId: string,
  scheduleId: string,
  generation: number,
): Promise<PersistedReminderDeliveryAttempt[]> {
  const rows = await db.reminderDeliveryAttempt.findMany({
    where: { organizationId, scheduleId, generation },
    orderBy: [{ occurrenceAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(mapReminderDeliveryAttempt);
}

/**
 * Whether this generation's advance occurrence has reached a terminal outcome (A8.4a, re-audit A-A).
 *
 * Replaces `hasProcessedAdvanceOccurrence`, which counted *any* attempt row — including a bare
 * `claimed` lease. The A8 lifecycle re-audit showed why that was wrong once claims become
 * reachable: a worker that claimed the advance occurrence and died left a permanently `claimed`
 * row, so Waiting-resume would decline to settle the disposition and the schedule would sit
 * `active` with a `scheduled` advance whose instant had passed — forever, and unreclaimable,
 * because the unique occurrence identity refuses a second claim. The exact state H-2 closed.
 *
 * A lease is not a result. Only a terminal outcome is a recorded fact that resume must not
 * overwrite; a live or abandoned claim is recovered by the occurrence recovery sweep instead.
 */
export async function hasTerminalAdvanceOccurrence(
  db: Client,
  organizationId: string,
  scheduleId: string,
  generation: number,
): Promise<boolean> {
  const count = await db.reminderDeliveryAttempt.count({
    where: {
      organizationId,
      scheduleId,
      generation,
      occurrenceKind: 'advance',
      outcome: { not: 'claimed' },
    },
  });
  return count > 0;
}

/** One occurrence's claim state, for the recovery sweep to classify. */
export interface ExpiredOccurrenceClaim {
  readonly id: string;
  readonly organizationId: string;
  readonly scheduleId: string;
  readonly taskId: string;
  readonly generation: number;
  readonly occurrenceKind: ReminderOccurrenceKind;
  readonly occurrenceLocalDate: string;
  readonly claimSequence: number;
  /** Null means no transport call was ever started, so the occurrence may be safely reclaimed. */
  readonly providerCallStartedAt: string | null;
}

/**
 * Occurrences whose lease has expired, oldest first (A8.4a, A8.3a audit F2).
 *
 * Deliberately global rather than organization-scoped: the internal worker scan spans
 * organizations, and the partial index this reads (`outcome = 'claimed'`) is the one the recovery
 * sweep was built for. Every row carries its own `organizationId`, which is what subsequent
 * mutations scope themselves by — the scan is global, the writes never are.
 */
export async function listExpiredOccurrenceClaims(
  db: Client,
  input: { readonly now: string; readonly limit: number },
): Promise<ExpiredOccurrenceClaim[]> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw persistenceValidation('Expired-claim recovery limit must be between 1 and 500.');
  }
  const rows = await db.reminderDeliveryAttempt.findMany({
    where: { outcome: 'claimed', claimExpiresAt: { lte: fromIso(input.now)! } },
    orderBy: [{ claimExpiresAt: 'asc' }, { id: 'asc' }],
    take: input.limit,
    select: {
      id: true,
      organizationId: true,
      scheduleId: true,
      taskId: true,
      generation: true,
      occurrenceKind: true,
      occurrenceLocalDate: true,
      claimSequence: true,
      providerCallStartedAt: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    providerCallStartedAt: row.providerCallStartedAt
      ? row.providerCallStartedAt.toISOString()
      : null,
  }));
}

/**
 * Mark the transport call as started, under proof of claim ownership (A8.4a).
 *
 * This write is the boundary between the two recovery classes, and it must be committed *before*
 * the transport is invoked. An expired lease with no start marker means nothing left the building
 * and the occurrence can be handed to another worker; an expired lease with one means a provider
 * may already have accepted the message, so the occurrence is finalized ambiguous rather than
 * retried. Getting the order wrong — calling first, marking second — would make a crash mid-call
 * indistinguishable from a crash before it, and the recovery rule would resend.
 *
 * Fenced on `claimSequence`: a claimant whose lease was reclaimed cannot mark a successor's
 * occurrence as in-flight.
 */
export async function markProviderCallStarted(
  db: Client,
  input: {
    readonly organizationId: string;
    readonly attemptId: string;
    readonly claimSequence: number;
    readonly startedAt: string;
  },
): Promise<PersistedReminderDeliveryAttempt> {
  const updated = await db.reminderDeliveryAttempt.updateMany({
    where: {
      id: input.attemptId,
      organizationId: input.organizationId,
      outcome: 'claimed',
      claimSequence: input.claimSequence,
    },
    data: { providerCallStartedAt: fromIso(input.startedAt)! },
  });
  if (updated.count !== 1) {
    throw optimisticConcurrency(
      `Reminder occurrence ${input.attemptId} is no longer claimed at sequence ${input.claimSequence}.`,
    );
  }
  return requireAttemptById(db, input.organizationId, input.attemptId);
}

/**
 * Count the deliveries that consume the ceiling: successful **overdue** rows in one generation
 * (D106).
 *
 * This is an aggregate over stored facts, not a policy decision. The rule about what counts lives in
 * the domain `countSuccessfulOverdueDeliveries`; the filter here mirrors it, and
 * `a8-reminder-persistence.test.ts` asserts the two agree over the same rows so they cannot drift.
 */
export async function countSuccessfulOverdueDeliveriesForGeneration(
  db: Client,
  organizationId: string,
  scheduleId: string,
  generation: number,
): Promise<number> {
  return db.reminderDeliveryAttempt.count({
    where: {
      organizationId,
      scheduleId,
      generation,
      occurrenceKind: 'overdue',
      outcome: 'success',
    },
  });
}
