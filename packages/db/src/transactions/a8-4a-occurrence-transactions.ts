import type { LocalDate } from '@aicaa/domain';
import { hasReachedOverdueDeliveryCeiling } from '../../../domain/dist/index.js';
import type { DbClient } from '../client/create-prisma-client.js';
import { domainConflict, notFound } from '../errors/persistence-errors.js';
import { fromIso } from '../mappers/domain-mappers.js';
import {
  toReminderOccurrenceOutcome,
  type PersistedReminderDeliveryAttempt,
  type PersistedReminderSchedule,
  type ReminderAdvanceDisposition,
  type ReminderSkipReason,
} from '../mappers/reminder-mappers.js';
import {
  listReminderDeliveryAttemptsForGeneration,
  recordTerminalOccurrenceOutcomeUnsafe,
  type TerminalReminderDeliveryOutcome,
} from '../repositories/reminder-delivery-attempt-repository.js';
import { getReminderScheduleById } from '../repositories/reminder-schedule-repository.js';
import { lockTaskScopeForReminderMutation } from '../repositories/reminder-scope-guard.js';

/**
 * A8.4a occurrence finalization — the only safe way to record what happened to a reminder occurrence.
 *
 * ## Why this module exists (A8.3a audit F1)
 *
 * The audit proved a successful external delivery could be rolled back. `persistSuccessfulOverdueDelivery`
 * recorded the success, incremented the count, and armed the next occurrence in one transaction, and
 * both of the latter two were compare-and-set on the generation. So if an Owner changed the due date
 * while the provider call was in flight, the CAS threw, the transaction aborted — and the row saying
 * "this Recipient was emailed" disappeared with it. The provider had still sent the email. On the
 * next scan the same occurrence looked unprocessed and would be sent again.
 *
 * Recording a send is not conditional on anything. A message that left the building is a fact, and
 * the database's job is to remember facts, not to relitigate them against state that has since moved
 * on. So finalization runs in two phases with different rules:
 *
 * 1. **Terminalize the occurrence.** Unconditional on schedule state. Fenced only on claim
 *    ownership, because the one thing that *must* be checked is that this caller is still the
 *    claimant and is not overwriting a successor's work.
 * 2. **Apply the effect to the current schedule.** Every write compare-and-sets on generation and
 *    status, and a miss is a *no-op*, never an abort. A superseded generation simply does not
 *    receive the count; the occurrence keeps its truthful success.
 *
 * The two phases share one transaction, which the A8.4a authorization permits precisely because
 * phase two cannot abort phase one: every phase-two statement is an `updateMany` whose zero-row
 * result is an expected outcome rather than an error. Sharing the transaction is strictly better
 * than splitting it — a crash between two transactions would leave the occurrence terminal but the
 * schedule un-advanced, which is the same class of divergence in the other direction.
 *
 * ## Lock order
 *
 * The Task row is locked first, as in every other reminder transaction (A8.3b re-audit M1). The
 * provider call happens *outside* this transaction — a worker never holds a database lock across a
 * network call — so the lock is held only for the duration of the two phases.
 *
 * Nothing here calls a provider. The transport is invoked by the processing service before this is
 * reached, and this module records only what it was told happened.
 */

/** Which advance dispositions a terminal outcome may settle the schedule to (re-audit A-A). */
const ADVANCE_DISPOSITION_FOR_OUTCOME: Record<
  TerminalReminderDeliveryOutcome,
  ReminderAdvanceDisposition | null
> = {
  success: 'delivered',
  skipped: 'skipped_not_eligible',
  permanent_failure: 'failed_permanent',
  ambiguous: 'ambiguous',
  // A retryable failure has settled nothing: the occurrence may still be delivered on a later
  // invocation, so the schedule must keep saying the advance reminder is scheduled.
  retryable_failure: null,
};

export interface FinalizeReminderOccurrenceInput {
  readonly db: DbClient;
  readonly organizationId: string;
  readonly attemptId: string;
  /** The schedule the caller believes this occurrence belongs to. Verified, not trusted (F7). */
  readonly scheduleId: string;
  /** The fencing token this claimant was granted. */
  readonly claimSequence: number;
  readonly outcome: TerminalReminderDeliveryOutcome;
  readonly completedAt: string;
  /**
   * The generation the occurrence was claimed under. Phase two applies only while the schedule is
   * still at it; phase one ignores it entirely.
   */
  readonly expectedGeneration: number;
  readonly skipReason?: ReminderSkipReason | null;
  readonly failureCode?: string | null;
  /** Required for `success`. Durable proof, never rolled back for a schedule change. */
  readonly providerAcceptedAt?: string | null;
  readonly providerMessageRef?: string | null;
  /**
   * The next occurrence the caller computed with the A8.2 domain, supplied optimistically. Applied
   * only when the generation still matches and the schedule is still active, and discarded when
   * this delivery reached the ceiling.
   */
  readonly nextOverdueOccurrence: {
    readonly occurrenceLocalDate: LocalDate;
    readonly occurrenceAt: string;
  } | null;
}

export interface FinalizeReminderOccurrenceResult {
  readonly attempt: PersistedReminderDeliveryAttempt;
  readonly schedule: PersistedReminderSchedule;
  /** True when the D106 per-generation count was incremented by this finalization. */
  readonly counted: boolean;
  /** True when this delivery reached the D106 ceiling and stopped the schedule. */
  readonly ceilingReached: boolean;
  /**
   * False when the schedule had moved on — superseded generation, suspended, or stopped — so the
   * occurrence was recorded truthfully but changed nothing about the current schedule.
   */
  readonly scheduleAdvanced: boolean;
  /** The advance disposition this finalization settled, or null when it settled none. */
  readonly settledAdvanceDisposition: ReminderAdvanceDisposition | null;
}

/**
 * Record a terminal occurrence outcome and, if the schedule still agrees, advance the schedule.
 *
 * Counting obeys D106 exactly: a success increments the per-generation count only when the
 * occurrence is `overdue` **and** the schedule is still at the expected generation **and** still
 * active. An advance send never counts; nor does a skip, a failure of either kind, or ambiguity.
 * A success whose generation was superseded mid-flight is kept in full and counted against nothing.
 */
export async function finalizeReminderOccurrence(
  input: FinalizeReminderOccurrenceInput,
): Promise<FinalizeReminderOccurrenceResult> {
  return input.db.$transaction(async (tx) => {
    const claimed = await tx.reminderDeliveryAttempt.findFirst({
      where: { id: input.attemptId, organizationId: input.organizationId },
      select: {
        taskId: true,
        scheduleId: true,
        occurrenceKind: true,
        generation: true,
        outcome: true,
      },
    });
    if (!claimed) {
      throw notFound(`Reminder delivery attempt ${input.attemptId} not found for organization.`);
    }

    // A8.3a audit F7: the occurrence's own identity is loaded and checked rather than taken from
    // the caller. The kind decides which effect runs at all — an advance occurrence physically
    // cannot reach the counting branch below, so a caller that mislabelled one cannot inflate the
    // D106 overdue count. Schedule and generation are immutable occurrence identity: a mismatch is
    // a caller bug, distinct from the schedule having legitimately moved on, which phase two
    // absorbs as a no-op.
    if (claimed.scheduleId !== input.scheduleId) {
      throw domainConflict(
        `Reminder occurrence ${input.attemptId} belongs to schedule ${claimed.scheduleId}, not ${input.scheduleId}.`,
      );
    }
    if (claimed.generation !== input.expectedGeneration) {
      throw domainConflict(
        `Reminder occurrence ${input.attemptId} is generation ${claimed.generation}, not ${input.expectedGeneration}.`,
      );
    }
    if (claimed.outcome !== 'claimed') {
      throw domainConflict(
        `Reminder occurrence ${input.attemptId} is already ${claimed.outcome} and cannot be finalized again.`,
      );
    }

    // Universal lock order: the Task row first, before any schedule read or write.
    await lockTaskScopeForReminderMutation(tx, input.organizationId, claimed.taskId);

    // ---- Phase 1: the occurrence. Unconditional on schedule state. ----
    const attempt = await recordTerminalOccurrenceOutcomeUnsafe(tx, {
      organizationId: input.organizationId,
      attemptId: input.attemptId,
      outcome: input.outcome,
      completedAt: input.completedAt,
      claimSequence: input.claimSequence,
      skipReason: input.skipReason ?? null,
      failureCode: input.failureCode ?? null,
      providerAcceptedAt: input.providerAcceptedAt ?? null,
      providerMessageRef: input.providerMessageRef ?? null,
    });

    // ---- Phase 2: the schedule. Every write is conditional; a miss is a no-op. ----
    const effect = await applyScheduleEffect(tx, input, claimed);

    const schedule = await getReminderScheduleById(tx, input.organizationId, claimed.scheduleId);
    return { attempt, schedule, ...effect };
  });
}

type OccurrenceIdentity = {
  readonly taskId: string;
  readonly scheduleId: string;
  readonly occurrenceKind: 'advance' | 'overdue';
  readonly generation: number;
};

/**
 * Apply a terminal occurrence to the current schedule, or to nothing at all.
 *
 * Returns rather than throws for every mismatch. That is the whole point: this function exists to
 * be allowed to fail without taking the recorded delivery down with it.
 */
async function applyScheduleEffect(
  tx: Parameters<Parameters<DbClient['$transaction']>[0]>[0],
  input: FinalizeReminderOccurrenceInput,
  occurrence: OccurrenceIdentity,
): Promise<{
  counted: boolean;
  ceilingReached: boolean;
  scheduleAdvanced: boolean;
  settledAdvanceDisposition: ReminderAdvanceDisposition | null;
}> {
  const generationMatches = { generation: input.expectedGeneration } as const;
  const scope = {
    id: occurrence.scheduleId,
    organizationId: input.organizationId,
    ...generationMatches,
  } as const;

  if (occurrence.occurrenceKind === 'advance') {
    const disposition = ADVANCE_DISPOSITION_FOR_OUTCOME[input.outcome];
    if (disposition === null) {
      return {
        counted: false,
        ceilingReached: false,
        scheduleAdvanced: false,
        settledAdvanceDisposition: null,
      };
    }
    // Settled in the same transaction as the occurrence, which is what makes "the attempt row and
    // the schedule disposition can never disagree" true rather than aspirational. Conditional on
    // `scheduled` so a truthful earlier skip — established or Waiting-spanned — is never relabelled.
    const settled = await tx.taskReminderSchedule.updateMany({
      where: { ...scope, advanceDisposition: 'scheduled' },
      data: { advanceDisposition: disposition },
    });
    return {
      counted: false,
      ceilingReached: false,
      scheduleAdvanced: settled.count === 1,
      settledAdvanceDisposition: settled.count === 1 ? disposition : null,
    };
  }

  if (input.outcome === 'retryable_failure') {
    // The occurrence stays owed. Arming the next one would abandon today's reminder.
    return {
      counted: false,
      ceilingReached: false,
      scheduleAdvanced: false,
      settledAdvanceDisposition: null,
    };
  }

  if (input.outcome === 'permanent_failure') {
    const stopped = await tx.taskReminderSchedule.updateMany({
      where: { ...scope, status: 'active' },
      data: {
        status: 'stopped',
        reminderVersion: { increment: 1 },
        stopReason: 'permanent_delivery_failure',
        stoppedAt: fromIso(input.completedAt)!,
        suspendedAt: null,
        requiresOwnerAttention: true,
        nextOverdueOccurrenceLocalDate: null,
        nextOverdueOccurrenceAt: null,
        claimedBy: null,
        claimedAt: null,
        claimExpiresAt: null,
      },
    });
    return {
      counted: false,
      ceilingReached: false,
      scheduleAdvanced: stopped.count === 1,
      settledAdvanceDisposition: null,
    };
  }

  const counted =
    input.outcome === 'success'
      ? (
          await tx.taskReminderSchedule.updateMany({
            where: { ...scope, status: 'active' },
            data: { overdueDeliveredCount: { increment: 1 } },
          })
        ).count === 1
      : false;

  if (counted) {
    // The ceiling is judged by the domain over the recorded occurrences, not over the denormalized
    // counter: the attempt rows are what actually happened, and D106 defines the ceiling on them.
    const history = await listReminderDeliveryAttemptsForGeneration(
      tx,
      input.organizationId,
      occurrence.scheduleId,
      input.expectedGeneration,
    );
    if (hasReachedOverdueDeliveryCeiling(history.map(toReminderOccurrenceOutcome))) {
      await tx.taskReminderSchedule.updateMany({
        where: { ...scope, status: 'active' },
        data: {
          status: 'stopped',
          reminderVersion: { increment: 1 },
          stopReason: 'overdue_ceiling_reached',
          stoppedAt: fromIso(input.completedAt)!,
          suspendedAt: null,
          requiresOwnerAttention: true,
          nextOverdueOccurrenceLocalDate: null,
          nextOverdueOccurrenceAt: null,
          claimedBy: null,
          claimedAt: null,
          claimExpiresAt: null,
        },
      });
      return {
        counted,
        ceilingReached: true,
        scheduleAdvanced: true,
        settledAdvanceDisposition: null,
      };
    }
  }

  const armed = await tx.taskReminderSchedule.updateMany({
    where: { ...scope, status: 'active' },
    data: {
      nextOverdueOccurrenceLocalDate: input.nextOverdueOccurrence?.occurrenceLocalDate ?? null,
      nextOverdueOccurrenceAt: fromIso(input.nextOverdueOccurrence?.occurrenceAt ?? null),
    },
  });
  return {
    counted,
    ceilingReached: false,
    scheduleAdvanced: armed.count === 1,
    settledAdvanceDisposition: null,
  };
}

/**
 * Finalize an occurrence whose claimant vanished after starting a transport call (A8.4a, F2).
 *
 * The lease expired and `provider_call_started_at` is set, so a provider may hold the message and
 * nobody can prove otherwise. D106 caps deliveries and the whole point of occurrence identity is
 * that a Recipient never hears about the same morning twice, so the safe reading of "unknown" is
 * "assume it went". The occurrence is consumed for its local day and never retried.
 *
 * Ambiguity is recorded truthfully rather than as a success: nothing may claim a provider accepted
 * a message when that is exactly what is unknown, so no `provider_accepted_at` is written and the
 * D106 count is untouched. The row is the durable evidence a future Owner-attention threshold will
 * count (Q8), which is why it is terminal rather than swept away.
 */
export async function finalizeAbandonedInFlightOccurrence(input: {
  readonly db: DbClient;
  readonly organizationId: string;
  readonly attemptId: string;
  readonly scheduleId: string;
  readonly claimSequence: number;
  readonly completedAt: string;
  readonly expectedGeneration: number;
}): Promise<FinalizeReminderOccurrenceResult> {
  return finalizeReminderOccurrence({
    db: input.db,
    organizationId: input.organizationId,
    attemptId: input.attemptId,
    scheduleId: input.scheduleId,
    claimSequence: input.claimSequence,
    outcome: 'ambiguous',
    completedAt: input.completedAt,
    expectedGeneration: input.expectedGeneration,
    failureCode: 'lease_expired_in_flight',
    nextOverdueOccurrence: null,
  });
}

/**
 * Release a lease this claimant still owns, returning the occurrence to the pool (A8.4a, F2).
 *
 * Fenced on the claim sequence, so a stale claimant cannot release a successor's claim — the
 * failure mode F2 named explicitly. Refuses outright when a transport call had already started:
 * releasing then would advertise the occurrence as safe to retry while a provider might hold the
 * message.
 */
export async function releaseReminderOccurrenceClaim(input: {
  readonly db: DbClient;
  readonly organizationId: string;
  readonly attemptId: string;
  readonly claimSequence: number;
}): Promise<void> {
  const released = await input.db.reminderDeliveryAttempt.updateMany({
    where: {
      id: input.attemptId,
      organizationId: input.organizationId,
      outcome: 'claimed',
      claimSequence: input.claimSequence,
      providerCallStartedAt: null,
    },
    data: { claimedBy: null, claimedAt: null, claimExpiresAt: null },
  });
  if (released.count !== 1) {
    throw domainConflict(
      `Reminder occurrence ${input.attemptId} is not releasable at claim sequence ${input.claimSequence}.`,
    );
  }
}
