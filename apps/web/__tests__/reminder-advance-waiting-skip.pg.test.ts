// @vitest-environment node
/**
 * A Waiting period that spans the advance reminder, against a real PostgreSQL server (A8 lifecycle
 * audit H-2).
 *
 * The rule this proves: when a Task stays Waiting through its scheduled advance-reminder occurrence,
 * that advance reminder is permanently skipped for the current generation. Resuming never replays it,
 * the original advance local date and instant survive as history, and the persisted state records that
 * Waiting is what caused the occurrence to be missed.
 *
 * The audit reproduced the opposite on this engine: a Task resumed after its advance morning came back
 * `active` still carrying `advance_disposition = 'scheduled'` with an `advance_occurrence_at` already
 * in the past. Nothing could act on it, because no worker exists — but the row asserted a reminder was
 * pending that must never be sent, and the first due-scan would have had to invent the product rule.
 *
 * ## Why the advance instant is staged rather than waited for
 *
 * These tests use real clocks for `now` at the persistence layer but cannot wait a day for 09:00 local
 * to pass. Establishing a schedule with a past due date does not help either: the domain then decides
 * the advance was `skipped_window_elapsed` at establishment, which is a *different* fact and must stay
 * distinguishable. So the schedule is established with a future due date, suspended for Waiting through
 * the real lifecycle path, and its `advance_occurrence_at` is then moved into the past — which is
 * exactly the row a long Waiting period produces, reached in one step.
 *
 * ## Running it
 *
 * Skipped unless `AICAA_PG_CONCURRENCY_URL` names a **loopback** PostgreSQL with the migrations
 * applied. It is not part of `pnpm verify`, which must not require Docker.
 *
 *   pnpm db:docker:up
 *   AICAA_LOCAL_DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     node packages/db/scripts/run-local-prisma.mjs migrate deploy
 *   AICAA_PG_CONCURRENCY_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     pnpm --filter @aicaa/web exec vitest run reminder-advance-waiting-skip
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CAPABILITY_TTL_MS,
  asAssignmentId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  ownerActor,
  type Task,
  type TaskAssignment,
  type UtcInstant,
} from '@aicaa/domain';
import {
  createPrismaClient,
  createTask,
  findReminderScheduleByTaskId,
  upsertRecipient,
  type DbClient,
} from '@aicaa/db';
import * as aicaaDb from '@aicaa/db/runtime';
import { resetDbRuntimeForTests, setDbRuntimeForTests } from '@/lib/db/runtime-db';
import { issueCapabilityForTask } from '@/lib/capability';
import { markCapabilityTaskWaiting, resumeCapabilityTask } from '@/lib/capability/mutations';
import { markOwnerTaskWaiting, resumeOwnerTask } from '@/lib/tasks/mutations';
import { setOwnerTaskReminder } from '@/lib/reminders/service';

const RAW_URL = process.env.AICAA_PG_CONCURRENCY_URL;

/** Refuse anything but loopback. `packages/db/.env` holds a production URL. */
function assertLoopback(raw: string): string {
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())) {
    throw new Error(`AICAA_PG_CONCURRENCY_URL must be loopback, got ${url.hostname}.`);
  }
  return raw;
}

const describeMaybe = RAW_URL ? describe : describe.skip;

const org = 'org_advance_skip';
const owner = ownerActor(asOwnerId('owner_advance'), asOrganizationId(org));
const pepper = 'advance-skip-pepper-value-32ch!!';
const appUrl = 'http://localhost:3000';

/** Rounds per scenario. Sequential, not contended: the rule must hold every time, not usually. */
const ROUNDS = 3;

describeMaybe('A8 waiting-spanned advance reminder (real PostgreSQL)', () => {
  let prisma: DbClient;
  let sequence = 0;

  beforeAll(async () => {
    prisma = createPrismaClient(assertLoopback(RAW_URL!));
    await prisma.$connect();
    setDbRuntimeForTests(aicaaDb);
  });

  afterAll(async () => {
    resetDbRuntimeForTests();
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await resetOrganizationData();
  });

  /** Dependants first, and deliberately not wrapped in a `catch`: a failed cleanup must be visible. */
  async function resetOrganizationData() {
    await prisma.reminderDeliveryAttempt.deleteMany({ where: { organizationId: org } });
    await prisma.taskReminderSchedule.deleteMany({ where: { organizationId: org } });
    await prisma.auditEvent.deleteMany({ where: { organizationId: org } });
    await prisma.taskCapability.deleteMany({ where: { organizationId: org } });
    await prisma.taskNote.deleteMany({ where: { organizationId: org } });
    await prisma.taskAssignment.deleteMany({ where: { organizationId: org } });
    await prisma.taskSuggestion.deleteMany({ where: { organizationId: org } });
    await prisma.task.deleteMany({ where: { organizationId: org } });
    await prisma.recipient.deleteMany({ where: { organizationId: org } });
  }

  function assignmentFixture(taskId: string, now: string): TaskAssignment {
    return {
      id: asAssignmentId(`asg_${taskId}`),
      recipientId: asRecipientId(`rcp_${taskId}`),
      intendedRecipientEmail: `rcp_${taskId}@example.com`,
      assignedAt: now,
      assignedByOwnerId: owner.ownerId,
      allowedCapabilityActions: ['view_assigned_task', 'mark_task_waiting', 'complete_task'],
    };
  }

  /**
   * A Task with a live reminder schedule whose advance occurrence is genuinely scheduled.
   *
   * The due date is a month out and the schedule is established through the Owner reminder service, so
   * the advance disposition is the one the A8.2 domain actually decided rather than a hand-written row.
   */
  async function seedScheduledTask() {
    sequence += 1;
    const taskId = `task_adv_pg_${sequence}`;
    const now = new Date().toISOString() as UtcInstant;
    const dueLocalDate = localDateInDays(45);

    await upsertRecipient(prisma, {
      organizationId: org,
      recipient: {
        id: asRecipientId(`rcp_${taskId}`),
        displayName: 'Alex Recipient',
        email: `rcp_${taskId}@example.com`,
        active: true,
      },
    });
    const task = {
      id: asTaskId(taskId),
      organizationId: asOrganizationId(org),
      status: 'open',
      summaryPoints: [
        { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Follow up' },
      ],
      notes: [],
      reminder: { paused: false },
      retention: {},
      version: 1,
      createdAt: now,
      updatedAt: now,
      assignment: assignmentFixture(taskId, now),
    } as Task;
    await createTask(prisma, org, task, task.assignment);

    await setOwnerTaskReminder({
      db: prisma,
      owner,
      taskId,
      now,
      dueLocalDate,
      expectedReminderVersion: 0,
    });

    const schedule = await findReminderScheduleByTaskId(prisma, org, taskId);
    expect(schedule?.status).toBe('active');
    expect(schedule?.advanceDisposition).toBe('scheduled');
    return { taskId, now, dueLocalDate, schedule: schedule! };
  }

  /** A local calendar date `days` ahead, formatted for the reminder contract. */
  function localDateInDays(days: number): string {
    const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return target.toISOString().slice(0, 10);
  }

  async function currentTaskVersion(taskId: string): Promise<number> {
    const row = await prisma.task.findFirstOrThrow({
      where: { organizationId: org, id: taskId },
      select: { version: true },
    });
    return row.version;
  }

  /**
   * Move the suspended schedule's advance occurrence into the past.
   *
   * This is the "Waiting lasted past the advance morning" fact, staged because the test cannot wait for
   * it. Only the instant moves; the disposition stays `scheduled`, which is precisely the state
   * suspension legitimately leaves behind and which resume must now resolve.
   */
  async function stageElapsedAdvanceOccurrence(taskId: string, at: Date) {
    const schedule = await findReminderScheduleByTaskId(prisma, org, taskId);
    expect(schedule?.status).toBe('suspended_waiting');
    expect(schedule?.advanceDisposition).toBe('scheduled');
    await prisma.taskReminderSchedule.update({
      where: { id: schedule!.id },
      data: { advanceOccurrenceAt: at },
    });
    return (await findReminderScheduleByTaskId(prisma, org, taskId))!;
  }

  async function reminderEventsFor(taskId: string) {
    const events = await prisma.auditEvent.findMany({
      where: { organizationId: org, taskId },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });
    return events.filter((event) => event.action.startsWith('reminder.'));
  }

  /**
   * Everything the rule promises about a resume that spanned the advance morning.
   *
   * Asserted together because they are one decision, not five: the disposition becomes truthful, the
   * occurrence's identity survives as history, the generation and delivered count are untouched, and the
   * only thing armed is a strictly future overdue occurrence.
   */
  async function assertAdvanceWasSkippedByWaiting(
    taskId: string,
    before: { advanceOccurrenceLocalDate: string; advanceOccurrenceAt: string; generation: number },
    resumedAt: Date,
  ) {
    const after = await findReminderScheduleByTaskId(prisma, org, taskId);
    expect(after?.status).toBe('active');
    expect(after?.advanceDisposition).toBe('skipped_waiting_elapsed');
    // History survives: the Owner surface can still say which morning Waiting covered.
    expect(after?.advanceOccurrenceLocalDate).toBe(before.advanceOccurrenceLocalDate);
    expect(after?.advanceOccurrenceAt).toBe(before.advanceOccurrenceAt);
    // Waiting is a pause, not a new scheduling decision.
    expect(after?.generation).toBe(before.generation);
    expect(after?.overdueDeliveredCount).toBe(0);
    // Exactly one future occurrence, and no backlog of the mornings Waiting covered.
    expect(after?.nextOverdueOccurrenceAt).not.toBeNull();
    expect(new Date(after!.nextOverdueOccurrenceAt!).getTime()).toBeGreaterThan(
      resumedAt.getTime(),
    );
    // Nothing was sent, so nothing is recorded as sent — or as skipped at the delivery layer.
    expect(
      await prisma.reminderDeliveryAttempt.count({
        where: { organizationId: org, scheduleId: after!.id },
      }),
    ).toBe(0);
    return after!;
  }

  it('skips the advance occurrence across an Owner-triggered waiting round trip', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await resetOrganizationData();
      const seeded = await seedScheduledTask();

      await markOwnerTaskWaiting({
        db: prisma,
        owner,
        taskId: seeded.taskId,
        now: seeded.now,
        expectedVersion: await currentTaskVersion(seeded.taskId),
        waitingUntil: new Date(Date.now() + 60_000).toISOString() as UtcInstant,
      });
      const suspended = await stageElapsedAdvanceOccurrence(
        seeded.taskId,
        new Date(Date.now() - 60_000),
      );

      const resumedAt = new Date();
      await resumeOwnerTask({
        db: prisma,
        owner,
        taskId: seeded.taskId,
        now: resumedAt.toISOString() as UtcInstant,
        expectedVersion: await currentTaskVersion(seeded.taskId),
      });

      await assertAdvanceWasSkippedByWaiting(seeded.taskId, suspended, resumedAt);

      const events = await reminderEventsFor(seeded.taskId);
      const resumed = events.find((event) => event.action === 'reminder.schedule.resumed');
      expect(resumed?.actorKind).toBe('owner');
      expect(resumed?.ownerId).toBe(owner.ownerId);
      expect(resumed?.note).toContain('advance_disposition=skipped_waiting_elapsed');
      expect(resumed?.note).toContain(
        `advance_occurrence_local_date=${suspended.advanceOccurrenceLocalDate}`,
      );
      expect(resumed?.note).toContain('advance_skip_reason=waiting_spanned_occurrence');
    }
  });

  it('skips the advance occurrence across a capability-triggered waiting round trip', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await resetOrganizationData();
      const seeded = await seedScheduledTask();
      const issued = await issueCapabilityForTask({
        db: prisma,
        owner,
        taskId: seeded.taskId,
        ttlMs: DEFAULT_CAPABILITY_TTL_MS,
        pepper,
        appUrl,
        now: seeded.now,
      });

      await markCapabilityTaskWaiting({
        db: prisma,
        rawToken: issued.rawToken,
        pepper,
        taskId: seeded.taskId,
        now: seeded.now,
        expectedVersion: await currentTaskVersion(seeded.taskId),
        waitingUntil: new Date(Date.now() + 60_000).toISOString() as UtcInstant,
      });
      const suspended = await stageElapsedAdvanceOccurrence(
        seeded.taskId,
        new Date(Date.now() - 60_000),
      );

      const resumedAt = new Date();
      await resumeCapabilityTask({
        db: prisma,
        rawToken: issued.rawToken,
        pepper,
        taskId: seeded.taskId,
        now: resumedAt.toISOString() as UtcInstant,
        expectedVersion: await currentTaskVersion(seeded.taskId),
      });

      await assertAdvanceWasSkippedByWaiting(seeded.taskId, suspended, resumedAt);

      const events = await reminderEventsFor(seeded.taskId);
      const resumed = events.find((event) => event.action === 'reminder.schedule.resumed');
      // Attributed to the party that actually acted, never to the Owner, and never as a send.
      expect(resumed?.actorKind).toBe('capability');
      expect(resumed?.capabilityId).toBe(issued.capability.id);
      expect(resumed?.ownerId).toBeNull();
      expect(resumed?.note).toContain('advance_disposition=skipped_waiting_elapsed');
      expect(resumed?.note).not.toContain('sent');
    }
  });

  it('keeps a scheduled advance occurrence that is still ahead of the resume', async () => {
    const seeded = await seedScheduledTask();

    await markOwnerTaskWaiting({
      db: prisma,
      owner,
      taskId: seeded.taskId,
      now: seeded.now,
      expectedVersion: await currentTaskVersion(seeded.taskId),
      waitingUntil: new Date(Date.now() + 60_000).toISOString() as UtcInstant,
    });
    const suspended = (await findReminderScheduleByTaskId(prisma, org, seeded.taskId))!;

    await resumeOwnerTask({
      db: prisma,
      owner,
      taskId: seeded.taskId,
      now: new Date().toISOString() as UtcInstant,
      expectedVersion: await currentTaskVersion(seeded.taskId),
    });

    // A short Waiting period must not cost the Owner their advance reminder.
    const after = await findReminderScheduleByTaskId(prisma, org, seeded.taskId);
    expect(after?.advanceDisposition).toBe('scheduled');
    expect(after?.advanceOccurrenceAt).toBe(suspended.advanceOccurrenceAt);
    expect(after?.status).toBe('active');

    const resumed = (await reminderEventsFor(seeded.taskId)).find(
      (event) => event.action === 'reminder.schedule.resumed',
    );
    expect(resumed?.note).not.toContain('advance_disposition');
  });

  it('does not relabel an advance occurrence already skipped at establishment', async () => {
    sequence += 1;
    const taskId = `task_adv_pg_est_${sequence}`;
    const now = new Date().toISOString() as UtcInstant;
    await upsertRecipient(prisma, {
      organizationId: org,
      recipient: {
        id: asRecipientId(`rcp_${taskId}`),
        displayName: 'Alex Recipient',
        email: `rcp_${taskId}@example.com`,
        active: true,
      },
    });
    const task = {
      id: asTaskId(taskId),
      organizationId: asOrganizationId(org),
      status: 'open',
      summaryPoints: [
        { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Follow up' },
      ],
      notes: [],
      reminder: { paused: false },
      retention: {},
      version: 1,
      createdAt: now,
      updatedAt: now,
      assignment: assignmentFixture(taskId, now),
    } as Task;
    await createTask(prisma, org, task, task.assignment);
    // Today's date: the advance morning was yesterday, so it had already elapsed when the Owner chose
    // the date (D105) and no advance reminder was ever scheduled.
    await setOwnerTaskReminder({
      db: prisma,
      owner,
      taskId,
      now,
      dueLocalDate: localDateInDays(0),
      expectedReminderVersion: 0,
    });
    expect((await findReminderScheduleByTaskId(prisma, org, taskId))?.advanceDisposition).toBe(
      'skipped_window_elapsed',
    );

    await markOwnerTaskWaiting({
      db: prisma,
      owner,
      taskId,
      now,
      expectedVersion: await currentTaskVersion(taskId),
      waitingUntil: new Date(Date.now() + 60_000).toISOString() as UtcInstant,
    });
    await resumeOwnerTask({
      db: prisma,
      owner,
      taskId,
      now: new Date().toISOString() as UtcInstant,
      expectedVersion: await currentTaskVersion(taskId),
    });

    // The establishment-time reason is the truthful one, and the two reasons answer different
    // questions. Resume does not get to overwrite the answer.
    const after = await findReminderScheduleByTaskId(prisma, org, taskId);
    expect(after?.advanceDisposition).toBe('skipped_window_elapsed');
    expect(after?.status).toBe('active');
  });

  /**
   * The invariant a future due-scan depends on, asserted in SQL rather than through the API.
   *
   * No schedule that became active through a resume after Waiting may hold a `scheduled` advance
   * occurrence whose instant has already passed. Scoped to the schedules this test resumed, because an
   * active schedule with a merely past advance instant is not by itself wrong — that is what a pending
   * occurrence no worker has reached looks like. What must never exist is the row a *resume* left
   * behind, since a resume has already concluded the occurrence is unsendable.
   */
  it('leaves no resumed schedule holding an elapsed scheduled advance occurrence', async () => {
    const resumedIds: string[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const seeded = await seedScheduledTask();
      await markOwnerTaskWaiting({
        db: prisma,
        owner,
        taskId: seeded.taskId,
        now: seeded.now,
        expectedVersion: await currentTaskVersion(seeded.taskId),
        waitingUntil: new Date(Date.now() + 60_000).toISOString() as UtcInstant,
      });
      await stageElapsedAdvanceOccurrence(seeded.taskId, new Date(Date.now() - 60_000));
      await resumeOwnerTask({
        db: prisma,
        owner,
        taskId: seeded.taskId,
        now: new Date().toISOString() as UtcInstant,
        expectedVersion: await currentTaskVersion(seeded.taskId),
      });
      resumedIds.push(seeded.schedule.id);
    }

    const placeholders = resumedIds.map((_, index) => `$${index + 3}`).join(', ');
    const offenders = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM task_reminder_schedules
       WHERE organization_id = $1
         AND status = 'active'
         AND advance_disposition = 'scheduled'
         AND advance_occurrence_at <= $2::timestamptz
         AND id IN (${placeholders})`,
      org,
      new Date().toISOString(),
      ...resumedIds,
    );

    expect(offenders).toEqual([]);
  });
});
