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
  type ReminderScheduleStatus,
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
      // A8.4a audit H2. The takeover resets the provider boundary to "this attempt has not called
      // anything yet", because that is the only thing the boundary is allowed to mean.
      //
      // The marker used to survive a retry takeover, so a reclaimed `retryable_failure` row started
      // its new attempt already looking in-flight. If that attempt then crashed *before* reaching
      // its own transport call — the case the marker exists to distinguish — recovery read the
      // previous attempt's marker, concluded a provider might hold the message, and finalized an
      // occurrence ambiguous that had provably never been sent. A reminder silently lost, recorded
      // as "probably delivered", consuming its local day.
      //
      // Acceptance and the message reference are cleared for the same reason. They cannot be set on
      // a reclaimable row today — only a `success` carries them and a success is terminal — so this
      // is the constraint stated in the write rather than inferred from the ones around it.
      providerCallStartedAt: null,
      providerAcceptedAt: null,
      providerMessageRef: null,
      // A settled row that becomes owed again is no longer settled. The `settlement_only_when_terminal`
      // CHECK would reject the write without this, which is the intended second lock on the door.
      scheduleSettledAt: null,
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
        // Phase A only (A8.4a audit H1). This transaction records what happened to the occurrence
        // and stops. The schedule has not been counted, advanced, stopped, or had its advance
        // disposition settled, and a null marker is the durable statement of exactly that — the
        // debt the settlement sweep collects if this caller never gets to phase B.
        scheduleSettledAt: null,
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
 * Terminalize an occurrence whose retry budget is spent, without holding a claim (A8.4a audit B2).
 *
 * **Not exported from `@aicaa/db` or `@aicaa/db/runtime`**, for the same reason
 * `recordTerminalOccurrenceOutcomeUnsafe` is not: it writes a terminal outcome without settling the
 * schedule. `terminalizeExhaustedRetryOccurrence` is the public path and runs both phases.
 *
 * Every other terminalization is fenced on a claim sequence, because every other terminalization is
 * a claimant reporting its own result. This one is not: the occurrence's owner is gone and the
 * budget refusal is a fact about the row rather than a report from anybody. The fence is replaced by
 * a conditional update whose predicate *is* the exhaustion condition — still non-terminal, budget
 * spent, no in-flight marker, no live lease — so it is idempotent by construction. The second
 * worker to arrive matches zero rows and is told, truthfully, that there was nothing left to do.
 *
 * The provider marker must be absent rather than merely ignored. A row with one belongs to the
 * ambiguous class, where the honest answer is "a provider may hold this message"; recording it as a
 * permanent failure instead would assert something nobody can know.
 */
export async function terminalizeExhaustedOccurrenceUnsafe(
  db: Client,
  input: {
    readonly organizationId: string;
    readonly attemptId: string;
    readonly maxAttempts: number;
    readonly completedAt: string;
    readonly now: string;
  },
): Promise<PersistedReminderDeliveryAttempt | null> {
  const now = fromIso(input.now)!;
  const updated = await db.reminderDeliveryAttempt.updateMany({
    where: {
      id: input.attemptId,
      organizationId: input.organizationId,
      outcome: { in: ['claimed', 'retryable_failure'] },
      providerCallStartedAt: null,
      attemptCount: { gte: input.maxAttempts },
      OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lte: now } }],
    },
    data: {
      outcome: 'permanent_failure',
      failureCode: RETRY_BUDGET_EXHAUSTED_FAILURE_CODE,
      skipReason: null,
      completedAt: fromIso(input.completedAt)!,
      // The claim is not merely expired, it is over. Leaving a dead owner on a terminal row invites
      // the next reader to wonder whether somebody is still working on it.
      claimedBy: null,
      claimedAt: null,
      claimExpiresAt: null,
      providerAcceptedAt: null,
      providerMessageRef: null,
      // Phase A. The schedule is settled by the caller's second transaction.
      scheduleSettledAt: null,
    },
  });
  if (updated.count !== 1) {
    return null;
  }
  return requireAttemptById(db, input.organizationId, input.attemptId);
}

/**
 * The failure code for an occurrence that ran out of attempts rather than being rejected (B2).
 *
 * Distinguishable from a provider's permanent rejection on purpose: one says the message was
 * refused, the other says we stopped asking. The future Q8 Owner-attention threshold will want to
 * tell those apart, and a shared constant means the worker and the recovery sweep cannot spell it
 * two different ways.
 */
export const RETRY_BUDGET_EXHAUSTED_FAILURE_CODE = 'retry_budget_exhausted';

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
        // Born settled (A8.4a audit H1). Every caller of this writer sets the schedule's advance
        // disposition in the same transaction, so there is no settlement debt to discharge — and
        // leaving it null would hand the settlement sweep a row whose schedule effect had already
        // been applied by somebody else.
        scheduleSettledAt: fromIso(input.recordedAt)!,
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

/**
 * The generation's due date and time zone, carried on every recovery row (A8.4a audit B1).
 *
 * Recovery has to be able to arm the *next* occurrence, and the next occurrence is a function of
 * the due date rather than of the occurrence being recovered — re-anchoring on today would slide
 * the series forward a day every time one was recovered. Persistence cannot compute it (D103), so
 * the inputs the A8.2 domain needs travel with the row instead of costing the caller a second query
 * per recovered occurrence.
 */
export interface RecoveryScheduleContext {
  readonly dueLocalDate: string;
  readonly schedulingTimeZone: string;
  /** The schedule's *current* generation, which may already have moved past the occurrence's. */
  readonly scheduleGeneration: number;
  readonly scheduleStatus: ReminderScheduleStatus;
}

/** One occurrence's claim state, for the recovery sweep to classify. */
export interface ExpiredOccurrenceClaim extends RecoveryScheduleContext {
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

const RECOVERY_SCHEDULE_SELECT = {
  select: {
    dueLocalDate: true,
    schedulingTimeZone: true,
    generation: true,
    status: true,
  },
} as const;

function toRecoveryContext(schedule: {
  dueLocalDate: string;
  schedulingTimeZone: string;
  generation: number;
  status: ReminderScheduleStatus;
}): RecoveryScheduleContext {
  return {
    dueLocalDate: schedule.dueLocalDate,
    schedulingTimeZone: schedule.schedulingTimeZone,
    scheduleGeneration: schedule.generation,
    scheduleStatus: schedule.status,
  };
}

function assertRecoveryLimit(limit: number, what: string): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw persistenceValidation(`${what} limit must be between 1 and 500.`);
  }
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
  assertRecoveryLimit(input.limit, 'Expired-claim recovery');
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
      schedule: RECOVERY_SCHEDULE_SELECT,
    },
  });
  return rows.map(({ schedule, ...row }) => ({
    ...row,
    providerCallStartedAt: row.providerCallStartedAt
      ? row.providerCallStartedAt.toISOString()
      : null,
    ...toRecoveryContext(schedule),
  }));
}

/** A terminal occurrence whose schedule effect has not been applied yet (A8.4a audit H1). */
export interface UnsettledTerminalOccurrence extends RecoveryScheduleContext {
  readonly id: string;
  readonly organizationId: string;
  readonly scheduleId: string;
  readonly generation: number;
  readonly occurrenceKind: ReminderOccurrenceKind;
  readonly outcome: TerminalReminderDeliveryOutcome;
}

/**
 * Terminal occurrences still owed a schedule settlement, oldest completion first (audit H1).
 *
 * This is the query that makes splitting finalization into two transactions safe rather than
 * merely different. The seam between them is a real crash point, and the only thing that separates
 * "recoverable" from "silently divergent" is whether the state left behind can be *found*. It can:
 * a terminal row with a null marker is settlement debt by definition, and this returns it.
 *
 * Global for the same reason the expired-claim sweep is, and reading the same shape of partial
 * index — which in steady state contains nothing at all, because settlement normally happens
 * milliseconds after terminalization on the same invocation.
 */
export async function listUnsettledTerminalOccurrences(
  db: Client,
  input: { readonly limit: number },
): Promise<UnsettledTerminalOccurrence[]> {
  assertRecoveryLimit(input.limit, 'Unsettled-occurrence recovery');
  const rows = await db.reminderDeliveryAttempt.findMany({
    where: { outcome: { not: 'claimed' }, scheduleSettledAt: null },
    orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
    take: input.limit,
    select: {
      id: true,
      organizationId: true,
      scheduleId: true,
      generation: true,
      occurrenceKind: true,
      outcome: true,
      schedule: RECOVERY_SCHEDULE_SELECT,
    },
  });
  return rows.map(({ schedule, outcome, ...row }) => ({
    ...row,
    // Narrowing rather than casting: the `not: 'claimed'` filter is what makes this true, and
    // stating it here means a future filter change fails the type check instead of the invariant.
    outcome: outcome as TerminalReminderDeliveryOutcome,
    ...toRecoveryContext(schedule),
  }));
}

/** An occurrence that has spent its retry budget without ever reaching a terminal outcome (B2). */
export interface ExhaustedRetryOccurrence extends RecoveryScheduleContext {
  readonly id: string;
  readonly organizationId: string;
  readonly scheduleId: string;
  readonly generation: number;
  readonly occurrenceKind: ReminderOccurrenceKind;
  readonly attemptCount: number;
}

/**
 * Occurrences that can never be claimed again and have not been terminalized (A8.4a audit B2).
 *
 * The audit's hot loop lives here. A worker that crashed on the last permitted attempt *before*
 * marking its provider call left a `claimed` row at the budget ceiling; recovery released the dead
 * lease, correctly, because nothing had left the building — and then the row sat there. The claim
 * path refuses it with `retry_budget_exhausted`, so no worker could finish it, and the schedule
 * stayed active and armed at an occurrence instant already in the past. Every later invocation
 * scanned it, took the schedule lease, was refused the claim, released the lease, and moved on,
 * forever, while the reminder series silently stopped.
 *
 * A refusal that no future invocation can turn into progress is not contention; it is a terminal
 * fact that nobody wrote down. This finds those rows so the worker can write it down.
 *
 * Deliberately excludes rows with an in-flight marker: those belong to the ambiguous-recovery class,
 * which is the stricter of the two and must not be pre-empted by a budget rule. Deliberately
 * excludes rows with a live lease: a claimant still inside its lease may yet finish, and the last
 * attempt is exactly the one it is entitled to make.
 */
export async function listRetryBudgetExhaustedOccurrences(
  db: Client,
  input: { readonly now: string; readonly maxAttempts: number; readonly limit: number },
): Promise<ExhaustedRetryOccurrence[]> {
  assertRecoveryLimit(input.limit, 'Retry-budget recovery');
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
    throw persistenceValidation('maxAttempts must be a positive integer.');
  }
  const now = fromIso(input.now)!;
  const rows = await db.reminderDeliveryAttempt.findMany({
    where: {
      outcome: { in: ['claimed', 'retryable_failure'] },
      providerCallStartedAt: null,
      attemptCount: { gte: input.maxAttempts },
      OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lte: now } }],
    },
    orderBy: [{ attemptCount: 'desc' }, { id: 'asc' }],
    take: input.limit,
    select: {
      id: true,
      organizationId: true,
      scheduleId: true,
      generation: true,
      occurrenceKind: true,
      attemptCount: true,
      schedule: RECOVERY_SCHEDULE_SELECT,
    },
  });
  return rows.map(({ schedule, ...row }) => ({ ...row, ...toRecoveryContext(schedule) }));
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
