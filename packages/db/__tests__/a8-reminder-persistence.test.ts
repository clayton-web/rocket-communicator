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
  countSuccessfulOverdueDeliveries,
  decideAdvanceReminder,
  isDueDateChangeMaterial,
  parseLocalDate,
  selectNextOverdueOccurrence,
  type AdvanceReminderDisposition,
  type LocalDate,
  type Recipient,
  type Task,
} from '@aicaa/domain';
import {
  PersistenceError,
  claimReminderOccurrence,
  claimReminderScheduleForProcessing,
  countSuccessfulOverdueDeliveriesForGeneration,
  createReminderSchedule,
  createTask,
  findReminderScheduleByTaskId,
  getTaskDueLocalDate,
  listReminderDeliveryAttemptsForGeneration,
  listReminderDeliveryAttemptsForTask,
  listReminderSchedulesDueForProcessing,
  openNextReminderGeneration,
  persistDueDateRemoval,
  persistEstablishedReminderSchedule,
  persistNonDeliveryOutcome,
  persistSuccessfulOverdueDelivery,
  recordReminderDeliveryOutcome,
  recordSkippedReminderOccurrence,
  releaseReminderScheduleClaim,
  resumeReminderScheduleFromWaiting,
  stopReminderSchedule,
  suspendReminderScheduleForWaiting,
  toReminderOccurrenceOutcome,
  upsertRecipient,
  type ReminderOccurrenceInput,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

/**
 * A8.3a reminder persistence (D102–D110, D127).
 *
 * Every occurrence written in these tests is produced by the A8.2 domain rather than hand-typed.
 * That is the point of the slice: if persistence and the domain ever disagree about which morning a
 * reminder falls on, these tests fail instead of production quietly delivering on the wrong day.
 */

const org = 'org_reminder';
const otherOrg = 'org_reminder_other';
const zone = REMINDER_SCHEDULING_TIME_ZONE;

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

/** The translation an A8.4 orchestrator will perform: domain disposition to stored enum. */
function storedDisposition(
  disposition: AdvanceReminderDisposition,
): 'scheduled' | 'skipped_window_elapsed' {
  return disposition.kind === 'scheduled' ? 'scheduled' : 'skipped_window_elapsed';
}

function toOccurrenceInput(occurrence: {
  occurrenceLocalDate: LocalDate;
  occurrenceAt: string;
}): ReminderOccurrenceInput {
  return {
    occurrenceLocalDate: occurrence.occurrenceLocalDate,
    occurrenceAt: occurrence.occurrenceAt,
  };
}

describe('A8.3a reminder persistence (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await upsertRecipient(db.prisma, {
      organizationId: org,
      recipient: recipientFixture('rcp_seed'),
    });
  });

  afterAll(async () => {
    await db.close();
  });

  /** Create a Task plus its Recipient so foreign keys resolve, and return domain-computed inputs. */
  async function seedTask(
    id: string,
    options: { organizationId?: string; dueLocalDate: string; establishedAt: string },
  ) {
    const organizationId = options.organizationId ?? org;
    const at = options.establishedAt;
    await upsertRecipient(db.prisma, {
      organizationId,
      recipient: recipientFixture(`rcp_${id}`),
    });
    const task = taskFixture(id, organizationId, at);
    await createTask(db.prisma, organizationId, task, task.assignment);

    const dueLocalDate = parseLocalDate(options.dueLocalDate);
    const advance = decideAdvanceReminder({ dueLocalDate, establishedAt: at });
    const nextOverdue = selectNextOverdueOccurrence({ dueLocalDate, now: at });

    return { organizationId, taskId: id, dueLocalDate, advance, nextOverdue, establishedAt: at };
  }

  describe('schema integrity', () => {
    it('rejects a local date that is not canonical YYYY-MM-DD', async () => {
      await expect(
        db.pglite.exec(`
          INSERT INTO tasks (id, organization_id, status, summary_points, reminder, retention,
                             version, due_local_date, created_at, updated_at)
          VALUES ('task_bad_date', '${org}', 'open', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, 1,
                  '2026-7-1', NOW(), NOW())
        `),
      ).rejects.toThrow();
    });

    it('rejects an out-of-range month or day at the database boundary', async () => {
      for (const value of ['2026-13-01', '2026-00-10', '2026-01-32', '2026-01-00']) {
        await expect(
          db.pglite.exec(`
            INSERT INTO tasks (id, organization_id, status, summary_points, reminder, retention,
                               version, due_local_date, created_at, updated_at)
            VALUES ('task_bad_${value}', '${org}', 'open', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, 1,
                    '${value}', NOW(), NOW())
          `),
        ).rejects.toThrow();
      }
    });

    it('bounds the stored overdue count by the same ceiling the domain enforces', async () => {
      const bound = await db.pglite.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
         WHERE conname = 'task_reminder_schedules_overdue_delivered_count_bounded'`,
      );
      const definition = bound.rows[0]?.definition ?? '';
      // The SQL backstop and the domain constant must not drift apart (D106).
      expect(definition).toContain(String(OVERDUE_SUCCESSFUL_DELIVERY_CEILING));
    });

    it('enables deny-by-default RLS on both reminder tables', async () => {
      const rls = await db.pglite.query<{ relname: string; relrowsecurity: boolean }>(
        `SELECT relname, relrowsecurity FROM pg_class
         WHERE relname IN ('task_reminder_schedules', 'reminder_delivery_attempts')
         ORDER BY relname`,
      );
      expect(rls.rows).toEqual([
        { relname: 'reminder_delivery_attempts', relrowsecurity: true },
        { relname: 'task_reminder_schedules', relrowsecurity: true },
      ]);
    });

    it('stores no capability token, capability URL, or message body column (D109, D114)', async () => {
      const cols = await db.pglite.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name IN ('task_reminder_schedules', 'reminder_delivery_attempts')`,
      );
      const names = cols.rows.map((r) => r.column_name).join(' ');
      expect(names).not.toMatch(/token|capability|url|link|body|subject|recipient_email/);
    });
  });

  describe('schedule persistence', () => {
    it('persists a schedule with domain-computed occurrences and the canonical due date', async () => {
      const seed = await seedTask('task_est', {
        dueLocalDate: '2026-08-20',
        establishedAt: '2026-08-01T12:00:00.000Z',
      });
      expect(seed.advance.kind).toBe('scheduled');

      const { schedule, skippedAdvanceAttempt } = await persistEstablishedReminderSchedule({
        db: db.prisma,
        schedule: {
          id: 'sched_est',
          organizationId: seed.organizationId,
          taskId: seed.taskId,
          dueLocalDate: seed.dueLocalDate,
          schedulingTimeZone: zone,
          establishedAt: seed.establishedAt,
          advanceDisposition: storedDisposition(seed.advance),
          advanceOccurrence: toOccurrenceInput(seed.advance),
          nextOverdueOccurrence: toOccurrenceInput(seed.nextOverdue),
        },
      });

      expect(skippedAdvanceAttempt).toBeNull();
      expect(schedule.generation).toBe(1);
      expect(schedule.status).toBe('active');
      expect(schedule.overdueDeliveredCount).toBe(0);
      expect(schedule.requiresOwnerAttention).toBe(false);
      expect(schedule.schedulingTimeZone).toBe(zone);
      expect(schedule.dueLocalDate).toBe('2026-08-20');
      // The advance occurrence is the day before the due date, resolved by the domain (D105).
      expect(schedule.advanceOccurrenceLocalDate).toBe(addLocalDays(seed.dueLocalDate, -1));
      expect(schedule.advanceOccurrenceAt).toBe(seed.advance.occurrenceAt);
      expect(schedule.nextOverdueOccurrenceAt).toBe(seed.nextOverdue.occurrenceAt);

      // The canonical local due date is written atomically with the schedule (D109).
      expect(await getTaskDueLocalDate(db.prisma, seed.organizationId, seed.taskId)).toBe(
        '2026-08-20',
      );
    });

    it('records an elapsed advance window once, at establishment, as a skipped occurrence (D105)', async () => {
      const seed = await seedTask('task_elapsed', {
        dueLocalDate: '2026-08-05',
        establishedAt: '2026-08-05T18:00:00.000Z',
      });
      expect(seed.advance.kind).toBe('skipped');

      const { schedule, skippedAdvanceAttempt } = await persistEstablishedReminderSchedule({
        db: db.prisma,
        schedule: {
          id: 'sched_elapsed',
          organizationId: seed.organizationId,
          taskId: seed.taskId,
          dueLocalDate: seed.dueLocalDate,
          schedulingTimeZone: zone,
          establishedAt: seed.establishedAt,
          advanceDisposition: storedDisposition(seed.advance),
          advanceOccurrence: toOccurrenceInput(seed.advance),
          nextOverdueOccurrence: toOccurrenceInput(seed.nextOverdue),
        },
        skippedAdvanceAttempt: {
          id: 'att_elapsed_advance',
          skipReason: 'advance_window_elapsed',
          recordedAt: seed.establishedAt,
        },
      });

      expect(schedule.advanceDisposition).toBe('skipped_window_elapsed');
      expect(skippedAdvanceAttempt?.outcome).toBe('skipped');
      expect(skippedAdvanceAttempt?.skipReason).toBe('advance_window_elapsed');
      // The occurrence is still recorded, so the Owner surface can name the missed morning.
      expect(skippedAdvanceAttempt?.occurrenceKind).toBe('advance');
      expect(skippedAdvanceAttempt?.occurrenceLocalDate).toBe(addLocalDays(seed.dueLocalDate, -1));
    });

    it('allows at most one schedule per Task (D104)', async () => {
      const seed = await seedTask('task_one', {
        dueLocalDate: '2026-09-10',
        establishedAt: '2026-09-01T12:00:00.000Z',
      });
      const input = {
        id: 'sched_one',
        organizationId: seed.organizationId,
        taskId: seed.taskId,
        dueLocalDate: seed.dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt: seed.establishedAt,
        advanceDisposition: storedDisposition(seed.advance),
        advanceOccurrence: toOccurrenceInput(seed.advance),
        nextOverdueOccurrence: toOccurrenceInput(seed.nextOverdue),
      };
      await createReminderSchedule(db.prisma, input);

      await expect(
        createReminderSchedule(db.prisma, { ...input, id: 'sched_one_dup' }),
      ).rejects.toMatchObject({ code: 'UNIQUE_VIOLATION' });
    });

    it('does not leak schedules across organizations', async () => {
      const seed = await seedTask('task_other_org', {
        organizationId: otherOrg,
        dueLocalDate: '2026-09-15',
        establishedAt: '2026-09-01T12:00:00.000Z',
      });
      await createReminderSchedule(db.prisma, {
        id: 'sched_other_org',
        organizationId: otherOrg,
        taskId: seed.taskId,
        dueLocalDate: seed.dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt: seed.establishedAt,
        advanceDisposition: storedDisposition(seed.advance),
        advanceOccurrence: toOccurrenceInput(seed.advance),
        nextOverdueOccurrence: toOccurrenceInput(seed.nextOverdue),
      });

      expect(await findReminderScheduleByTaskId(db.prisma, org, seed.taskId)).toBeNull();
      expect(await findReminderScheduleByTaskId(db.prisma, otherOrg, seed.taskId)).not.toBeNull();
    });
  });

  describe('waiting suspension (D107)', () => {
    it('suspends, clears the pending occurrence, and resumes with no backlog', async () => {
      const seed = await seedTask('task_wait', {
        dueLocalDate: '2026-08-10',
        establishedAt: '2026-08-01T12:00:00.000Z',
      });
      await createReminderSchedule(db.prisma, {
        id: 'sched_wait',
        organizationId: org,
        taskId: seed.taskId,
        dueLocalDate: seed.dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt: seed.establishedAt,
        advanceDisposition: storedDisposition(seed.advance),
        advanceOccurrence: toOccurrenceInput(seed.advance),
        nextOverdueOccurrence: toOccurrenceInput(seed.nextOverdue),
      });

      const suspended = await suspendReminderScheduleForWaiting(db.prisma, {
        organizationId: org,
        scheduleId: 'sched_wait',
        suspendedAt: '2026-08-11T15:00:00.000Z',
      });
      expect(suspended.status).toBe('suspended_waiting');
      expect(suspended.suspendedAt).toBe('2026-08-11T15:00:00.000Z');
      // A suspended schedule must not sit in the worker's due-scan holding a stale occurrence.
      expect(suspended.nextOverdueOccurrenceAt).toBeNull();

      const resumedAt = '2026-08-25T16:00:00.000Z';
      const nextAfterResume = selectNextOverdueOccurrence({
        dueLocalDate: seed.dueLocalDate,
        now: resumedAt,
      });
      const resumed = await resumeReminderScheduleFromWaiting(db.prisma, {
        organizationId: org,
        scheduleId: 'sched_wait',
        nextOverdueOccurrence: toOccurrenceInput(nextAfterResume),
      });

      expect(resumed.status).toBe('active');
      expect(resumed.suspendedAt).toBeNull();
      // Exactly one future occurrence, not the fortnight of mornings that elapsed while Waiting.
      expect(resumed.nextOverdueOccurrenceAt).toBe(nextAfterResume.occurrenceAt);
      expect(new Date(resumed.nextOverdueOccurrenceAt!).getTime()).toBeGreaterThan(
        new Date(resumedAt).getTime(),
      );
    });

    it('refuses to resume a schedule that is not Waiting-suspended', async () => {
      await expect(
        resumeReminderScheduleFromWaiting(db.prisma, {
          organizationId: org,
          scheduleId: 'sched_est',
          nextOverdueOccurrence: null,
        }),
      ).rejects.toMatchObject({ code: 'DOMAIN_CONFLICT' });
    });
  });

  describe('occurrence identity and idempotency (D106, D109)', () => {
    async function seedClaimable(id: string) {
      const seed = await seedTask(`task_${id}`, {
        dueLocalDate: '2026-08-10',
        establishedAt: '2026-08-01T12:00:00.000Z',
      });
      const schedule = await createReminderSchedule(db.prisma, {
        id: `sched_${id}`,
        organizationId: org,
        taskId: seed.taskId,
        dueLocalDate: seed.dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt: seed.establishedAt,
        advanceDisposition: storedDisposition(seed.advance),
        advanceOccurrence: toOccurrenceInput(seed.advance),
        nextOverdueOccurrence: toOccurrenceInput(seed.nextOverdue),
      });
      return { seed, schedule };
    }

    it('lets only one of two overlapping claims win the same occurrence', async () => {
      const { seed, schedule } = await seedClaimable('race');
      const claimInput = {
        organizationId: org,
        scheduleId: schedule.id,
        taskId: seed.taskId,
        generation: schedule.generation,
        occurrenceKind: 'overdue' as const,
        occurrenceLocalDate: seed.nextOverdue.occurrenceLocalDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
        claimedAt: '2026-08-11T16:00:00.000Z',
      };

      const first = await claimReminderOccurrence(db.prisma, {
        ...claimInput,
        id: 'att_race_1',
        claimedBy: 'worker_a',
      });
      const second = await claimReminderOccurrence(db.prisma, {
        ...claimInput,
        id: 'att_race_2',
        claimedBy: 'worker_b',
      });

      expect(first.claimed).toBe(true);
      expect(second.claimed).toBe(false);
      // The loser is handed the winning row, not a second identity for the same morning.
      expect(second.attempt.id).toBe('att_race_1');
      expect(second.attempt.claimedBy).toBe('worker_a');

      const history = await listReminderDeliveryAttemptsForTask(db.prisma, org, seed.taskId);
      expect(history).toHaveLength(1);
    });

    it('refuses a second successful delivery on the same local calendar day (D106)', async () => {
      const { seed, schedule } = await seedClaimable('perday');
      const localDate = seed.nextOverdue.occurrenceLocalDate;

      const claim = await claimReminderOccurrence(db.prisma, {
        id: 'att_perday_1',
        organizationId: org,
        scheduleId: schedule.id,
        taskId: seed.taskId,
        generation: schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: localDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: '2026-08-11T16:00:00.000Z',
      });
      await recordReminderDeliveryOutcome(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        outcome: 'success',
        completedAt: '2026-08-11T16:00:05.000Z',
      });

      // A material due-date change moves the generation forward, but the Recipient already heard
      // from us this morning — the per-local-day guarantee is not generation-scoped.
      const nextGeneration = schedule.generation + 1;
      await db.pglite.exec(
        `UPDATE task_reminder_schedules SET generation = ${nextGeneration} WHERE id = '${schedule.id}'`,
      );
      const secondClaim = await claimReminderOccurrence(db.prisma, {
        id: 'att_perday_2',
        organizationId: org,
        scheduleId: schedule.id,
        taskId: seed.taskId,
        generation: nextGeneration,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: localDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
        claimedBy: 'worker_b',
        claimedAt: '2026-08-11T17:00:00.000Z',
      });
      expect(secondClaim.claimed).toBe(true);

      await expect(
        recordReminderDeliveryOutcome(db.prisma, {
          organizationId: org,
          attemptId: secondClaim.attempt.id,
          outcome: 'success',
          completedAt: '2026-08-11T17:00:05.000Z',
        }),
      ).rejects.toMatchObject({ code: 'UNIQUE_VIOLATION' });
    });

    it('does not consume the local day for a skipped occurrence (D107)', async () => {
      const { seed, schedule } = await seedClaimable('skipday');
      const localDate = seed.nextOverdue.occurrenceLocalDate;

      await recordSkippedReminderOccurrence(db.prisma, {
        id: 'att_skipday_1',
        organizationId: org,
        scheduleId: schedule.id,
        taskId: seed.taskId,
        generation: schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: localDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
        skipReason: 'no_active_assignment',
        recordedAt: '2026-08-11T16:00:00.000Z',
      });

      // Same schedule, same local day, next generation: a skip blocked nobody, so a later
      // successful delivery on that day must still be allowed.
      await db.pglite.exec(
        `UPDATE task_reminder_schedules SET generation = 2 WHERE id = '${schedule.id}'`,
      );
      const claim = await claimReminderOccurrence(db.prisma, {
        id: 'att_skipday_2',
        organizationId: org,
        scheduleId: schedule.id,
        taskId: seed.taskId,
        generation: 2,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: localDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: '2026-08-11T18:00:00.000Z',
      });
      const delivered = await recordReminderDeliveryOutcome(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        outcome: 'success',
        completedAt: '2026-08-11T18:00:05.000Z',
      });
      expect(delivered.outcome).toBe('success');
    });

    it('refuses to rewrite a recorded outcome', async () => {
      const { seed, schedule } = await seedClaimable('rewrite');
      const claim = await claimReminderOccurrence(db.prisma, {
        id: 'att_rewrite',
        organizationId: org,
        scheduleId: schedule.id,
        taskId: seed.taskId,
        generation: schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seed.nextOverdue.occurrenceLocalDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: '2026-08-11T16:00:00.000Z',
      });
      await recordReminderDeliveryOutcome(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        outcome: 'permanent_failure',
        failureCode: 'GMAIL_PERMANENT',
        completedAt: '2026-08-11T16:00:05.000Z',
      });

      // A late duplicate must not upgrade a recorded failure into a success the ceiling counts.
      await expect(
        recordReminderDeliveryOutcome(db.prisma, {
          organizationId: org,
          attemptId: claim.attempt.id,
          outcome: 'success',
          completedAt: '2026-08-11T16:00:09.000Z',
        }),
      ).rejects.toMatchObject({ code: 'DOMAIN_CONFLICT' });
    });

    it('rejects a skip with no reason and a failure code on a success', async () => {
      const { seed, schedule } = await seedClaimable('truthful');
      await expect(
        db.pglite.exec(`
          INSERT INTO reminder_delivery_attempts
            (id, organization_id, schedule_id, task_id, generation, occurrence_kind,
             occurrence_local_date, occurrence_at, outcome, completed_at, updated_at)
          VALUES ('att_untruthful_skip', '${org}', '${schedule.id}', '${seed.taskId}', 1, 'overdue',
                  '2026-09-01', NOW(), 'skipped', NOW(), NOW())
        `),
      ).rejects.toThrow();

      await expect(
        db.pglite.exec(`
          INSERT INTO reminder_delivery_attempts
            (id, organization_id, schedule_id, task_id, generation, occurrence_kind,
             occurrence_local_date, occurrence_at, outcome, failure_code, completed_at, updated_at)
          VALUES ('att_untruthful_ok', '${org}', '${schedule.id}', '${seed.taskId}', 2, 'overdue',
                  '2026-09-02', NOW(), 'success', 'SOME_CODE', NOW(), NOW())
        `),
      ).rejects.toThrow();
    });
  });

  describe('overdue ceiling accounting (D106)', () => {
    it('stops the schedule and raises Owner attention on the 14th successful delivery', async () => {
      const seed = await seedTask('task_ceiling', {
        dueLocalDate: '2026-08-10',
        establishedAt: '2026-08-01T12:00:00.000Z',
      });
      const schedule = await createReminderSchedule(db.prisma, {
        id: 'sched_ceiling',
        organizationId: org,
        taskId: seed.taskId,
        dueLocalDate: seed.dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt: seed.establishedAt,
        advanceDisposition: storedDisposition(seed.advance),
        advanceOccurrence: toOccurrenceInput(seed.advance),
        nextOverdueOccurrence: toOccurrenceInput(seed.nextOverdue),
      });

      let occurrence = seed.nextOverdue;
      let reachedOn = 0;

      for (let day = 1; day <= OVERDUE_SUCCESSFUL_DELIVERY_CEILING; day += 1) {
        const claim = await claimReminderOccurrence(db.prisma, {
          id: `att_ceiling_${day}`,
          organizationId: org,
          scheduleId: schedule.id,
          taskId: seed.taskId,
          generation: schedule.generation,
          occurrenceKind: 'overdue',
          occurrenceLocalDate: occurrence.occurrenceLocalDate,
          occurrenceAt: occurrence.occurrenceAt,
          claimedBy: 'worker_a',
          claimedAt: occurrence.occurrenceAt,
        });
        expect(claim.claimed).toBe(true);

        const nextLocalDate = addLocalDays(occurrence.occurrenceLocalDate, 1);
        const next = selectNextOverdueOccurrence({
          dueLocalDate: seed.dueLocalDate,
          now: occurrence.occurrenceAt,
        });

        const result = await persistSuccessfulOverdueDelivery({
          db: db.prisma,
          organizationId: org,
          scheduleId: schedule.id,
          attemptId: claim.attempt.id,
          generation: schedule.generation,
          completedAt: occurrence.occurrenceAt,
          nextOverdueOccurrence: toOccurrenceInput(next),
        });

        if (result.ceilingReached) {
          reachedOn = day;
          expect(result.schedule.status).toBe('stopped');
          expect(result.schedule.stopReason).toBe('overdue_ceiling_reached');
          expect(result.schedule.requiresOwnerAttention).toBe(true);
          // A stopped schedule carries no future occurrence, so the due-scan cannot resurrect it.
          expect(result.schedule.nextOverdueOccurrenceAt).toBeNull();
          break;
        }

        expect(result.schedule.status).toBe('active');
        expect(next.occurrenceLocalDate).toBe(nextLocalDate);
        occurrence = next;
      }

      expect(reachedOn).toBe(OVERDUE_SUCCESSFUL_DELIVERY_CEILING);

      const stored = await countSuccessfulOverdueDeliveriesForGeneration(
        db.prisma,
        org,
        schedule.id,
        schedule.generation,
      );
      const history = await listReminderDeliveryAttemptsForGeneration(
        db.prisma,
        org,
        schedule.id,
        schedule.generation,
      );
      // The SQL aggregate, the denormalized counter, and the domain rule must all agree.
      expect(stored).toBe(OVERDUE_SUCCESSFUL_DELIVERY_CEILING);
      expect(countSuccessfulOverdueDeliveries(history.map(toReminderOccurrenceOutcome))).toBe(
        OVERDUE_SUCCESSFUL_DELIVERY_CEILING,
      );
      const reloaded = await findReminderScheduleByTaskId(db.prisma, org, seed.taskId);
      expect(reloaded?.overdueDeliveredCount).toBe(OVERDUE_SUCCESSFUL_DELIVERY_CEILING);
    });

    it('excludes failures, ambiguity, skips, claims, and advance sends from the count', async () => {
      const seed = await seedTask('task_noncount', {
        dueLocalDate: '2026-08-10',
        establishedAt: '2026-08-01T12:00:00.000Z',
      });
      const schedule = await createReminderSchedule(db.prisma, {
        id: 'sched_noncount',
        organizationId: org,
        taskId: seed.taskId,
        dueLocalDate: seed.dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt: seed.establishedAt,
        advanceDisposition: storedDisposition(seed.advance),
        advanceOccurrence: toOccurrenceInput(seed.advance),
        nextOverdueOccurrence: toOccurrenceInput(seed.nextOverdue),
      });

      // A successful *advance* reminder is a different occurrence kind and never consumes ceiling.
      const advanceClaim = await claimReminderOccurrence(db.prisma, {
        id: 'att_noncount_advance',
        organizationId: org,
        scheduleId: schedule.id,
        taskId: seed.taskId,
        generation: 1,
        occurrenceKind: 'advance',
        occurrenceLocalDate: schedule.advanceOccurrenceLocalDate,
        occurrenceAt: schedule.advanceOccurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: schedule.advanceOccurrenceAt,
      });
      await recordReminderDeliveryOutcome(db.prisma, {
        organizationId: org,
        attemptId: advanceClaim.attempt.id,
        outcome: 'success',
        completedAt: schedule.advanceOccurrenceAt,
      });

      const nonCounting = [
        { outcome: 'retryable_failure' as const, failureCode: 'GMAIL_RETRYABLE' },
        { outcome: 'permanent_failure' as const, failureCode: 'GMAIL_PERMANENT' },
        { outcome: 'ambiguous' as const, failureCode: 'GMAIL_AMBIGUOUS_SEND' },
      ];
      let localDate = parseLocalDate('2026-08-11');
      for (const [index, entry] of nonCounting.entries()) {
        const claim = await claimReminderOccurrence(db.prisma, {
          id: `att_noncount_${index}`,
          organizationId: org,
          scheduleId: schedule.id,
          taskId: seed.taskId,
          generation: 1,
          occurrenceKind: 'overdue',
          occurrenceLocalDate: localDate,
          occurrenceAt: seed.nextOverdue.occurrenceAt,
          claimedBy: 'worker_a',
          claimedAt: seed.nextOverdue.occurrenceAt,
        });
        await persistNonDeliveryOutcome({
          db: db.prisma,
          organizationId: org,
          scheduleId: schedule.id,
          attemptId: claim.attempt.id,
          generation: 1,
          outcome: entry.outcome,
          failureCode: entry.failureCode,
          completedAt: seed.nextOverdue.occurrenceAt,
          nextOverdueOccurrence: toOccurrenceInput(seed.nextOverdue),
        });
        localDate = addLocalDays(localDate, 1);
      }

      // One outstanding claim, never completed.
      await claimReminderOccurrence(db.prisma, {
        id: 'att_noncount_claimed',
        organizationId: org,
        scheduleId: schedule.id,
        taskId: seed.taskId,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: localDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: seed.nextOverdue.occurrenceAt,
      });

      const history = await listReminderDeliveryAttemptsForGeneration(
        db.prisma,
        org,
        schedule.id,
        1,
      );
      expect(history.length).toBeGreaterThan(4);
      expect(countSuccessfulOverdueDeliveries(history.map(toReminderOccurrenceOutcome))).toBe(0);
      expect(
        await countSuccessfulOverdueDeliveriesForGeneration(db.prisma, org, schedule.id, 1),
      ).toBe(0);

      const reloaded = await findReminderScheduleByTaskId(db.prisma, org, seed.taskId);
      expect(reloaded?.overdueDeliveredCount).toBe(0);
    });

    it('refuses to store a count above the ceiling', async () => {
      await expect(
        db.pglite.exec(
          `UPDATE task_reminder_schedules SET overdue_delivered_count = ${
            OVERDUE_SUCCESSFUL_DELIVERY_CEILING + 1
          } WHERE id = 'sched_noncount'`,
        ),
      ).rejects.toThrow();
    });
  });

  describe('generations (D104)', () => {
    it('opens a new generation on a material change, preserving history and resetting the count', async () => {
      const seed = await seedTask('task_gen', {
        dueLocalDate: '2026-08-10',
        establishedAt: '2026-08-01T12:00:00.000Z',
      });
      const schedule = await createReminderSchedule(db.prisma, {
        id: 'sched_gen',
        organizationId: org,
        taskId: seed.taskId,
        dueLocalDate: seed.dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt: seed.establishedAt,
        advanceDisposition: storedDisposition(seed.advance),
        advanceOccurrence: toOccurrenceInput(seed.advance),
        nextOverdueOccurrence: toOccurrenceInput(seed.nextOverdue),
      });

      const claim = await claimReminderOccurrence(db.prisma, {
        id: 'att_gen_1',
        organizationId: org,
        scheduleId: schedule.id,
        taskId: seed.taskId,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seed.nextOverdue.occurrenceLocalDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: seed.nextOverdue.occurrenceAt,
      });
      await persistSuccessfulOverdueDelivery({
        db: db.prisma,
        organizationId: org,
        scheduleId: schedule.id,
        attemptId: claim.attempt.id,
        generation: 1,
        completedAt: seed.nextOverdue.occurrenceAt,
        nextOverdueOccurrence: toOccurrenceInput(
          selectNextOverdueOccurrence({
            dueLocalDate: seed.dueLocalDate,
            now: seed.nextOverdue.occurrenceAt,
          }),
        ),
      });

      const newDue = parseLocalDate('2026-09-30');
      const changedAt = '2026-08-15T12:00:00.000Z';
      expect(isDueDateChangeMaterial(seed.dueLocalDate, newDue)).toBe(true);

      const advance = decideAdvanceReminder({ dueLocalDate: newDue, establishedAt: changedAt });
      const nextOverdue = selectNextOverdueOccurrence({ dueLocalDate: newDue, now: changedAt });
      const superseded = await openNextReminderGeneration(db.prisma, {
        organizationId: org,
        taskId: seed.taskId,
        expectedGeneration: 1,
        dueLocalDate: newDue,
        schedulingTimeZone: zone,
        establishedAt: changedAt,
        advanceDisposition: storedDisposition(advance),
        advanceOccurrence: toOccurrenceInput(advance),
        nextOverdueOccurrence: toOccurrenceInput(nextOverdue),
      });

      expect(superseded.generation).toBe(2);
      expect(superseded.dueLocalDate).toBe('2026-09-30');
      expect(superseded.overdueDeliveredCount).toBe(0);
      expect(superseded.status).toBe('active');

      // Prior history is preserved, not deleted or rewritten (D107, D109).
      const priorGeneration = await listReminderDeliveryAttemptsForGeneration(
        db.prisma,
        org,
        schedule.id,
        1,
      );
      expect(priorGeneration).toHaveLength(1);
      expect(priorGeneration[0]?.outcome).toBe('success');
      expect(
        await countSuccessfulOverdueDeliveriesForGeneration(db.prisma, org, schedule.id, 1),
      ).toBe(1);
      expect(
        await countSuccessfulOverdueDeliveriesForGeneration(db.prisma, org, schedule.id, 2),
      ).toBe(0);
    });

    it('rejects superseding from a stale generation', async () => {
      const advance = decideAdvanceReminder({
        dueLocalDate: parseLocalDate('2026-10-10'),
        establishedAt: '2026-08-20T12:00:00.000Z',
      });
      await expect(
        openNextReminderGeneration(db.prisma, {
          organizationId: org,
          taskId: 'task_gen',
          expectedGeneration: 1,
          dueLocalDate: parseLocalDate('2026-10-10'),
          schedulingTimeZone: zone,
          establishedAt: '2026-08-20T12:00:00.000Z',
          advanceDisposition: storedDisposition(advance),
          advanceOccurrence: toOccurrenceInput(advance),
          nextOverdueOccurrence: null,
        }),
      ).rejects.toMatchObject({ code: 'OPTIMISTIC_CONCURRENCY' });
    });

    it('does not credit a delivery made under a superseded generation', async () => {
      const seed = await seedTask('task_stalegen', {
        dueLocalDate: '2026-08-10',
        establishedAt: '2026-08-01T12:00:00.000Z',
      });
      const schedule = await createReminderSchedule(db.prisma, {
        id: 'sched_stalegen',
        organizationId: org,
        taskId: seed.taskId,
        dueLocalDate: seed.dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt: seed.establishedAt,
        advanceDisposition: storedDisposition(seed.advance),
        advanceOccurrence: toOccurrenceInput(seed.advance),
        nextOverdueOccurrence: toOccurrenceInput(seed.nextOverdue),
      });
      const claim = await claimReminderOccurrence(db.prisma, {
        id: 'att_stalegen',
        organizationId: org,
        scheduleId: schedule.id,
        taskId: seed.taskId,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seed.nextOverdue.occurrenceLocalDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: seed.nextOverdue.occurrenceAt,
      });

      const newDue = parseLocalDate('2026-09-01');
      const changedAt = '2026-08-12T12:00:00.000Z';
      const advance = decideAdvanceReminder({ dueLocalDate: newDue, establishedAt: changedAt });
      await openNextReminderGeneration(db.prisma, {
        organizationId: org,
        taskId: seed.taskId,
        expectedGeneration: 1,
        dueLocalDate: newDue,
        schedulingTimeZone: zone,
        establishedAt: changedAt,
        advanceDisposition: storedDisposition(advance),
        advanceOccurrence: toOccurrenceInput(advance),
        nextOverdueOccurrence: null,
      });

      // The in-flight generation-1 delivery cannot inflate generation 2's count.
      await expect(
        persistSuccessfulOverdueDelivery({
          db: db.prisma,
          organizationId: org,
          scheduleId: schedule.id,
          attemptId: claim.attempt.id,
          generation: 1,
          completedAt: '2026-08-12T16:00:00.000Z',
          nextOverdueOccurrence: null,
        }),
      ).rejects.toBeInstanceOf(PersistenceError);

      const reloaded = await findReminderScheduleByTaskId(db.prisma, org, seed.taskId);
      expect(reloaded?.generation).toBe(2);
      expect(reloaded?.overdueDeliveredCount).toBe(0);
    });
  });

  describe('stopping (D107)', () => {
    it('stops on due-date removal and clears the canonical due date atomically', async () => {
      const seed = await seedTask('task_removed', {
        dueLocalDate: '2026-08-10',
        establishedAt: '2026-08-01T12:00:00.000Z',
      });
      await persistEstablishedReminderSchedule({
        db: db.prisma,
        schedule: {
          id: 'sched_removed',
          organizationId: org,
          taskId: seed.taskId,
          dueLocalDate: seed.dueLocalDate,
          schedulingTimeZone: zone,
          establishedAt: seed.establishedAt,
          advanceDisposition: storedDisposition(seed.advance),
          advanceOccurrence: toOccurrenceInput(seed.advance),
          nextOverdueOccurrence: toOccurrenceInput(seed.nextOverdue),
        },
      });
      expect(await getTaskDueLocalDate(db.prisma, org, seed.taskId)).toBe('2026-08-10');

      const stopped = await persistDueDateRemoval({
        db: db.prisma,
        organizationId: org,
        taskId: seed.taskId,
        scheduleId: 'sched_removed',
        stoppedAt: '2026-08-05T12:00:00.000Z',
      });

      expect(stopped.status).toBe('stopped');
      expect(stopped.stopReason).toBe('due_date_removed');
      expect(stopped.nextOverdueOccurrenceAt).toBeNull();
      expect(await getTaskDueLocalDate(db.prisma, org, seed.taskId)).toBeNull();
    });

    it('is idempotent when completion and dismissal race', async () => {
      const seed = await seedTask('task_stopidem', {
        dueLocalDate: '2026-08-10',
        establishedAt: '2026-08-01T12:00:00.000Z',
      });
      await createReminderSchedule(db.prisma, {
        id: 'sched_stopidem',
        organizationId: org,
        taskId: seed.taskId,
        dueLocalDate: seed.dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt: seed.establishedAt,
        advanceDisposition: storedDisposition(seed.advance),
        advanceOccurrence: toOccurrenceInput(seed.advance),
        nextOverdueOccurrence: toOccurrenceInput(seed.nextOverdue),
      });

      const first = await stopReminderSchedule(db.prisma, {
        organizationId: org,
        scheduleId: 'sched_stopidem',
        reason: 'task_completed',
        stoppedAt: '2026-08-06T12:00:00.000Z',
      });
      const second = await stopReminderSchedule(db.prisma, {
        organizationId: org,
        scheduleId: 'sched_stopidem',
        reason: 'task_dismissed',
        stoppedAt: '2026-08-06T12:00:01.000Z',
      });

      expect(first.stopReason).toBe('task_completed');
      // The first truthful reason survives; the race does not rewrite recorded history.
      expect(second.stopReason).toBe('task_completed');
      expect(second.stoppedAt).toBe('2026-08-06T12:00:00.000Z');
    });

    it('refuses a stopped schedule that still carries a future occurrence', async () => {
      await expect(
        db.pglite.exec(`
          UPDATE task_reminder_schedules
          SET next_overdue_occurrence_local_date = '2026-12-01',
              next_overdue_occurrence_at = NOW()
          WHERE id = 'sched_stopidem'
        `),
      ).rejects.toThrow();
    });
  });

  describe('claim leases for a future worker', () => {
    it('grants one lease, refuses a second, and reclaims after expiry', async () => {
      const seed = await seedTask('task_lease', {
        dueLocalDate: '2026-08-10',
        establishedAt: '2026-08-01T12:00:00.000Z',
      });
      await createReminderSchedule(db.prisma, {
        id: 'sched_lease',
        organizationId: org,
        taskId: seed.taskId,
        dueLocalDate: seed.dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt: seed.establishedAt,
        advanceDisposition: storedDisposition(seed.advance),
        advanceOccurrence: toOccurrenceInput(seed.advance),
        nextOverdueOccurrence: toOccurrenceInput(seed.nextOverdue),
      });

      const granted = await claimReminderScheduleForProcessing(db.prisma, {
        organizationId: org,
        scheduleId: 'sched_lease',
        claimedBy: 'worker_a',
        claimedAt: '2026-08-11T16:00:00.000Z',
        claimExpiresAt: '2026-08-11T16:05:00.000Z',
        now: '2026-08-11T16:00:00.000Z',
      });
      expect(granted?.claimedBy).toBe('worker_a');

      const contended = await claimReminderScheduleForProcessing(db.prisma, {
        organizationId: org,
        scheduleId: 'sched_lease',
        claimedBy: 'worker_b',
        claimedAt: '2026-08-11T16:01:00.000Z',
        claimExpiresAt: '2026-08-11T16:06:00.000Z',
        now: '2026-08-11T16:01:00.000Z',
      });
      expect(contended).toBeNull();

      // An abandoned worker must not hold a schedule forever.
      const reclaimed = await claimReminderScheduleForProcessing(db.prisma, {
        organizationId: org,
        scheduleId: 'sched_lease',
        claimedBy: 'worker_b',
        claimedAt: '2026-08-11T16:10:00.000Z',
        claimExpiresAt: '2026-08-11T16:15:00.000Z',
        now: '2026-08-11T16:10:00.000Z',
      });
      expect(reclaimed?.claimedBy).toBe('worker_b');

      const released = await releaseReminderScheduleClaim(db.prisma, {
        organizationId: org,
        scheduleId: 'sched_lease',
        claimedBy: 'worker_b',
      });
      expect(released.claimedBy).toBeNull();
      expect(released.claimExpiresAt).toBeNull();
    });

    it('returns only unleased active schedules whose occurrence has arrived, bounded', async () => {
      const due = await listReminderSchedulesDueForProcessing(db.prisma, {
        organizationId: org,
        dueAtOrBefore: '2026-08-12T00:00:00.000Z',
        now: '2026-08-12T00:00:00.000Z',
        limit: 50,
      });

      expect(due.every((s) => s.status === 'active')).toBe(true);
      expect(
        due.every(
          (s) =>
            s.nextOverdueOccurrenceAt !== null &&
            new Date(s.nextOverdueOccurrenceAt).getTime() <=
              new Date('2026-08-12T00:00:00.000Z').getTime(),
        ),
      ).toBe(true);
      expect(due.some((s) => s.id === 'sched_stopidem')).toBe(false);

      await expect(
        listReminderSchedulesDueForProcessing(db.prisma, {
          organizationId: org,
          dueAtOrBefore: '2026-08-12T00:00:00.000Z',
          now: '2026-08-12T00:00:00.000Z',
          limit: 5000,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });
});
