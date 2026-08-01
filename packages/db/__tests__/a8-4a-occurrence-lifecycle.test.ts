import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  REMINDER_SCHEDULING_TIME_ZONE,
  addLocalDays,
  asAssignmentId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  decideAdvanceReminder,
  parseLocalDate,
  selectNextOverdueOccurrence,
  type LocalDate,
  type Recipient,
  type Task,
} from '@aicaa/domain';
import {
  PersistenceError,
  claimReminderOccurrence,
  createTask,
  finalizeAbandonedInFlightOccurrence,
  finalizeReminderOccurrence,
  hasTerminalAdvanceOccurrence,
  listExpiredOccurrenceClaims,
  listDueReminderSchedulesGlobally,
  listRetryBudgetExhaustedOccurrences,
  listUnsettledTerminalOccurrences,
  markProviderCallStarted,
  openNextReminderGeneration,
  persistEstablishedReminderSchedule,
  recordSkippedReminderOccurrence,
  releaseReminderOccurrenceClaim,
  RETRY_BUDGET_EXHAUSTED_FAILURE_CODE,
  settleReminderOccurrenceSchedule,
  stopReminderSchedule,
  suspendReminderScheduleForWaiting,
  terminalizeExhaustedRetryOccurrence,
  upsertRecipient,
  type PersistedReminderSchedule,
} from '../src/index.js';
// Phase A on its own is deliberately absent from the barrel (A8.4a audit H1): a caller that ran it
// and stopped would leave settlement debt only the sweep would notice. These tests reach into the
// module directly, precisely to prove the phases are separable.
import { terminalizeReminderOccurrence } from '../src/transactions/a8-4a-occurrence-transactions.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

/**
 * A8.4a occurrence claim lifecycle and safe finalization (audit F1, F2, F7, F8; re-audit A-A).
 *
 * The A8.3a audit found two defects that only became reachable once a worker existed. F1: a
 * successful external delivery could be *rolled back* if the Owner changed the schedule while the
 * provider call was in flight — the send had happened, the row saying so had not. F2: the occurrence
 * table could not tell a live claim from an abandoned one, so a worker that died mid-occurrence
 * froze that morning's reminder permanently.
 *
 * These tests are the regression floor for both. They run on PGlite because every property here is
 * a single-connection state-machine property; the multi-connection contention proofs live in
 * `a8-4a-occurrence-concurrency.test.ts` against real PostgreSQL 16.
 */

const org = 'org_a84a';
const zone = REMINDER_SCHEDULING_TIME_ZONE;
const FOREVER = '2099-01-01T00:00:00.000Z';

function recipientFixture(id: string): Recipient {
  return {
    id: asRecipientId(id),
    displayName: 'Alex Recipient',
    email: `${id}@example.com`,
    active: true,
  };
}

function taskFixture(id: string, organizationId: string, at: string): Task {
  return {
    id: asTaskId(id),
    organizationId: asOrganizationId(organizationId),
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

describe('A8.4a occurrence lifecycle (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  /**
   * An active schedule with one armed overdue occurrence, ready to claim.
   *
   * Occurrences come from the A8.2 domain rather than being hand-typed, so a disagreement between
   * the scheduling rules and what these tests process fails here rather than in production.
   */
  async function seedSchedule(
    key: string,
    options: { dueLocalDate?: string; establishedAt?: string } = {},
  ): Promise<{
    taskId: string;
    schedule: PersistedReminderSchedule;
    overdue: { occurrenceLocalDate: LocalDate; occurrenceAt: string };
    advance: { occurrenceLocalDate: LocalDate; occurrenceAt: string } | null;
  }> {
    const taskId = `task_${key}`;
    const establishedAt = options.establishedAt ?? '2026-08-01T12:00:00.000Z';
    await upsertRecipient(db.prisma, {
      organizationId: org,
      recipient: recipientFixture(`rcp_${taskId}`),
    });
    const task = taskFixture(taskId, org, establishedAt);
    await createTask(db.prisma, org, task, task.assignment);

    const dueLocalDate = parseLocalDate(options.dueLocalDate ?? '2026-08-10');
    const advance = decideAdvanceReminder({ dueLocalDate, establishedAt });
    const nextOverdue = selectNextOverdueOccurrence({ dueLocalDate, now: establishedAt });

    const { schedule } = await persistEstablishedReminderSchedule({
      db: db.prisma,
      schedule: {
        id: `sched_${key}`,
        organizationId: org,
        taskId,
        dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt,
        advanceDisposition: advance.kind === 'scheduled' ? 'scheduled' : 'skipped_window_elapsed',
        advanceOccurrence: {
          occurrenceLocalDate: advance.occurrenceLocalDate,
          occurrenceAt: advance.occurrenceAt,
        },
        nextOverdueOccurrence: {
          occurrenceLocalDate: nextOverdue.occurrenceLocalDate,
          occurrenceAt: nextOverdue.occurrenceAt,
        },
      },
    });

    return {
      taskId,
      schedule,
      overdue: nextOverdue,
      advance: advance.kind === 'scheduled' ? advance : null,
    };
  }

  /** Claim the armed overdue occurrence of a seeded schedule. */
  async function claimOverdue(
    key: string,
    seeded: Awaited<ReturnType<typeof seedSchedule>>,
    options: {
      claimedBy?: string;
      claimedAt?: string;
      claimExpiresAt?: string;
      now?: string;
      maxAttempts?: number;
    } = {},
  ) {
    const at = options.claimedAt ?? seeded.overdue.occurrenceAt;
    return claimReminderOccurrence(db.prisma, {
      id: `att_${key}`,
      organizationId: org,
      scheduleId: seeded.schedule.id,
      generation: seeded.schedule.generation,
      occurrenceKind: 'overdue',
      occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
      occurrenceAt: seeded.overdue.occurrenceAt,
      claimedBy: options.claimedBy ?? 'worker_a',
      claimedAt: at,
      claimExpiresAt: options.claimExpiresAt ?? FOREVER,
      now: options.now ?? at,
      maxAttempts: options.maxAttempts ?? 3,
    });
  }

  async function readSchedule(id: string) {
    const row = await db.prisma.taskReminderSchedule.findUniqueOrThrow({ where: { id } });
    return row;
  }

  // ---------------------------------------------------------------------------------------------
  // F2 — claim, reclaim, fencing, expiry
  // ---------------------------------------------------------------------------------------------

  describe('F2: the claim is a bounded lease with a fencing token', () => {
    it('grants sequence 1 with an owner, an acquisition time, and an expiry', async () => {
      const seeded = await seedSchedule('claim_first');
      const claim = await claimOverdue('claim_first', seeded, {
        claimedAt: '2026-08-11T16:00:00.000Z',
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });

      expect(claim.claimed).toBe(true);
      if (!claim.claimed) return;
      expect(claim.claimSequence).toBe(1);
      expect(claim.attempt.outcome).toBe('claimed');
      expect(claim.attempt.claimedBy).toBe('worker_a');
      expect(claim.attempt.claimedAt).toBe('2026-08-11T16:00:00.000Z');
      expect(claim.attempt.claimExpiresAt).toBe('2026-08-11T16:05:00.000Z');
      expect(claim.attempt.attemptCount).toBe(1);
      expect(claim.attempt.providerCallStartedAt).toBeNull();
    });

    it('refuses a live lease without disturbing it', async () => {
      const seeded = await seedSchedule('claim_live');
      await claimOverdue('claim_live', seeded, {
        claimedBy: 'worker_a',
        claimedAt: '2026-08-11T16:00:00.000Z',
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });

      const second = await claimReminderOccurrence(db.prisma, {
        id: 'att_claim_live_b',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: seeded.schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
        occurrenceAt: seeded.overdue.occurrenceAt,
        claimedBy: 'worker_b',
        claimedAt: '2026-08-11T16:01:00.000Z',
        claimExpiresAt: '2026-08-11T16:06:00.000Z',
        now: '2026-08-11T16:01:00.000Z',
        maxAttempts: 3,
      });

      expect(second.claimed).toBe(false);
      if (second.claimed) return;
      expect(second.reason).toBe('lease_held');
      // The loser is handed the winner's row, not a second identity for the same morning (D109).
      expect(second.attempt.id).toBe('att_claim_live');
      expect(second.attempt.claimedBy).toBe('worker_a');
      expect(second.attempt.claimSequence).toBe(1);
    });

    it('reclaims an expired pre-provider lease, advancing the fence and the attempt count', async () => {
      const seeded = await seedSchedule('claim_expired');
      await claimOverdue('claim_expired', seeded, {
        claimedBy: 'worker_a',
        claimedAt: '2026-08-11T16:00:00.000Z',
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });

      const reclaim = await claimReminderOccurrence(db.prisma, {
        id: 'att_claim_expired_b',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: seeded.schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
        occurrenceAt: seeded.overdue.occurrenceAt,
        claimedBy: 'worker_b',
        claimedAt: '2026-08-11T16:06:00.000Z',
        claimExpiresAt: '2026-08-11T16:11:00.000Z',
        // Past the first lease's expiry.
        now: '2026-08-11T16:06:00.000Z',
        maxAttempts: 3,
      });

      expect(reclaim.claimed).toBe(true);
      if (!reclaim.claimed) return;
      expect(reclaim.claimSequence).toBe(2);
      // Reuses the row. A retry is the same logical occurrence, not a second one (D109).
      expect(reclaim.attempt.id).toBe('att_claim_expired');
      expect(reclaim.attempt.claimedBy).toBe('worker_b');
      expect(reclaim.attempt.attemptCount).toBe(2);
    });

    it('refuses to reclaim an expired lease whose transport call had started', async () => {
      const seeded = await seedSchedule('claim_inflight');
      const claim = await claimOverdue('claim_inflight', seeded, {
        claimedAt: '2026-08-11T16:00:00.000Z',
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        startedAt: '2026-08-11T16:00:02.000Z',
      });

      const reclaim = await claimReminderOccurrence(db.prisma, {
        id: 'att_claim_inflight_b',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: seeded.schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
        occurrenceAt: seeded.overdue.occurrenceAt,
        claimedBy: 'worker_b',
        claimedAt: '2026-08-11T16:30:00.000Z',
        claimExpiresAt: '2026-08-11T16:35:00.000Z',
        now: '2026-08-11T16:30:00.000Z',
        maxAttempts: 3,
      });

      expect(reclaim.claimed).toBe(false);
      if (reclaim.claimed) return;
      // The distinction that prevents a duplicate reminder: the provider may hold the message.
      expect(reclaim.reason).toBe('in_flight_unknown');
    });

    it('refuses to reclaim a terminal occurrence', async () => {
      const seeded = await seedSchedule('claim_terminal');
      const claim = await claimOverdue('claim_terminal', seeded);
      await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        scheduleId: seeded.schedule.id,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        expectedGeneration: seeded.schedule.generation,
        outcome: 'skipped',
        skipReason: 'task_not_eligible',
        completedAt: '2026-08-11T16:00:05.000Z',
        nextOverdueOccurrence: null,
      });

      const again = await claimReminderOccurrence(db.prisma, {
        id: 'att_claim_terminal_b',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: seeded.schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
        occurrenceAt: seeded.overdue.occurrenceAt,
        claimedBy: 'worker_b',
        claimedAt: '2026-08-11T17:00:00.000Z',
        claimExpiresAt: FOREVER,
        now: '2026-08-11T17:00:00.000Z',
        maxAttempts: 3,
      });

      expect(again.claimed).toBe(false);
      if (again.claimed) return;
      expect(again.reason).toBe('already_terminal');
    });

    it('stops retrying a retryable failure once the budget is exhausted', async () => {
      const seeded = await seedSchedule('claim_budget');
      let sequence = 0;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const claim = await claimReminderOccurrence(db.prisma, {
          id: 'att_claim_budget',
          organizationId: org,
          scheduleId: seeded.schedule.id,
          generation: seeded.schedule.generation,
          occurrenceKind: 'overdue',
          occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
          occurrenceAt: seeded.overdue.occurrenceAt,
          claimedBy: `worker_${attempt}`,
          claimedAt: `2026-08-11T1${attempt}:00:00.000Z`,
          claimExpiresAt: FOREVER,
          now: `2026-08-11T1${attempt}:00:00.000Z`,
          maxAttempts: 2,
        });
        expect(claim.claimed).toBe(true);
        if (!claim.claimed) return;
        sequence = claim.claimSequence;
        await finalizeReminderOccurrence({
          db: db.prisma,
          organizationId: org,
          scheduleId: seeded.schedule.id,
          attemptId: claim.attempt.id,
          claimSequence: sequence,
          expectedGeneration: seeded.schedule.generation,
          outcome: 'retryable_failure',
          failureCode: 'TRANSPORT_UNAVAILABLE',
          completedAt: `2026-08-11T1${attempt}:00:05.000Z`,
          nextOverdueOccurrence: null,
        });
      }

      const exhausted = await claimReminderOccurrence(db.prisma, {
        id: 'att_claim_budget',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: seeded.schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
        occurrenceAt: seeded.overdue.occurrenceAt,
        claimedBy: 'worker_3',
        claimedAt: '2026-08-11T13:00:00.000Z',
        claimExpiresAt: FOREVER,
        now: '2026-08-11T13:00:00.000Z',
        maxAttempts: 2,
      });

      expect(exhausted.claimed).toBe(false);
      if (exhausted.claimed) return;
      expect(exhausted.reason).toBe('retry_budget_exhausted');
      // Still exactly one row for this occurrence, across all three attempts.
      const rows = await db.prisma.reminderDeliveryAttempt.count({
        where: { scheduleId: seeded.schedule.id },
      });
      expect(rows).toBe(1);
    });
  });

  describe('F2: a stale claimant cannot act on a successor claim', () => {
    it('refuses to finalize at a superseded sequence', async () => {
      const seeded = await seedSchedule('stale_finalize');
      await claimOverdue('stale_finalize', seeded, {
        claimedAt: '2026-08-11T16:00:00.000Z',
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });
      const successor = await claimReminderOccurrence(db.prisma, {
        id: 'att_stale_finalize_b',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: seeded.schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
        occurrenceAt: seeded.overdue.occurrenceAt,
        claimedBy: 'worker_b',
        claimedAt: '2026-08-11T16:06:00.000Z',
        claimExpiresAt: FOREVER,
        now: '2026-08-11T16:06:00.000Z',
        maxAttempts: 3,
      });
      expect(successor.claimed).toBe(true);

      await expect(
        finalizeReminderOccurrence({
          db: db.prisma,
          organizationId: org,
          scheduleId: seeded.schedule.id,
          attemptId: 'att_stale_finalize',
          // The lease worker A was granted, which worker B has since superseded.
          claimSequence: 1,
          expectedGeneration: seeded.schedule.generation,
          outcome: 'permanent_failure',
          failureCode: 'STALE',
          completedAt: '2026-08-11T16:07:00.000Z',
          nextOverdueOccurrence: null,
        }),
      ).rejects.toThrow(PersistenceError);

      const row = await db.prisma.reminderDeliveryAttempt.findUniqueOrThrow({
        where: { id: 'att_stale_finalize' },
      });
      expect(row.outcome).toBe('claimed');
      expect(row.claimedBy).toBe('worker_b');
      expect(row.claimSequence).toBe(2);
    });

    it('refuses to release at a superseded sequence', async () => {
      const seeded = await seedSchedule('stale_release');
      await claimOverdue('stale_release', seeded, {
        claimedAt: '2026-08-11T16:00:00.000Z',
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });
      await claimReminderOccurrence(db.prisma, {
        id: 'att_stale_release_b',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: seeded.schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
        occurrenceAt: seeded.overdue.occurrenceAt,
        claimedBy: 'worker_b',
        claimedAt: '2026-08-11T16:06:00.000Z',
        claimExpiresAt: FOREVER,
        now: '2026-08-11T16:06:00.000Z',
        maxAttempts: 3,
      });

      await expect(
        releaseReminderOccurrenceClaim({
          db: db.prisma,
          organizationId: org,
          attemptId: 'att_stale_release',
          claimSequence: 1,
        }),
      ).rejects.toThrow(PersistenceError);

      const row = await db.prisma.reminderDeliveryAttempt.findUniqueOrThrow({
        where: { id: 'att_stale_release' },
      });
      expect(row.claimedBy).toBe('worker_b');
      expect(row.claimExpiresAt).not.toBeNull();
    });

    it('refuses to mark a transport call started at a superseded sequence', async () => {
      const seeded = await seedSchedule('stale_start');
      await claimOverdue('stale_start', seeded, {
        claimedAt: '2026-08-11T16:00:00.000Z',
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });
      await claimReminderOccurrence(db.prisma, {
        id: 'att_stale_start_b',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: seeded.schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
        occurrenceAt: seeded.overdue.occurrenceAt,
        claimedBy: 'worker_b',
        claimedAt: '2026-08-11T16:06:00.000Z',
        claimExpiresAt: FOREVER,
        now: '2026-08-11T16:06:00.000Z',
        maxAttempts: 3,
      });

      await expect(
        markProviderCallStarted(db.prisma, {
          organizationId: org,
          attemptId: 'att_stale_start',
          claimSequence: 1,
          startedAt: '2026-08-11T16:07:00.000Z',
        }),
      ).rejects.toThrow(PersistenceError);

      const row = await db.prisma.reminderDeliveryAttempt.findUniqueOrThrow({
        where: { id: 'att_stale_start' },
      });
      expect(row.providerCallStartedAt).toBeNull();
    });

    it('releases cleanly at the owned sequence, returning the occurrence to the pool', async () => {
      const seeded = await seedSchedule('release_ok');
      const claim = await claimOverdue('release_ok', seeded);
      await releaseReminderOccurrenceClaim({
        db: db.prisma,
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: 1,
      });

      const row = await db.prisma.reminderDeliveryAttempt.findUniqueOrThrow({
        where: { id: claim.attempt.id },
      });
      expect(row.claimedBy).toBeNull();
      expect(row.claimedAt).toBeNull();
      expect(row.claimExpiresAt).toBeNull();
      // Still `claimed`, and still sequence 1: releasing is not finalizing.
      expect(row.outcome).toBe('claimed');
      expect(row.claimSequence).toBe(1);
    });

    it('refuses to release an occurrence whose transport call had started', async () => {
      const seeded = await seedSchedule('release_inflight');
      const claim = await claimOverdue('release_inflight', seeded);
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        startedAt: '2026-08-11T16:00:02.000Z',
      });

      await expect(
        releaseReminderOccurrenceClaim({
          db: db.prisma,
          organizationId: org,
          attemptId: claim.attempt.id,
          claimSequence: 1,
        }),
      ).rejects.toThrow(PersistenceError);
    });
  });

  describe('F2: expired claims are visible to the recovery sweep', () => {
    it('lists only expired claims, oldest first, and classifies them by provider start', async () => {
      const pre = await seedSchedule('sweep_pre');
      const inFlight = await seedSchedule('sweep_inflight');
      const live = await seedSchedule('sweep_live');

      await claimOverdue('sweep_pre', pre, {
        claimedAt: '2026-08-11T16:00:00.000Z',
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });
      const flying = await claimOverdue('sweep_inflight', inFlight, {
        claimedAt: '2026-08-11T16:01:00.000Z',
        claimExpiresAt: '2026-08-11T16:06:00.000Z',
      });
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: flying.attempt.id,
        claimSequence: 1,
        startedAt: '2026-08-11T16:01:02.000Z',
      });
      await claimOverdue('sweep_live', live, {
        claimedAt: '2026-08-11T16:02:00.000Z',
        claimExpiresAt: FOREVER,
      });

      const expired = await listExpiredOccurrenceClaims(db.prisma, {
        now: '2026-08-11T16:30:00.000Z',
        limit: 50,
      });
      const ids = expired.map((row) => row.id);
      expect(ids).toContain('att_sweep_pre');
      expect(ids).toContain('att_sweep_inflight');
      expect(ids).not.toContain('att_sweep_live');
      // Ordered by expiry so the longest-abandoned occurrence is recovered first.
      expect(ids.indexOf('att_sweep_pre')).toBeLessThan(ids.indexOf('att_sweep_inflight'));

      const preRow = expired.find((row) => row.id === 'att_sweep_pre');
      const flightRow = expired.find((row) => row.id === 'att_sweep_inflight');
      expect(preRow?.providerCallStartedAt).toBeNull();
      expect(flightRow?.providerCallStartedAt).not.toBeNull();
      // Organization travels on the row, which is what makes the global scan safe (F11).
      expect(preRow?.organizationId).toBe(org);
    });

    it('rejects an unbounded recovery limit', async () => {
      await expect(
        listExpiredOccurrenceClaims(db.prisma, { now: '2026-08-11T16:30:00.000Z', limit: 0 }),
      ).rejects.toThrow(PersistenceError);
      await expect(
        listExpiredOccurrenceClaims(db.prisma, { now: '2026-08-11T16:30:00.000Z', limit: 5000 }),
      ).rejects.toThrow(PersistenceError);
    });

    it('finalizes an abandoned in-flight occurrence ambiguous, and never retries it', async () => {
      const seeded = await seedSchedule('ambiguous');
      const claim = await claimOverdue('ambiguous', seeded, {
        claimedAt: '2026-08-11T16:00:00.000Z',
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        startedAt: '2026-08-11T16:00:02.000Z',
      });

      const nextAfterRecovery = selectNextOverdueOccurrence({
        dueLocalDate: seeded.schedule.dueLocalDate,
        now: '2026-08-11T16:30:00.000Z',
      });
      const finalized = await finalizeAbandonedInFlightOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId: claim.attempt.id,
        scheduleId: seeded.schedule.id,
        claimSequence: 1,
        completedAt: '2026-08-11T16:30:00.000Z',
        expectedGeneration: seeded.schedule.generation,
        nextOverdueOccurrence: nextAfterRecovery,
      });

      expect(finalized.attempt.outcome).toBe('ambiguous');
      expect(finalized.attempt.failureCode).toBe('lease_expired_in_flight');
      // Ambiguity is not success: nothing may claim the provider accepted a message when that is
      // precisely what is unknown, and the D106 count stays untouched.
      expect(finalized.attempt.providerAcceptedAt).toBeNull();
      expect(finalized.counted).toBe(false);
      const afterRecovery = await readSchedule(seeded.schedule.id);
      expect(afterRecovery.overdueDeliveredCount).toBe(0);
      // B1: consuming this occurrence is not the same act as ending the series. The schedule stays
      // active *and* armed, which is what the audit found recovery silently failed to do.
      expect(afterRecovery.status).toBe('active');
      expect(afterRecovery.stopReason).toBeNull();
      expect(afterRecovery.nextOverdueOccurrenceAt?.toISOString()).toBe(
        nextAfterRecovery.occurrenceAt,
      );

      // And the local day is consumed: no further claim of this occurrence is possible.
      const retry = await claimReminderOccurrence(db.prisma, {
        id: 'att_ambiguous_b',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: seeded.schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
        occurrenceAt: seeded.overdue.occurrenceAt,
        claimedBy: 'worker_b',
        claimedAt: '2026-08-11T17:00:00.000Z',
        claimExpiresAt: FOREVER,
        now: '2026-08-11T17:00:00.000Z',
        maxAttempts: 3,
      });
      expect(retry.claimed).toBe(false);
      if (retry.claimed) return;
      expect(retry.reason).toBe('already_terminal');

      // The sweep is done with it.
      const stillExpired = await listExpiredOccurrenceClaims(db.prisma, {
        now: '2026-08-11T18:00:00.000Z',
        limit: 50,
      });
      expect(stillExpired.map((row) => row.id)).not.toContain(claim.attempt.id);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // F1 — a recorded delivery survives every schedule change
  // ---------------------------------------------------------------------------------------------

  describe('F1: an accepted delivery is never rolled back by a schedule change', () => {
    /**
     * The audit's exact scenario, four ways. In each: the occurrence is claimed, the transport call
     * starts, the schedule moves underneath, and only then does finalization run. Before the fix
     * the compare-and-set threw and took the delivery record down with it.
     */
    const MUTATIONS = [
      {
        name: 'the Task went Waiting mid-call',
        mutate: async (seeded: Awaited<ReturnType<typeof seedSchedule>>) => {
          await suspendReminderScheduleForWaiting(db.prisma, {
            organizationId: org,
            scheduleId: seeded.schedule.id,
            suspendedAt: '2026-08-11T16:00:03.000Z',
          });
        },
        expectStatus: 'suspended_waiting',
      },
      {
        name: 'the Task completed mid-call',
        mutate: async (seeded: Awaited<ReturnType<typeof seedSchedule>>) => {
          await stopReminderSchedule(db.prisma, {
            organizationId: org,
            scheduleId: seeded.schedule.id,
            reason: 'task_completed',
            stoppedAt: '2026-08-11T16:00:03.000Z',
          });
        },
        expectStatus: 'stopped',
      },
      {
        name: 'the due date was removed mid-call',
        mutate: async (seeded: Awaited<ReturnType<typeof seedSchedule>>) => {
          await stopReminderSchedule(db.prisma, {
            organizationId: org,
            scheduleId: seeded.schedule.id,
            reason: 'due_date_removed',
            stoppedAt: '2026-08-11T16:00:03.000Z',
          });
        },
        expectStatus: 'stopped',
      },
      {
        name: 'the Task was dismissed mid-call',
        mutate: async (seeded: Awaited<ReturnType<typeof seedSchedule>>) => {
          await stopReminderSchedule(db.prisma, {
            organizationId: org,
            scheduleId: seeded.schedule.id,
            reason: 'task_dismissed',
            stoppedAt: '2026-08-11T16:00:03.000Z',
          });
        },
        expectStatus: 'stopped',
      },
    ] as const;

    for (const [index, scenario] of MUTATIONS.entries()) {
      it(`records the success in full when ${scenario.name}`, async () => {
        const key = `f1_mut${index}`;
        const seeded = await seedSchedule(key);
        const claim = await claimOverdue(key, seeded);
        await markProviderCallStarted(db.prisma, {
          organizationId: org,
          attemptId: claim.attempt.id,
          claimSequence: 1,
          startedAt: '2026-08-11T16:00:02.000Z',
        });

        await scenario.mutate(seeded);

        const finalized = await finalizeReminderOccurrence({
          db: db.prisma,
          organizationId: org,
          scheduleId: seeded.schedule.id,
          attemptId: claim.attempt.id,
          claimSequence: 1,
          expectedGeneration: seeded.schedule.generation,
          outcome: 'success',
          completedAt: '2026-08-11T16:00:05.000Z',
          providerAcceptedAt: '2026-08-11T16:00:04.000Z',
          providerMessageRef: 'ref_1',
          nextOverdueOccurrence: {
            occurrenceLocalDate: addLocalDays(seeded.overdue.occurrenceLocalDate, 1),
            occurrenceAt: '2026-08-12T16:00:00.000Z',
          },
        });

        // The message left the building, so the row says so — unconditionally.
        expect(finalized.attempt.outcome).toBe('success');
        expect(finalized.attempt.providerAcceptedAt).toBe('2026-08-11T16:00:04.000Z');
        expect(finalized.attempt.providerMessageRef).toBe('ref_1');
        // But the schedule had moved on, so nothing was counted and nothing was armed.
        expect(finalized.counted).toBe(false);
        expect(finalized.scheduleAdvanced).toBe(false);

        const schedule = await readSchedule(seeded.schedule.id);
        expect(schedule.status).toBe(scenario.expectStatus);
        expect(schedule.overdueDeliveredCount).toBe(0);
        expect(schedule.nextOverdueOccurrenceAt).toBeNull();
      });
    }

    it('records the success in full when the generation was superseded mid-call', async () => {
      const seeded = await seedSchedule('f1_superseded');
      const claim = await claimOverdue('f1_superseded', seeded);
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        startedAt: '2026-08-11T16:00:02.000Z',
      });

      const newDue = parseLocalDate('2026-09-01');
      const nextOverdue = selectNextOverdueOccurrence({
        dueLocalDate: newDue,
        now: '2026-08-11T16:00:03.000Z',
      });
      const advance = decideAdvanceReminder({
        dueLocalDate: newDue,
        establishedAt: '2026-08-11T16:00:03.000Z',
      });
      const superseded = await openNextReminderGeneration(db.prisma, {
        organizationId: org,
        taskId: seeded.taskId,
        expectedGeneration: seeded.schedule.generation,
        dueLocalDate: newDue,
        schedulingTimeZone: zone,
        establishedAt: '2026-08-11T16:00:03.000Z',
        advanceDisposition: advance.kind === 'scheduled' ? 'scheduled' : 'skipped_window_elapsed',
        advanceOccurrence: {
          occurrenceLocalDate: advance.occurrenceLocalDate,
          occurrenceAt: advance.occurrenceAt,
        },
        nextOverdueOccurrence: {
          occurrenceLocalDate: nextOverdue.occurrenceLocalDate,
          occurrenceAt: nextOverdue.occurrenceAt,
        },
      });
      expect(superseded.generation).toBe(2);

      const finalized = await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        scheduleId: seeded.schedule.id,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        // The occurrence's own generation, which the schedule has since left behind.
        expectedGeneration: 1,
        outcome: 'success',
        completedAt: '2026-08-11T16:00:05.000Z',
        providerAcceptedAt: '2026-08-11T16:00:04.000Z',
        nextOverdueOccurrence: {
          occurrenceLocalDate: addLocalDays(seeded.overdue.occurrenceLocalDate, 1),
          occurrenceAt: '2026-08-12T16:00:00.000Z',
        },
      });

      expect(finalized.attempt.outcome).toBe('success');
      expect(finalized.attempt.providerAcceptedAt).toBe('2026-08-11T16:00:04.000Z');
      expect(finalized.counted).toBe(false);
      expect(finalized.scheduleAdvanced).toBe(false);

      const schedule = await readSchedule(seeded.schedule.id);
      expect(schedule.generation).toBe(2);
      // The new generation's counter is untouched and its armed occurrence is intact.
      expect(schedule.overdueDeliveredCount).toBe(0);
      expect(schedule.nextOverdueOccurrenceAt?.toISOString()).toBe(nextOverdue.occurrenceAt);
    });

    it('counts exactly once and arms the next occurrence when the generation still matches', async () => {
      const seeded = await seedSchedule('f1_counted');
      const claim = await claimOverdue('f1_counted', seeded);
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        startedAt: '2026-08-11T16:00:02.000Z',
      });

      const nextLocalDate = addLocalDays(seeded.overdue.occurrenceLocalDate, 1);
      const finalized = await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        scheduleId: seeded.schedule.id,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        expectedGeneration: seeded.schedule.generation,
        outcome: 'success',
        completedAt: '2026-08-11T16:00:05.000Z',
        providerAcceptedAt: '2026-08-11T16:00:04.000Z',
        nextOverdueOccurrence: {
          occurrenceLocalDate: nextLocalDate,
          occurrenceAt: '2026-08-12T16:00:00.000Z',
        },
      });

      expect(finalized.counted).toBe(true);
      expect(finalized.ceilingReached).toBe(false);
      expect(finalized.scheduleAdvanced).toBe(true);

      const schedule = await readSchedule(seeded.schedule.id);
      expect(schedule.overdueDeliveredCount).toBe(1);
      expect(schedule.nextOverdueOccurrenceLocalDate).toBe(nextLocalDate);

      // Finalizing again is refused, so no double count is reachable through this API.
      await expect(
        finalizeReminderOccurrence({
          db: db.prisma,
          organizationId: org,
          scheduleId: seeded.schedule.id,
          attemptId: claim.attempt.id,
          claimSequence: 1,
          expectedGeneration: seeded.schedule.generation,
          outcome: 'success',
          completedAt: '2026-08-11T16:00:06.000Z',
          providerAcceptedAt: '2026-08-11T16:00:04.000Z',
          nextOverdueOccurrence: null,
        }),
      ).rejects.toThrow(PersistenceError);
      expect((await readSchedule(seeded.schedule.id)).overdueDeliveredCount).toBe(1);
    });

    it('never counts a successful advance send', async () => {
      const seeded = await seedSchedule('f1_advance', {
        dueLocalDate: '2026-08-20',
        establishedAt: '2026-08-01T12:00:00.000Z',
      });
      expect(seeded.advance).not.toBeNull();
      if (!seeded.advance) return;

      const claim = await claimReminderOccurrence(db.prisma, {
        id: 'att_f1_advance',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: 1,
        occurrenceKind: 'advance',
        occurrenceLocalDate: seeded.advance.occurrenceLocalDate,
        occurrenceAt: seeded.advance.occurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: seeded.advance.occurrenceAt,
        claimExpiresAt: FOREVER,
        now: seeded.advance.occurrenceAt,
        maxAttempts: 3,
      });
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        startedAt: seeded.advance.occurrenceAt,
      });

      const finalized = await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        scheduleId: seeded.schedule.id,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        expectedGeneration: 1,
        outcome: 'success',
        completedAt: '2026-08-19T16:00:05.000Z',
        providerAcceptedAt: '2026-08-19T16:00:04.000Z',
        // Supplied, and correctly ignored: an advance send does not re-arm the overdue occurrence.
        nextOverdueOccurrence: {
          occurrenceLocalDate: parseLocalDate('2026-08-25'),
          occurrenceAt: '2026-08-25T16:00:00.000Z',
        },
      });

      expect(finalized.counted).toBe(false);
      expect(finalized.settledAdvanceDisposition).toBe('delivered');

      const schedule = await readSchedule(seeded.schedule.id);
      expect(schedule.overdueDeliveredCount).toBe(0);
      expect(schedule.advanceDisposition).toBe('delivered');
      // The armed overdue occurrence is exactly where establishment left it.
      expect(schedule.nextOverdueOccurrenceAt?.toISOString()).toBe(seeded.overdue.occurrenceAt);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // F7 — the success transaction verifies occurrence identity rather than trusting the caller
  // ---------------------------------------------------------------------------------------------

  describe('F7: the finalizer validates the occurrence it was handed', () => {
    it('rejects a schedule id that is not the occurrence\u2019s own', async () => {
      const seeded = await seedSchedule('f7_schedule');
      const other = await seedSchedule('f7_schedule_other');
      const claim = await claimOverdue('f7_schedule', seeded);

      await expect(
        finalizeReminderOccurrence({
          db: db.prisma,
          organizationId: org,
          scheduleId: other.schedule.id,
          attemptId: claim.attempt.id,
          claimSequence: 1,
          expectedGeneration: 1,
          outcome: 'skipped',
          skipReason: 'task_not_eligible',
          completedAt: '2026-08-11T16:00:05.000Z',
          nextOverdueOccurrence: null,
        }),
      ).rejects.toThrow(/belongs to schedule/);
    });

    it('rejects an expected generation the occurrence does not carry', async () => {
      const seeded = await seedSchedule('f7_generation');
      const claim = await claimOverdue('f7_generation', seeded);

      await expect(
        finalizeReminderOccurrence({
          db: db.prisma,
          organizationId: org,
          scheduleId: seeded.schedule.id,
          attemptId: claim.attempt.id,
          claimSequence: 1,
          expectedGeneration: 7,
          outcome: 'skipped',
          skipReason: 'task_not_eligible',
          completedAt: '2026-08-11T16:00:05.000Z',
          nextOverdueOccurrence: null,
        }),
      ).rejects.toThrow(/is generation 1, not 7/);
    });

    it('rejects an occurrence that is already terminal', async () => {
      const seeded = await seedSchedule('f7_terminal');
      const claim = await claimOverdue('f7_terminal', seeded);
      await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        scheduleId: seeded.schedule.id,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        expectedGeneration: 1,
        outcome: 'retryable_failure',
        failureCode: 'TRANSPORT_UNAVAILABLE',
        completedAt: '2026-08-11T16:00:05.000Z',
        nextOverdueOccurrence: null,
      });

      await expect(
        finalizeReminderOccurrence({
          db: db.prisma,
          organizationId: org,
          scheduleId: seeded.schedule.id,
          attemptId: claim.attempt.id,
          claimSequence: 1,
          expectedGeneration: 1,
          outcome: 'success',
          completedAt: '2026-08-11T16:00:06.000Z',
          providerAcceptedAt: '2026-08-11T16:00:05.500Z',
          nextOverdueOccurrence: null,
        }),
      ).rejects.toThrow(/already retryable_failure/);
    });

    it('rejects an attempt id from another organization', async () => {
      const seeded = await seedSchedule('f7_org');
      const claim = await claimOverdue('f7_org', seeded);

      await expect(
        finalizeReminderOccurrence({
          db: db.prisma,
          organizationId: 'org_somebody_else',
          scheduleId: seeded.schedule.id,
          attemptId: claim.attempt.id,
          claimSequence: 1,
          expectedGeneration: 1,
          outcome: 'skipped',
          skipReason: 'task_not_eligible',
          completedAt: '2026-08-11T16:00:05.000Z',
          nextOverdueOccurrence: null,
        }),
      ).rejects.toThrow(/not found for organization/);
    });

    it('requires provider acceptance for a success', async () => {
      const seeded = await seedSchedule('f7_accept');
      const claim = await claimOverdue('f7_accept', seeded);

      await expect(
        finalizeReminderOccurrence({
          db: db.prisma,
          organizationId: org,
          scheduleId: seeded.schedule.id,
          attemptId: claim.attempt.id,
          claimSequence: 1,
          expectedGeneration: 1,
          outcome: 'success',
          completedAt: '2026-08-11T16:00:05.000Z',
          nextOverdueOccurrence: null,
        }),
      ).rejects.toThrow(/provider accepted it/);

      // Nothing was written: the validation runs before phase one.
      const row = await db.prisma.reminderDeliveryAttempt.findUniqueOrThrow({
        where: { id: claim.attempt.id },
      });
      expect(row.outcome).toBe('claimed');
    });
  });

  // ---------------------------------------------------------------------------------------------
  // A-A — only a terminal outcome settles an advance disposition
  // ---------------------------------------------------------------------------------------------

  describe('A-A: a lease is not a processed occurrence', () => {
    async function seedAdvance(key: string) {
      const seeded = await seedSchedule(key, {
        dueLocalDate: '2026-08-20',
        establishedAt: '2026-08-01T12:00:00.000Z',
      });
      if (!seeded.advance) throw new Error('Expected a scheduled advance occurrence.');
      const claim = await claimReminderOccurrence(db.prisma, {
        id: `att_${key}`,
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: 1,
        occurrenceKind: 'advance',
        occurrenceLocalDate: seeded.advance.occurrenceLocalDate,
        occurrenceAt: seeded.advance.occurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: seeded.advance.occurrenceAt,
        claimExpiresAt: FOREVER,
        now: seeded.advance.occurrenceAt,
        maxAttempts: 3,
      });
      return { seeded, claim };
    }

    it('reports a claimed advance occurrence as not processed', async () => {
      const { seeded } = await seedAdvance('aa_claimed');
      expect(await hasTerminalAdvanceOccurrence(db.prisma, org, seeded.schedule.id, 1)).toBe(false);
      // And the disposition is untouched, so a resume can still settle it truthfully.
      expect((await readSchedule(seeded.schedule.id)).advanceDisposition).toBe('scheduled');
    });

    it('reports a terminal advance occurrence as processed', async () => {
      const { seeded, claim } = await seedAdvance('aa_terminal');
      await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        scheduleId: seeded.schedule.id,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        expectedGeneration: 1,
        outcome: 'skipped',
        skipReason: 'task_not_eligible',
        completedAt: '2026-08-19T16:00:05.000Z',
        nextOverdueOccurrence: null,
      });
      expect(await hasTerminalAdvanceOccurrence(db.prisma, org, seeded.schedule.id, 1)).toBe(true);
    });

    it('settles the schedule disposition in the same transaction as the outcome', async () => {
      const cases = [
        { key: 'aa_delivered', outcome: 'success', disposition: 'delivered' },
        { key: 'aa_skipped', outcome: 'skipped', disposition: 'skipped_not_eligible' },
        { key: 'aa_failed', outcome: 'permanent_failure', disposition: 'failed_permanent' },
        { key: 'aa_ambiguous', outcome: 'ambiguous', disposition: 'ambiguous' },
      ] as const;

      for (const entry of cases) {
        const { seeded, claim } = await seedAdvance(entry.key);
        if (entry.outcome === 'success') {
          await markProviderCallStarted(db.prisma, {
            organizationId: org,
            attemptId: claim.attempt.id,
            claimSequence: 1,
            startedAt: '2026-08-19T16:00:02.000Z',
          });
        }
        const finalized = await finalizeReminderOccurrence({
          db: db.prisma,
          organizationId: org,
          scheduleId: seeded.schedule.id,
          attemptId: claim.attempt.id,
          claimSequence: 1,
          expectedGeneration: 1,
          outcome: entry.outcome,
          skipReason: entry.outcome === 'skipped' ? 'task_not_eligible' : null,
          failureCode: entry.outcome === 'permanent_failure' ? 'PERMANENT' : null,
          providerAcceptedAt: entry.outcome === 'success' ? '2026-08-19T16:00:04.000Z' : null,
          completedAt: '2026-08-19T16:00:05.000Z',
          nextOverdueOccurrence: null,
        });

        expect(finalized.settledAdvanceDisposition).toBe(entry.disposition);
        const schedule = await readSchedule(seeded.schedule.id);
        expect(schedule.advanceDisposition).toBe(entry.disposition);
        // The attempt row and the schedule disposition can never disagree, because one transaction
        // wrote both.
        expect(finalized.attempt.outcome).toBe(entry.outcome);
      }
    });

    it('leaves a retryable advance unsettled and still retryable', async () => {
      const { seeded, claim } = await seedAdvance('aa_retryable');
      const finalized = await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        scheduleId: seeded.schedule.id,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        expectedGeneration: 1,
        outcome: 'retryable_failure',
        failureCode: 'TRANSPORT_UNAVAILABLE',
        completedAt: '2026-08-19T16:00:05.000Z',
        nextOverdueOccurrence: null,
      });

      expect(finalized.settledAdvanceDisposition).toBeNull();
      expect((await readSchedule(seeded.schedule.id)).advanceDisposition).toBe('scheduled');
      // hasTerminalAdvanceOccurrence counts it, because a retryable failure *is* a recorded outcome
      // for that attempt; the disposition stays `scheduled` so the occurrence remains deliverable.
      const reclaim = await claimReminderOccurrence(db.prisma, {
        id: 'att_aa_retryable',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: 1,
        occurrenceKind: 'advance',
        occurrenceLocalDate: seeded.advance!.occurrenceLocalDate,
        occurrenceAt: seeded.advance!.occurrenceAt,
        claimedBy: 'worker_b',
        claimedAt: '2026-08-19T17:00:00.000Z',
        claimExpiresAt: FOREVER,
        now: '2026-08-19T17:00:00.000Z',
        maxAttempts: 3,
      });
      expect(reclaim.claimed).toBe(true);
    });

    it('never relabels an advance already truthfully skipped at establishment', async () => {
      // Established the day before the due date, so the advance window has elapsed (D105).
      const seeded = await seedSchedule('aa_elapsed', {
        dueLocalDate: '2026-08-02',
        establishedAt: '2026-08-01T23:00:00.000Z',
      });
      const before = await readSchedule(seeded.schedule.id);
      expect(before.advanceDisposition).toBe('skipped_window_elapsed');

      const claim = await claimOverdue('aa_elapsed', seeded);
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        startedAt: '2026-08-03T16:00:02.000Z',
      });
      await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        scheduleId: seeded.schedule.id,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        expectedGeneration: 1,
        outcome: 'success',
        completedAt: '2026-08-03T16:00:05.000Z',
        providerAcceptedAt: '2026-08-03T16:00:04.000Z',
        nextOverdueOccurrence: null,
      });

      expect((await readSchedule(seeded.schedule.id)).advanceDisposition).toBe(
        'skipped_window_elapsed',
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  // F11 — global bounded due scan
  // ---------------------------------------------------------------------------------------------

  describe('F11: the internal worker scan is global, bounded, and deterministically ordered', () => {
    it('returns due active schedules across organizations, earliest occurrence first', async () => {
      const otherOrgId = 'org_a84a_second';
      await upsertRecipient(db.prisma, {
        organizationId: otherOrgId,
        recipient: recipientFixture('rcp_task_scan_other'),
      });
      const otherTask = taskFixture('task_scan_other', otherOrgId, '2026-08-01T12:00:00.000Z');
      await createTask(db.prisma, otherOrgId, otherTask, otherTask.assignment);
      const otherDue = parseLocalDate('2026-08-05');
      const otherOverdue = selectNextOverdueOccurrence({
        dueLocalDate: otherDue,
        now: '2026-08-01T12:00:00.000Z',
      });
      const otherAdvance = decideAdvanceReminder({
        dueLocalDate: otherDue,
        establishedAt: '2026-08-01T12:00:00.000Z',
      });
      await persistEstablishedReminderSchedule({
        db: db.prisma,
        schedule: {
          id: 'sched_scan_other',
          organizationId: otherOrgId,
          taskId: 'task_scan_other',
          dueLocalDate: otherDue,
          schedulingTimeZone: zone,
          establishedAt: '2026-08-01T12:00:00.000Z',
          advanceDisposition:
            otherAdvance.kind === 'scheduled' ? 'scheduled' : 'skipped_window_elapsed',
          advanceOccurrence: {
            occurrenceLocalDate: otherAdvance.occurrenceLocalDate,
            occurrenceAt: otherAdvance.occurrenceAt,
          },
          nextOverdueOccurrence: {
            occurrenceLocalDate: otherOverdue.occurrenceLocalDate,
            occurrenceAt: otherOverdue.occurrenceAt,
          },
        },
      });

      const due = await listDueReminderSchedulesGlobally(db.prisma, {
        dueAtOrBefore: '2099-01-01T00:00:00.000Z',
        limit: 200,
      });

      const organizations = new Set(due.map((row) => row.organizationId));
      expect(organizations.has(org)).toBe(true);
      expect(organizations.has(otherOrgId)).toBe(true);
      // No caller-supplied organization filter, and yet every row carries its own — which is what
      // subsequent mutations scope themselves by.
      expect(due.every((row) => typeof row.organizationId === 'string')).toBe(true);

      const instants = due.map((row) => row.nextOverdueOccurrenceAt);
      expect([...instants].sort()).toEqual(instants);
    });

    it('honours the batch bound and rejects an unbounded one', async () => {
      const bounded = await listDueReminderSchedulesGlobally(db.prisma, {
        dueAtOrBefore: '2099-01-01T00:00:00.000Z',
        limit: 2,
      });
      expect(bounded.length).toBeLessThanOrEqual(2);

      await expect(
        listDueReminderSchedulesGlobally(db.prisma, {
          dueAtOrBefore: '2099-01-01T00:00:00.000Z',
          limit: 0,
        }),
      ).rejects.toThrow(PersistenceError);
      await expect(
        listDueReminderSchedulesGlobally(db.prisma, {
          dueAtOrBefore: '2099-01-01T00:00:00.000Z',
          limit: 100_000,
        }),
      ).rejects.toThrow(PersistenceError);
    });

    it('excludes schedules that are not active and those not yet due', async () => {
      const suspended = await seedSchedule('scan_suspended');
      await suspendReminderScheduleForWaiting(db.prisma, {
        organizationId: org,
        scheduleId: suspended.schedule.id,
        suspendedAt: '2026-08-02T12:00:00.000Z',
      });

      const due = await listDueReminderSchedulesGlobally(db.prisma, {
        dueAtOrBefore: '2099-01-01T00:00:00.000Z',
        limit: 200,
      });
      expect(due.map((row) => row.id)).not.toContain(suspended.schedule.id);

      // Nothing is due before the earliest armed occurrence.
      const early = await listDueReminderSchedulesGlobally(db.prisma, {
        dueAtOrBefore: '2020-01-01T00:00:00.000Z',
        limit: 200,
      });
      expect(early).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // H1 — terminalization and settlement are two transactions
  // ---------------------------------------------------------------------------------------------

  /**
   * The audit disproved "phase two cannot abort phase one". Every phase-two write was a conditional
   * update whose zero-row result is a no-op, which is true and insufficient: a CHECK violation, a
   * unique collision, or any unexpected error raised anywhere in phase two aborts the transaction
   * and takes the recorded delivery with it. That is the original F1 defect, narrowed.
   *
   * These prove the phases are genuinely separable, that the seam is queryable, and that crossing
   * it twice produces the same schedule as crossing it once.
   */
  describe('H1: phase A survives phase B, and phase B is repeatable', () => {
    function nextFrom(schedule: PersistedReminderSchedule, now: string) {
      return selectNextOverdueOccurrence({ dueLocalDate: schedule.dueLocalDate, now });
    }

    it('leaves settlement debt that is visible and findable', async () => {
      const seeded = await seedSchedule('h1_debt');
      const claim = await claimOverdue('h1_debt', seeded);
      if (!claim.claimed) throw new Error('claim failed');
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: claim.claimSequence,
        startedAt: '2026-08-11T16:00:02.000Z',
      });

      const attempt = await terminalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId: claim.attempt.id,
        scheduleId: seeded.schedule.id,
        claimSequence: claim.claimSequence,
        outcome: 'success',
        completedAt: '2026-08-11T16:00:05.000Z',
        expectedGeneration: seeded.schedule.generation,
        providerAcceptedAt: '2026-08-11T16:00:04.000Z',
        providerMessageRef: 'ref_debt',
        nextOverdueOccurrence: null,
      });

      // Phase A is complete and unconditional: the send is a fact.
      expect(attempt.outcome).toBe('success');
      expect(attempt.providerAcceptedAt).toBe('2026-08-11T16:00:04.000Z');
      expect(attempt.scheduleSettledAt).toBeNull();

      // Phase B has not run, and the schedule says so rather than pretending.
      const before = await readSchedule(seeded.schedule.id);
      expect(before.overdueDeliveredCount).toBe(0);

      const unsettled = await listUnsettledTerminalOccurrences(db.prisma, { limit: 50 });
      const mine = unsettled.find((row) => row.id === claim.attempt.id);
      expect(mine, 'settlement debt must be discoverable, not merely representable').toBeDefined();
      expect(mine?.outcome).toBe('success');
      // The sweep carries what the domain needs to compute the next occurrence itself.
      expect(mine?.dueLocalDate).toBe(seeded.schedule.dueLocalDate);
      expect(mine?.schedulingTimeZone).toBe(zone);
    });

    it('applies the effect exactly once no matter how often settlement is retried', async () => {
      const seeded = await seedSchedule('h1_idempotent');
      const claim = await claimOverdue('h1_idempotent', seeded);
      if (!claim.claimed) throw new Error('claim failed');
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: claim.claimSequence,
        startedAt: '2026-08-11T16:00:02.000Z',
      });
      await terminalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId: claim.attempt.id,
        scheduleId: seeded.schedule.id,
        claimSequence: claim.claimSequence,
        outcome: 'success',
        completedAt: '2026-08-11T16:00:05.000Z',
        expectedGeneration: seeded.schedule.generation,
        providerAcceptedAt: '2026-08-11T16:00:04.000Z',
        nextOverdueOccurrence: null,
      });

      const next = nextFrom(seeded.schedule, '2026-08-11T16:00:05.000Z');
      const settleOnce = () =>
        settleReminderOccurrenceSchedule({
          db: db.prisma,
          organizationId: org,
          attemptId: claim.attempt.id,
          settledAt: '2026-08-11T16:10:00.000Z',
          nextOverdueOccurrence: next,
        });

      const first = await settleOnce();
      expect(first.alreadySettled).toBe(false);
      expect(first.counted).toBe(true);
      expect(first.scheduleAdvanced).toBe(true);

      for (const attempt of [2, 3, 4]) {
        const repeat = await settleOnce();
        expect(repeat.alreadySettled, `settlement ${attempt}`).toBe(true);
        expect(repeat.counted, `settlement ${attempt}`).toBe(false);
      }

      const schedule = await readSchedule(seeded.schedule.id);
      expect(schedule.overdueDeliveredCount, 'the count increments at most once').toBe(1);
      expect(schedule.nextOverdueOccurrenceAt?.toISOString()).toBe(next.occurrenceAt);
      expect(
        (await listUnsettledTerminalOccurrences(db.prisma, { limit: 50 })).some(
          (row) => row.id === claim.attempt.id,
        ),
      ).toBe(false);
    });

    it('refuses to settle an occurrence that is still claimed', async () => {
      const seeded = await seedSchedule('h1_claimed');
      const claim = await claimOverdue('h1_claimed', seeded);
      if (!claim.claimed) throw new Error('claim failed');

      await expect(
        settleReminderOccurrenceSchedule({
          db: db.prisma,
          organizationId: org,
          attemptId: claim.attempt.id,
          settledAt: '2026-08-11T16:10:00.000Z',
          nextOverdueOccurrence: null,
        }),
      ).rejects.toThrow(PersistenceError);
      // A lease is not a result, so there was nothing to settle and nothing was marked settled.
      const row = await db.prisma.reminderDeliveryAttempt.findUniqueOrThrow({
        where: { id: claim.attempt.id },
      });
      expect(row.scheduleSettledAt).toBeNull();
    });

    it('settles a stale-generation success into history without touching the current schedule', async () => {
      const seeded = await seedSchedule('h1_stale');
      const claim = await claimOverdue('h1_stale', seeded);
      if (!claim.claimed) throw new Error('claim failed');
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: claim.claimSequence,
        startedAt: '2026-08-11T16:00:02.000Z',
      });
      await terminalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId: claim.attempt.id,
        scheduleId: seeded.schedule.id,
        claimSequence: claim.claimSequence,
        outcome: 'success',
        completedAt: '2026-08-11T16:00:05.000Z',
        expectedGeneration: seeded.schedule.generation,
        providerAcceptedAt: '2026-08-11T16:00:04.000Z',
        nextOverdueOccurrence: null,
      });

      // The Owner changes the due date before the debt is collected.
      const newDue = addLocalDays(seeded.schedule.dueLocalDate, 7);
      const reopened = selectNextOverdueOccurrence({
        dueLocalDate: newDue,
        now: '2026-08-11T17:00:00.000Z',
      });
      await openNextReminderGeneration(db.prisma, {
        organizationId: org,
        taskId: seeded.taskId,
        expectedGeneration: seeded.schedule.generation,
        dueLocalDate: newDue,
        schedulingTimeZone: zone,
        establishedAt: '2026-08-11T17:00:00.000Z',
        advanceDisposition: 'skipped_window_elapsed',
        advanceOccurrence: {
          occurrenceLocalDate: addLocalDays(newDue, -1),
          occurrenceAt: reopened.occurrenceAt,
        },
        nextOverdueOccurrence: reopened,
      });

      const settled = await settleReminderOccurrenceSchedule({
        db: db.prisma,
        organizationId: org,
        attemptId: claim.attempt.id,
        settledAt: '2026-08-11T18:00:00.000Z',
        nextOverdueOccurrence: reopened,
      });

      expect(settled.counted).toBe(false);
      expect(settled.scheduleAdvanced).toBe(false);
      // Recorded, marked settled, and counted against nothing — the F1 rule, applied late.
      const row = await db.prisma.reminderDeliveryAttempt.findUniqueOrThrow({
        where: { id: claim.attempt.id },
      });
      expect(row.outcome).toBe('success');
      expect(row.scheduleSettledAt).not.toBeNull();
      const schedule = await readSchedule(seeded.schedule.id);
      expect(schedule.generation).toBe(2);
      expect(schedule.overdueDeliveredCount).toBe(0);
      expect(schedule.nextOverdueOccurrenceAt?.toISOString()).toBe(reopened.occurrenceAt);
    });

    it('marks skips settled at birth, so the sweep never sees them', async () => {
      // A skip is written by the caller that is already setting the schedule's advance disposition
      // in the same transaction, so it carries no settlement debt. Leaving it unsettled would hand
      // the sweep a row whose schedule effect somebody else had already applied, and the sweep
      // would apply it a second time.
      const seeded = await seedSchedule('h1_born');
      const skipped = await recordSkippedReminderOccurrence(db.prisma, {
        id: 'att_h1_born',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: seeded.schedule.generation,
        occurrenceKind: 'advance',
        occurrenceLocalDate: seeded.advance!.occurrenceLocalDate,
        occurrenceAt: seeded.advance!.occurrenceAt,
        skipReason: 'advance_window_elapsed',
        recordedAt: '2026-08-09T12:00:00.000Z',
      });

      expect(skipped.outcome).toBe('skipped');
      expect(skipped.scheduleSettledAt).not.toBeNull();
      expect(
        (await listUnsettledTerminalOccurrences(db.prisma, { limit: 200 })).some(
          (row) => row.id === skipped.id,
        ),
      ).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // B2 — an exhausted retry budget is a terminal fact, not a permanent refusal
  // ---------------------------------------------------------------------------------------------

  describe('B2: the retry budget terminalizes rather than hot-looping', () => {
    /** The exact state the audit reproduced: last attempt claimed, then the worker died. */
    async function seedCrashedFinalAttempt(key: string) {
      const seeded = await seedSchedule(key);
      const claim = await claimOverdue(key, seeded, {
        claimedAt: '2026-08-11T16:00:00.000Z',
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });
      if (!claim.claimed) throw new Error('claim failed');
      // Fast-forward the attempt counter to the ceiling without inventing a second occurrence.
      await db.prisma.reminderDeliveryAttempt.update({
        where: { id: claim.attempt.id },
        data: { attemptCount: 3 },
      });
      return { seeded, attemptId: claim.attempt.id };
    }

    it('finds an occurrence no worker can claim and no worker has finished', async () => {
      const { attemptId } = await seedCrashedFinalAttempt('b2_find');

      // Still leased: the current claimant is entitled to its last attempt.
      const leaseLive = await listRetryBudgetExhaustedOccurrences(db.prisma, {
        now: '2026-08-11T16:01:00.000Z',
        maxAttempts: 3,
        limit: 50,
      });
      expect(leaseLive.some((row) => row.id === attemptId)).toBe(false);

      // Lease expired, budget spent, nothing in flight: nobody can ever finish this.
      const stranded = await listRetryBudgetExhaustedOccurrences(db.prisma, {
        now: FOREVER,
        maxAttempts: 3,
        limit: 50,
      });
      expect(stranded.some((row) => row.id === attemptId)).toBe(true);
    });

    it('never treats an in-flight occurrence as merely out of budget', async () => {
      const { attemptId } = await seedCrashedFinalAttempt('b2_inflight');
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId,
        claimSequence: 1,
        startedAt: '2026-08-11T16:00:02.000Z',
      });

      const stranded = await listRetryBudgetExhaustedOccurrences(db.prisma, {
        now: FOREVER,
        maxAttempts: 3,
        limit: 50,
      });
      // A provider may hold this message. "We ran out of attempts" would assert something nobody
      // can know; the ambiguous class is the stricter and correct reading.
      expect(stranded.some((row) => row.id === attemptId)).toBe(false);
    });

    it('terminalizes it as a permanent failure and stops the schedule', async () => {
      const { seeded, attemptId } = await seedCrashedFinalAttempt('b2_terminal');

      const result = await terminalizeExhaustedRetryOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId,
        maxAttempts: 3,
        completedAt: '2026-08-11T17:00:00.000Z',
        now: FOREVER,
        nextOverdueOccurrence: null,
      });

      expect(result).not.toBeNull();
      expect(result?.attempt.outcome).toBe('permanent_failure');
      expect(result?.attempt.failureCode).toBe(RETRY_BUDGET_EXHAUSTED_FAILURE_CODE);
      expect(result?.attempt.claimedBy).toBeNull();
      expect(result?.attempt.claimExpiresAt).toBeNull();
      expect(result?.attempt.providerCallStartedAt).toBeNull();
      expect(result?.attempt.providerAcceptedAt).toBeNull();
      expect(result?.attempt.scheduleSettledAt).not.toBeNull();

      const schedule = await readSchedule(seeded.schedule.id);
      expect(schedule.status).toBe('stopped');
      expect(schedule.stopReason).toBe('permanent_delivery_failure');
      expect(schedule.requiresOwnerAttention).toBe(true);
      expect(schedule.nextOverdueOccurrenceAt).toBeNull();

      // And it is gone from the scan, which is what ends the loop.
      const due = await listDueReminderSchedulesGlobally(db.prisma, {
        dueAtOrBefore: FOREVER,
        limit: 200,
      });
      expect(due.map((row) => row.id)).not.toContain(seeded.schedule.id);
    });

    it('is a no-op for a second worker, and for an occurrence still within budget', async () => {
      const { seeded, attemptId } = await seedCrashedFinalAttempt('b2_second');
      await terminalizeExhaustedRetryOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId,
        maxAttempts: 3,
        completedAt: '2026-08-11T17:00:00.000Z',
        now: FOREVER,
        nextOverdueOccurrence: null,
      });
      const versionAfterFirst = (await readSchedule(seeded.schedule.id)).reminderVersion;

      const second = await terminalizeExhaustedRetryOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId,
        maxAttempts: 3,
        completedAt: '2026-08-11T18:00:00.000Z',
        now: FOREVER,
        nextOverdueOccurrence: null,
      });
      expect(second).toBeNull();
      expect((await readSchedule(seeded.schedule.id)).reminderVersion).toBe(versionAfterFirst);

      // A budget of four means this occurrence still has an attempt left, so nothing may close it.
      const withinBudget = await seedCrashedFinalAttempt('b2_within');
      expect(
        await terminalizeExhaustedRetryOccurrence({
          db: db.prisma,
          organizationId: org,
          attemptId: withinBudget.attemptId,
          maxAttempts: 4,
          completedAt: '2026-08-11T17:00:00.000Z',
          now: FOREVER,
          nextOverdueOccurrence: null,
        }),
      ).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------
  // H2 — a retry takeover resets the provider boundary
  // ---------------------------------------------------------------------------------------------

  describe('H2: taking over a retryable occurrence clears the previous attempt provider state', () => {
    it('clears the marker, the acceptance fields, and the settlement marker', async () => {
      const seeded = await seedSchedule('h2_clear');
      const claim = await claimOverdue('h2_clear', seeded, {
        claimedAt: '2026-08-11T16:00:00.000Z',
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });
      if (!claim.claimed) throw new Error('claim failed');
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        startedAt: '2026-08-11T16:00:02.000Z',
      });
      const failed = await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId: claim.attempt.id,
        scheduleId: seeded.schedule.id,
        claimSequence: 1,
        outcome: 'retryable_failure',
        completedAt: '2026-08-11T16:00:06.000Z',
        expectedGeneration: seeded.schedule.generation,
        failureCode: 'provider_unavailable',
        nextOverdueOccurrence: null,
      });
      expect(failed.attempt.providerCallStartedAt).not.toBeNull();
      expect(failed.attempt.scheduleSettledAt).not.toBeNull();

      const retaken = await claimReminderOccurrence(db.prisma, {
        id: 'att_h2_clear_ignored',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: seeded.schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
        occurrenceAt: seeded.overdue.occurrenceAt,
        claimedBy: 'worker_b',
        claimedAt: '2026-08-11T17:00:00.000Z',
        claimExpiresAt: '2026-08-11T17:05:00.000Z',
        now: '2026-08-11T17:00:00.000Z',
        maxAttempts: 3,
      });

      expect(retaken.claimed).toBe(true);
      if (!retaken.claimed) return;
      expect(retaken.claimSequence).toBe(2);
      expect(retaken.attempt.attemptCount).toBe(2);
      // The marker describes *this* attempt, which has not called anything yet. Inheriting the
      // previous answer made a crash before the new call look like a crash during it, so a reminder
      // provably never sent was finalized ambiguous and its local day consumed (audit H2).
      expect(retaken.attempt.providerCallStartedAt).toBeNull();
      expect(retaken.attempt.providerAcceptedAt).toBeNull();
      expect(retaken.attempt.providerMessageRef).toBeNull();
      expect(retaken.attempt.scheduleSettledAt).toBeNull();
      expect(retaken.attempt.failureCode).toBeNull();
      expect(retaken.attempt.completedAt).toBeNull();
    });

    it('makes the reclaimed occurrence safely releasable rather than ambiguous', async () => {
      const seeded = await seedSchedule('h2_release');
      const claim = await claimOverdue('h2_release', seeded, {
        claimedAt: '2026-08-11T16:00:00.000Z',
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });
      if (!claim.claimed) throw new Error('claim failed');
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        startedAt: '2026-08-11T16:00:02.000Z',
      });
      await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId: claim.attempt.id,
        scheduleId: seeded.schedule.id,
        claimSequence: 1,
        outcome: 'retryable_failure',
        completedAt: '2026-08-11T16:00:06.000Z',
        expectedGeneration: seeded.schedule.generation,
        failureCode: 'provider_unavailable',
        nextOverdueOccurrence: null,
      });
      await claimReminderOccurrence(db.prisma, {
        id: 'att_h2_release_ignored',
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: seeded.schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
        occurrenceAt: seeded.overdue.occurrenceAt,
        claimedBy: 'worker_b',
        claimedAt: '2026-08-11T17:00:00.000Z',
        claimExpiresAt: '2026-08-11T17:05:00.000Z',
        now: '2026-08-11T17:00:00.000Z',
        maxAttempts: 3,
      });

      // The recovery sweep classifies purely on the marker, and the marker is now truthful.
      const expired = await listExpiredOccurrenceClaims(db.prisma, { now: FOREVER, limit: 50 });
      const mine = expired.find((row) => row.id === claim.attempt.id);
      expect(mine?.providerCallStartedAt).toBeNull();
      await releaseReminderOccurrenceClaim({
        db: db.prisma,
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: 2,
      });
      const released = await db.prisma.reminderDeliveryAttempt.findUniqueOrThrow({
        where: { id: claim.attempt.id },
      });
      expect(released.outcome).toBe('claimed');
      expect(released.claimedBy).toBeNull();
    });
  });
});
