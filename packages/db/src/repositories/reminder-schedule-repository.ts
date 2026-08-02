import type { LocalDate } from '@aicaa/domain';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import {
  domainConflict,
  notFound,
  optimisticConcurrency,
  persistenceValidation,
  uniqueViolation,
} from '../errors/persistence-errors.js';
import { fromIso } from '../mappers/domain-mappers.js';
import {
  mapReminderSchedule,
  toStorableLocalDate,
  toStorableLocalDateOrNull,
  type PersistedReminderSchedule,
  type ReminderAdvanceDisposition,
  type ReminderScheduleStopReason,
} from '../mappers/reminder-mappers.js';
import { requireTaskScope } from './reminder-scope-guard.js';

/**
 * Task Reminder Schedule persistence (A8.3a; D104–D107, D109).
 *
 * **This module stores decisions; it does not make them.** Every occurrence value arrives as an
 * argument, already computed by the A8.2 domain (`decideAdvanceReminder`,
 * `selectNextOverdueOccurrence`). Nothing here derives "tomorrow", "overdue", an advance date, a
 * 09:00 local instant, or any daylight-saving behaviour, and nothing here reads a clock: callers
 * pass `now`. D103 places that arithmetic exclusively in `packages/domain/src/reminders/`, and
 * `packages/db/__tests__/a8-reminder-persistence-boundary.test.ts` enforces the absence.
 *
 * Transitions use conditional `updateMany` (compare-and-set) rather than read-then-write. Two
 * overlapping scheduler invocations are expected — D106 requires at most one delivery per local
 * calendar day even then — so a lost update here would be a duplicate reminder to a real Recipient.
 *
 * Writes that name a Task resolve the owning organization from the Task row rather than trusting
 * the caller's `organizationId` (see `reminder-scope-guard.ts`), and every local date is parsed by
 * the A8.2 domain before it reaches Prisma — the column CHECK proves shape, not that the day exists.
 */

type Client = DbClient | DbTransaction;

/** An occurrence computed by the A8.2 domain and handed to persistence verbatim. */
export interface ReminderOccurrenceInput {
  readonly occurrenceLocalDate: LocalDate;
  /** ISO-8601 UTC instant the A8.2 resolver produced for 09:00 organization-local. */
  readonly occurrenceAt: string;
}

/**
 * The state a new or superseded generation should sit in, decided by the A8.2 eligibility policy
 * from the Task's status (D107).
 *
 * `suspended_waiting` is not a later transition applied to an active schedule — a Waiting Task's
 * generation is *born* suspended, so no window exists in which its occurrence is claimable.
 */
export type ReminderScheduleInitialStatus = 'active' | 'suspended_waiting';

export interface CreateReminderScheduleInput {
  readonly id: string;
  readonly organizationId: string;
  readonly taskId: string;
  readonly dueLocalDate: LocalDate;
  /** IANA zone snapshot the occurrences were resolved in (D103, D109). */
  readonly schedulingTimeZone: string;
  /** The instant the Owner established this schedule — the advance decision's reference point. */
  readonly establishedAt: string;
  /** `decideAdvanceReminder(...)` output, translated by the caller. */
  readonly advanceDisposition: 'scheduled' | 'skipped_window_elapsed';
  readonly advanceOccurrence: ReminderOccurrenceInput;
  /** `selectNextOverdueOccurrence(...)` output. Null only when no overdue reminder is owed. */
  readonly nextOverdueOccurrence: ReminderOccurrenceInput | null;
  /**
   * Defaults to `active`. When `suspended_waiting`, the next overdue occurrence is discarded and
   * `suspendedAt` is required — a suspended schedule owes no claimable occurrence (D107), and a
   * database CHECK enforces both halves.
   */
  readonly status?: ReminderScheduleInitialStatus;
  readonly suspendedAt?: string;
}

export interface OpenNextReminderGenerationInput {
  readonly organizationId: string;
  readonly taskId: string;
  /** The generation the caller believes is current. A mismatch is a concurrency failure. */
  readonly expectedGeneration: number;
  /**
   * The reminder version the caller observed (A8.3b audit F5). Required for Owner-initiated
   * changes: generation alone cannot detect a stop-and-reactivate that returned to the same
   * generation, and the audit proved a removal could be silently overwritten without it.
   */
  readonly expectedReminderVersion?: number;
  readonly dueLocalDate: LocalDate;
  readonly schedulingTimeZone: string;
  readonly establishedAt: string;
  readonly advanceDisposition: 'scheduled' | 'skipped_window_elapsed';
  readonly advanceOccurrence: ReminderOccurrenceInput;
  readonly nextOverdueOccurrence: ReminderOccurrenceInput | null;
  /** See {@link CreateReminderScheduleInput.status}. Defaults to `active`. */
  readonly status?: ReminderScheduleInitialStatus;
  readonly suspendedAt?: string;
}

export interface ClaimReminderScheduleInput {
  readonly organizationId: string;
  readonly scheduleId: string;
  readonly claimedBy: string;
  readonly claimedAt: string;
  /** Lease expiry supplied by the caller; this module never invents a duration. */
  readonly claimExpiresAt: string;
  /** Current instant, used only to decide whether an existing lease has expired. */
  readonly now: string;
}

export interface ListSchedulesDueForProcessingInput {
  readonly organizationId: string;
  /** Occurrences at or before this instant are due. Supplied by the caller, never derived here. */
  readonly dueAtOrBefore: string;
  /** Leases at or before this instant are reclaimable. */
  readonly now: string;
  /** Bounded batch — a worker must never load an unbounded set. */
  readonly limit: number;
}

async function requireScheduleById(
  db: Client,
  organizationId: string,
  scheduleId: string,
): Promise<PersistedReminderSchedule> {
  const row = await db.taskReminderSchedule.findFirst({
    where: { id: scheduleId, organizationId },
  });
  if (!row) {
    throw notFound(`Reminder schedule ${scheduleId} not found for organization.`);
  }
  return mapReminderSchedule(row);
}

/**
 * Translate a requested initial status into the column set a suspended generation requires.
 *
 * Two database CHECKs make this non-optional: `suspended_waiting` demands a `suspended_at`, and a
 * suspended row must carry no next occurrence. Deriving all three from one argument means a caller
 * cannot ask for suspension and forget half of what suspension means.
 */
function resolveSuspension(
  status: ReminderScheduleInitialStatus | undefined,
  suspendedAt: string | undefined,
): {
  readonly status: ReminderScheduleInitialStatus;
  readonly suspended: boolean;
  readonly suspendedAt: Date | null;
} {
  if (status !== 'suspended_waiting') {
    return { status: 'active', suspended: false, suspendedAt: null };
  }
  if (!suspendedAt) {
    throw persistenceValidation('suspendedAt is required when status is suspended_waiting.');
  }
  return { status: 'suspended_waiting', suspended: true, suspendedAt: fromIso(suspendedAt)! };
}

/**
 * Create the Reminder Schedule for a Task (D104: at most one per Task).
 *
 * A second schedule for the same Task is rejected by a unique index rather than by a prior read,
 * so two concurrent establishments cannot both succeed and double every future reminder.
 *
 * The stored `organization_id` is the Task's, not the caller's: the schedule and the Task it
 * reminds about cannot be made to disagree about who owns them.
 */
export async function createReminderSchedule(
  db: Client,
  input: CreateReminderScheduleInput,
): Promise<PersistedReminderSchedule> {
  const scope = await requireTaskScope(db, input.organizationId, input.taskId);
  const dueLocalDate = toStorableLocalDate(input.dueLocalDate, 'dueLocalDate');
  const advanceOccurrenceLocalDate = toStorableLocalDate(
    input.advanceOccurrence.occurrenceLocalDate,
    'advanceOccurrence.occurrenceLocalDate',
  );
  const nextOverdueOccurrenceLocalDate = toStorableLocalDateOrNull(
    input.nextOverdueOccurrence?.occurrenceLocalDate,
    'nextOverdueOccurrence.occurrenceLocalDate',
  );
  const suspension = resolveSuspension(input.status, input.suspendedAt);

  try {
    const row = await db.taskReminderSchedule.create({
      data: {
        id: input.id,
        organizationId: scope.organizationId,
        taskId: scope.taskId,
        dueLocalDate,
        schedulingTimeZone: input.schedulingTimeZone,
        generation: 1,
        reminderVersion: 1,
        status: suspension.status,
        suspendedAt: suspension.suspendedAt,
        advanceDisposition: input.advanceDisposition,
        advanceOccurrenceLocalDate,
        advanceOccurrenceAt: fromIso(input.advanceOccurrence.occurrenceAt)!,
        nextOverdueOccurrenceLocalDate: suspension.suspended
          ? null
          : nextOverdueOccurrenceLocalDate,
        nextOverdueOccurrenceAt: suspension.suspended
          ? null
          : fromIso(input.nextOverdueOccurrence?.occurrenceAt ?? null),
        overdueDeliveredCount: 0,
        establishedAt: fromIso(input.establishedAt)!,
      },
    });
    return mapReminderSchedule(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw uniqueViolation('Task already has a Reminder Schedule (D104).');
    }
    throw error;
  }
}

export async function findReminderScheduleByTaskId(
  db: Client,
  organizationId: string,
  taskId: string,
): Promise<PersistedReminderSchedule | null> {
  const row = await db.taskReminderSchedule.findFirst({ where: { taskId, organizationId } });
  return row ? mapReminderSchedule(row) : null;
}

export async function getReminderScheduleById(
  db: Client,
  organizationId: string,
  scheduleId: string,
): Promise<PersistedReminderSchedule> {
  return requireScheduleById(db, organizationId, scheduleId);
}

/**
 * Open the next generation after a material due-date change (D104).
 *
 * Materiality is **not** decided here — the caller decides it with the domain
 * `isDueDateChangeMaterial`, because re-saving the same date must not reset anything and that rule
 * is scheduling law, not storage law.
 *
 * Prior delivery attempts are untouched: history is preserved and superseded, never deleted or
 * rewritten (D107, D109). Only the per-generation count resets to zero, and any stop or attention
 * state from the previous generation is cleared because the Owner has explicitly re-scheduled.
 */
export async function openNextReminderGeneration(
  db: Client,
  input: OpenNextReminderGenerationInput,
): Promise<PersistedReminderSchedule> {
  const scope = await requireTaskScope(db, input.organizationId, input.taskId);
  const dueLocalDate = toStorableLocalDate(input.dueLocalDate, 'dueLocalDate');
  const advanceOccurrenceLocalDate = toStorableLocalDate(
    input.advanceOccurrence.occurrenceLocalDate,
    'advanceOccurrence.occurrenceLocalDate',
  );
  const nextOverdueOccurrenceLocalDate = toStorableLocalDateOrNull(
    input.nextOverdueOccurrence?.occurrenceLocalDate,
    'nextOverdueOccurrence.occurrenceLocalDate',
  );

  const suspension = resolveSuspension(input.status, input.suspendedAt);

  const existing = await findReminderScheduleByTaskId(db, scope.organizationId, scope.taskId);
  if (!existing) {
    throw notFound(`Task ${input.taskId} has no Reminder Schedule to supersede.`);
  }

  const updated = await db.taskReminderSchedule.updateMany({
    where: {
      id: existing.id,
      organizationId: scope.organizationId,
      generation: input.expectedGeneration,
      // Reminder version is the stronger half of the precondition (A8.3b audit F5). Generation
      // alone cannot detect that the schedule was stopped since the caller read it, because a stop
      // keeps the generation number it stopped at — which is exactly how the audit's concurrent
      // removal got silently overwritten by a reactivation.
      ...(input.expectedReminderVersion === undefined
        ? {}
        : { reminderVersion: input.expectedReminderVersion }),
    },
    data: {
      generation: input.expectedGeneration + 1,
      reminderVersion: { increment: 1 },
      dueLocalDate,
      schedulingTimeZone: input.schedulingTimeZone,
      status: suspension.status,
      stopReason: null,
      stoppedAt: null,
      suspendedAt: suspension.suspendedAt,
      requiresOwnerAttention: false,
      advanceDisposition: input.advanceDisposition,
      advanceOccurrenceLocalDate,
      advanceOccurrenceAt: fromIso(input.advanceOccurrence.occurrenceAt)!,
      nextOverdueOccurrenceLocalDate: suspension.suspended ? null : nextOverdueOccurrenceLocalDate,
      nextOverdueOccurrenceAt: suspension.suspended
        ? null
        : fromIso(input.nextOverdueOccurrence?.occurrenceAt ?? null),
      overdueDeliveredCount: 0,
      claimedBy: null,
      claimedAt: null,
      claimExpiresAt: null,
      establishedAt: fromIso(input.establishedAt)!,
    },
  });

  if (updated.count !== 1) {
    throw optimisticConcurrency(
      `Reminder schedule ${existing.id} is no longer at generation ${input.expectedGeneration}` +
        `${input.expectedReminderVersion === undefined ? '' : ` and reminder version ${input.expectedReminderVersion}`}.`,
    );
  }
  return requireScheduleById(db, scope.organizationId, existing.id);
}

/**
 * Suspend for Waiting — the only pause mechanism (D097, D107).
 *
 * The next occurrence is cleared rather than retained. Keeping it would leave a suspended schedule
 * sitting in the worker's due-scan index with a date that will be wrong by the time it resumes;
 * D107 requires resume to compute the next *future* occurrence with no backlog.
 */
export async function suspendReminderScheduleForWaiting(
  db: Client,
  input: { organizationId: string; scheduleId: string; suspendedAt: string },
): Promise<PersistedReminderSchedule> {
  const updated = await db.taskReminderSchedule.updateMany({
    where: { id: input.scheduleId, organizationId: input.organizationId, status: 'active' },
    data: {
      status: 'suspended_waiting',
      reminderVersion: { increment: 1 },
      suspendedAt: fromIso(input.suspendedAt)!,
      nextOverdueOccurrenceLocalDate: null,
      nextOverdueOccurrenceAt: null,
      claimedBy: null,
      claimedAt: null,
      claimExpiresAt: null,
    },
  });

  const existing = await requireScheduleById(db, input.organizationId, input.scheduleId);
  if (updated.count === 1 || existing.status === 'suspended_waiting') {
    return existing;
  }
  throw domainConflict(
    `Only an active Reminder Schedule can be suspended (status ${existing.status}).`,
  );
}

/**
 * Resume from Waiting with the next future occurrence the caller computed (D107).
 *
 * No elapsed-time accounting and no backlog: whatever the caller passes is exactly one occurrence,
 * and persistence has no way to reconstruct the missed ones even if it wanted to.
 *
 * `advanceDisposition` is the one field a resume may rewrite, and only to
 * `'skipped_waiting_elapsed'` (A8 lifecycle audit H-2). The advance occurrence's local date and
 * instant are deliberately left untouched: the generation's record of *which* morning was missed is
 * history and survives, while the disposition stops asserting that a passed occurrence is still
 * pending. Whether it elapsed is the caller's decision, made with the A8.2 domain boundary rule —
 * persistence does not compare instants to the clock.
 */
export async function resumeReminderScheduleFromWaiting(
  db: Client,
  input: {
    organizationId: string;
    scheduleId: string;
    nextOverdueOccurrence: ReminderOccurrenceInput | null;
    /** Set only when the Waiting period spanned a still-scheduled advance occurrence. */
    advanceDisposition?: Extract<ReminderAdvanceDisposition, 'skipped_waiting_elapsed'>;
  },
): Promise<PersistedReminderSchedule> {
  const nextOverdueOccurrenceLocalDate = toStorableLocalDateOrNull(
    input.nextOverdueOccurrence?.occurrenceLocalDate,
    'nextOverdueOccurrence.occurrenceLocalDate',
  );

  const updated = await db.taskReminderSchedule.updateMany({
    where: {
      id: input.scheduleId,
      organizationId: input.organizationId,
      status: 'suspended_waiting',
    },
    data: {
      status: 'active',
      reminderVersion: { increment: 1 },
      suspendedAt: null,
      nextOverdueOccurrenceLocalDate,
      nextOverdueOccurrenceAt: fromIso(input.nextOverdueOccurrence?.occurrenceAt ?? null),
      ...(input.advanceDisposition ? { advanceDisposition: input.advanceDisposition } : {}),
    },
  });

  const existing = await requireScheduleById(db, input.organizationId, input.scheduleId);
  if (updated.count === 1) {
    return existing;
  }
  throw domainConflict(
    `Only a Waiting-suspended Reminder Schedule can resume (status ${existing.status}).`,
  );
}

/**
 * Stop a schedule permanently (D106, D107).
 *
 * Stopping clears the next occurrence — a database CHECK also refuses a stopped schedule that still
 * carries one, so a stopped schedule cannot reappear in the worker's due-scan. Stopping is
 * idempotent for the same reason: completion and due-date removal can legitimately race.
 *
 * `expectedReminderVersion` makes the stop conditional (A8.3b audit F2). Owner-initiated removal
 * supplies it, so a removal can only stop the schedule the Owner actually looked at; the audit
 * showed that without it, a removal issued against one generation would happily stop whatever the
 * row had become in the meantime, and the audit trail would then claim a removal that the surviving
 * state contradicted. Worker and lifecycle callers omit it and keep the unconditional, idempotent
 * behaviour, because "stop this, whatever it is now" is genuinely what completion means.
 */
export async function stopReminderSchedule(
  db: Client,
  input: {
    organizationId: string;
    scheduleId: string;
    reason: ReminderScheduleStopReason;
    stoppedAt: string;
    requiresOwnerAttention?: boolean;
    expectedReminderVersion?: number;
  },
): Promise<PersistedReminderSchedule> {
  const updated = await db.taskReminderSchedule.updateMany({
    where: {
      id: input.scheduleId,
      organizationId: input.organizationId,
      status: { in: ['active', 'suspended_waiting'] },
      ...(input.expectedReminderVersion === undefined
        ? {}
        : { reminderVersion: input.expectedReminderVersion }),
    },
    data: {
      status: 'stopped',
      reminderVersion: { increment: 1 },
      stopReason: input.reason,
      stoppedAt: fromIso(input.stoppedAt)!,
      suspendedAt: null,
      nextOverdueOccurrenceLocalDate: null,
      nextOverdueOccurrenceAt: null,
      claimedBy: null,
      claimedAt: null,
      claimExpiresAt: null,
      ...(input.requiresOwnerAttention === undefined
        ? {}
        : { requiresOwnerAttention: input.requiresOwnerAttention }),
    },
  });

  const existing = await requireScheduleById(db, input.organizationId, input.scheduleId);
  if (updated.count === 1) {
    return existing;
  }
  // Ordered deliberately: a caller whose token is stale learns that, rather than being told the
  // schedule "could not be stopped" when the truth is that someone else stopped or changed it.
  if (
    input.expectedReminderVersion !== undefined &&
    existing.reminderVersion !== input.expectedReminderVersion
  ) {
    throw optimisticConcurrency(
      `Reminder schedule ${input.scheduleId} changed since reminder version ${input.expectedReminderVersion}.`,
    );
  }
  if (existing.status === 'stopped') {
    return existing;
  }
  throw domainConflict(`Reminder schedule ${input.scheduleId} could not be stopped.`);
}

/**
 * Compare-and-set the reminder version alone, leaving schedule state untouched.
 *
 * For the Owner change that alters reminder configuration without altering the schedule row's state:
 * clearing `tasks.due_local_date` when the schedule is already stopped. The real PostgreSQL suite
 * showed why the version must still move. That removal committed a material change and a
 * `reminder.due_date.removed` event while leaving the version where it was, so a second Owner holding
 * the *same* token still satisfied their precondition afterwards and reactivated on top of it. Two
 * incompatible requests both won from one observed state, which is the lost update the version exists
 * to prevent.
 *
 * The update is itself the precondition: a caller whose version has moved matches no row and is
 * refused, so this is a genuine compare-and-set rather than a read followed by a hopeful write.
 */
export async function bumpReminderVersionForOwnerChange(
  db: Client,
  input: { organizationId: string; scheduleId: string; expectedReminderVersion: number },
): Promise<PersistedReminderSchedule> {
  const updated = await db.taskReminderSchedule.updateMany({
    where: {
      id: input.scheduleId,
      organizationId: input.organizationId,
      reminderVersion: input.expectedReminderVersion,
    },
    data: { reminderVersion: { increment: 1 } },
  });
  if (updated.count !== 1) {
    throw optimisticConcurrency(
      `Reminder schedule ${input.scheduleId} changed since reminder version ${input.expectedReminderVersion}.`,
    );
  }
  return requireScheduleById(db, input.organizationId, input.scheduleId);
}

/** Record the next future overdue occurrence the caller computed with the A8.2 domain. */
export async function setNextOverdueOccurrence(
  db: Client,
  input: {
    organizationId: string;
    scheduleId: string;
    expectedGeneration: number;
    nextOverdueOccurrence: ReminderOccurrenceInput | null;
  },
): Promise<PersistedReminderSchedule> {
  const nextOverdueOccurrenceLocalDate = toStorableLocalDateOrNull(
    input.nextOverdueOccurrence?.occurrenceLocalDate,
    'nextOverdueOccurrence.occurrenceLocalDate',
  );

  const updated = await db.taskReminderSchedule.updateMany({
    where: {
      id: input.scheduleId,
      organizationId: input.organizationId,
      generation: input.expectedGeneration,
      status: 'active',
    },
    data: {
      nextOverdueOccurrenceLocalDate,
      nextOverdueOccurrenceAt: fromIso(input.nextOverdueOccurrence?.occurrenceAt ?? null),
    },
  });

  if (updated.count !== 1) {
    throw optimisticConcurrency(
      `Reminder schedule ${input.scheduleId} is not active at generation ${input.expectedGeneration}.`,
    );
  }
  return requireScheduleById(db, input.organizationId, input.scheduleId);
}

/** Raise the Owner-attention flag (D106, D108). Idempotent. */
export async function markReminderScheduleRequiresOwnerAttention(
  db: Client,
  input: { organizationId: string; scheduleId: string },
): Promise<PersistedReminderSchedule> {
  await db.taskReminderSchedule.updateMany({
    where: { id: input.scheduleId, organizationId: input.organizationId },
    data: { requiresOwnerAttention: true },
  });
  return requireScheduleById(db, input.organizationId, input.scheduleId);
}

/**
 * Record one successful overdue delivery against the per-generation count (D106).
 *
 * Increments only when the schedule is still at the expected generation, so a delivery whose
 * generation was superseded mid-flight cannot inflate the new generation's count. The column CHECK
 * bounds the value at the ceiling as a backstop; callers stop the schedule at the ceiling rather
 * than relying on the constraint to fire.
 *
 * The number itself is not policy: whether the ceiling has been reached is decided by the domain
 * `hasReachedOverdueDeliveryCeiling` over the recorded delivery attempts, not over this column.
 */
export async function incrementOverdueDeliveredCount(
  db: Client,
  input: { organizationId: string; scheduleId: string; expectedGeneration: number },
): Promise<PersistedReminderSchedule> {
  const updated = await db.taskReminderSchedule.updateMany({
    where: {
      id: input.scheduleId,
      organizationId: input.organizationId,
      generation: input.expectedGeneration,
    },
    data: { overdueDeliveredCount: { increment: 1 } },
  });

  if (updated.count !== 1) {
    throw optimisticConcurrency(
      `Reminder schedule ${input.scheduleId} is no longer at generation ${input.expectedGeneration}.`,
    );
  }
  return requireScheduleById(db, input.organizationId, input.scheduleId);
}

/**
 * Acquire a schedule processing lease.
 *
 * ## This lease is a scan-efficiency hint, not the duplicate-delivery authority (A8.3a audit F6)
 *
 * The audit asked which of two claim systems is correctness-bearing, because two independent ones
 * that can disagree are worse than either alone. The answer, decided in A8.4a, is the occurrence
 * row: `(schedule, generation, kind, local date)` is a unique index, a claim on it is a fenced
 * bounded lease, and finalization is conditional on holding that fence. Nothing about whether a
 * message is sent twice depends on this lease.
 *
 * What this lease buys is that two overlapping five-minute invocations do not both walk the same
 * schedules and do redundant eligibility work before losing the occurrence race. Losing it costs
 * wasted queries, never a duplicate reminder. Delivery finalization therefore never checks it, and
 * a worker that finds a schedule leased simply moves to the next one.
 *
 * A lease is granted only when the schedule is unclaimed or the previous lease has expired, and the
 * grant is a single conditional update — two workers racing produce one winner and one `null`,
 * rather than two claimants deciding politely in application code. Release is fenced on exact grant
 * identity so a stale claimant cannot release a successor's lease.
 */
export async function claimReminderScheduleForProcessing(
  db: Client,
  input: ClaimReminderScheduleInput,
): Promise<PersistedReminderSchedule | null> {
  const now = fromIso(input.now)!;
  const claimed = await db.taskReminderSchedule.updateMany({
    where: {
      id: input.scheduleId,
      organizationId: input.organizationId,
      status: 'active',
      OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lte: now } }],
    },
    data: {
      claimedBy: input.claimedBy,
      claimedAt: fromIso(input.claimedAt)!,
      claimExpiresAt: fromIso(input.claimExpiresAt)!,
    },
  });

  if (claimed.count !== 1) {
    return null;
  }
  return requireScheduleById(db, input.organizationId, input.scheduleId);
}

/**
 * Release a schedule lease, proving exact claim identity (A8.3a audit F6).
 *
 * `claimedAt` is required alongside `claimedBy` and is the fence. Without it, a worker whose lease
 * expired and was re-granted to a *differently named* successor would be refused — but one re-granted
 * to a successor with the same identity, which is what happens when the same deployment wakes up
 * twice, would release a lease it no longer held. `(claimedBy, claimedAt)` is unique per grant, so a
 * stale claimant matches nothing and leaves the successor alone.
 *
 * This lease is a scan-efficiency hint, not the duplicate-delivery authority — see the module
 * header on {@link claimReminderScheduleForProcessing}. Releasing the wrong one would waste work,
 * not send a second reminder; the occurrence row is what prevents that.
 */
export async function releaseReminderScheduleClaim(
  db: Client,
  input: {
    organizationId: string;
    scheduleId: string;
    claimedBy: string;
    /** The exact grant instant this claimant was given. */
    claimedAt: string;
  },
): Promise<PersistedReminderSchedule> {
  await db.taskReminderSchedule.updateMany({
    where: {
      id: input.scheduleId,
      organizationId: input.organizationId,
      claimedBy: input.claimedBy,
      claimedAt: fromIso(input.claimedAt)!,
    },
    data: { claimedBy: null, claimedAt: null, claimExpiresAt: null },
  });
  return requireScheduleById(db, input.organizationId, input.scheduleId);
}

/** One due schedule from the global internal scan, carrying its own authoritative organization. */
export interface DueReminderScheduleRow {
  readonly id: string;
  /** Authoritative row data, not a caller-supplied filter. Every later write scopes itself by it. */
  readonly organizationId: string;
  readonly taskId: string;
  readonly generation: number;
  /**
   * The generation's due date. Carried because the *next* overdue occurrence is a function of the
   * due date, not of the occurrence being processed — deriving it from today's occurrence would
   * quietly re-anchor the series every morning (D106).
   */
  readonly dueLocalDate: LocalDate;
  readonly nextOverdueOccurrenceLocalDate: LocalDate;
  readonly nextOverdueOccurrenceAt: string;
  readonly schedulingTimeZone: string;
}

/**
 * Bounded global scan for schedules whose next overdue occurrence has arrived (A8.3a audit F11).
 *
 * ## Why this scan spans organizations
 *
 * One Owner organization exists. A cron-driven worker that had to enumerate organizations would
 * hold that list in application memory, re-derive it every wake-up, and make a fairness decision in
 * the least observable place available. A bounded global scan ordered by occurrence instant is
 * simpler and is the ordering that a multi-organization deployment would want anyway: the reminder
 * that has been owed longest goes first.
 *
 * Scanning globally is not the same as writing globally. Every row carries its own
 * `organizationId`, read from the database rather than supplied by the caller, and every subsequent
 * claim, transport decision, and finalization scopes itself by that value. The Owner-facing reads
 * remain organization-scoped and are unaffected.
 *
 * Future multi-organization fairness — round-robin, per-organization batch caps, weighted
 * ordering — is a change to this ORDER BY and this WHERE. It requires no change to occurrence
 * identity, because identity is `(schedule, generation, kind, local date)` and never mentions the
 * scan that found it.
 *
 * "Has arrived" is entirely the caller's judgement: `dueAtOrBefore` is an argument. This function
 * has no notion of now, today, or overdue. The ordering is total — occurrence instant then id — so
 * the batch bound is deterministic and two workers see the same candidates in the same order.
 */
export async function listDueReminderSchedulesGlobally(
  db: Client,
  input: { readonly dueAtOrBefore: string; readonly limit: number },
): Promise<DueReminderScheduleRow[]> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw persistenceValidation('Reminder processing batch limit must be between 1 and 500.');
  }

  const rows = await db.taskReminderSchedule.findMany({
    where: {
      status: 'active',
      nextOverdueOccurrenceAt: { lte: fromIso(input.dueAtOrBefore)! },
    },
    orderBy: [{ nextOverdueOccurrenceAt: 'asc' }, { id: 'asc' }],
    take: input.limit,
    select: {
      id: true,
      organizationId: true,
      taskId: true,
      generation: true,
      dueLocalDate: true,
      nextOverdueOccurrenceLocalDate: true,
      nextOverdueOccurrenceAt: true,
      schedulingTimeZone: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    taskId: row.taskId,
    generation: row.generation,
    dueLocalDate: toStorableLocalDate(row.dueLocalDate, 'dueLocalDate'),
    // Non-null by the `next_overdue_pair_coherent` CHECK plus the `lte` filter above: a row with a
    // matching instant necessarily has the local date beside it.
    nextOverdueOccurrenceLocalDate: toStorableLocalDate(
      row.nextOverdueOccurrenceLocalDate!,
      'nextOverdueOccurrenceLocalDate',
    ),
    nextOverdueOccurrenceAt: row.nextOverdueOccurrenceAt!.toISOString(),
    schedulingTimeZone: row.schedulingTimeZone,
  }));
}

/** One schedule whose single advance occurrence has arrived and has not yet been settled. */
export interface DueAdvanceReminderScheduleRow {
  readonly id: string;
  readonly organizationId: string;
  readonly taskId: string;
  readonly generation: number;
  /** The generation's due date. The advance occurrence is the morning before it (D105). */
  readonly dueLocalDate: LocalDate;
  readonly advanceOccurrenceLocalDate: LocalDate;
  readonly advanceOccurrenceAt: string;
  readonly schedulingTimeZone: string;
}

/**
 * Bounded global scan for schedules whose advance occurrence has arrived (A8.4b.3).
 *
 * The advance twin of {@link listDueReminderSchedulesGlobally}, and deliberately a separate
 * function rather than a widened one. The two scans agree on organization spanning, on bounding,
 * and on deterministic ordering, and agree on nothing else: overdue follows a nullable pointer that
 * is re-armed after every occurrence and may return the same schedule tomorrow, while advance reads
 * one immutable instant per generation whose disposition changes exactly once and never returns to
 * `scheduled`. Merging them would mean a query that could not say which occurrence it had found.
 *
 * `advance_disposition = 'scheduled'` is the whole of the "not yet handled" test, and it is why this
 * scan needs no anti-join against occurrence history. Every terminal outcome settles the disposition
 * inside the same transaction that marks the occurrence settled, so a delivered, skipped, failed, or
 * ambiguous advance occurrence has already left this scan by the time the next invocation runs. The
 * two skips that happen without a worker — the window having already elapsed at establishment, and a
 * Waiting period having spanned the morning — settle the same field through the same rule.
 *
 * Deliberately no lateness predicate. "Has arrived" is `dueAtOrBefore`, the caller's judgement, and
 * how late is *too* late is a calendar-day question in the organization's zone that SQL should not
 * be answering: the worker asks the domain, and records a truthful skip for an occurrence whose day
 * has passed. Filtering it out here instead would leave those rows in the index forever, still
 * claiming to be `scheduled`, with nothing left in the system that would ever say otherwise.
 */
export async function listDueAdvanceReminderSchedulesGlobally(
  db: Client,
  input: { readonly dueAtOrBefore: string; readonly limit: number },
): Promise<DueAdvanceReminderScheduleRow[]> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw persistenceValidation('Reminder processing batch limit must be between 1 and 500.');
  }

  const rows = await db.taskReminderSchedule.findMany({
    where: {
      status: 'active',
      advanceDisposition: 'scheduled',
      advanceOccurrenceAt: { lte: fromIso(input.dueAtOrBefore)! },
    },
    orderBy: [{ advanceOccurrenceAt: 'asc' }, { id: 'asc' }],
    take: input.limit,
    select: {
      id: true,
      organizationId: true,
      taskId: true,
      generation: true,
      dueLocalDate: true,
      advanceOccurrenceLocalDate: true,
      advanceOccurrenceAt: true,
      schedulingTimeZone: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    taskId: row.taskId,
    generation: row.generation,
    dueLocalDate: toStorableLocalDate(row.dueLocalDate, 'dueLocalDate'),
    advanceOccurrenceLocalDate: toStorableLocalDate(
      row.advanceOccurrenceLocalDate,
      'advanceOccurrenceLocalDate',
    ),
    advanceOccurrenceAt: row.advanceOccurrenceAt.toISOString(),
    schedulingTimeZone: row.schedulingTimeZone,
  }));
}

/**
 * Bounded batch of schedules whose next overdue occurrence has arrived and that are not held under
 * a live lease.
 *
 * "Has arrived" is entirely the caller's judgement: `dueAtOrBefore` is an argument. This function
 * has no notion of now, today, or overdue.
 */
export async function listReminderSchedulesDueForProcessing(
  db: Client,
  input: ListSchedulesDueForProcessingInput,
): Promise<PersistedReminderSchedule[]> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw persistenceValidation('Reminder processing batch limit must be between 1 and 500.');
  }

  const now = fromIso(input.now)!;
  const rows = await db.taskReminderSchedule.findMany({
    where: {
      organizationId: input.organizationId,
      status: 'active',
      nextOverdueOccurrenceAt: { lte: fromIso(input.dueAtOrBefore)! },
      OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lte: now } }],
    },
    orderBy: [{ nextOverdueOccurrenceAt: 'asc' }, { id: 'asc' }],
    take: input.limit,
  });
  return rows.map(mapReminderSchedule);
}
