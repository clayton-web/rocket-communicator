import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  OVERDUE_SUCCESSFUL_DELIVERY_CEILING,
  REMINDER_SCHEDULING_TIME_ZONE,
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
  type TaskStatus,
} from '@aicaa/domain';
import {
  buildReminderLifecycleAudit,
  createReminderSchedule,
  createTask,
  findReminderScheduleByTaskId,
  reconcileReminderScheduleForTaskStatus,
  recordSkippedReminderOccurrence,
  stopReminderSchedule,
  suspendReminderScheduleForWaiting,
  upsertRecipient,
  type ReminderLifecycleEffect,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

/**
 * A8 lifecycle wiring: reminder schedule state reconciled against Task status (D107).
 *
 * The route tests in `apps/web` prove the wiring end to end. These prove the properties that are
 * awkward to reach through a route: that reconciliation is idempotent, that it refuses to revive or
 * reinterpret a terminally stopped schedule, that resume computes forward rather than replaying, and
 * that the derived audit event attributes the transition to whoever actually caused it.
 *
 * PGlite is sufficient here because none of this is a race. The concurrent behaviour is proven against
 * a real server in `apps/web/__tests__/owner-reminder-concurrency.pg.test.ts`.
 */

const org = 'org_lifecycle_effects';
const zone = REMINDER_SCHEDULING_TIME_ZONE;
const at = '2026-08-01T12:00:00.000Z';

function recipientFixture(id: string): Recipient {
  return {
    id: asRecipientId(id),
    displayName: 'Alex Recipient',
    email: `${id}@example.com`,
    active: true,
  };
}

function taskFixture(id: string, status: TaskStatus): Task {
  return {
    id: asTaskId(id),
    organizationId: asOrganizationId(org),
    status,
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
      assignedByOwnerId: asOwnerId('owner_lifecycle'),
      allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
    },
  } as Task;
}

describe('A8 lifecycle reminder reconciliation (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  let sequence = 0;

  async function seed(options: {
    status?: TaskStatus;
    withSchedule?: boolean;
    advanceEnabled?: boolean;
  } = {}) {
    sequence += 1;
    const taskId = `task_lc_${sequence}`;
    const dueLocalDate = parseLocalDate('2026-08-10');
    await upsertRecipient(db.prisma, {
      organizationId: org,
      recipient: recipientFixture(`rcp_${taskId}`),
    });
    const task = taskFixture(taskId, options.status ?? 'open');
    await createTask(db.prisma, org, task, task.assignment);
    await db.prisma.task.update({ where: { id: taskId }, data: { dueLocalDate } });

    if (options.withSchedule !== false) {
      const advanceEnabled = options.advanceEnabled ?? true;
      const advance = decideAdvanceReminder({ dueLocalDate, establishedAt: at, advanceEnabled });
      const nextOverdue = selectNextOverdueOccurrence({ dueLocalDate, now: at });
      await createReminderSchedule(db.prisma, {
        id: `sched_${taskId}`,
        organizationId: org,
        taskId,
        dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt: at,
        advanceEnabled,
        advanceDisposition:
          advance.kind === 'not_enabled'
            ? 'not_enabled'
            : advance.kind === 'skipped'
              ? 'skipped_window_elapsed'
              : 'scheduled',
        advanceOccurrence: {
          occurrenceLocalDate: advance.occurrenceLocalDate,
          occurrenceAt: advance.occurrenceAt,
        },
        nextOverdueOccurrence: {
          occurrenceLocalDate: nextOverdue.occurrenceLocalDate,
          occurrenceAt: nextOverdue.occurrenceAt,
        },
      });
    }
    return { taskId, scheduleId: `sched_${taskId}`, dueLocalDate };
  }

  /** Reconcile in a transaction, since the reconciler may only ever join one. */
  function reconcile(
    taskId: string,
    taskStatus: TaskStatus,
    now = at,
  ): Promise<ReminderLifecycleEffect | null> {
    return db.prisma.$transaction((tx) =>
      reconcileReminderScheduleForTaskStatus(tx, { organizationId: org, taskId, taskStatus, now }),
    );
  }

  describe('entering waiting', () => {
    it('suspends an active schedule and clears the claimable occurrence', async () => {
      const seeded = await seed();

      const effect = await reconcile(seeded.taskId, 'waiting');

      expect(effect?.transition).toBe('suspended_for_waiting');
      expect(effect?.priorStatus).toBe('active');
      expect(effect?.schedule.status).toBe('suspended_waiting');
      expect(effect?.schedule.nextOverdueOccurrenceAt).toBeNull();
      // Generation is untouched: entering Waiting is a pause, not a new scheduling decision.
      expect(effect?.schedule.generation).toBe(1);
      expect(await getTaskDueLocalDate()).toBe('2026-08-10');
    });

    it('is idempotent when the schedule is already suspended for waiting', async () => {
      const seeded = await seed();
      const first = await reconcile(seeded.taskId, 'waiting');

      const second = await reconcile(seeded.taskId, 'waiting');

      expect(second).toBeNull();
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      // No effect means no event and no version movement, so a repeated transition cannot inflate the
      // history or invalidate an Owner's ETag for nothing.
      expect(schedule?.reminderVersion).toBe(first?.schedule.reminderVersion);
    });

    it('does not convert a terminally stopped schedule into a waiting suspension', async () => {
      const seeded = await seed();
      await stopReminderSchedule(db.prisma, {
        organizationId: org,
        scheduleId: seeded.scheduleId,
        reason: 'due_date_removed',
        stoppedAt: at,
      });

      const effect = await reconcile(seeded.taskId, 'waiting');

      expect(effect).toBeNull();
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.status).toBe('stopped');
      expect(schedule?.stopReason).toBe('due_date_removed');
    });

    it('does nothing for a task that has no schedule', async () => {
      const seeded = await seed({ withSchedule: false });

      expect(await reconcile(seeded.taskId, 'waiting')).toBeNull();
      expect(await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId)).toBeNull();
    });

    async function getTaskDueLocalDate(): Promise<string | null> {
      const row = await db.prisma.task.findFirst({
        where: { organizationId: org },
        orderBy: { createdAt: 'desc' },
        select: { dueLocalDate: true },
      });
      return row?.dueLocalDate ?? null;
    }
  });

  describe('leaving waiting', () => {
    async function seedSuspended() {
      const seeded = await seed();
      await suspendReminderScheduleForWaiting(db.prisma, {
        organizationId: org,
        scheduleId: seeded.scheduleId,
        suspendedAt: at,
      });
      return seeded;
    }

    it('resumes to an occurrence strictly after the resume instant', async () => {
      const seeded = await seedSuspended();
      const resumeAt = '2026-11-20T18:00:00.000Z';

      const effect = await reconcile(seeded.taskId, 'open', resumeAt);

      expect(effect?.transition).toBe('resumed_from_waiting');
      expect(effect?.schedule.status).toBe('active');
      expect(new Date(effect!.nextOverdueOccurrenceAt!).getTime()).toBeGreaterThan(
        new Date(resumeAt).getTime(),
      );
    });

    it('arms exactly one occurrence rather than the backlog waiting covered', async () => {
      const seeded = await seedSuspended();
      // Over three months of 09:00 mornings elapsed between the due date and this resume.
      const resumeAt = '2026-11-20T18:00:00.000Z';

      const effect = await reconcile(seeded.taskId, 'open', resumeAt);

      // The occurrence is the next local morning, not the first one missed back in August. No
      // elapsed-time accounting, and nothing due at the resume instant merely because time passed.
      expect(effect?.schedule.nextOverdueOccurrenceLocalDate).toBe('2026-11-21');
      expect(effect?.schedule.overdueDeliveredCount).toBe(0);
    });

    it('does not re-enable an OFF advance preference on resume (D178)', async () => {
      const seeded = await seed({ advanceEnabled: false });
      await suspendReminderScheduleForWaiting(db.prisma, {
        organizationId: org,
        scheduleId: seeded.scheduleId,
        suspendedAt: at,
      });

      const effect = await reconcile(seeded.taskId, 'open', '2026-08-12T18:00:00.000Z');

      expect(effect?.schedule.advanceEnabled).toBe(false);
      expect(effect?.schedule.advanceDisposition).toBe('not_enabled');
      expect(effect?.schedule.nextOverdueOccurrenceLocalDate).toBeTruthy();
    });

    it('resumes to in_progress the same way it resumes to open', async () => {
      const seeded = await seedSuspended();

      const effect = await reconcile(seeded.taskId, 'in_progress');

      // `resumeTask` restores whichever actionable status the Task left, and both mean "reminders
      // should run", so the reconciler must not care which one it got.
      expect(effect?.transition).toBe('resumed_from_waiting');
      expect(effect?.schedule.status).toBe('active');
    });

    it('preserves the generation and the delivered-overdue count', async () => {
      const seeded = await seedSuspended();
      await db.prisma.taskReminderSchedule.update({
        where: { id: seeded.scheduleId },
        data: { overdueDeliveredCount: 3 },
      });

      const effect = await reconcile(seeded.taskId, 'open');

      expect(effect?.schedule.generation).toBe(1);
      // Waiting does not forgive overdue deliveries already made: the count survives, so the D106
      // ceiling still counts them.
      expect(effect?.schedule.overdueDeliveredCount).toBe(3);
    });

    it('arms no occurrence when the generation already reached the overdue ceiling', async () => {
      const seeded = await seedSuspended();
      await db.prisma.taskReminderSchedule.update({
        where: { id: seeded.scheduleId },
        data: { overdueDeliveredCount: OVERDUE_SUCCESSFUL_DELIVERY_CEILING },
      });

      const effect = await reconcile(seeded.taskId, 'open');

      // Otherwise Waiting could be used to buy overdue reminders past the D106 limit.
      expect(effect?.transition).toBe('resumed_from_waiting');
      expect(effect?.nextOverdueOccurrenceAt).toBeNull();
      expect(effect?.schedule.nextOverdueOccurrenceAt).toBeNull();
    });

    it('does not revive a terminally stopped schedule', async () => {
      const seeded = await seedSuspended();
      await stopReminderSchedule(db.prisma, {
        organizationId: org,
        scheduleId: seeded.scheduleId,
        reason: 'task_completed',
        stoppedAt: at,
      });

      const effect = await reconcile(seeded.taskId, 'open');

      // Reactivating a stopped schedule is an explicit Owner act (D109). Leaving Waiting is not it,
      // and neither is reopening — which is why no reopen path can resurrect reminders by accident.
      expect(effect).toBeNull();
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.status).toBe('stopped');
      expect(schedule?.nextOverdueOccurrenceAt).toBeNull();
    });

    it('is idempotent for an already-active schedule', async () => {
      const seeded = await seed();

      expect(await reconcile(seeded.taskId, 'open')).toBeNull();
    });
  });

  /**
   * The advance occurrence a Waiting period spanned (A8 lifecycle audit H-2).
   *
   * The rule: a Task that stays Waiting through its scheduled advance morning loses that advance
   * reminder permanently for the current generation. It is never replayed on resume, and the row stops
   * claiming it is pending — while the occurrence's own local date and instant survive, so the history
   * can still say which morning was missed.
   *
   * Before this, suspension preserved `advance_disposition = 'scheduled'` (correct — a short Waiting
   * period must not cost the Owner their advance reminder) and resume never revisited it, so a Task
   * that waited past its advance morning came back **active** carrying a scheduled advance occurrence
   * whose instant was already in the past. The audit reproduced exactly that state on real PostgreSQL.
   *
   * The boundary is `<=`: resuming at exactly the advance instant is too late, matching a generation
   * established at exactly 09:00 on the advance morning, which gets no advance reminder either.
   */
  describe('advance occurrence spanned by waiting', () => {
    /**
     * A Waiting-suspended schedule whose advance occurrence is known precisely.
     *
     * The advance instant is read back from the row rather than recomputed here, so the boundary tests
     * compare against the instant the domain actually resolved through `America/Vancouver` rather than
     * against a second guess at it.
     */
    async function seedSuspendedWithAdvance(dueLocalDate: string, establishedAt: string) {
      sequence += 1;
      const taskId = `task_adv_${sequence}`;
      const scheduleId = `sched_${taskId}`;
      const due = parseLocalDate(dueLocalDate);
      await upsertRecipient(db.prisma, {
        organizationId: org,
        recipient: recipientFixture(`rcp_${taskId}`),
      });
      const task = taskFixture(taskId, 'waiting');
      await createTask(db.prisma, org, task, task.assignment);
      await db.prisma.task.update({ where: { id: taskId }, data: { dueLocalDate: due } });

      const advance = decideAdvanceReminder({ dueLocalDate: due, establishedAt });
      const nextOverdue = selectNextOverdueOccurrence({ dueLocalDate: due, now: establishedAt });
      await createReminderSchedule(db.prisma, {
        id: scheduleId,
        organizationId: org,
        taskId,
        dueLocalDate: due,
        schedulingTimeZone: zone,
        establishedAt,
        advanceDisposition: advance.kind === 'skipped' ? 'skipped_window_elapsed' : 'scheduled',
        advanceOccurrence: {
          occurrenceLocalDate: advance.occurrenceLocalDate,
          occurrenceAt: advance.occurrenceAt,
        },
        nextOverdueOccurrence: {
          occurrenceLocalDate: nextOverdue.occurrenceLocalDate,
          occurrenceAt: nextOverdue.occurrenceAt,
        },
      });
      await suspendReminderScheduleForWaiting(db.prisma, {
        organizationId: org,
        scheduleId,
        suspendedAt: establishedAt,
      });

      const suspended = await findReminderScheduleByTaskId(db.prisma, org, taskId);
      return {
        taskId,
        scheduleId,
        dueLocalDate: due,
        advanceOccurrenceAt: suspended!.advanceOccurrenceAt,
        advanceOccurrenceLocalDate: suspended!.advanceOccurrenceLocalDate,
      };
    }

    /** A due date far enough out that the advance occurrence is genuinely scheduled. */
    const FUTURE_DUE = '2026-08-10';
    const ESTABLISHED = '2026-08-01T12:00:00.000Z';

    function shift(instant: string, ms: number): string {
      return new Date(new Date(instant).getTime() + ms).toISOString();
    }

    it('keeps a scheduled advance occurrence that is still in the future', async () => {
      const seeded = await seedSuspendedWithAdvance(FUTURE_DUE, ESTABLISHED);

      const effect = await reconcile(
        seeded.taskId,
        'open',
        shift(seeded.advanceOccurrenceAt, -1000),
      );

      // A Task that waits an hour and resumes before its advance morning must still get that
      // reminder, so resume leaves the disposition alone and arms the schedule as it was.
      expect(effect?.schedule.advanceDisposition).toBe('scheduled');
      expect(effect?.schedule.advanceOccurrenceAt).toBe(seeded.advanceOccurrenceAt);
      expect(effect?.skippedAdvanceOccurrenceLocalDate).toBeNull();
      expect(effect?.schedule.status).toBe('active');
    });

    it('skips the advance occurrence when resume lands exactly on its instant', async () => {
      const seeded = await seedSuspendedWithAdvance(FUTURE_DUE, ESTABLISHED);

      const effect = await reconcile(seeded.taskId, 'open', seeded.advanceOccurrenceAt);

      // `<=`, not `<`: an advance reminder is never sent late, and 09:00 exactly is already too late,
      // exactly as it is for a generation established at that instant.
      expect(effect?.schedule.advanceDisposition).toBe('skipped_waiting_elapsed');
      expect(effect?.skippedAdvanceOccurrenceLocalDate).toBe(seeded.advanceOccurrenceLocalDate);
    });

    it('skips the advance occurrence one millisecond after its instant', async () => {
      const seeded = await seedSuspendedWithAdvance(FUTURE_DUE, ESTABLISHED);

      const effect = await reconcile(seeded.taskId, 'open', shift(seeded.advanceOccurrenceAt, 1));

      expect(effect?.schedule.advanceDisposition).toBe('skipped_waiting_elapsed');
    });

    it('preserves the original advance local date and instant when it skips', async () => {
      const seeded = await seedSuspendedWithAdvance(FUTURE_DUE, ESTABLISHED);

      const effect = await reconcile(seeded.taskId, 'open', '2026-11-20T18:00:00.000Z');

      // History, not scheduling state: the Owner surface must still be able to say *which* morning
      // Waiting covered, so only the disposition moves.
      expect(effect?.schedule.advanceOccurrenceLocalDate).toBe(seeded.advanceOccurrenceLocalDate);
      expect(effect?.schedule.advanceOccurrenceAt).toBe(seeded.advanceOccurrenceAt);
      expect(effect?.schedule.advanceDisposition).toBe('skipped_waiting_elapsed');
    });

    it('never classifies a waiting-spanned occurrence as advance_window_elapsed', async () => {
      const seeded = await seedSuspendedWithAdvance(FUTURE_DUE, ESTABLISHED);

      const effect = await reconcile(seeded.taskId, 'open', '2026-08-20T18:00:00.000Z');

      // The two reasons answer different questions — "the Owner set the date too late" versus "the
      // Recipient's Waiting period covered the reminder" — and collapsing them loses the answer.
      expect(effect?.schedule.advanceDisposition).not.toBe('skipped_window_elapsed');
      expect(effect?.schedule.advanceDisposition).toBe('skipped_waiting_elapsed');
    });

    it('leaves an advance occurrence already skipped at establishment alone', async () => {
      // Established the day the Task was already due, so the advance morning had passed before the
      // schedule existed (D105).
      const seeded = await seedSuspendedWithAdvance('2026-08-01', ESTABLISHED);
      const before = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(before?.advanceDisposition).toBe('skipped_window_elapsed');

      const effect = await reconcile(seeded.taskId, 'open', '2026-08-20T18:00:00.000Z');

      // There is nothing pending to skip, and the establishment-time reason is the truthful one.
      expect(effect?.schedule.advanceDisposition).toBe('skipped_window_elapsed');
      expect(effect?.skippedAdvanceOccurrenceLocalDate).toBeNull();
    });

    it('leaves an advance occurrence with a recorded attempt alone', async () => {
      const seeded = await seedSuspendedWithAdvance(FUTURE_DUE, ESTABLISHED);
      // What a future worker would leave behind once it has processed the advance occurrence. No
      // worker exists yet; the guard exists so that when one does, resume cannot rewrite its record.
      await recordSkippedReminderOccurrence(db.prisma, {
        id: `rda_${seeded.taskId}`,
        organizationId: org,
        scheduleId: seeded.scheduleId,
        generation: 1,
        occurrenceKind: 'advance',
        occurrenceLocalDate: parseLocalDate(seeded.advanceOccurrenceLocalDate),
        occurrenceAt: seeded.advanceOccurrenceAt,
        skipReason: 'no_active_assignment',
        recordedAt: ESTABLISHED,
      });

      const effect = await reconcile(seeded.taskId, 'open', '2026-11-20T18:00:00.000Z');

      // Relabelling the disposition behind an existing attempt row would make the schedule and the
      // attempt history disagree about what happened to the same occurrence.
      expect(effect?.schedule.advanceDisposition).toBe('scheduled');
      expect(effect?.skippedAdvanceOccurrenceLocalDate).toBeNull();
    });

    it('preserves generation and overdue count while skipping the advance', async () => {
      const seeded = await seedSuspendedWithAdvance(FUTURE_DUE, ESTABLISHED);
      await db.prisma.taskReminderSchedule.update({
        where: { id: seeded.scheduleId },
        data: { overdueDeliveredCount: 2 },
      });

      const effect = await reconcile(seeded.taskId, 'open', '2026-11-20T18:00:00.000Z');

      expect(effect?.schedule.generation).toBe(1);
      expect(effect?.schedule.overdueDeliveredCount).toBe(2);
    });

    it('arms only a strictly future overdue occurrence and no advance backlog', async () => {
      const seeded = await seedSuspendedWithAdvance(FUTURE_DUE, ESTABLISHED);
      const resumeAt = '2026-11-20T18:00:00.000Z';

      const effect = await reconcile(seeded.taskId, 'open', resumeAt);

      expect(new Date(effect!.schedule.nextOverdueOccurrenceAt!).getTime()).toBeGreaterThan(
        new Date(resumeAt).getTime(),
      );
      // The skipped advance is not re-armed as an occurrence, and no attempt row is invented for it:
      // nothing was sent, so nothing is recorded as sent (or as failed).
      expect(
        await db.prisma.reminderDeliveryAttempt.count({
          where: { organizationId: org, scheduleId: seeded.scheduleId },
        }),
      ).toBe(0);
    });

    it('is idempotent across repeated resumes', async () => {
      const seeded = await seedSuspendedWithAdvance(FUTURE_DUE, ESTABLISHED);
      const first = await reconcile(seeded.taskId, 'open', '2026-11-20T18:00:00.000Z');

      const second = await reconcile(seeded.taskId, 'open', '2026-11-21T18:00:00.000Z');

      // The schedule is already active, so there is no gap to close: no event, no version movement,
      // and no second chance to reinterpret the advance disposition.
      expect(second).toBeNull();
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.reminderVersion).toBe(first?.schedule.reminderVersion);
      expect(schedule?.advanceDisposition).toBe('skipped_waiting_elapsed');
    });

    it('skips across the spring DST transition without fixed-day arithmetic', async () => {
      // Advance morning is 2027-03-13, the day before the due date; 2027-03-14 is the spring-forward
      // day in America/Vancouver, so the resume window spans a 23-hour local day.
      const seeded = await seedSuspendedWithAdvance('2027-03-14', '2027-03-01T12:00:00.000Z');

      const effect = await reconcile(seeded.taskId, 'open', '2027-03-16T17:00:00.000Z');

      expect(effect?.schedule.advanceDisposition).toBe('skipped_waiting_elapsed');
      expect(effect?.schedule.advanceOccurrenceLocalDate).toBe('2027-03-13');
      // The armed occurrence is still 09:00 local on a real calendar day, resolved through the zone
      // rather than by adding 24-hour blocks.
      expect(effect?.schedule.nextOverdueOccurrenceAt).toBe('2027-03-17T16:00:00.000Z');
    });

    it('skips across the fall DST transition without fixed-day arithmetic', async () => {
      // 2026-11-01 is the fall-back day in America/Vancouver, so the local day is 25 hours long.
      const seeded = await seedSuspendedWithAdvance('2026-11-01', '2026-10-20T12:00:00.000Z');

      const effect = await reconcile(seeded.taskId, 'open', '2026-11-03T18:00:00.000Z');

      expect(effect?.schedule.advanceDisposition).toBe('skipped_waiting_elapsed');
      expect(effect?.schedule.advanceOccurrenceLocalDate).toBe('2026-10-31');
      // 09:00 PST, an hour later in UTC than the same wall clock before the transition.
      expect(effect?.schedule.nextOverdueOccurrenceAt).toBe('2026-11-04T17:00:00.000Z');
    });

    it('records the advance skip in the derived resume audit note', async () => {
      const seeded = await seedSuspendedWithAdvance(FUTURE_DUE, ESTABLISHED);
      const effect = await reconcile(seeded.taskId, 'open', '2026-11-20T18:00:00.000Z');

      const audit = buildReminderLifecycleAudit(
        {
          id: 'audit_resume_adv',
          organizationId: org,
          actorKind: 'capability',
          capabilityId: 'cap_resume',
          action: 'task.resumed',
        },
        effect!,
        '2026-11-20T18:00:00.000Z',
      );

      expect(audit.action).toBe('reminder.schedule.resumed');
      expect(audit.note).toContain('advance_disposition=skipped_waiting_elapsed');
      expect(audit.note).toContain(
        `advance_occurrence_local_date=${seeded.advanceOccurrenceLocalDate}`,
      );
      expect(audit.note).toContain('advance_skip_reason=waiting_spanned_occurrence');
      // The initiating actor is preserved, and nothing claims a send happened.
      expect(audit.actorKind).toBe('capability');
      expect(audit.capabilityId).toBe('cap_resume');
      expect(audit.outcome).toBe('succeeded');
      expect(audit.note).not.toContain('sent');
    });

    it('says nothing about the advance when the occurrence is still pending', async () => {
      const seeded = await seedSuspendedWithAdvance(FUTURE_DUE, ESTABLISHED);
      const resumeAt = shift(seeded.advanceOccurrenceAt, -1000);
      const effect = await reconcile(seeded.taskId, 'open', resumeAt);

      const audit = buildReminderLifecycleAudit(
        {
          id: 'audit_resume_pending',
          organizationId: org,
          actorKind: 'owner',
          ownerId: 'owner_lifecycle',
          action: 'task.resumed',
        },
        effect!,
        resumeAt,
      );

      expect(audit.note).not.toContain('advance_disposition');
      expect(audit.note).not.toContain('advance_skip_reason');
    });

    /**
     * The invariant a future due-scan depends on, asserted against the database rather than the API.
     *
     * No schedule that became active *through a resume after Waiting* may hold a `scheduled` advance
     * occurrence whose instant has already passed. This is the query the audit ran to prove the defect
     * was reachable, and it is why the decision lives in persisted state: the worker must not have to
     * invent the product rule.
     *
     * Scoped to the schedules this test resumed, and that scope is the point rather than a convenience.
     * An active schedule whose advance instant is merely in the past is not by itself wrong — a worker
     * that has not yet reached a pending occurrence leaves exactly that row, and this suite's other
     * fixtures are full of them. What must never exist is the row a *resume* left behind, because a
     * resume has already decided the occurrence is unsendable and must say so.
     */
    it('leaves no resumed schedule holding an elapsed scheduled advance occurrence', async () => {
      const resumeAt = '2026-11-20T18:00:00.000Z';
      const resumedScheduleIds: string[] = [];
      for (const dueLocalDate of ['2026-08-10', '2026-08-01', '2026-09-15']) {
        const seeded = await seedSuspendedWithAdvance(dueLocalDate, ESTABLISHED);
        await reconcile(seeded.taskId, 'open', resumeAt);
        resumedScheduleIds.push(seeded.scheduleId);
      }

      const idPlaceholders = resumedScheduleIds.map((_, index) => `$${index + 3}`).join(', ');
      const offenders = await db.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM task_reminder_schedules
         WHERE organization_id = $1
           AND status = 'active'
           AND advance_disposition = 'scheduled'
           AND advance_occurrence_at <= $2::timestamptz
           AND id IN (${idPlaceholders})`,
        org,
        resumeAt,
        ...resumedScheduleIds,
      );

      expect(offenders).toEqual([]);
    });
  });

  describe('terminal stops', () => {
    it('stops an active schedule with a completion reason', async () => {
      const seeded = await seed();

      const effect = await reconcile(seeded.taskId, 'completed');

      expect(effect?.transition).toBe('stopped');
      expect(effect?.stopReason).toBe('task_completed');
      expect(effect?.schedule.status).toBe('stopped');
      expect(effect?.schedule.nextOverdueOccurrenceAt).toBeNull();
      // History is preserved, not deleted: the row and its generation survive the stop (D107, D109).
      expect(effect?.schedule.generation).toBe(1);
    });

    it('stops an active schedule with a dismissal reason', async () => {
      const seeded = await seed();

      const effect = await reconcile(seeded.taskId, 'dismissed');

      expect(effect?.stopReason).toBe('task_dismissed');
      expect(effect?.schedule.status).toBe('stopped');
    });

    it('stops a waiting-suspended schedule too', async () => {
      const seeded = await seed();
      await suspendReminderScheduleForWaiting(db.prisma, {
        organizationId: org,
        scheduleId: seeded.scheduleId,
        suspendedAt: at,
      });

      const effect = await reconcile(seeded.taskId, 'completed');

      // A Waiting Task can be completed directly, so the suspension must be stopped rather than left
      // as a pause on a Task that will never resume.
      expect(effect?.priorStatus).toBe('suspended_waiting');
      expect(effect?.schedule.status).toBe('stopped');
      expect(effect?.stopReason).toBe('task_completed');
    });

    it('is idempotent and does not overwrite an existing stop reason', async () => {
      const seeded = await seed();
      await reconcile(seeded.taskId, 'completed');

      const second = await reconcile(seeded.taskId, 'completed');

      expect(second).toBeNull();
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.stopReason).toBe('task_completed');
    });

    it('does not restate a due-date removal as a completion stop', async () => {
      const seeded = await seed();
      await stopReminderSchedule(db.prisma, {
        organizationId: org,
        scheduleId: seeded.scheduleId,
        reason: 'due_date_removed',
        stoppedAt: at,
      });

      const effect = await reconcile(seeded.taskId, 'completed');

      // Reminders ended when the Owner removed the date. Completing the Task later does not get to
      // rewrite why they ended.
      expect(effect).toBeNull();
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.stopReason).toBe('due_date_removed');
    });
  });

  describe('derived audit attribution (D110)', () => {
    async function effectFor(status: TaskStatus): Promise<ReminderLifecycleEffect> {
      const seeded = await seed();
      const effect = await reconcile(seeded.taskId, status);
      expect(effect).not.toBeNull();
      return effect!;
    }

    it('attributes an Owner-caused transition to the owner', async () => {
      const effect = await effectFor('completed');

      const event = buildReminderLifecycleAudit(
        {
          id: 'audit_owner_1',
          organizationId: org,
          actorKind: 'owner',
          ownerId: 'owner_lifecycle',
          action: 'complete_task',
          requestId: 'req-1',
        },
        effect,
        at,
      );

      expect(event.actorKind).toBe('owner');
      expect(event.ownerId).toBe('owner_lifecycle');
      expect(event.capabilityId).toBeUndefined();
      expect(event.action).toBe('reminder.schedule.stopped');
      expect(event.requestId).toBe('req-1');
    });

    it('attributes a Recipient-caused transition to the capability, never the owner', async () => {
      const effect = await effectFor('waiting');

      const event = buildReminderLifecycleAudit(
        {
          id: 'audit_cap_1',
          organizationId: org,
          actorKind: 'capability',
          capabilityId: 'cap_1',
          assignmentId: 'asg_1',
          action: 'mark_task_waiting',
        },
        effect,
        at,
      );

      // The whole point of D110's attribution rule: a suspension a Recipient caused must not read as
      // something the Owner did.
      expect(event.actorKind).toBe('capability');
      expect(event.capabilityId).toBe('cap_1');
      expect(event.ownerId).toBeUndefined();
      expect(event.assignmentId).toBe('asg_1');
      expect(event.action).toBe('reminder.schedule.suspended');
    });

    it('names the causing lifecycle action and both schedule states', async () => {
      const effect = await effectFor('dismissed');

      const event = buildReminderLifecycleAudit(
        {
          id: 'audit_note_1',
          organizationId: org,
          actorKind: 'owner',
          ownerId: 'owner_lifecycle',
          action: 'dismiss_task',
        },
        effect,
        at,
      );

      expect(event.note).toContain('cause=dismiss_task');
      expect(event.note).toContain('transition=stopped');
      expect(event.note).toContain('from=active');
      expect(event.note).toContain('to=stopped');
      expect(event.note).toContain('generation=1');
      expect(event.note).toContain('stop_reason=task_dismissed');
      // The reminder resource's version, not the Task's, matching the Owner reminder events.
      expect(event.resourceVersion).toBe(effect.schedule.reminderVersion);
      expect(event.taskStatus).toBe('dismissed');
    });

    it('derives its id from the causing event, recording the causal link', async () => {
      const effect = await effectFor('completed');

      const event = buildReminderLifecycleAudit(
        {
          id: 'audit_cause_1',
          organizationId: org,
          actorKind: 'owner',
          ownerId: 'owner_lifecycle',
          action: 'complete_task',
        },
        effect,
        at,
      );

      expect(event.id).toBe('audit_cause_1.reminder');
      expect(event.id.length).toBeLessThanOrEqual(64);
    });

    it('carries no recipient email, message content, or capability token', async () => {
      const effect = await effectFor('waiting');

      const event = buildReminderLifecycleAudit(
        {
          id: 'audit_privacy_1',
          organizationId: org,
          actorKind: 'capability',
          capabilityId: 'cap_privacy',
          action: 'mark_task_waiting',
        },
        effect,
        at,
      );

      // `capabilityId` already identifies the actor, so the address would add no attribution and
      // duplicate personal data into a second row for nothing.
      expect(event.intendedRecipientEmail).toBeUndefined();
      expect(event.note).toMatch(/^[A-Za-z_]+=[A-Za-z0-9_:.-]+(?: [A-Za-z_]+=[A-Za-z0-9_:.-]+)*$/);
    });
  });
});
