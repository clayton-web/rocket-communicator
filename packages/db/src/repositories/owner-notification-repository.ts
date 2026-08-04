import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../client/create-prisma-client.js';
import { persistenceValidation, uniqueViolation } from '../errors/persistence-errors.js';
import { fromIso, toIso } from '../mappers/domain-mappers.js';
import {
  mapOwnerNotificationAttempt,
  mapOwnerNotificationIntent,
  type OwnerNotificationActor,
  type OwnerNotificationAttemptRecord,
  type OwnerNotificationEventTypeValue,
  type OwnerNotificationIntentRecord,
  type OwnerNotificationSubjectKindValue,
  type OwnerNotificationSuppressionReasonValue,
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

/**
 * A caller's decision that one event is notifiable, and the identifier to record it under (A8.5d).
 *
 * Only the identifier crosses the boundary. Which event, which subject, which occurrence, and who
 * acted are all derived inside the transaction from state it already holds, so a caller cannot name
 * a different Task, a stale version, or an event that did not happen. `packages/db` reads no
 * feature flag, so the presence of this object *is* the capture decision: absent means absent, and
 * no statement is issued against an A8.5 table.
 */
export interface OwnerNotificationCapture {
  readonly id: string;
}

/**
 * Capture for an event nobody performed (A8.5d).
 *
 * A provider refusing a message, a lease of time running out, a reminder schedule reaching its
 * ceiling: these are observations, not actions, and their truthful actor is the system that noticed.
 * Producers of such events take this variant so the system identifier is an argument they cannot
 * forget rather than a literal invented inside persistence, which reads no environment and knows the
 * name of no worker.
 */
export interface OwnerNotificationSystemCapture extends OwnerNotificationCapture {
  readonly systemId: string;
}

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

/**
 * The Task an intent's subject belongs to, or null when it has none (A8.5d).
 *
 * Six of the ten ratified events are recorded against something that is not a Task — a capability,
 * a handoff attempt, a reminder schedule — because that is what their identity is derived from and
 * what makes a repeat distinguishable from a retry. The Owner still needs to be told *which* task,
 * and "this task" in an email that names none is the kind of true-but-useless sentence A8.5d's
 * truthfulness review exists to catch.
 *
 * Every branch selects `taskId` and nothing else. That is deliberate rather than tidy: the
 * capability row carries `intendedRecipientEmail`, and a rendering path has no business loading a
 * Recipient address into memory at all (D134).
 *
 * `communication_account` has no Task and returns null. A Gmail channel failure is about the
 * organization's mailbox, and its copy says so without naming any task.
 */
export async function findOwnerNotificationSubjectTaskId(
  db: Client,
  organizationId: string,
  subjectKind: OwnerNotificationSubjectKindValue,
  subjectId: string,
): Promise<string | null> {
  switch (subjectKind) {
    case 'task':
      return subjectId;
    case 'task_capability': {
      const row = await db.taskCapability.findFirst({
        where: { id: subjectId, organizationId },
        select: { taskId: true },
      });
      return row?.taskId ?? null;
    }
    case 'handoff_attempt': {
      const row = await db.handoffAttempt.findFirst({
        where: { id: subjectId, organizationId },
        select: { taskId: true },
      });
      return row?.taskId ?? null;
    }
    case 'task_reminder_schedule': {
      const row = await db.taskReminderSchedule.findFirst({
        where: { id: subjectId, organizationId },
        select: { taskId: true },
      });
      return row?.taskId ?? null;
    }
    case 'communication_account':
      return null;
  }
}

// ---------------------------------------------------------------------------
// A8.6c Owner visibility: notifications that were never delivered
// ---------------------------------------------------------------------------

/**
 * The states in which Rocket owes the Owner an event it never managed to send.
 *
 * `sent` is excluded because the Owner already has the email — repeating it on a web surface is
 * an inbox, which A8.6c is deliberately not. `pending`, `claimed`, and `failed_retryable` are
 * excluded because they are still in progress and saying so would invite the Owner to act on a
 * decision the worker has not finished making. A retryable failure returns the intent to
 * `pending` rather than resting in `failed_retryable`, so that state is unreachable in practice
 * and listed only to keep this set exhaustive against the enum.
 */
const UNDELIVERED_NOTIFICATION_STATES = [
  'suppressed',
  'failed_permanent',
  'ambiguous',
  'requires_owner_attention',
] as const satisfies ReadonlyArray<OwnerNotificationIntentRecord['state']>;

/**
 * Reminder stops, excluded from this read because `/attention` already has a section for them.
 *
 * The exclusion is a correctness requirement, not a de-duplication nicety. Section one of that
 * page is driven by `TaskReminderSchedule.requiresOwnerAttention`, which **clears** when the Owner
 * sets a new due date; a notification intent is terminal and clears never. An unfiltered read
 * would therefore keep announcing "we could not tell you reminders stopped" for a schedule the
 * Owner repaired weeks ago, directly beneath the live section that no longer lists it.
 *
 * Filtering in SQL rather than after projection also keeps the bound honest. Dropping rows in the
 * presentation layer would let a full batch of fifty reminder stops render as an empty list while
 * still reporting the batch as filled.
 *
 * `reminder_no_active_assignment` is **not** here. It never sets `requiresOwnerAttention`, never
 * reaches the reminder section, and is invisible to the Owner today.
 */
const REMINDER_STOP_EVENT_TYPES = [
  'reminder_schedule_stopped_ceiling_reached',
  'reminder_schedule_stopped_permanent_failure',
  'reminder_schedule_stopped_repeated_ambiguous',
] as const satisfies ReadonlyArray<OwnerNotificationEventTypeValue>;

/** One undelivered notification, already joined to the Task it is about. */
export interface OwnerMissedNotificationRow {
  readonly id: string;
  readonly eventType: OwnerNotificationEventTypeValue;
  readonly state: OwnerNotificationIntentRecord['state'];
  readonly suppressionReason: OwnerNotificationSuppressionReasonValue | null;
  readonly actorKind: OwnerNotificationActor['actorKind'];
  readonly occurredAt: string;
  readonly settledAt: string | null;
  /**
   * The Task this event is about, or null.
   *
   * Null has three causes and they are deliberately indistinguishable here: the subject names no
   * Task at all (`communication_account`), the subject was purged under retention, or the subject
   * belongs to another organization. All three must produce the same outcome — an item that
   * renders without a link — so collapsing them removes the chance of a caller treating the third
   * case as linkable.
   */
  readonly taskId: string | null;
  /** The Task's summary points, for title derivation. Null whenever `taskId` is. */
  readonly taskSummaryPoints: unknown;
}

/**
 * Resolve many subjects to their Tasks in a fixed number of statements (A8.6c).
 *
 * `findOwnerNotificationSubjectTaskId` above answers this for one subject and is the wrong tool
 * for a list: it issues a statement per row, so a fifty-item page would cost fifty round-trips.
 * This groups by subject kind first and issues at most one `IN` per kind, which makes the cost a
 * function of the *number of kinds* — a constant of five, three of which query — rather than of
 * how many notifications went undelivered.
 *
 * Every lookup repeats `organizationId`. No foreign key binds a subject to the organization of the
 * intent that names it — an intent deliberately has no foreign key to its subject at all, so that
 * purging a Task cannot delete a notification that is still owed — which makes their agreement an
 * invariant of the write path rather than something the database enforces. A subject naming
 * another organization's row simply fails to match and resolves to null.
 */
async function resolveSubjectTaskIds(
  db: Client,
  organizationId: string,
  subjects: ReadonlyArray<{ kind: OwnerNotificationSubjectKindValue; id: string }>,
): Promise<Map<string, string>> {
  const byKind = new Map<OwnerNotificationSubjectKindValue, Set<string>>();
  for (const subject of subjects) {
    const existing = byKind.get(subject.kind);
    if (existing) {
      existing.add(subject.id);
    } else {
      byKind.set(subject.kind, new Set([subject.id]));
    }
  }

  // Keyed by `kind:id` because a capability and a Task could in principle share an identifier,
  // and a collision here would link a notification to the wrong Task.
  const resolved = new Map<string, string>();

  const capabilityIds = byKind.get('task_capability');
  if (capabilityIds && capabilityIds.size > 0) {
    const rows = await db.taskCapability.findMany({
      where: { id: { in: [...capabilityIds] }, organizationId },
      select: { id: true, taskId: true },
    });
    for (const row of rows) {
      resolved.set(`task_capability:${row.id}`, row.taskId);
    }
  }

  const handoffIds = byKind.get('handoff_attempt');
  if (handoffIds && handoffIds.size > 0) {
    const rows = await db.handoffAttempt.findMany({
      where: { id: { in: [...handoffIds] }, organizationId },
      select: { id: true, taskId: true },
    });
    for (const row of rows) {
      resolved.set(`handoff_attempt:${row.id}`, row.taskId);
    }
  }

  const scheduleIds = byKind.get('task_reminder_schedule');
  if (scheduleIds && scheduleIds.size > 0) {
    const rows = await db.taskReminderSchedule.findMany({
      where: { id: { in: [...scheduleIds] }, organizationId },
      select: { id: true, taskId: true },
    });
    for (const row of rows) {
      resolved.set(`task_reminder_schedule:${row.id}`, row.taskId);
    }
  }

  // A `task` subject already carries its own identifier, and `communication_account` names no
  // Task. Neither costs a statement. Both are still verified against the organization below,
  // because the Task load is what proves a Task is real and ours.
  for (const id of byKind.get('task') ?? []) {
    resolved.set(`task:${id}`, id);
  }

  return resolved;
}

/**
 * Bounded, organization-scoped read of recent Owner notifications that were never delivered
 * (A8.6c; D133, D135).
 *
 * A8.5 exists to email the Owner once per notable event. When that email is not sent, the Owner
 * may never learn the event happened at all, and until now no surface said so. This read is that
 * backstop — the events Rocket could not tell them about — and nothing more. It is not a
 * notification inbox, an audit feed, or a delivery console.
 *
 * ## The window is what keeps this from becoming an inbox
 *
 * `occurredAtOrAfter` is required and is computed by the caller, because nothing in this package
 * reads a clock (D103). The window is also the *only* mechanism by which an item ever leaves this
 * surface: A8.6c introduces no acknowledgement, dismissal, or read state, so an item is retired
 * by ageing out and by nothing else. That is a ratified product decision, and it is why the
 * predicate is mandatory rather than optional — an unbounded variant of this query would quietly
 * become the perpetual to-do list the surface is designed not to be.
 *
 * The window is **not** a performance measure, and it was measured rather than assumed. On
 * PostgreSQL 16.14 with 200,000 intents in one organization, the windowed and unbounded forms of
 * this query cost the same 3,656 buffers and 0.50 ms, because `LIMIT 50` against a backward scan
 * of `owner_notification_intents_occurred_at_idx` stops early either way. The window earns its
 * place as a product bound, not as an optimization, and claiming otherwise would leave a future
 * reader thinking the surface cannot be widened without a query rewrite.
 *
 * ## Why no index was added
 *
 * A candidate `(organization_id, occurred_at, id)` index was built and measured during the A8.6c
 * review. It helps the populated case — 61 buffers and 0.18 ms against 3,656 and 0.50 ms — and the
 * planner **declines it** in the steady state, where every notification was delivered and the scan
 * must walk the whole window to prove the answer is empty (20,522 buffers, 3.0 ms, identical with
 * and without the candidate, because no index covers `state`). Three milliseconds on a
 * hundredfold more rows than Production holds does not buy a permanent write cost, so nothing was
 * added. Should that change, the shape to reach for is a partial index on the four visible states
 * — the same trick `owner_notification_intents_pending_idx` uses — and not this candidate, which
 * the empty case never touches.
 *
 * ## Constant round-trips
 *
 * One statement for the intents, at most three to resolve their subjects, and one to load the
 * Tasks: five at the most, whatever the row count. The `select` lists exactly the columns the
 * Owner surface projects, so claim holders, lease expiry, fencing sequence, attempt counts,
 * provider references, failure codes, and request identifiers are never loaded into memory at all
 * — absent rather than filtered out later.
 */
export async function listUndeliveredOwnerNotifications(
  db: Client,
  input: {
    readonly organizationId: string;
    readonly occurredAtOrAfter: string;
    readonly limit: number;
  },
): Promise<OwnerMissedNotificationRow[]> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    throw persistenceValidation(
      'Undelivered Owner notification limit must be an integer between 1 and 50.',
    );
  }

  // `fromIso` constructs a `Date` without validating, so an unparseable cutoff would otherwise
  // reach Prisma as `Invalid Date` and surface as a driver error rather than a caller mistake.
  const cutoff = fromIso(input.occurredAtOrAfter);
  if (cutoff === null || Number.isNaN(cutoff.getTime())) {
    throw persistenceValidation(
      'Undelivered Owner notification read requires an ISO-8601 window cutoff.',
    );
  }

  const intents = await db.ownerNotificationIntent.findMany({
    where: {
      organizationId: input.organizationId,
      occurredAt: { gte: cutoff },
      state: { in: [...UNDELIVERED_NOTIFICATION_STATES] },
      eventType: { notIn: [...REMINDER_STOP_EVENT_TYPES] },
    },
    // Most recent first: this is a "what did I miss" surface, and the newest miss is the one most
    // likely to still be actionable. `id` breaks ties so two loads of an unchanged database agree.
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: input.limit,
    select: {
      id: true,
      eventType: true,
      subjectKind: true,
      subjectId: true,
      state: true,
      suppressionReason: true,
      actorKind: true,
      occurredAt: true,
      settledAt: true,
    },
  });

  const subjectTaskIds = await resolveSubjectTaskIds(
    db,
    input.organizationId,
    intents.map((intent) => ({ kind: intent.subjectKind, id: intent.subjectId })),
  );

  const candidateTaskIds = [...new Set(subjectTaskIds.values())];
  const tasks =
    candidateTaskIds.length === 0
      ? []
      : await db.task.findMany({
          where: { id: { in: candidateTaskIds }, organizationId: input.organizationId },
          select: { id: true, summaryPoints: true },
        });
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  return intents.map((intent) => {
    const taskId = subjectTaskIds.get(`${intent.subjectKind}:${intent.subjectId}`);
    // A resolved identifier is not yet a linkable Task. Only a row that loaded under this
    // organization's filter proves the Task exists and is ours, so the Task load — not the
    // subject lookup — is what decides whether the item gets a link.
    const task = taskId === undefined ? undefined : tasksById.get(taskId);
    return {
      id: intent.id,
      eventType: intent.eventType,
      state: intent.state,
      suppressionReason: intent.suppressionReason,
      actorKind: intent.actorKind,
      occurredAt: toIso(intent.occurredAt),
      settledAt: intent.settledAt === null ? null : toIso(intent.settledAt),
      taskId: task ? task.id : null,
      taskSummaryPoints: task ? task.summaryPoints : null,
    };
  });
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
