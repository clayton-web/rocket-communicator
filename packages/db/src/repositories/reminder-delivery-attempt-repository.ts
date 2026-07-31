import type { LocalDate } from '@aicaa/domain';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import { domainConflict, notFound, uniqueViolation } from '../errors/persistence-errors.js';
import { fromIso } from '../mappers/domain-mappers.js';
import {
  mapReminderDeliveryAttempt,
  type PersistedReminderDeliveryAttempt,
  type ReminderDeliveryOutcome,
  type ReminderOccurrenceKind,
  type ReminderSkipReason,
} from '../mappers/reminder-mappers.js';

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

export interface ClaimReminderOccurrenceInput {
  readonly id: string;
  readonly organizationId: string;
  readonly scheduleId: string;
  readonly taskId: string;
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

export interface RecordSkippedOccurrenceInput {
  readonly id: string;
  readonly organizationId: string;
  readonly scheduleId: string;
  readonly taskId: string;
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
 * Claim one occurrence for processing, creating its attempt row.
 *
 * The insert is attempted first and the collision is caught, rather than checking for an existing
 * row and then inserting. Under overlapping scheduler invocations — which D106 explicitly
 * anticipates — a check-then-insert has a window in which both callers see nothing and both
 * proceed. Here the unique index decides, and the loser is told it did not claim.
 */
export async function claimReminderOccurrence(
  db: Client,
  input: ClaimReminderOccurrenceInput,
): Promise<ClaimReminderOccurrenceResult> {
  try {
    const row = await db.reminderDeliveryAttempt.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        scheduleId: input.scheduleId,
        taskId: input.taskId,
        generation: input.generation,
        occurrenceKind: input.occurrenceKind,
        occurrenceLocalDate: input.occurrenceLocalDate,
        occurrenceAt: fromIso(input.occurrenceAt)!,
        outcome: 'claimed',
        claimedBy: input.claimedBy,
        claimedAt: fromIso(input.claimedAt)!,
      },
    });
    return { claimed: true, attempt: mapReminderDeliveryAttempt(row) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await findByOccurrenceIdentity(db, input);
      if (existing) {
        return { claimed: false, attempt: existing };
      }
      throw uniqueViolation('Reminder occurrence identity is already taken.');
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
 */
export async function recordSkippedReminderOccurrence(
  db: Client,
  input: RecordSkippedOccurrenceInput,
): Promise<PersistedReminderDeliveryAttempt> {
  try {
    const row = await db.reminderDeliveryAttempt.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        scheduleId: input.scheduleId,
        taskId: input.taskId,
        generation: input.generation,
        occurrenceKind: input.occurrenceKind,
        occurrenceLocalDate: input.occurrenceLocalDate,
        occurrenceAt: fromIso(input.occurrenceAt)!,
        outcome: 'skipped',
        skipReason: input.skipReason,
        completedAt: fromIso(input.recordedAt)!,
      },
    });
    return mapReminderDeliveryAttempt(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await findByOccurrenceIdentity(db, input);
      if (existing) {
        return existing;
      }
      throw uniqueViolation('Reminder occurrence identity is already taken.');
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
