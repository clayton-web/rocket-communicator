import type { LocalDate } from '@aicaa/domain';
import { hasReachedOverdueDeliveryCeiling } from '../../../domain/dist/index.js';
import type { DbClient } from '../client/create-prisma-client.js';
import { domainConflict, notFound } from '../errors/persistence-errors.js';
import { fromIso } from '../mappers/domain-mappers.js';
import {
  mapReminderDeliveryAttempt,
  toReminderOccurrenceOutcome,
  type PersistedReminderDeliveryAttempt,
  type PersistedReminderSchedule,
  type ReminderAdvanceDisposition,
  type ReminderSkipReason,
} from '../mappers/reminder-mappers.js';
import {
  listReminderDeliveryAttemptsForGeneration,
  recordTerminalOccurrenceOutcomeUnsafe,
  terminalizeExhaustedOccurrenceUnsafe,
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
 * ## Why the two phases are two transactions (A8.4a audit H1)
 *
 * They originally shared one, on the reasoning that phase two could not abort phase one because
 * every phase-two write was an `updateMany` whose zero-row result is an expected outcome rather than
 * an error. That reasoning covered the *expected* failures and nothing else. Fault injection during
 * the A8.4a audit forced an unexpected one — a CHECK violation raised inside phase two — and watched
 * the whole transaction abort, taking the committed-in-spirit success with it. Zero-row tolerance is
 * not the same property as "cannot raise", and F1 was narrowed rather than closed.
 *
 * So phase A commits alone. Once it returns, the occurrence is terminal and immutable, and no
 * failure anywhere downstream can un-send what was sent.
 *
 * That trade is not free: a crash between the two transactions leaves the occurrence terminal and
 * the schedule un-advanced. The single transaction was chosen precisely to avoid that. The
 * difference is that this divergence is *representable* — a terminal row whose `schedule_settled_at`
 * is null is settlement debt, `listUnsettledTerminalOccurrences` finds it, and
 * `settleReminderOccurrenceSchedule` is idempotent so discharging it late produces the same schedule
 * as discharging it on time. A rolled-back delivery record left nothing behind to find.
 *
 * ## Lock order
 *
 * Both phases lock the Task row first, as every other reminder transaction does (A8.3b re-audit M1).
 * The provider call happens *outside* both — a worker never holds a database lock across a network
 * call.
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

/**
 * The next occurrence a caller computed with the A8.2 domain, supplied optimistically.
 *
 * Applied only when the generation still matches and the schedule is still active, and discarded
 * when this delivery reached the ceiling. Persistence never computes one (D103).
 */
export interface NextOverdueOccurrenceInput {
  readonly occurrenceLocalDate: LocalDate;
  readonly occurrenceAt: string;
}

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
   * The generation the occurrence was claimed under. Phase B applies only while the schedule is
   * still at it; phase A ignores it entirely.
   */
  readonly expectedGeneration: number;
  readonly skipReason?: ReminderSkipReason | null;
  readonly failureCode?: string | null;
  /** Required for `success`. Durable proof, never rolled back for a schedule change. */
  readonly providerAcceptedAt?: string | null;
  readonly providerMessageRef?: string | null;
  readonly nextOverdueOccurrence: NextOverdueOccurrenceInput | null;
}

/** What phase B did, or truthfully did not do. */
export interface ReminderScheduleSettlementResult {
  /**
   * The schedule as phase B left it, or null when settlement was deferred by a failure. Null does
   * not mean the occurrence is in doubt: the occurrence is terminal either way.
   */
  readonly schedule: PersistedReminderSchedule | null;
  /** True when the D106 per-generation count was incremented by this settlement. */
  readonly counted: boolean;
  /** True when this delivery reached the D106 ceiling and stopped the schedule. */
  readonly ceilingReached: boolean;
  /**
   * False when the schedule had moved on — superseded generation, suspended, or stopped — so the
   * occurrence was recorded truthfully but changed nothing about the current schedule.
   */
  readonly scheduleAdvanced: boolean;
  /** The advance disposition this settlement settled, or null when it settled none. */
  readonly settledAdvanceDisposition: ReminderAdvanceDisposition | null;
  /**
   * True when a previous invocation had already settled this occurrence, so this one applied
   * nothing. The idempotency guarantee, made visible rather than inferred from all-false counters.
   */
  readonly alreadySettled: boolean;
  /**
   * The occurrence as settlement left it — the same row phase A wrote, now carrying its settlement
   * marker. Phase A's return value is a snapshot from before this transaction and says
   * `scheduleSettledAt: null` forever; handing that back to a caller would be a small lie of exactly
   * the kind the marker exists to prevent.
   */
  readonly settledAttempt: PersistedReminderDeliveryAttempt;
}

export interface FinalizeReminderOccurrenceResult extends Omit<
  ReminderScheduleSettlementResult,
  'settledAttempt'
> {
  readonly attempt: PersistedReminderDeliveryAttempt;
  /**
   * True when phase A committed but phase B did not, so the schedule still owes this occurrence its
   * effect. The occurrence itself is terminal and correct; the settlement sweep collects the rest.
   */
  readonly settlementDeferred: boolean;
}

const UNSETTLED = {
  schedule: null,
  counted: false,
  ceilingReached: false,
  scheduleAdvanced: false,
  settledAdvanceDisposition: null,
  alreadySettled: false,
} as const satisfies Omit<ReminderScheduleSettlementResult, 'settledAttempt'>;

/**
 * Record a terminal occurrence outcome and, if the schedule still agrees, advance the schedule.
 *
 * Two transactions, in order, with the guarantee that the first survives any failure of the second.
 * A phase B failure is swallowed and reported as `settlementDeferred` rather than thrown, because
 * the caller is a worker that has already sent a message: telling it "finalization failed" would
 * invite it to treat a delivered reminder as undelivered, which is the exact inversion F1 was about.
 * The debt is durable and the next invocation collects it.
 *
 * Counting obeys D106 exactly: a success increments the per-generation count only when the
 * occurrence is `overdue` **and** the schedule is still at the expected generation **and** still
 * active. An advance send never counts; nor does a skip, a failure of either kind, or ambiguity.
 * A success whose generation was superseded mid-flight is kept in full and counted against nothing.
 */
export async function finalizeReminderOccurrence(
  input: FinalizeReminderOccurrenceInput,
): Promise<FinalizeReminderOccurrenceResult> {
  const attempt = await terminalizeReminderOccurrence(input);

  try {
    const { settledAttempt, ...settlement } = await settleReminderOccurrenceSchedule({
      db: input.db,
      organizationId: input.organizationId,
      attemptId: input.attemptId,
      settledAt: input.completedAt,
      nextOverdueOccurrence: input.nextOverdueOccurrence,
    });
    return { attempt: settledAttempt, ...settlement, settlementDeferred: false };
  } catch {
    return { attempt, ...UNSETTLED, settlementDeferred: true };
  }
}

/**
 * Phase A: record what happened to the occurrence, and stop (A8.4a audit H1).
 *
 * Everything this writes is a fact about the occurrence itself — outcome, provider acceptance, the
 * message reference, the completion instant, the failure code, the fence it was written under. None
 * of it is conditional on the schedule, because none of it stops being true when the schedule moves.
 *
 * Exported so the settlement sweep's tests and the exhaustion path can reason about the phases
 * separately. It is not on either barrel: a caller that ran phase A and forgot phase B would leave
 * settlement debt that only the sweep would ever notice.
 */
export async function terminalizeReminderOccurrence(
  input: FinalizeReminderOccurrenceInput,
): Promise<PersistedReminderDeliveryAttempt> {
  return input.db.$transaction(async (tx) => {
    const claimed = await tx.reminderDeliveryAttempt.findFirst({
      where: { id: input.attemptId, organizationId: input.organizationId },
      select: { taskId: true, scheduleId: true, generation: true, outcome: true },
    });
    if (!claimed) {
      throw notFound(`Reminder delivery attempt ${input.attemptId} not found for organization.`);
    }

    // A8.3a audit F7: the occurrence's own identity is loaded and checked rather than taken from
    // the caller. Schedule and generation are immutable occurrence identity: a mismatch is a caller
    // bug, distinct from the schedule having legitimately moved on, which phase B absorbs as a
    // no-op.
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

    return recordTerminalOccurrenceOutcomeUnsafe(tx, {
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
  });
}

export interface SettleReminderOccurrenceScheduleInput {
  readonly db: DbClient;
  readonly organizationId: string;
  readonly attemptId: string;
  /** When settlement is being recorded. May be much later than the occurrence's completion. */
  readonly settledAt: string;
  readonly nextOverdueOccurrence: NextOverdueOccurrenceInput | null;
}

/**
 * Phase B: apply a terminal occurrence's effect to its schedule, at most once (A8.4a audit H1).
 *
 * Reads everything it needs from the terminal row rather than from its caller. That is what lets
 * the settlement sweep run this against an occurrence it knows nothing about, hours after the
 * worker that produced it died: the outcome, the kind, the generation, and the completion instant
 * are all durable facts on the row, and the only thing the caller must supply is the next
 * occurrence, because computing a calendar date is the domain's job and not persistence's (D103).
 *
 * ## Why it is safe to repeat
 *
 * `schedule_settled_at` is set in the same transaction as every effect, and it is re-read *after*
 * the Task row lock is taken. So two settlers of the same occurrence serialize on the lock, and the
 * second one sees the first's marker and applies nothing. The count increments once, the ceiling
 * transitions once, the next occurrence is armed once, and the advance disposition settles once —
 * not because the effects are individually idempotent, but because at most one transaction ever
 * runs them.
 */
export async function settleReminderOccurrenceSchedule(
  input: SettleReminderOccurrenceScheduleInput,
): Promise<ReminderScheduleSettlementResult> {
  return input.db.$transaction(async (tx) => {
    const identity = await tx.reminderDeliveryAttempt.findFirst({
      where: { id: input.attemptId, organizationId: input.organizationId },
      select: { taskId: true, scheduleId: true },
    });
    if (!identity) {
      throw notFound(`Reminder delivery attempt ${input.attemptId} not found for organization.`);
    }

    await lockTaskScopeForReminderMutation(tx, input.organizationId, identity.taskId);

    // Re-read under the lock. The pre-lock read exists only to find the Task to lock; every
    // decision below is made from state that cannot change while this transaction holds it.
    const row = await tx.reminderDeliveryAttempt.findFirst({
      where: { id: input.attemptId, organizationId: input.organizationId },
    });
    if (!row) {
      throw notFound(`Reminder delivery attempt ${input.attemptId} not found for organization.`);
    }
    const occurrence = mapReminderDeliveryAttempt(row);
    if (occurrence.outcome === 'claimed') {
      throw domainConflict(
        `Reminder occurrence ${input.attemptId} is still claimed and has no outcome to settle.`,
      );
    }
    if (occurrence.scheduleSettledAt !== null) {
      const schedule = await getReminderScheduleById(
        tx,
        input.organizationId,
        occurrence.scheduleId,
      );
      return { ...UNSETTLED, schedule, alreadySettled: true, settledAttempt: occurrence };
    }

    const effect = await applyScheduleEffect(tx, {
      organizationId: input.organizationId,
      scheduleId: occurrence.scheduleId,
      occurrenceKind: occurrence.occurrenceKind,
      generation: occurrence.generation,
      outcome: occurrence.outcome,
      // The occurrence's own completion instant, not this settlement's. A schedule stopped by a
      // permanent failure was stopped when the failure happened, not when the sweep noticed.
      effectiveAt: occurrence.completedAt ?? input.settledAt,
      nextOverdueOccurrence: input.nextOverdueOccurrence,
    });

    const marked = await tx.reminderDeliveryAttempt.updateMany({
      where: {
        id: input.attemptId,
        organizationId: input.organizationId,
        scheduleSettledAt: null,
        outcome: { not: 'claimed' },
      },
      data: { scheduleSettledAt: fromIso(input.settledAt)! },
    });
    if (marked.count !== 1) {
      // Unreachable while the Task lock is held, and therefore worth failing loudly on: it would
      // mean the lock did not serialize what it is relied upon to serialize. Aborting rolls back
      // the effects above, which is the correct response to "somebody else may have applied them".
      throw domainConflict(
        `Reminder occurrence ${input.attemptId} could not be marked settled under the Task lock.`,
      );
    }

    const schedule = await getReminderScheduleById(tx, input.organizationId, occurrence.scheduleId);
    return {
      ...effect,
      schedule,
      alreadySettled: false,
      settledAttempt: { ...occurrence, scheduleSettledAt: input.settledAt },
    };
  });
}

type ScheduleEffectInput = {
  readonly organizationId: string;
  readonly scheduleId: string;
  readonly occurrenceKind: 'advance' | 'overdue';
  readonly generation: number;
  readonly outcome: TerminalReminderDeliveryOutcome;
  readonly effectiveAt: string;
  readonly nextOverdueOccurrence: NextOverdueOccurrenceInput | null;
};

/**
 * Apply a terminal occurrence to the current schedule, or to nothing at all.
 *
 * Returns rather than throws for every mismatch. That is the whole point: this function exists to
 * be allowed to fail without taking the recorded delivery down with it.
 */
async function applyScheduleEffect(
  tx: Parameters<Parameters<DbClient['$transaction']>[0]>[0],
  input: ScheduleEffectInput,
): Promise<
  Omit<ReminderScheduleSettlementResult, 'schedule' | 'alreadySettled' | 'settledAttempt'>
> {
  const scope = {
    id: input.scheduleId,
    organizationId: input.organizationId,
    generation: input.generation,
  } as const;
  const nothing = {
    counted: false,
    ceilingReached: false,
    scheduleAdvanced: false,
    settledAdvanceDisposition: null,
  } as const;

  if (input.occurrenceKind === 'advance') {
    const disposition = ADVANCE_DISPOSITION_FOR_OUTCOME[input.outcome];
    if (disposition === null) {
      return nothing;
    }
    // Conditional on `scheduled` so a truthful earlier skip — established or Waiting-spanned — is
    // never relabelled.
    const settled = await tx.taskReminderSchedule.updateMany({
      where: { ...scope, advanceDisposition: 'scheduled' },
      data: { advanceDisposition: disposition },
    });
    return {
      ...nothing,
      scheduleAdvanced: settled.count === 1,
      settledAdvanceDisposition: settled.count === 1 ? disposition : null,
    };
  }

  if (input.outcome === 'retryable_failure') {
    // The occurrence stays owed. Arming the next one would abandon today's reminder.
    return nothing;
  }

  if (input.outcome === 'permanent_failure') {
    const stopped = await tx.taskReminderSchedule.updateMany({
      where: { ...scope, status: 'active' },
      data: {
        status: 'stopped',
        reminderVersion: { increment: 1 },
        stopReason: 'permanent_delivery_failure',
        stoppedAt: fromIso(input.effectiveAt)!,
        suspendedAt: null,
        requiresOwnerAttention: true,
        nextOverdueOccurrenceLocalDate: null,
        nextOverdueOccurrenceAt: null,
        claimedBy: null,
        claimedAt: null,
        claimExpiresAt: null,
      },
    });
    return { ...nothing, scheduleAdvanced: stopped.count === 1 };
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
      input.scheduleId,
      input.generation,
    );
    if (hasReachedOverdueDeliveryCeiling(history.map(toReminderOccurrenceOutcome))) {
      await tx.taskReminderSchedule.updateMany({
        where: { ...scope, status: 'active' },
        data: {
          status: 'stopped',
          reminderVersion: { increment: 1 },
          stopReason: 'overdue_ceiling_reached',
          stoppedAt: fromIso(input.effectiveAt)!,
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
  return { ...nothing, counted, scheduleAdvanced: armed.count === 1 };
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
 *
 * ## The next occurrence must be supplied (A8.4a audit B1)
 *
 * It used to pass `null`, and the audit showed what that meant: settlement dutifully wrote the null
 * into `next_overdue_occurrence_at` on a schedule that was still `active`, with no stop reason and
 * no Owner attention flag. The reminder series ended silently and nothing anywhere recorded that it
 * had. Consuming one occurrence is not the same act as ending the series, and recovery is not
 * entitled to conflate them.
 *
 * The caller computes the next occurrence with the same A8.2 domain call the live path uses — one
 * calendar algorithm, not two — and settlement arms it only while the schedule is still active at
 * the matching generation. If the schedule moved on, the terminal occurrence is preserved and the
 * newer schedule is left exactly as it is.
 */
export async function finalizeAbandonedInFlightOccurrence(input: {
  readonly db: DbClient;
  readonly organizationId: string;
  readonly attemptId: string;
  readonly scheduleId: string;
  readonly claimSequence: number;
  readonly completedAt: string;
  readonly expectedGeneration: number;
  readonly nextOverdueOccurrence: NextOverdueOccurrenceInput | null;
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
    nextOverdueOccurrence: input.nextOverdueOccurrence,
  });
}

/**
 * Terminalize an occurrence that has spent its retry budget, and settle its schedule (audit B2).
 *
 * The occurrence the audit found could not be finished by anybody: non-terminal, at the attempt
 * ceiling, no live lease, no in-flight marker. Every worker that reached it was refused the claim
 * with `retry_budget_exhausted` and moved on, so the schedule stayed active and armed at a past
 * instant and was re-scanned on every invocation for as long as the deployment lived.
 *
 * A permanent failure is the truthful reading. The occurrence was attempted the permitted number of
 * times and never succeeded; the distinguishing failure code says the budget ran out rather than
 * that a provider refused, which the future Q8 threshold will want to tell apart. Settlement then
 * applies the ordinary permanent-failure policy: the schedule stops, records the reason, and raises
 * Owner attention — which also removes it from the scan, ending the loop.
 *
 * Returns null when there was nothing to terminalize, which is what a second worker sees.
 */
export async function terminalizeExhaustedRetryOccurrence(input: {
  readonly db: DbClient;
  readonly organizationId: string;
  readonly attemptId: string;
  readonly maxAttempts: number;
  readonly completedAt: string;
  readonly now: string;
  readonly nextOverdueOccurrence: NextOverdueOccurrenceInput | null;
}): Promise<FinalizeReminderOccurrenceResult | null> {
  const attempt = await input.db.$transaction(async (tx) => {
    const identity = await tx.reminderDeliveryAttempt.findFirst({
      where: { id: input.attemptId, organizationId: input.organizationId },
      select: { taskId: true },
    });
    if (!identity) {
      return null;
    }
    await lockTaskScopeForReminderMutation(tx, input.organizationId, identity.taskId);
    return terminalizeExhaustedOccurrenceUnsafe(tx, {
      organizationId: input.organizationId,
      attemptId: input.attemptId,
      maxAttempts: input.maxAttempts,
      completedAt: input.completedAt,
      now: input.now,
    });
  });

  if (!attempt) {
    return null;
  }

  try {
    const { settledAttempt, ...settlement } = await settleReminderOccurrenceSchedule({
      db: input.db,
      organizationId: input.organizationId,
      attemptId: input.attemptId,
      settledAt: input.completedAt,
      nextOverdueOccurrence: input.nextOverdueOccurrence,
    });
    return { attempt: settledAttempt, ...settlement, settlementDeferred: false };
  } catch {
    return { attempt, ...UNSETTLED, settlementDeferred: true };
  }
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
