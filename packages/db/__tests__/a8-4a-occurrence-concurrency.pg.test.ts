/**
 * A8.4a occurrence lifecycle under real concurrency (audit F1, F2, F6, F7, F10, F11).
 *
 * PGlite cannot prove any of this. It runs one connection and serializes every statement, so two
 * "concurrent" workers are really sequential and always agree — which is precisely the illusion the
 * A8.3a audit's findings hid behind. Every property here is about two independent connections
 * reaching the same row at the same time, so every test opens its own clients and races them with
 * `Promise.all`.
 *
 * The invariants at the bottom are queried directly against the database rather than through the
 * repository functions, because a repository that is wrong would report itself consistent.
 *
 * ## Running it
 *
 * Skipped unless `AICAA_PG_CONCURRENCY_URL` names a **loopback** PostgreSQL 16 with the migrations
 * applied. Not part of `pnpm verify`, which must not require Docker.
 *
 *   pnpm db:docker:up
 *   AICAA_LOCAL_DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     node packages/db/scripts/run-local-prisma.mjs migrate deploy
 *   AICAA_PG_CONCURRENCY_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     pnpm --filter @aicaa/db exec vitest run a8-4a-occurrence-concurrency
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  OVERDUE_SUCCESSFUL_DELIVERY_CEILING,
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
  claimReminderOccurrence,
  claimReminderScheduleForProcessing,
  createPrismaClient,
  createTask,
  finalizeAbandonedInFlightOccurrence,
  finalizeReminderOccurrence,
  listDueReminderSchedulesGlobally,
  listExpiredOccurrenceClaims,
  markProviderCallStarted,
  openNextReminderGeneration,
  persistEstablishedReminderSchedule,
  releaseReminderOccurrenceClaim,
  stopReminderSchedule,
  suspendReminderScheduleForWaiting,
  upsertRecipient,
  type DbClient,
} from '../src/index.js';

const RAW_URL = process.env.AICAA_PG_CONCURRENCY_URL;

/**
 * Refuse anything but loopback. `packages/db/.env` holds a production URL, and a test that races
 * transactions in a loop is the last thing that should ever reach it.
 */
function assertLoopback(raw: string): string {
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())) {
    throw new Error(`AICAA_PG_CONCURRENCY_URL must be loopback, got ${url.hostname}.`);
  }
  return raw;
}

const describeMaybe = RAW_URL ? describe : describe.skip;

const org = 'org_occ_race';
const zone = REMINDER_SCHEDULING_TIME_ZONE;
const FOREVER = '2099-01-01T00:00:00.000Z';

/**
 * How many times each interleaving runs.
 *
 * A race that fails one time in ten passes once and looks fixed. Twenty consecutive rounds of every
 * interleaving is the bar the A8.4a authorization set, and it is the bar these run at.
 */
const ROUNDS = 20;

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

/** Settled outcome of one racer, so a rejection is data rather than a thrown test failure. */
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

describeMaybe('A8.4a occurrence lifecycle under contention (real PostgreSQL 16)', () => {
  /** Independent connections. Two workers are two processes; two clients is the closest analogue. */
  let a: DbClient;
  let b: DbClient;
  let c: DbClient;

  beforeAll(async () => {
    const url = assertLoopback(RAW_URL!);
    a = createPrismaClient(url);
    b = createPrismaClient(url);
    c = createPrismaClient(url);
    await Promise.all([a.$connect(), b.$connect(), c.$connect()]);
  });

  afterAll(async () => {
    await Promise.all([a.$disconnect(), b.$disconnect(), c.$disconnect()]);
  });

  let sequence = 0;

  /**
   * Unique per process run.
   *
   * Deleting the previous run's rows would mean getting a dependency order right across tasks,
   * schedules, attempts, assignments, and audit events, and keeping it right as the schema grows —
   * an ordered cascade that half-succeeds leaves a suite believing it is isolated when it is not.
   * Minting fresh ids cannot half-succeed. The invariant queries below deliberately stay scoped to
   * the organization rather than to the run, so every earlier run's rows are re-checked too.
   */
  const runId = Math.random().toString(36).slice(2, 8);

  /** A fresh Task with an active schedule and an armed overdue occurrence. */
  async function seed(
    prefix: string,
    options: { dueLocalDate?: string } = {},
  ): Promise<{
    key: string;
    taskId: string;
    scheduleId: string;
    dueLocalDate: LocalDate;
    overdue: { occurrenceLocalDate: LocalDate; occurrenceAt: string };
  }> {
    sequence += 1;
    const key = `${runId}_${prefix}_${sequence}`;
    const taskId = `task_${key}`;
    const establishedAt = '2026-08-01T12:00:00.000Z';
    await upsertRecipient(a, { organizationId: org, recipient: recipientFixture(`rcp_${taskId}`) });
    const task = taskFixture(taskId, establishedAt);
    await createTask(a, org, task, task.assignment);

    const dueLocalDate = parseLocalDate(options.dueLocalDate ?? '2026-08-10');
    const advance = decideAdvanceReminder({ dueLocalDate, establishedAt });
    const overdue = selectNextOverdueOccurrence({ dueLocalDate, now: establishedAt });

    const { schedule } = await persistEstablishedReminderSchedule({
      db: a,
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
          occurrenceLocalDate: overdue.occurrenceLocalDate,
          occurrenceAt: overdue.occurrenceAt,
        },
      },
    });

    return { key, taskId, scheduleId: schedule.id, dueLocalDate, overdue };
  }

  function claimInput(
    seeded: Awaited<ReturnType<typeof seed>>,
    worker: string,
    options: { claimExpiresAt?: string; now?: string; maxAttempts?: number } = {},
  ) {
    const at = options.now ?? seeded.overdue.occurrenceAt;
    return {
      id: `att_${seeded.key}_${worker}`,
      organizationId: org,
      scheduleId: seeded.scheduleId,
      generation: 1,
      occurrenceKind: 'overdue' as const,
      occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
      occurrenceAt: seeded.overdue.occurrenceAt,
      claimedBy: worker,
      claimedAt: at,
      claimExpiresAt: options.claimExpiresAt ?? FOREVER,
      now: at,
      maxAttempts: options.maxAttempts ?? 3,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Two workers, one occurrence
  // ---------------------------------------------------------------------------------------------

  it('gives one occurrence to exactly one of two simultaneous claimants', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const seeded = await seed('two_claim');

      const [first, second] = await Promise.all([
        settle(claimReminderOccurrence(a, claimInput(seeded, 'a'))),
        settle(claimReminderOccurrence(b, claimInput(seeded, 'b'))),
      ]);

      const winners = [first, second].filter(
        (result) => result.ok && result.value.claimed === true,
      );
      expect(winners, `round ${round}`).toHaveLength(1);

      // And exactly one row exists for the occurrence, whatever the losers were told.
      const rows = await a.reminderDeliveryAttempt.findMany({
        where: { scheduleId: seeded.scheduleId },
      });
      expect(rows, `round ${round}`).toHaveLength(1);
      expect(rows[0].outcome).toBe('claimed');
      expect(rows[0].claimSequence).toBe(1);
    }
  });

  it('gives one expired lease to exactly one of two simultaneous reclaimers', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const seeded = await seed('two_reclaim');
      await claimReminderOccurrence(a, {
        ...claimInput(seeded, 'dead'),
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });

      const late = { claimExpiresAt: FOREVER, now: '2026-08-11T17:00:00.000Z' };
      const [first, second] = await Promise.all([
        settle(claimReminderOccurrence(a, claimInput(seeded, 'a', late))),
        settle(claimReminderOccurrence(b, claimInput(seeded, 'b', late))),
      ]);

      const winners = [first, second].filter(
        (result) => result.ok && result.value.claimed === true,
      );
      // The fence is a conditional update on the observed sequence, so the loser matches no row.
      expect(winners, `round ${round}`).toHaveLength(1);

      const row = await a.reminderDeliveryAttempt.findFirstOrThrow({
        where: { scheduleId: seeded.scheduleId },
      });
      expect(row.claimSequence, `round ${round}`).toBe(2);
      expect(row.attemptCount).toBe(2);
    }
  });

  it('lets only the current claimant finalize, however late the predecessor arrives', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const seeded = await seed('late_final');
      const original = await claimReminderOccurrence(a, {
        ...claimInput(seeded, 'a'),
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });
      expect(original.claimed).toBe(true);
      const successor = await claimReminderOccurrence(b, {
        ...claimInput(seeded, 'b'),
        now: '2026-08-11T17:00:00.000Z',
        claimExpiresAt: FOREVER,
      });
      expect(successor.claimed).toBe(true);

      const attemptId = original.attempt.id;
      const [stale, live] = await Promise.all([
        settle(
          finalizeReminderOccurrence({
            db: a,
            organizationId: org,
            scheduleId: seeded.scheduleId,
            attemptId,
            claimSequence: 1,
            expectedGeneration: 1,
            outcome: 'success',
            completedAt: '2026-08-11T17:00:05.000Z',
            providerAcceptedAt: '2026-08-11T17:00:04.000Z',
            nextOverdueOccurrence: null,
          }),
        ),
        settle(
          finalizeReminderOccurrence({
            db: b,
            organizationId: org,
            scheduleId: seeded.scheduleId,
            attemptId,
            claimSequence: 2,
            expectedGeneration: 1,
            outcome: 'permanent_failure',
            failureCode: 'SUCCESSOR',
            completedAt: '2026-08-11T17:00:06.000Z',
            nextOverdueOccurrence: null,
          }),
        ),
      ]);

      expect(stale.ok, `round ${round}: the superseded claimant must be refused`).toBe(false);
      expect(live.ok, `round ${round}: the current claimant must succeed`).toBe(true);

      const row = await a.reminderDeliveryAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      expect(row.outcome).toBe('permanent_failure');
    }
  });

  it('refuses a stale release against a successor lease', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const seeded = await seed('stale_release');
      const original = await claimReminderOccurrence(a, {
        ...claimInput(seeded, 'a'),
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });
      await claimReminderOccurrence(b, {
        ...claimInput(seeded, 'b'),
        now: '2026-08-11T17:00:00.000Z',
      });

      const [stale] = await Promise.all([
        settle(
          releaseReminderOccurrenceClaim({
            db: a,
            organizationId: org,
            attemptId: original.attempt.id,
            claimSequence: 1,
          }),
        ),
      ]);
      expect(stale.ok, `round ${round}`).toBe(false);

      const row = await a.reminderDeliveryAttempt.findUniqueOrThrow({
        where: { id: original.attempt.id },
      });
      expect(row.claimedBy).toBe('b');
      expect(row.claimExpiresAt).not.toBeNull();
    }
  });

  it('recovers a provider-call-start crash as ambiguous, once, under two racing recoverers', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const seeded = await seed('crash');
      const claim = await claimReminderOccurrence(a, {
        ...claimInput(seeded, 'dead'),
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });
      await markProviderCallStarted(a, {
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        startedAt: '2026-08-11T16:00:02.000Z',
      });

      const recover = (db: DbClient) =>
        settle(
          finalizeAbandonedInFlightOccurrence({
            db,
            organizationId: org,
            attemptId: claim.attempt.id,
            scheduleId: seeded.scheduleId,
            claimSequence: 1,
            completedAt: '2026-08-11T17:00:00.000Z',
            expectedGeneration: 1,
          }),
        );
      const [first, second] = await Promise.all([recover(a), recover(b)]);

      const succeeded = [first, second].filter((result) => result.ok);
      expect(succeeded, `round ${round}: exactly one recoverer settles it`).toHaveLength(1);

      const row = await a.reminderDeliveryAttempt.findUniqueOrThrow({
        where: { id: claim.attempt.id },
      });
      expect(row.outcome).toBe('ambiguous');
      expect(row.providerAcceptedAt).toBeNull();
      // No reclaim is possible, so no second provider call can ever happen for this morning.
      const retry = await claimReminderOccurrence(b, {
        ...claimInput(seeded, 'later'),
        now: '2026-08-11T18:00:00.000Z',
      });
      expect(retry.claimed).toBe(false);
    }
  });

  // ---------------------------------------------------------------------------------------------
  // F1 — the delivery survives whatever the Owner does mid-call
  // ---------------------------------------------------------------------------------------------

  const LIFECYCLE_RACES = [
    {
      name: 'Waiting suspension',
      mutate: (db: DbClient, seeded: Awaited<ReturnType<typeof seed>>) =>
        suspendReminderScheduleForWaiting(db, {
          organizationId: org,
          scheduleId: seeded.scheduleId,
          suspendedAt: '2026-08-11T16:00:03.000Z',
        }),
    },
    {
      name: 'completion',
      mutate: (db: DbClient, seeded: Awaited<ReturnType<typeof seed>>) =>
        stopReminderSchedule(db, {
          organizationId: org,
          scheduleId: seeded.scheduleId,
          reason: 'task_completed',
          stoppedAt: '2026-08-11T16:00:03.000Z',
        }),
    },
    {
      name: 'a material due-date change',
      mutate: async (db: DbClient, seeded: Awaited<ReturnType<typeof seed>>) => {
        const newDue = parseLocalDate('2026-09-15');
        const advance = decideAdvanceReminder({
          dueLocalDate: newDue,
          establishedAt: '2026-08-11T16:00:03.000Z',
        });
        const next = selectNextOverdueOccurrence({
          dueLocalDate: newDue,
          now: '2026-08-11T16:00:03.000Z',
        });
        await openNextReminderGeneration(db, {
          organizationId: org,
          taskId: seeded.taskId,
          expectedGeneration: 1,
          dueLocalDate: newDue,
          schedulingTimeZone: zone,
          establishedAt: '2026-08-11T16:00:03.000Z',
          advanceDisposition: advance.kind === 'scheduled' ? 'scheduled' : 'skipped_window_elapsed',
          advanceOccurrence: {
            occurrenceLocalDate: advance.occurrenceLocalDate,
            occurrenceAt: advance.occurrenceAt,
          },
          nextOverdueOccurrence: {
            occurrenceLocalDate: next.occurrenceLocalDate,
            occurrenceAt: next.occurrenceAt,
          },
        });
      },
    },
    {
      name: 'due-date removal',
      mutate: (db: DbClient, seeded: Awaited<ReturnType<typeof seed>>) =>
        stopReminderSchedule(db, {
          organizationId: org,
          scheduleId: seeded.scheduleId,
          reason: 'due_date_removed',
          stoppedAt: '2026-08-11T16:00:03.000Z',
        }),
    },
  ] as const;

  for (const race of LIFECYCLE_RACES) {
    it(`never loses an accepted delivery to a concurrent ${race.name}`, async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const seeded = await seed('f1_race');
        const claim = await claimReminderOccurrence(a, claimInput(seeded, 'a'));
        await markProviderCallStarted(a, {
          organizationId: org,
          attemptId: claim.attempt.id,
          claimSequence: 1,
          startedAt: '2026-08-11T16:00:02.000Z',
        });

        // The provider has accepted. The Owner acts at the same instant the worker records it.
        const [finalized, mutated] = await Promise.all([
          settle(
            finalizeReminderOccurrence({
              db: a,
              organizationId: org,
              scheduleId: seeded.scheduleId,
              attemptId: claim.attempt.id,
              claimSequence: 1,
              expectedGeneration: 1,
              outcome: 'success',
              completedAt: '2026-08-11T16:00:05.000Z',
              providerAcceptedAt: '2026-08-11T16:00:04.000Z',
              providerMessageRef: 'ref_race',
              nextOverdueOccurrence: {
                occurrenceLocalDate: addLocalDays(seeded.overdue.occurrenceLocalDate, 1),
                occurrenceAt: '2026-08-12T16:00:00.000Z',
              },
            }),
          ),
          settle(race.mutate(b, seeded)),
        ]);

        // The finalization must always win, whichever order the two committed in. Losing it is the
        // F1 defect: an email that was sent with no record that it was.
        expect(finalized.ok, `round ${round}: ${JSON.stringify(finalized)}`).toBe(true);

        const row = await a.reminderDeliveryAttempt.findUniqueOrThrow({
          where: { id: claim.attempt.id },
        });
        expect(row.outcome, `round ${round}`).toBe('success');
        expect(row.providerAcceptedAt, `round ${round}`).not.toBeNull();
        expect(row.providerMessageRef).toBe('ref_race');

        // And whatever the schedule ended up as, it is never counted twice and never counted for a
        // generation that did not own the delivery.
        const schedule = await a.taskReminderSchedule.findUniqueOrThrow({
          where: { id: seeded.scheduleId },
        });
        expect(schedule.overdueDeliveredCount, `round ${round}`).toBeLessThanOrEqual(1);
        if (schedule.generation !== 1 || schedule.status !== 'active') {
          expect(schedule.overdueDeliveredCount, `round ${round}`).toBe(0);
        }
        void mutated;
      }
    });
  }

  it('counts a delivery exactly once when two finalizations race', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const seeded = await seed('count_once');
      const claim = await claimReminderOccurrence(a, claimInput(seeded, 'a'));
      await markProviderCallStarted(a, {
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: 1,
        startedAt: '2026-08-11T16:00:02.000Z',
      });

      const finalize = (db: DbClient) =>
        settle(
          finalizeReminderOccurrence({
            db,
            organizationId: org,
            scheduleId: seeded.scheduleId,
            attemptId: claim.attempt.id,
            claimSequence: 1,
            expectedGeneration: 1,
            outcome: 'success',
            completedAt: '2026-08-11T16:00:05.000Z',
            providerAcceptedAt: '2026-08-11T16:00:04.000Z',
            nextOverdueOccurrence: null,
          }),
        );
      const results = await Promise.all([finalize(a), finalize(b)]);

      expect(
        results.filter((result) => result.ok),
        `round ${round}`,
      ).toHaveLength(1);
      const schedule = await a.taskReminderSchedule.findUniqueOrThrow({
        where: { id: seeded.scheduleId },
      });
      expect(schedule.overdueDeliveredCount, `round ${round}`).toBe(1);
    }
  });

  // ---------------------------------------------------------------------------------------------
  // The ceiling
  // ---------------------------------------------------------------------------------------------

  it('stops at the ceiling exactly once when the final delivery races a lifecycle change', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const seeded = await seed('ceiling');
      let localDate = seeded.overdue.occurrenceLocalDate;
      let occurrenceAt = seeded.overdue.occurrenceAt;

      // Deliver up to one short of the ceiling, sequentially: only the last one is raced.
      for (let day = 1; day < OVERDUE_SUCCESSFUL_DELIVERY_CEILING; day += 1) {
        const claim = await claimReminderOccurrence(a, {
          id: `att_${seeded.key}_day${day}`,
          organizationId: org,
          scheduleId: seeded.scheduleId,
          generation: 1,
          occurrenceKind: 'overdue',
          occurrenceLocalDate: localDate,
          occurrenceAt,
          claimedBy: 'a',
          claimedAt: occurrenceAt,
          claimExpiresAt: FOREVER,
          now: occurrenceAt,
          maxAttempts: 3,
        });
        await markProviderCallStarted(a, {
          organizationId: org,
          attemptId: claim.attempt.id,
          claimSequence: 1,
          startedAt: occurrenceAt,
        });
        const nextLocalDate = addLocalDays(localDate, 1);
        const nextAt = new Date(Date.parse(occurrenceAt) + 86_400_000).toISOString();
        const finalized = await finalizeReminderOccurrence({
          db: a,
          organizationId: org,
          scheduleId: seeded.scheduleId,
          attemptId: claim.attempt.id,
          claimSequence: 1,
          expectedGeneration: 1,
          outcome: 'success',
          completedAt: occurrenceAt,
          providerAcceptedAt: occurrenceAt,
          nextOverdueOccurrence: { occurrenceLocalDate: nextLocalDate, occurrenceAt: nextAt },
        });
        expect(finalized.ceilingReached, `round ${round} day ${day}`).toBe(false);
        localDate = nextLocalDate;
        occurrenceAt = nextAt;
      }

      // The final delivery, raced against a Waiting suspension.
      const last = await claimReminderOccurrence(a, {
        id: `att_${seeded.key}_last`,
        organizationId: org,
        scheduleId: seeded.scheduleId,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: localDate,
        occurrenceAt,
        claimedBy: 'a',
        claimedAt: occurrenceAt,
        claimExpiresAt: FOREVER,
        now: occurrenceAt,
        maxAttempts: 3,
      });
      await markProviderCallStarted(a, {
        organizationId: org,
        attemptId: last.attempt.id,
        claimSequence: 1,
        startedAt: occurrenceAt,
      });

      const [finalized] = await Promise.all([
        settle(
          finalizeReminderOccurrence({
            db: a,
            organizationId: org,
            scheduleId: seeded.scheduleId,
            attemptId: last.attempt.id,
            claimSequence: 1,
            expectedGeneration: 1,
            outcome: 'success',
            completedAt: occurrenceAt,
            providerAcceptedAt: occurrenceAt,
            nextOverdueOccurrence: {
              occurrenceLocalDate: addLocalDays(localDate, 1),
              occurrenceAt: new Date(Date.parse(occurrenceAt) + 86_400_000).toISOString(),
            },
          }),
        ),
        settle(
          suspendReminderScheduleForWaiting(b, {
            organizationId: org,
            scheduleId: seeded.scheduleId,
            suspendedAt: occurrenceAt,
          }),
        ),
      ]);

      expect(finalized.ok, `round ${round}`).toBe(true);
      const schedule = await a.taskReminderSchedule.findUniqueOrThrow({
        where: { id: seeded.scheduleId },
      });
      // Never more than the ceiling, whichever committed first.
      expect(schedule.overdueDeliveredCount, `round ${round}`).toBeLessThanOrEqual(
        OVERDUE_SUCCESSFUL_DELIVERY_CEILING,
      );
      // A schedule at the ceiling never keeps an armed occurrence.
      if (schedule.overdueDeliveredCount === OVERDUE_SUCCESSFUL_DELIVERY_CEILING) {
        expect(schedule.status, `round ${round}`).not.toBe('active');
        expect(schedule.nextOverdueOccurrenceAt, `round ${round}`).toBeNull();
      }
    }
  });

  // ---------------------------------------------------------------------------------------------
  // F6 and F11 — the schedule lease and the global scan
  // ---------------------------------------------------------------------------------------------

  it('gives an advisory schedule lease to one of two scanners without deciding delivery', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const seeded = await seed('scan_lease');
      const lease = (db: DbClient, worker: string) =>
        settle(
          claimReminderScheduleForProcessing(db, {
            organizationId: org,
            scheduleId: seeded.scheduleId,
            claimedBy: worker,
            claimedAt: '2026-08-11T16:00:00.000Z',
            claimExpiresAt: '2026-08-11T16:05:00.000Z',
            now: '2026-08-11T16:00:00.000Z',
          }),
        );
      const results = await Promise.all([lease(a, 'a'), lease(b, 'b')]);
      const winners = results.filter((result) => result.ok && result.value !== null);
      expect(winners, `round ${round}`).toHaveLength(1);

      // The lease is a scan hint. Losing it must not be what prevents a duplicate send — the
      // occurrence row is, and it refuses a second claimant even with no lease taken at all.
      const claims = await Promise.all([
        settle(claimReminderOccurrence(a, claimInput(seeded, 'a'))),
        settle(claimReminderOccurrence(b, claimInput(seeded, 'b'))),
      ]);
      expect(
        claims.filter((result) => result.ok && result.value.claimed === true),
        `round ${round}`,
      ).toHaveLength(1);
    }
  });

  it('returns the same bounded, deterministically ordered batch to concurrent scanners', async () => {
    await Promise.all([seed('scan_order'), seed('scan_order'), seed('scan_order')]);

    for (let round = 0; round < ROUNDS; round += 1) {
      const [first, second] = await Promise.all([
        listDueReminderSchedulesGlobally(a, { dueAtOrBefore: FOREVER, limit: 3 }),
        listDueReminderSchedulesGlobally(b, { dueAtOrBefore: FOREVER, limit: 3 }),
      ]);

      expect(first.length, `round ${round}`).toBeLessThanOrEqual(3);
      expect(
        first.map((row) => row.id),
        `round ${round}`,
      ).toEqual(second.map((row) => row.id));
      const instants = first.map((row) => `${row.nextOverdueOccurrenceAt}|${row.id}`);
      expect([...instants].sort(), `round ${round}`).toEqual(instants);
    }
  });

  it('keeps mixed worker, Owner, and recovery traffic coherent', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const seeded = await seed('mixed');
      // An abandoned in-flight claim to recover, plus live contention on top of it.
      const dead = await claimReminderOccurrence(a, {
        ...claimInput(seeded, 'dead'),
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
      });
      await markProviderCallStarted(a, {
        organizationId: org,
        attemptId: dead.attempt.id,
        claimSequence: 1,
        startedAt: '2026-08-11T16:00:02.000Z',
      });

      await Promise.all([
        settle(
          finalizeAbandonedInFlightOccurrence({
            db: a,
            organizationId: org,
            attemptId: dead.attempt.id,
            scheduleId: seeded.scheduleId,
            claimSequence: 1,
            completedAt: '2026-08-11T17:00:00.000Z',
            expectedGeneration: 1,
          }),
        ),
        settle(
          claimReminderOccurrence(b, {
            ...claimInput(seeded, 'b'),
            now: '2026-08-11T17:00:00.000Z',
          }),
        ),
        settle(
          suspendReminderScheduleForWaiting(c, {
            organizationId: org,
            scheduleId: seeded.scheduleId,
            suspendedAt: '2026-08-11T17:00:01.000Z',
          }),
        ),
      ]);

      const rows = await a.reminderDeliveryAttempt.findMany({
        where: { scheduleId: seeded.scheduleId },
      });
      // Still exactly one occurrence row for that morning, whatever happened around it.
      expect(rows, `round ${round}`).toHaveLength(1);
      expect(rows[0].outcome === 'ambiguous' || rows[0].outcome === 'claimed').toBe(true);
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Direct invariant queries over everything the rounds above produced
  // ---------------------------------------------------------------------------------------------

  describe('invariants, queried directly rather than through the repository', () => {
    async function rows<T>(sql: string): Promise<T[]> {
      return a.$queryRawUnsafe<T[]>(sql);
    }

    it('has exactly one row per logical occurrence identity', async () => {
      const duplicates = await rows(`
        SELECT schedule_id, generation, occurrence_kind, occurrence_local_date, COUNT(*) AS n
        FROM reminder_delivery_attempts
        WHERE organization_id = '${org}'
        GROUP BY 1, 2, 3, 4
        HAVING COUNT(*) > 1
      `);
      expect(duplicates).toEqual([]);
    });

    it('has no successful delivery recorded twice for one schedule on one local day', async () => {
      const duplicates = await rows(`
        SELECT schedule_id, occurrence_local_date, COUNT(*) AS n
        FROM reminder_delivery_attempts
        WHERE organization_id = '${org}' AND outcome = 'success'
        GROUP BY 1, 2
        HAVING COUNT(*) > 1
      `);
      expect(duplicates).toEqual([]);
    });

    it('has no accepted send missing from history', async () => {
      // Provider acceptance and a success outcome imply each other. A row with acceptance but a
      // non-success outcome would be a delivery the history disowns; the reverse would be a success
      // claiming an acceptance it never had.
      const contradictions = await rows(`
        SELECT id FROM reminder_delivery_attempts
        WHERE organization_id = '${org}'
          AND ((provider_accepted_at IS NOT NULL AND outcome <> 'success')
            OR (outcome = 'success' AND provider_accepted_at IS NULL)
            OR (provider_accepted_at IS NOT NULL AND provider_call_started_at IS NULL))
      `);
      expect(contradictions).toEqual([]);
    });

    it('has no terminal occurrence that is still holding a live lease', async () => {
      // `claimed_by` survives as provenance; the expiry must not, or the row advertises a countdown
      // nobody is running and the recovery sweep has a second, contradictory source of truth.
      const contradictions = await rows(`
        SELECT id FROM reminder_delivery_attempts
        WHERE organization_id = '${org}'
          AND outcome <> 'claimed'
          AND claim_expires_at IS NOT NULL
      `);
      expect(contradictions).toEqual([]);
    });

    it('has no completed occurrence without a completion time, or the reverse', async () => {
      const contradictions = await rows(`
        SELECT id FROM reminder_delivery_attempts
        WHERE organization_id = '${org}'
          AND ((outcome = 'claimed') <> (completed_at IS NULL))
      `);
      expect(contradictions).toEqual([]);
    });

    it('has no count that disagrees with the recorded successful overdue deliveries', async () => {
      const contradictions = await rows(`
        SELECT s.id
        FROM task_reminder_schedules s
        WHERE s.organization_id = '${org}'
          AND s.overdue_delivered_count <> (
            SELECT COUNT(*) FROM reminder_delivery_attempts att
            WHERE att.schedule_id = s.id
              AND att.generation = s.generation
              AND att.occurrence_kind = 'overdue'
              AND att.outcome = 'success'
          )
          -- A success whose generation was superseded mid-call is recorded and deliberately not
          -- counted, which is the F1 rule; those schedules are excluded rather than asserted equal.
          AND NOT EXISTS (
            SELECT 1 FROM reminder_delivery_attempts stale
            WHERE stale.schedule_id = s.id AND stale.generation <> s.generation
          )
          -- Likewise a delivery that landed after the schedule stopped or suspended.
          AND s.status = 'active'
      `);
      expect(contradictions).toEqual([]);
    });

    it('has no schedule holding an armed occurrence while not active', async () => {
      const contradictions = await rows(`
        SELECT id FROM task_reminder_schedules
        WHERE organization_id = '${org}'
          AND status <> 'active'
          AND (next_overdue_occurrence_at IS NOT NULL
            OR next_overdue_occurrence_local_date IS NOT NULL)
      `);
      expect(contradictions).toEqual([]);
    });

    it('has no non-active schedule holding a live scan lease', async () => {
      const contradictions = await rows(`
        SELECT id FROM task_reminder_schedules
        WHERE organization_id = '${org}'
          AND status <> 'active'
          AND (claimed_by IS NOT NULL OR claimed_at IS NOT NULL OR claim_expires_at IS NOT NULL)
      `);
      expect(contradictions).toEqual([]);
    });

    it('has no advance history that disagrees with the schedule disposition', async () => {
      const contradictions = await rows(`
        SELECT s.id
        FROM task_reminder_schedules s
        JOIN reminder_delivery_attempts att
          ON att.schedule_id = s.id
         AND att.generation = s.generation
         AND att.occurrence_kind = 'advance'
        WHERE s.organization_id = '${org}'
          AND att.outcome = 'success'
          AND s.advance_disposition <> 'delivered'
          -- Unless it was already truthfully skipped before the send, which nothing may relabel.
          AND s.advance_disposition::text NOT LIKE 'skipped%'
      `);
      expect(contradictions).toEqual([]);
    });

    it('has no live expired claim left behind after recovery', async () => {
      const stranded = await listExpiredOccurrenceClaims(a, { now: FOREVER, limit: 500 });
      const mine = stranded.filter((row) => row.organizationId === org);
      // Everything abandoned in this file was recovered by the test that abandoned it. Anything left
      // is an occurrence no worker can ever finish — the exact F2 failure.
      expect(
        mine.filter((row) => row.providerCallStartedAt !== null),
        'in-flight claims must be finalized ambiguous, never left claimed',
      ).toEqual([]);
    });
  });
});
