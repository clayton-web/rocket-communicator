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

  async function seed(options: { status?: TaskStatus; withSchedule?: boolean } = {}) {
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
      const advance = decideAdvanceReminder({ dueLocalDate, establishedAt: at });
      const nextOverdue = selectNextOverdueOccurrence({ dueLocalDate, now: at });
      await createReminderSchedule(db.prisma, {
        id: `sched_${taskId}`,
        organizationId: org,
        taskId,
        dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt: at,
        advanceDisposition: 'scheduled',
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
