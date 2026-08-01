import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONSECUTIVE_AMBIGUOUS_STOP_THRESHOLD,
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  REMINDER_SCHEDULING_TIME_ZONE,
  asAssignmentId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  decideAdvanceReminder,
  hasReachedConsecutiveAmbiguousStop,
  parseLocalDate,
  selectNextOverdueOccurrence,
  type LocalDate,
  type Recipient,
  type Task,
} from '@aicaa/domain';
import {
  claimReminderOccurrence,
  createTask,
  finalizeReminderOccurrence,
  listRecentAmbiguitySequenceOutcomes,
  markProviderCallStarted,
  openNextReminderGeneration,
  persistEstablishedReminderSchedule,
  recordSkippedReminderOccurrence,
  settleReminderOccurrenceSchedule,
  terminalizeExhaustedRetryOccurrence,
  upsertRecipient,
  type PersistedReminderSchedule,
} from '../src/index.js';
import { terminalizeReminderOccurrence } from '../src/transactions/a8-4a-occurrence-transactions.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

/**
 * D129 — three consecutive terminal ambiguous overdue outcomes stop a generation (A8.4b.2).
 *
 * An ambiguous occurrence is one where the transport could not prove whether Gmail accepted the
 * message. A8.4b.1 made those reachable in quantity: every send failure carrying no HTTP status is
 * ambiguous, so a deployment whose path to the provider is broken produces one every morning, each
 * consuming a local calendar day (D106) and each leaving nobody able to say whether the Recipient
 * was reminded. D129 is the stop that turns a silent accumulation of that into an Owner-visible fact.
 *
 * What is under test here is the *derivation*, which is the part that can be subtly wrong: which
 * outcomes extend a run, which break it, which are invisible to it, what "consecutive" means when
 * settlements arrive out of order, and what a generation boundary does to history. The rule is
 * derived from occurrence rows at settlement — there is no counter — so these tests seed real
 * occurrence histories and read the schedule the settlement produced.
 *
 * PGlite, because every property here is single-connection state-machine behaviour. The concurrent
 * proofs — two workers settling the third ambiguity at once, and no fourth claim after the stop —
 * live in `a8-4a-occurrence-concurrency.pg.test.ts` against real PostgreSQL 16.
 */

const org = 'org_a84b2';
const zone = REMINDER_SCHEDULING_TIME_ZONE;
const FOREVER = '2099-01-01T00:00:00.000Z';
const DUE = '2026-08-10';
const ESTABLISHED = '2026-08-01T12:00:00.000Z';

type Occurrence = { readonly occurrenceLocalDate: LocalDate; readonly occurrenceAt: string };
type Outcome = 'success' | 'permanent_failure' | 'ambiguous' | 'skipped';

function recipientFixture(id: string): Recipient {
  return {
    id: asRecipientId(id),
    displayName: 'Alex Recipient',
    email: `${id}@example.com`,
    active: true,
  };
}

function taskFixture(id: string, at: string): Task {
  return {
    id: asTaskId(id),
    organizationId: asOrganizationId(org),
    status: 'open',
    summaryPoints: [{ id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Follow up' }],
    notes: [],
    reminder: { paused: false },
    retention: {},
    version: 1,
    createdAt: at,
    updatedAt: at,
    assignment: {
      id: asAssignmentId(`asg_${id}`),
      recipientId: asRecipientId(`rcp_${id}`),
      intendedRecipientEmail: `rcp_${id}@example.com`,
      assignedAt: at,
      assignedByOwnerId: asOwnerId('owner_1'),
      allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
    },
  };
}

/** The nth overdue occurrence of a generation, from the A8.2 domain rather than hand-typed. */
function overdueOccurrence(dueLocalDate: LocalDate, index: number): Occurrence {
  let cursor = selectNextOverdueOccurrence({ dueLocalDate, now: ESTABLISHED });
  for (let step = 0; step < index; step += 1) {
    cursor = selectNextOverdueOccurrence({
      dueLocalDate,
      now: new Date(Date.parse(cursor.occurrenceAt) + 1).toISOString(),
    });
  }
  return cursor;
}

describe('A8.4b.2 consecutive ambiguous outcomes (D129, PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  async function seedSchedule(key: string): Promise<{
    taskId: string;
    schedule: PersistedReminderSchedule;
    dueLocalDate: LocalDate;
  }> {
    const taskId = `task_${key}`;
    await upsertRecipient(db.prisma, {
      organizationId: org,
      recipient: recipientFixture(`rcp_${taskId}`),
    });
    const task = taskFixture(taskId, ESTABLISHED);
    await createTask(db.prisma, org, task, task.assignment);

    const dueLocalDate = parseLocalDate(DUE);
    const advance = decideAdvanceReminder({ dueLocalDate, establishedAt: ESTABLISHED });
    const first = overdueOccurrence(dueLocalDate, 0);

    const { schedule } = await persistEstablishedReminderSchedule({
      db: db.prisma,
      schedule: {
        id: `sched_${key}`,
        organizationId: org,
        taskId,
        dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt: ESTABLISHED,
        advanceDisposition: advance.kind === 'scheduled' ? 'scheduled' : 'skipped_window_elapsed',
        advanceOccurrence: {
          occurrenceLocalDate: advance.occurrenceLocalDate,
          occurrenceAt: advance.occurrenceAt,
        },
        nextOverdueOccurrence: first,
      },
    });

    return { taskId, schedule, dueLocalDate };
  }

  /**
   * Process one whole overdue occurrence: claim it, then finalize with the given outcome.
   *
   * `index` selects which occurrence of the generation this is, so a test reads as the sequence of
   * mornings it is describing. A skip is written through the skip writer rather than as a finalized
   * outcome, because that is how the worker records one.
   */
  async function morning(
    key: string,
    seeded: { schedule: PersistedReminderSchedule; dueLocalDate: LocalDate },
    index: number,
    outcome: Outcome,
    options: { generation?: number; attempts?: number } = {},
  ) {
    const generation = options.generation ?? seeded.schedule.generation;
    const occurrence = overdueOccurrence(seeded.dueLocalDate, index);
    const next = overdueOccurrence(seeded.dueLocalDate, index + 1);
    const attemptId = `att_${key}_g${generation}_${index}`;

    if (outcome === 'skipped') {
      return recordSkippedReminderOccurrence(db.prisma, {
        id: attemptId,
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: occurrence.occurrenceLocalDate,
        occurrenceAt: occurrence.occurrenceAt,
        skipReason: 'no_actionable_capability',
        recordedAt: occurrence.occurrenceAt,
      });
    }

    const claim = await claimReminderOccurrence(db.prisma, {
      id: attemptId,
      organizationId: org,
      scheduleId: seeded.schedule.id,
      generation,
      occurrenceKind: 'overdue',
      occurrenceLocalDate: occurrence.occurrenceLocalDate,
      occurrenceAt: occurrence.occurrenceAt,
      claimedBy: 'worker_a',
      claimedAt: occurrence.occurrenceAt,
      claimExpiresAt: FOREVER,
      now: occurrence.occurrenceAt,
      maxAttempts: options.attempts ?? 3,
    });
    if (!claim.claimed) throw new Error(`could not claim occurrence ${index}`);

    // Every real send marks the provider call before making it, and A8.4a's
    // `acceptance_implies_started` CHECK enforces that a recorded acceptance had one.
    await markProviderCallStarted(db.prisma, {
      organizationId: org,
      attemptId,
      claimSequence: claim.claimSequence,
      startedAt: occurrence.occurrenceAt,
    });

    return finalizeReminderOccurrence({
      db: db.prisma,
      organizationId: org,
      attemptId,
      scheduleId: seeded.schedule.id,
      claimSequence: claim.claimSequence,
      outcome,
      completedAt: occurrence.occurrenceAt,
      expectedGeneration: generation,
      failureCode: outcome === 'ambiguous' ? 'GMAIL_AMBIGUOUS_SEND' : null,
      providerAcceptedAt: outcome === 'success' ? occurrence.occurrenceAt : null,
      providerMessageRef: outcome === 'success' ? `msg_${index}` : null,
      nextOverdueOccurrence: next,
    });
  }

  /** Run a whole generation's worth of mornings in order and return the final schedule row. */
  async function mornings(key: string, outcomes: readonly Outcome[]) {
    const seeded = await seedSchedule(key);
    for (const [index, outcome] of outcomes.entries()) {
      await morning(key, seeded, index, outcome);
    }
    return { seeded, schedule: await readSchedule(seeded.schedule.id) };
  }

  async function readSchedule(id: string) {
    return db.prisma.taskReminderSchedule.findUniqueOrThrow({ where: { id } });
  }

  async function outcomesFor(scheduleId: string, generation: number) {
    const rows = await db.prisma.reminderDeliveryAttempt.findMany({
      where: { scheduleId, generation },
      orderBy: [{ occurrenceAt: 'asc' }, { id: 'asc' }],
      select: { outcome: true, occurrenceLocalDate: true },
    });
    return rows.map((row) => row.outcome);
  }

  // ---------------------------------------------------------------------------------------------
  // The core sequence
  // ---------------------------------------------------------------------------------------------

  describe('the threshold is the third consecutive ambiguity, not the first or second', () => {
    it('leaves the schedule active and armed after one ambiguous morning', async () => {
      const { schedule } = await mornings('one', ['ambiguous']);

      expect(schedule.status).toBe('active');
      expect(schedule.stopReason).toBeNull();
      expect(schedule.requiresOwnerAttention).toBe(false);
      expect(schedule.nextOverdueOccurrenceAt).not.toBeNull();
    });

    it('leaves the schedule active and armed after two consecutive ambiguous mornings', async () => {
      const { schedule } = await mornings('two', ['ambiguous', 'ambiguous']);

      expect(schedule.status).toBe('active');
      expect(schedule.stopReason).toBeNull();
      expect(schedule.requiresOwnerAttention).toBe(false);
      expect(schedule.nextOverdueOccurrenceAt).not.toBeNull();
    });

    it('stops on the third, with the reason and the Owner flag D129 requires', async () => {
      const seeded = await seedSchedule('three');
      await morning('three', seeded, 0, 'ambiguous');
      await morning('three', seeded, 1, 'ambiguous');
      const third = await morning('three', seeded, 2, 'ambiguous');

      expect(third.repeatedAmbiguityStop).toBe(true);
      const schedule = await readSchedule(seeded.schedule.id);
      expect(schedule.status).toBe('stopped');
      expect(schedule.stopReason).toBe('repeated_ambiguous_outcomes');
      expect(schedule.requiresOwnerAttention).toBe(true);
      expect(schedule.stoppedAt).not.toBeNull();
      // Disarmed, which is what makes the stop bite: nothing is left for a scan to select.
      expect(schedule.nextOverdueOccurrenceAt).toBeNull();
      expect(schedule.nextOverdueOccurrenceLocalDate).toBeNull();
      expect(schedule.claimedBy).toBeNull();
      // Suspension state is not how a stop is expressed. There is no suspended state in D129.
      expect(schedule.suspendedAt).toBeNull();
    });

    it('records the third occurrence as ambiguous and never rewrites it into a failure', async () => {
      const seeded = await seedSchedule('truthful');
      await morning('truthful', seeded, 0, 'ambiguous');
      await morning('truthful', seeded, 1, 'ambiguous');
      await morning('truthful', seeded, 2, 'ambiguous');

      // The stop is a fact about the schedule. What happened to the message stays what happened.
      expect(await outcomesFor(seeded.schedule.id, 1)).toEqual([
        'ambiguous',
        'ambiguous',
        'ambiguous',
      ]);
      const third = await db.prisma.reminderDeliveryAttempt.findUniqueOrThrow({
        where: { id: 'att_truthful_g1_2' },
      });
      expect(third.outcome).toBe('ambiguous');
      expect(third.failureCode).toBe('GMAIL_AMBIGUOUS_SEND');
      expect(third.providerAcceptedAt).toBeNull();
      expect(third.scheduleSettledAt).not.toBeNull();
    });

    it('does not count ambiguity toward the D106 delivery ceiling', async () => {
      const seeded = await seedSchedule('not_delivered');
      await morning('not_delivered', seeded, 0, 'ambiguous');
      await morning('not_delivered', seeded, 1, 'ambiguous');
      await morning('not_delivered', seeded, 2, 'ambiguous');

      // Nothing was proven delivered, so nothing was delivered as far as D106 is concerned.
      expect((await readSchedule(seeded.schedule.id)).overdueDeliveredCount).toBe(0);
    });

    it('stores no ambiguity counter anywhere on the schedule', async () => {
      const seeded = await seedSchedule('no_counter');
      await morning('no_counter', seeded, 0, 'ambiguous');
      await morning('no_counter', seeded, 1, 'ambiguous');

      // The derivation is the only record. Two ambiguities exist in history and nothing on the
      // schedule row says "2" — which is what makes a generation reset need no reset operation.
      const columns = Object.entries(await readSchedule(seeded.schedule.id));
      expect(columns.filter(([name]) => /ambig/i.test(name)).map(([name]) => name)).toEqual([]);
      expect(columns.filter(([, value]) => value === 2).map(([name]) => name)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // What breaks a run, what is invisible to it
  // ---------------------------------------------------------------------------------------------

  describe('a definite outcome breaks the run; a non-delivery is invisible to it', () => {
    it('does not stop when a success interrupts: ambiguous, success, ambiguous, ambiguous', async () => {
      const { schedule } = await mornings('broken_success', [
        'ambiguous',
        'success',
        'ambiguous',
        'ambiguous',
      ]);

      // A message that provably arrived says the path to the provider works. The run restarts at
      // the next ambiguity, and two is not three.
      expect(schedule.status).toBe('active');
      expect(schedule.stopReason).toBeNull();
    });

    it('does not stop when a permanent failure interrupts the run', async () => {
      const seeded = await seedSchedule('broken_permanent');
      await morning('broken_permanent', seeded, 0, 'ambiguous');
      // A permanent failure is itself a stop under existing A8.4a law, so this generation is
      // stopped for `permanent_delivery_failure` before the later ambiguities are even reachable.
      await morning('broken_permanent', seeded, 1, 'permanent_failure');

      const stopped = await readSchedule(seeded.schedule.id);
      expect(stopped.status).toBe('stopped');
      expect(stopped.stopReason).toBe('permanent_delivery_failure');

      // Two more ambiguous occurrences settle against a schedule that has already moved on. They
      // are recorded truthfully and change nothing — including the reason it stopped for.
      await morning('broken_permanent', seeded, 2, 'ambiguous');
      await morning('broken_permanent', seeded, 3, 'ambiguous');

      const after = await readSchedule(seeded.schedule.id);
      expect(after.stopReason).toBe('permanent_delivery_failure');
      expect(after.status).toBe('stopped');
    });

    it('reads a permanent failure as breaking the run even in a pure derivation', async () => {
      // The behavioural test above cannot isolate this, because a permanent failure stops the
      // schedule on its own. The derivation itself must still treat it as a break, so that a
      // permanent failure recorded against a superseded schedule cannot be misread as ambiguity.
      expect(
        hasReachedConsecutiveAmbiguousStop([
          { occurrence: 'overdue', outcome: 'ambiguous' },
          { occurrence: 'overdue', outcome: 'permanent_failure' },
          { occurrence: 'overdue', outcome: 'ambiguous' },
        ]),
      ).toBe(false);
    });

    it('stops across a skipped morning: ambiguous, skipped, ambiguous, ambiguous', async () => {
      const seeded = await seedSchedule('skip_spanning');
      await morning('skip_spanning', seeded, 0, 'ambiguous');
      await morning('skip_spanning', seeded, 1, 'skipped');
      await morning('skip_spanning', seeded, 2, 'ambiguous');
      const third = await morning('skip_spanning', seeded, 3, 'ambiguous');

      // No provider was contacted on the skipped morning, so it says nothing about whether the
      // path to the provider works. Three consecutive ambiguous *deliveries* still happened.
      expect(third.repeatedAmbiguityStop).toBe(true);
      const schedule = await readSchedule(seeded.schedule.id);
      expect(schedule.stopReason).toBe('repeated_ambiguous_outcomes');
    });

    it('ignores skips that precede the run entirely', async () => {
      const seeded = await seedSchedule('skip_leading');
      await morning('skip_leading', seeded, 0, 'skipped');
      await morning('skip_leading', seeded, 1, 'skipped');
      await morning('skip_leading', seeded, 2, 'ambiguous');
      await morning('skip_leading', seeded, 3, 'ambiguous');

      // Two ambiguities and two skips is not three ambiguities.
      expect((await readSchedule(seeded.schedule.id)).status).toBe('active');

      const third = await morning('skip_leading', seeded, 4, 'ambiguous');
      expect(third.repeatedAmbiguityStop).toBe(true);
    });

    it('does not let a retryable attempt count as an outcome or break the run', async () => {
      const seeded = await seedSchedule('retryable_mid');
      await morning('retryable_mid', seeded, 0, 'ambiguous');

      // A retryable failure leaves the occurrence owed rather than finished: the same occurrence is
      // still going to be delivered or not. It must neither extend the run nor break it.
      const occurrence = overdueOccurrence(seeded.dueLocalDate, 1);
      const claim = await claimReminderOccurrence(db.prisma, {
        id: 'att_retryable_mid_g1_1',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: occurrence.occurrenceLocalDate,
        occurrenceAt: occurrence.occurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: occurrence.occurrenceAt,
        claimExpiresAt: FOREVER,
        now: occurrence.occurrenceAt,
        maxAttempts: 3,
      });
      if (!claim.claimed) throw new Error('claim failed');
      await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId: 'att_retryable_mid_g1_1',
        scheduleId: seeded.schedule.id,
        claimSequence: claim.claimSequence,
        outcome: 'retryable_failure',
        completedAt: occurrence.occurrenceAt,
        expectedGeneration: 1,
        failureCode: 'GMAIL_RATE_LIMITED',
        nextOverdueOccurrence: null,
      });

      // Invisible to the derivation: the window still sees only the one finished ambiguity.
      expect(
        await listRecentAmbiguitySequenceOutcomes(db.prisma, {
          organizationId: org,
          scheduleId: seeded.schedule.id,
          generation: 1,
          limit: CONSECUTIVE_AMBIGUOUS_STOP_THRESHOLD,
        }),
      ).toEqual([{ occurrence: 'overdue', outcome: 'ambiguous' }]);
      expect((await readSchedule(seeded.schedule.id)).status).toBe('active');
    });

    it('treats retry-budget exhaustion as the permanent failure it is recorded as', async () => {
      const seeded = await seedSchedule('exhausted');
      const occurrence = overdueOccurrence(seeded.dueLocalDate, 0);
      const claim = await claimReminderOccurrence(db.prisma, {
        id: 'att_exhausted_g1_0',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: occurrence.occurrenceLocalDate,
        occurrenceAt: occurrence.occurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: occurrence.occurrenceAt,
        claimExpiresAt: FOREVER,
        now: occurrence.occurrenceAt,
        // One attempt is the whole budget, so the first retryable failure exhausts it.
        maxAttempts: 1,
      });
      if (!claim.claimed) throw new Error('claim failed');
      await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId: 'att_exhausted_g1_0',
        scheduleId: seeded.schedule.id,
        claimSequence: claim.claimSequence,
        outcome: 'retryable_failure',
        completedAt: occurrence.occurrenceAt,
        expectedGeneration: 1,
        failureCode: 'GMAIL_RATE_LIMITED',
        nextOverdueOccurrence: null,
      });
      await terminalizeExhaustedRetryOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId: 'att_exhausted_g1_0',
        maxAttempts: 1,
        completedAt: occurrence.occurrenceAt,
        now: occurrence.occurrenceAt,
        nextOverdueOccurrence: null,
      });

      // Exhaustion is written as a permanent failure, and D129 counts what was written. Reading it
      // as ambiguity because the attempts along the way were uncertain would be the subtle bug: a
      // schedule could then stop for "we don't know" when it in fact knows delivery kept failing.
      const row = await db.prisma.reminderDeliveryAttempt.findUniqueOrThrow({
        where: { id: 'att_exhausted_g1_0' },
      });
      expect(row.outcome).toBe('permanent_failure');
      expect(
        await listRecentAmbiguitySequenceOutcomes(db.prisma, {
          organizationId: org,
          scheduleId: seeded.schedule.id,
          generation: 1,
          limit: CONSECUTIVE_AMBIGUOUS_STOP_THRESHOLD,
        }),
      ).toEqual([{ occurrence: 'overdue', outcome: 'permanent_failure' }]);
    });

    it('counts one occurrence once however many provider attempts it took', async () => {
      const seeded = await seedSchedule('many_attempts');
      await morning('many_attempts', seeded, 0, 'ambiguous');
      await morning('many_attempts', seeded, 1, 'ambiguous');

      // Third morning, reached on its second attempt after a retryable first.
      const occurrence = overdueOccurrence(seeded.dueLocalDate, 2);
      const attemptId = 'att_many_attempts_g1_2';
      const first = await claimReminderOccurrence(db.prisma, {
        id: attemptId,
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: occurrence.occurrenceLocalDate,
        occurrenceAt: occurrence.occurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: occurrence.occurrenceAt,
        claimExpiresAt: FOREVER,
        now: occurrence.occurrenceAt,
        maxAttempts: 3,
      });
      if (!first.claimed) throw new Error('claim failed');
      await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId,
        scheduleId: seeded.schedule.id,
        claimSequence: first.claimSequence,
        outcome: 'retryable_failure',
        completedAt: occurrence.occurrenceAt,
        expectedGeneration: 1,
        failureCode: 'GMAIL_RATE_LIMITED',
        nextOverdueOccurrence: null,
      });

      const retry = await claimReminderOccurrence(db.prisma, {
        id: attemptId,
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: occurrence.occurrenceLocalDate,
        occurrenceAt: occurrence.occurrenceAt,
        claimedBy: 'worker_b',
        claimedAt: occurrence.occurrenceAt,
        claimExpiresAt: FOREVER,
        now: occurrence.occurrenceAt,
        maxAttempts: 3,
      });
      if (!retry.claimed) throw new Error('reclaim failed');
      const settled = await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId,
        scheduleId: seeded.schedule.id,
        claimSequence: retry.claimSequence,
        outcome: 'ambiguous',
        completedAt: occurrence.occurrenceAt,
        expectedGeneration: 1,
        failureCode: 'GMAIL_AMBIGUOUS_SEND',
        nextOverdueOccurrence: overdueOccurrence(seeded.dueLocalDate, 3),
      });

      // Two provider attempts, one occurrence, third in the run. The row's attempt count proves
      // there were two, and the stop proves the derivation counted the occurrence once.
      const row = await db.prisma.reminderDeliveryAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      expect(row.attemptCount).toBe(2);
      expect(settled.repeatedAmbiguityStop).toBe(true);
      expect((await readSchedule(seeded.schedule.id)).stopReason).toBe(
        'repeated_ambiguous_outcomes',
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Generation scoping
  // ---------------------------------------------------------------------------------------------

  describe('history belongs to a generation and cannot cross into the next', () => {
    /** Open the next generation the way a material Owner due-date change does. */
    async function changeDueDate(
      seeded: Awaited<ReturnType<typeof seedSchedule>>,
      nextDue: string,
    ) {
      const schedule = await readSchedule(seeded.schedule.id);
      const dueLocalDate = parseLocalDate(nextDue);
      const advance = decideAdvanceReminder({ dueLocalDate, establishedAt: ESTABLISHED });
      const opened = await openNextReminderGeneration(db.prisma, {
        organizationId: org,
        taskId: seeded.taskId,
        dueLocalDate,
        schedulingTimeZone: zone,
        expectedGeneration: schedule.generation,
        expectedReminderVersion: schedule.reminderVersion,
        establishedAt: ESTABLISHED,
        status: 'active',
        advanceDisposition: advance.kind === 'scheduled' ? 'scheduled' : 'skipped_window_elapsed',
        advanceOccurrence: {
          occurrenceLocalDate: advance.occurrenceLocalDate,
          occurrenceAt: advance.occurrenceAt,
        },
        nextOverdueOccurrence: selectNextOverdueOccurrence({ dueLocalDate, now: ESTABLISHED }),
      });
      return { ...seeded, schedule: opened, dueLocalDate };
    }

    it('does not stop a new generation carrying two ambiguities from the old one', async () => {
      const seeded = await seedSchedule('gen_split');
      await morning('gen_split', seeded, 0, 'ambiguous');
      await morning('gen_split', seeded, 1, 'ambiguous');

      const next = await changeDueDate(seeded, '2026-09-10');
      expect(next.schedule.generation).toBe(2);
      // The Owner re-scheduled, so the stop state and attention flag from before are cleared.
      expect(next.schedule.stopReason).toBeNull();
      expect(next.schedule.requiresOwnerAttention).toBe(false);

      // The new generation starts from nothing derived, so its first ambiguity is its first.
      expect(
        await listRecentAmbiguitySequenceOutcomes(db.prisma, {
          organizationId: org,
          scheduleId: seeded.schedule.id,
          generation: 2,
          limit: CONSECUTIVE_AMBIGUOUS_STOP_THRESHOLD,
        }),
      ).toEqual([]);

      const third = await morning('gen_split', next, 0, 'ambiguous', { generation: 2 });
      expect(third.repeatedAmbiguityStop).toBe(false);
      expect((await readSchedule(seeded.schedule.id)).status).toBe('active');
    });

    it('stops a new generation only on three of its own ambiguities', async () => {
      const seeded = await seedSchedule('gen_own');
      await morning('gen_own', seeded, 0, 'ambiguous');
      await morning('gen_own', seeded, 1, 'ambiguous');
      const next = await changeDueDate(seeded, '2026-09-10');

      await morning('gen_own', next, 0, 'ambiguous', { generation: 2 });
      await morning('gen_own', next, 1, 'ambiguous', { generation: 2 });
      expect((await readSchedule(seeded.schedule.id)).status).toBe('active');
      const third = await morning('gen_own', next, 2, 'ambiguous', { generation: 2 });

      expect(third.repeatedAmbiguityStop).toBe(true);
      expect((await readSchedule(seeded.schedule.id)).stopReason).toBe(
        'repeated_ambiguous_outcomes',
      );
    });

    it('preserves the old generation history as an audit trail after re-scheduling', async () => {
      const seeded = await seedSchedule('gen_audit');
      await morning('gen_audit', seeded, 0, 'ambiguous');
      await morning('gen_audit', seeded, 1, 'ambiguous');
      await morning('gen_audit', seeded, 2, 'ambiguous');
      expect((await readSchedule(seeded.schedule.id)).stopReason).toBe(
        'repeated_ambiguous_outcomes',
      );

      await changeDueDate(seeded, '2026-09-10');

      // Superseded, never deleted or rewritten (D107, D109). The Owner can still see the three
      // mornings nobody could confirm, even though the schedule is deliverable again.
      expect(await outcomesFor(seeded.schedule.id, 1)).toEqual([
        'ambiguous',
        'ambiguous',
        'ambiguous',
      ]);
    });

    it('does not resume a stopped schedule merely because time passes or work is retried', async () => {
      const seeded = await seedSchedule('no_resume');
      await morning('no_resume', seeded, 0, 'ambiguous');
      await morning('no_resume', seeded, 1, 'ambiguous');
      await morning('no_resume', seeded, 2, 'ambiguous');
      const stopped = await readSchedule(seeded.schedule.id);

      // Re-running settlement against the already-settled third occurrence is the closest thing to
      // a "retry" the system has. Nothing about the stop moves, and no new generation appears.
      const replay = await settleReminderOccurrenceSchedule({
        db: db.prisma,
        organizationId: org,
        attemptId: 'att_no_resume_g1_2',
        settledAt: '2027-01-01T00:00:00.000Z',
        nextOverdueOccurrence: overdueOccurrence(seeded.dueLocalDate, 3),
      });

      expect(replay.alreadySettled).toBe(true);
      expect(replay.repeatedAmbiguityStop).toBe(false);
      const after = await readSchedule(seeded.schedule.id);
      expect(after.status).toBe('stopped');
      expect(after.stopReason).toBe('repeated_ambiguous_outcomes');
      expect(after.generation).toBe(stopped.generation);
      expect(after.reminderVersion).toBe(stopped.reminderVersion);
      expect(after.nextOverdueOccurrenceAt).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Ordering and out-of-order settlement
  // ---------------------------------------------------------------------------------------------

  describe('ordering is by scheduled occurrence, not by when settlement happened to run', () => {
    it('reaches the same verdict when an older occurrence settles last', async () => {
      const seeded = await seedSchedule('late_settlement');

      // Three ambiguous mornings, but the middle one crashes between phase A and phase B and is
      // only swept afterwards — so settlement order is 0, 2, 1 while occurrence order is 0, 1, 2.
      await morning('late_settlement', seeded, 0, 'ambiguous');

      const middle = overdueOccurrence(seeded.dueLocalDate, 1);
      const middleClaim = await claimReminderOccurrence(db.prisma, {
        id: 'att_late_middle',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: middle.occurrenceLocalDate,
        occurrenceAt: middle.occurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: middle.occurrenceAt,
        claimExpiresAt: FOREVER,
        now: middle.occurrenceAt,
        maxAttempts: 3,
      });
      if (!middleClaim.claimed) throw new Error('claim failed');
      // Phase A only: the occurrence is terminal, its schedule effect is still owed.
      await terminalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId: 'att_late_middle',
        scheduleId: seeded.schedule.id,
        claimSequence: middleClaim.claimSequence,
        outcome: 'ambiguous',
        completedAt: middle.occurrenceAt,
        expectedGeneration: 1,
        failureCode: 'GMAIL_AMBIGUOUS_SEND',
        nextOverdueOccurrence: null,
      });

      const third = await morning('late_settlement', seeded, 2, 'ambiguous');

      // The third occurrence is the third ambiguity by occurrence identity regardless of the fact
      // that the second has not been settled yet: what the run counts is what happened, not what
      // has been bookkept. Ordering by `completed_at` would have produced the same answer here, but
      // ordering by settlement time would have made the sweep below look like the newest event.
      expect(third.repeatedAmbiguityStop).toBe(true);
      expect((await readSchedule(seeded.schedule.id)).stopReason).toBe(
        'repeated_ambiguous_outcomes',
      );

      // Now the sweep collects the middle occurrence's debt, long after. It must not double-stop,
      // reorder the run, or disturb the stop already recorded.
      const swept = await settleReminderOccurrenceSchedule({
        db: db.prisma,
        organizationId: org,
        attemptId: 'att_late_middle',
        settledAt: '2026-12-01T00:00:00.000Z',
        nextOverdueOccurrence: overdueOccurrence(seeded.dueLocalDate, 2),
      });
      expect(swept.repeatedAmbiguityStop).toBe(false);
      const after = await readSchedule(seeded.schedule.id);
      expect(after.stopReason).toBe('repeated_ambiguous_outcomes');
      expect(after.nextOverdueOccurrenceAt).toBeNull();
    });

    it('orders deterministically when completion instants are identical', async () => {
      const seeded = await seedSchedule('same_instant');
      // Every morning here is finalized at the same wall-clock instant, which is exactly the case
      // a `completed_at` ordering cannot resolve. Occurrence identity still totally orders them.
      const at = '2026-08-20T09:00:00.000Z';
      for (const index of [0, 1, 2]) {
        const occurrence = overdueOccurrence(seeded.dueLocalDate, index);
        const attemptId = `att_same_instant_${index}`;
        const claim = await claimReminderOccurrence(db.prisma, {
          id: attemptId,
          organizationId: org,
          scheduleId: seeded.schedule.id,
          generation: 1,
          occurrenceKind: 'overdue',
          occurrenceLocalDate: occurrence.occurrenceLocalDate,
          occurrenceAt: occurrence.occurrenceAt,
          claimedBy: 'worker_a',
          claimedAt: at,
          claimExpiresAt: FOREVER,
          now: at,
          maxAttempts: 3,
        });
        if (!claim.claimed) throw new Error('claim failed');
        await finalizeReminderOccurrence({
          db: db.prisma,
          organizationId: org,
          attemptId,
          scheduleId: seeded.schedule.id,
          claimSequence: claim.claimSequence,
          outcome: 'ambiguous',
          completedAt: at,
          expectedGeneration: 1,
          failureCode: 'GMAIL_AMBIGUOUS_SEND',
          nextOverdueOccurrence: overdueOccurrence(seeded.dueLocalDate, index + 1),
        });
      }

      expect((await readSchedule(seeded.schedule.id)).stopReason).toBe(
        'repeated_ambiguous_outcomes',
      );
    });

    it('reads only the newest window, so older history cannot revive a broken run', async () => {
      const seeded = await seedSchedule('window');
      await morning('window', seeded, 0, 'ambiguous');
      await morning('window', seeded, 1, 'ambiguous');
      await morning('window', seeded, 2, 'success');

      // Three ambiguities exist in this generation later on, but not three *consecutive* ones, and
      // the bounded window is what enforces that: it never looks past the success.
      await morning('window', seeded, 3, 'ambiguous');
      await morning('window', seeded, 4, 'ambiguous');
      expect((await readSchedule(seeded.schedule.id)).status).toBe('active');

      expect(
        await listRecentAmbiguitySequenceOutcomes(db.prisma, {
          organizationId: org,
          scheduleId: seeded.schedule.id,
          generation: 1,
          limit: CONSECUTIVE_AMBIGUOUS_STOP_THRESHOLD,
        }),
      ).toEqual([
        { occurrence: 'overdue', outcome: 'ambiguous' },
        { occurrence: 'overdue', outcome: 'ambiguous' },
        { occurrence: 'overdue', outcome: 'success' },
      ]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Idempotency and precedence
  // ---------------------------------------------------------------------------------------------

  describe('the stop happens once and never overwrites an earlier authoritative one', () => {
    it('does not re-apply when the third occurrence is settled again', async () => {
      const seeded = await seedSchedule('idempotent');
      await morning('idempotent', seeded, 0, 'ambiguous');
      await morning('idempotent', seeded, 1, 'ambiguous');
      await morning('idempotent', seeded, 2, 'ambiguous');
      const first = await readSchedule(seeded.schedule.id);

      const replay = await settleReminderOccurrenceSchedule({
        db: db.prisma,
        organizationId: org,
        attemptId: 'att_idempotent_g1_2',
        settledAt: '2026-09-01T00:00:00.000Z',
        nextOverdueOccurrence: null,
      });

      expect(replay.alreadySettled).toBe(true);
      const after = await readSchedule(seeded.schedule.id);
      // The version is the tell: a second stop would have incremented it.
      expect(after.reminderVersion).toBe(first.reminderVersion);
      expect(after.stoppedAt?.toISOString()).toBe(first.stoppedAt?.toISOString());
    });

    it('leaves a schedule stopped for completion alone when a late ambiguity settles', async () => {
      const seeded = await seedSchedule('precedence');
      await morning('precedence', seeded, 0, 'ambiguous');
      await morning('precedence', seeded, 1, 'ambiguous');

      // The Owner completes the Task before the third morning settles.
      await db.prisma.taskReminderSchedule.update({
        where: { id: seeded.schedule.id },
        data: {
          status: 'stopped',
          stopReason: 'task_completed',
          stoppedAt: new Date('2026-08-19T00:00:00.000Z'),
          nextOverdueOccurrenceLocalDate: null,
          nextOverdueOccurrenceAt: null,
        },
      });

      const third = await morning('precedence', seeded, 2, 'ambiguous');

      // The third ambiguity is recorded truthfully, the threshold is genuinely reached, and the
      // schedule keeps the reason it actually stopped for. "The Owner finished it" outranks
      // "we could not confirm three sends", and rewriting it would tell the Owner to investigate a
      // Task they already closed.
      expect(third.repeatedAmbiguityStop).toBe(false);
      const after = await readSchedule(seeded.schedule.id);
      expect(after.stopReason).toBe('task_completed');
      expect(
        (
          await db.prisma.reminderDeliveryAttempt.findUniqueOrThrow({
            where: { id: 'att_precedence_g1_2' },
          })
        ).outcome,
      ).toBe('ambiguous');
    });

    it('leaves a suspended schedule untouched, without stopping it', async () => {
      const seeded = await seedSchedule('suspended');
      await morning('suspended', seeded, 0, 'ambiguous');
      await morning('suspended', seeded, 1, 'ambiguous');

      await db.prisma.taskReminderSchedule.update({
        where: { id: seeded.schedule.id },
        data: {
          status: 'suspended_waiting',
          suspendedAt: new Date('2026-08-19T00:00:00.000Z'),
          nextOverdueOccurrenceLocalDate: null,
          nextOverdueOccurrenceAt: null,
        },
      });

      const third = await morning('suspended', seeded, 2, 'ambiguous');

      // Every stop in this module is conditional on `active`. A Waiting schedule is not stopped by
      // a settlement arriving late; the resume path owns what happens next.
      expect(third.repeatedAmbiguityStop).toBe(false);
      const after = await readSchedule(seeded.schedule.id);
      expect(after.status).toBe('suspended_waiting');
      expect(after.stopReason).toBeNull();
    });
  });
});
