import type { LocalDate } from '@aicaa/domain';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import {
  domainConflict,
  notFound,
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
}

export interface ClaimReminderOccurrenceResult {
  /** False when this occurrence was already claimed or already processed by someone else. */
  readonly claimed: boolean;
  readonly attempt: PersistedReminderDeliveryAttempt;
}

export interface RecordTerminalOutcomeInput {
  readonly organizationId: string;
  readonly attemptId: string;
  readonly outcome: TerminalReminderDeliveryOutcome;
  readonly completedAt: string;
  /** Required when `outcome` is `skipped`; rejected otherwise by a database CHECK. */
  readonly skipReason?: ReminderSkipReason | null;
  /** Short normalized code only — never a provider body, address, or capability value (D109). */
  readonly failureCode?: string | null;
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
 * Claim one occurrence for processing, creating its attempt row.
 *
 * The insert is attempted first and the collision is caught, rather than checking for an existing
 * row and then inserting. Under overlapping scheduler invocations — which D106 explicitly
 * anticipates — a check-then-insert has a window in which both callers see nothing and both
 * proceed. Here the unique index decides, and the loser is told it did not claim.
 *
 * The preceding scope read authorizes the write and supplies the Task; it deliberately does not
 * check whether the occurrence is already claimed, so the unique index remains the only arbiter.
 */
export async function claimReminderOccurrence(
  db: Client,
  input: ClaimReminderOccurrenceInput,
): Promise<ClaimReminderOccurrenceResult> {
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
        outcome: 'claimed',
        claimedBy: input.claimedBy,
        claimedAt: fromIso(input.claimedAt)!,
      },
    });
    return { claimed: true, attempt: mapReminderDeliveryAttempt(row) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await findByOccurrenceIdentity(db, { ...input, occurrenceLocalDate });
      if (existing) {
        return { claimed: false, attempt: existing };
      }
      throw await classifyAttemptWriteCollision(db, input.id);
    }
    throw error;
  }
}

/**
 * Complete a claimed occurrence with its truthful outcome.
 *
 * Only a `claimed` row may be completed, and the transition is conditional, so a late duplicate
 * cannot overwrite a recorded result — in particular it cannot turn a recorded failure into a
 * success, which is the outcome D106's ceiling counts.
 *
 * A `success` row additionally passes through a partial unique index enforcing D106's "at most one
 * delivery per local calendar day"; a second successful delivery on a day already delivered is
 * rejected by the database rather than by a caller remembering to check.
 */
export async function recordReminderDeliveryOutcome(
  db: Client,
  input: RecordTerminalOutcomeInput,
): Promise<PersistedReminderDeliveryAttempt> {
  try {
    const updated = await db.reminderDeliveryAttempt.updateMany({
      where: {
        id: input.attemptId,
        organizationId: input.organizationId,
        outcome: 'claimed',
      },
      data: {
        outcome: input.outcome,
        skipReason: input.skipReason ?? null,
        failureCode: input.failureCode ?? null,
        completedAt: fromIso(input.completedAt)!,
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
