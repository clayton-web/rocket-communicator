// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  REMINDER_SCHEDULING_TIME_ZONE,
  asAssignmentId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  decideAdvanceReminder,
  parseLocalDate,
  selectNextOverdueOccurrence,
  type Recipient,
  type Task,
} from '@aicaa/domain';
import {
  createTask,
  listReminderDeliveryAttemptsForTask,
  openNextReminderGeneration,
  persistEstablishedReminderSchedule,
  stopReminderSchedule,
  suspendReminderScheduleForWaiting,
  upsertRecipient,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { runInternalReminderProcess } from '@/lib/reminders/process-service';
import { FakeReminderTransport } from '@/lib/reminders/transport';

/**
 * A8.4b.3 advance reminder delivery (D105), end to end through the worker.
 *
 * The one advance reminder is the only occurrence in the system that can expire. An overdue
 * occurrence stays owed however late the worker is — the Task is still late, so the nudge is still
 * true — but the advance reminder says "this is due tomorrow", and a worker that reaches it the next
 * morning would be stating something false about a Task due today. Most of what follows is about
 * that boundary and the ways it could be got wrong: sending late, sending twice, sending after a
 * Waiting period swallowed the morning, sending for a generation the Owner has already replaced.
 *
 * The clock matters here more than in any other reminder suite, so every instant is written in UTC
 * with its Vancouver local time beside it. Due date 2026-08-05 puts the advance morning at
 * 2026-08-04 09:00 local (16:00 UTC, PDT) and the first overdue morning at 2026-08-06 09:00 local.
 */

const org = 'org_a8_4b3';
const zone = REMINDER_SCHEDULING_TIME_ZONE;
const ENABLED = { ...process.env, ENABLE_REMINDER_DELIVERY: 'true' } as NodeJS.ProcessEnv;
const ESTABLISHED = '2026-08-01T12:00:00.000Z';
const DUE = '2026-08-05';

/** 2026-08-04 09:05 Vancouver — five minutes after the advance occurrence falls. */
const ADVANCE_MORNING = '2026-08-04T16:05:00.000Z';
/** 2026-08-04 08:55 Vancouver — five minutes before it. */
const BEFORE_ADVANCE = '2026-08-04T15:55:00.000Z';
/** 2026-08-04 23:55 Vancouver — the last minutes of the advance day. Still truthful. */
const ADVANCE_NIGHT = '2026-08-05T06:55:00.000Z';
/** 2026-08-05 09:05 Vancouver — the due date itself. The advance morning is gone. */
const DUE_DAY = '2026-08-05T16:05:00.000Z';
/** 2026-08-06 09:05 Vancouver — the first overdue morning. */
const OVERDUE_MORNING = '2026-08-06T16:05:00.000Z';

let db: TestDatabase;

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
    summaryPoints: [
      { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Confirm the venue booking' },
    ],
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

/** The actionable capability the original assignment email carried, so D130's gate passes. */
async function grantActionableCapability(taskId: string, issuedAt: string): Promise<void> {
  const assignment = await db.prisma.taskAssignment.findFirstOrThrow({
    where: { taskId, organizationId: org, clearedAt: null },
  });
  await db.prisma.taskCapability.create({
    data: {
      id: `cap_${taskId}`,
      organizationId: org,
      taskId,
      assignmentId: assignment.id,
      recipientId: assignment.recipientId,
      intendedRecipientEmail: assignment.intendedRecipientEmail,
      scope: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
      status: 'active',
      tokenHash: `hash_cap_${taskId}`,
      issuedAt: new Date(issuedAt),
      expiresAt: new Date('2027-06-01T00:00:00.000Z'),
      actionableAt: new Date(Date.parse(issuedAt) + 5 * 60_000),
      revokedAt: null,
      revocationReason: null,
    },
  });
  await db.prisma.taskAssignment.update({
    where: { id: assignment.id },
    data: { activeCapabilityId: `cap_${taskId}`, capabilityStatus: 'active' },
  });
}

/**
 * A Task whose advance morning is still ahead of it — the state establishment actually produces.
 *
 * Unlike the overdue suites, nothing here resolves the advance disposition afterwards: an advance
 * occurrence waiting to be delivered is the subject.
 */
async function seedTask(
  key: string,
  options: { dueLocalDate?: string; establishedAt?: string; capability?: false } = {},
): Promise<{ taskId: string; scheduleId: string; advanceOccurrenceAt: string }> {
  const taskId = `task_${key}`;
  const establishedAt = options.establishedAt ?? ESTABLISHED;
  await upsertRecipient(db.prisma, {
    organizationId: org,
    recipient: recipientFixture(`rcp_${taskId}`),
  });
  const task = taskFixture(taskId, establishedAt);
  await createTask(db.prisma, org, task, task.assignment);
  if (options.capability !== false) {
    await grantActionableCapability(taskId, establishedAt);
  }

  const dueLocalDate = parseLocalDate(options.dueLocalDate ?? DUE);
  const advance = decideAdvanceReminder({ dueLocalDate, establishedAt });
  const nextOverdue = selectNextOverdueOccurrence({ dueLocalDate, now: establishedAt });
  expect(advance.kind, 'this fixture is about an advance reminder that can still be sent').toBe(
    'scheduled',
  );

  const { schedule } = await persistEstablishedReminderSchedule({
    db: db.prisma,
    schedule: {
      id: `sched_${key}`,
      organizationId: org,
      taskId,
      dueLocalDate,
      schedulingTimeZone: zone,
      establishedAt,
      advanceDisposition: 'scheduled',
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

  return { taskId, scheduleId: schedule.id, advanceOccurrenceAt: advance.occurrenceAt };
}

/** The worker scan is global, so a schedule an earlier test armed is genuinely due. */
async function quiesce(): Promise<void> {
  const active = await db.prisma.taskReminderSchedule.findMany({
    where: { status: { not: 'stopped' } },
    select: { id: true, organizationId: true },
  });
  for (const schedule of active) {
    await stopReminderSchedule(db.prisma, {
      organizationId: schedule.organizationId,
      scheduleId: schedule.id,
      reason: 'task_completed',
      stoppedAt: '2026-07-31T00:00:00.000Z',
    });
  }
}

function acceptingTransport(): FakeReminderTransport {
  return new FakeReminderTransport({
    defaultResult: { kind: 'accepted', providerMessageRef: 'gmail_advance_1' },
  });
}

async function run(transport: FakeReminderTransport, now: string) {
  const { response } = await runInternalReminderProcess({
    db: db.prisma,
    requestId: 'req_a8_4b3',
    now,
    env: ENABLED,
    transport,
  });
  return response;
}

async function readSchedule(scheduleId: string) {
  return db.prisma.taskReminderSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
}

async function attemptsFor(taskId: string) {
  return listReminderDeliveryAttemptsForTask(db.prisma, org, taskId, { limit: 50 });
}

async function advanceAttempts(taskId: string) {
  return (await attemptsFor(taskId)).filter((attempt) => attempt.occurrenceKind === 'advance');
}

beforeAll(async () => {
  db = await createTestDatabase();
  installDbTestRuntime(db.prisma);
});

afterAll(async () => {
  clearDbTestRuntime();
  await db.close();
});

beforeEach(async () => {
  await quiesce();
});

describe('A8.4b.3: the advance reminder is sent, once, on its own morning', () => {
  it('sends it on the advance morning', async () => {
    const seeded = await seedTask('core_send');
    const transport = acceptingTransport();

    const response = await run(transport, ADVANCE_MORNING);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.occurrenceKind).toBe('advance');
    expect(transport.calls[0]?.occurrenceLocalDate).toBe('2026-08-04');
    expect(transport.calls[0]?.taskId).toBe(seeded.taskId);
    expect(response.delivered).toBe(1);
  });

  it('records the occurrence and settles the disposition to delivered', async () => {
    const seeded = await seedTask('core_record');

    await run(acceptingTransport(), ADVANCE_MORNING);

    const [attempt] = await advanceAttempts(seeded.taskId);
    expect(attempt?.outcome).toBe('success');
    expect(attempt?.occurrenceLocalDate).toBe('2026-08-04');
    expect(attempt?.providerMessageRef).toBe('gmail_advance_1');
    expect(attempt?.scheduleSettledAt).not.toBeNull();
    const schedule = await readSchedule(seeded.scheduleId);
    expect(schedule.advanceDisposition).toBe('delivered');
    // The schedule is still active and still armed for its overdue series.
    expect(schedule.status).toBe('active');
    expect(schedule.nextOverdueOccurrenceAt).not.toBeNull();
  });

  it('does not send it a second time the same morning', async () => {
    const seeded = await seedTask('core_once');

    await run(acceptingTransport(), ADVANCE_MORNING);
    const second = acceptingTransport();
    await run(second, ADVANCE_MORNING);

    expect(second.calls).toEqual([]);
    expect(await advanceAttempts(seeded.taskId)).toHaveLength(1);
  });

  it('is not sent before its occurrence instant', async () => {
    await seedTask('core_early');
    const transport = acceptingTransport();

    await run(transport, BEFORE_ADVANCE);

    expect(transport.calls).toEqual([]);
  });

  /** D106 counts successful *overdue* deliveries. An advance send must not consume one of the 14. */
  it('does not count toward the overdue delivery ceiling', async () => {
    const seeded = await seedTask('core_ceiling');

    await run(acceptingTransport(), ADVANCE_MORNING);

    expect((await readSchedule(seeded.scheduleId)).overdueDeliveredCount).toBe(0);
  });

  it('sends the overdue series afterwards, unaffected', async () => {
    const seeded = await seedTask('core_then_overdue');

    await run(acceptingTransport(), ADVANCE_MORNING);
    const overdue = acceptingTransport();
    await run(overdue, OVERDUE_MORNING);

    expect(overdue.calls).toHaveLength(1);
    expect(overdue.calls[0]?.occurrenceKind).toBe('overdue');
    const schedule = await readSchedule(seeded.scheduleId);
    expect(schedule.advanceDisposition).toBe('delivered');
    expect(schedule.overdueDeliveredCount).toBe(1);
  });
});

describe('A8.4b.3: how late is too late (D105)', () => {
  it('still sends late on the same local day', async () => {
    await seedTask('late_same_day');
    const transport = acceptingTransport();

    await run(transport, ADVANCE_NIGHT);

    // 23:55 on the advance day: "due tomorrow" is still true, so the reminder is still worth sending.
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.occurrenceKind).toBe('advance');
  });

  it('refuses to send once the due date has arrived, and says why', async () => {
    const seeded = await seedTask('late_next_day');
    const transport = acceptingTransport();

    const response = await run(transport, DUE_DAY);

    expect(transport.calls, 'no provider call for a morning that has passed').toEqual([]);
    const [attempt] = await advanceAttempts(seeded.taskId);
    expect(attempt?.outcome).toBe('skipped');
    expect(attempt?.skipReason).toBe('advance_window_elapsed');
    expect(response.skipped).toBe(1);
  });

  it('settles the missed morning so it is truthful and never retried', async () => {
    const seeded = await seedTask('late_settled');

    await run(acceptingTransport(), DUE_DAY);
    const schedule = await readSchedule(seeded.scheduleId);
    // Not `skipped_not_eligible`: nothing was wrong with the Task, the morning simply went by.
    expect(schedule.advanceDisposition).toBe('skipped_window_elapsed');

    // And the settled disposition takes it out of the scan for good.
    const later = acceptingTransport();
    await run(later, DUE_DAY);
    expect(later.calls).toEqual([]);
    expect(await advanceAttempts(seeded.taskId)).toHaveLength(1);
  });

  /**
   * The advance day before a spring-forward is 23 hours long, so any fixed 24-hour lateness budget
   * would keep sending for an hour after the due date had begun. Due 2026-03-09 puts the advance
   * morning on 2026-03-08, the day Vancouver loses an hour at 02:00.
   */
  it('closes the window at local midnight even when the day is 23 hours long', async () => {
    const march = { dueLocalDate: '2026-03-09', establishedAt: '2026-03-01T12:00:00.000Z' };
    const seeded = await seedTask('dst_spring', march);

    // 2026-03-08 23:30 Vancouver (PDT, UTC-7), still inside the short day.
    const insideShortDay = acceptingTransport();
    await run(insideShortDay, '2026-03-09T06:30:00.000Z');
    expect(insideShortDay.calls).toHaveLength(1);

    // A fixed 24 hours from the 09:00 occurrence would still be open at this point; the calendar
    // day is not.
    const seededNext = await seedTask('dst_spring_late', march);
    const afterMidnight = acceptingTransport();
    await run(afterMidnight, '2026-03-09T08:30:00.000Z'); // 2026-03-09 01:30 Vancouver.
    expect(afterMidnight.calls.map((call) => call.taskId)).not.toContain(seededNext.taskId);
    const [missed] = await advanceAttempts(seededNext.taskId);
    expect(missed?.skipReason).toBe('advance_window_elapsed');

    expect((await readSchedule(seeded.scheduleId)).advanceDisposition).toBe('delivered');
  });
});

describe('A8.4b.3: Waiting swallows the morning rather than deferring it', () => {
  it('does not send while the schedule is Waiting', async () => {
    const seeded = await seedTask('waiting_suppressed');
    await suspendReminderScheduleForWaiting(db.prisma, {
      organizationId: org,
      scheduleId: seeded.scheduleId,
      suspendedAt: '2026-08-03T12:00:00.000Z',
    });
    const transport = acceptingTransport();

    await run(transport, ADVANCE_MORNING);

    expect(transport.calls).toEqual([]);
    expect(await advanceAttempts(seeded.taskId)).toEqual([]);
  });

  it('does not send after a resume that lands past the morning, and leaves no backlog', async () => {
    const seeded = await seedTask('waiting_resume');
    await suspendReminderScheduleForWaiting(db.prisma, {
      organizationId: org,
      scheduleId: seeded.scheduleId,
      suspendedAt: '2026-08-03T12:00:00.000Z',
    });
    // The Waiting period spans the advance morning; the lifecycle resume records that fact.
    await db.prisma.taskReminderSchedule.update({
      where: { id: seeded.scheduleId },
      data: {
        status: 'active',
        suspendedAt: null,
        advanceDisposition: 'skipped_waiting_elapsed',
      },
    });
    const transport = acceptingTransport();

    await run(transport, DUE_DAY);

    expect(transport.calls).toEqual([]);
    expect(await advanceAttempts(seeded.taskId)).toEqual([]);
    expect((await readSchedule(seeded.scheduleId)).advanceDisposition).toBe(
      'skipped_waiting_elapsed',
    );
  });

  it('still sends when the resume lands before the morning', async () => {
    const seeded = await seedTask('waiting_early_resume');
    await suspendReminderScheduleForWaiting(db.prisma, {
      organizationId: org,
      scheduleId: seeded.scheduleId,
      suspendedAt: '2026-08-02T12:00:00.000Z',
    });
    await db.prisma.taskReminderSchedule.update({
      where: { id: seeded.scheduleId },
      data: { status: 'active', suspendedAt: null },
    });
    const transport = acceptingTransport();

    await run(transport, ADVANCE_MORNING);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.occurrenceKind).toBe('advance');
  });
});

describe('A8.4b.3: a new generation replaces the advance occurrence', () => {
  /** Move the due date the way the Owner path does: a new generation with freshly derived occurrences. */
  async function moveDueDate(taskId: string, dueLocalDate: string, at: string): Promise<void> {
    const parsed = parseLocalDate(dueLocalDate);
    const advance = decideAdvanceReminder({ dueLocalDate: parsed, establishedAt: at });
    const nextOverdue = selectNextOverdueOccurrence({ dueLocalDate: parsed, now: at });
    const current = await db.prisma.taskReminderSchedule.findFirstOrThrow({ where: { taskId } });
    await openNextReminderGeneration(db.prisma, {
      organizationId: org,
      taskId,
      expectedGeneration: current.generation,
      dueLocalDate: parsed,
      schedulingTimeZone: zone,
      establishedAt: at,
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
  }

  it('does not send the superseded morning when the due date moves later', async () => {
    const seeded = await seedTask('gen_later');
    await moveDueDate(seeded.taskId, '2026-08-12', '2026-08-02T12:00:00.000Z');

    const onOldMorning = acceptingTransport();
    await run(onOldMorning, ADVANCE_MORNING);
    expect(onOldMorning.calls, 'the old advance morning belongs to a replaced generation').toEqual(
      [],
    );

    // 2026-08-11 09:05 Vancouver: the new generation's advance morning.
    const onNewMorning = acceptingTransport();
    await run(onNewMorning, '2026-08-11T16:05:00.000Z');
    expect(onNewMorning.calls).toHaveLength(1);
    expect(onNewMorning.calls[0]?.occurrenceLocalDate).toBe('2026-08-11');
  });

  it('sends the new morning when the due date moves earlier', async () => {
    const seeded = await seedTask('gen_earlier');
    await moveDueDate(seeded.taskId, '2026-08-03', '2026-08-01T13:00:00.000Z');

    // 2026-08-02 09:05 Vancouver: the earlier generation's advance morning.
    const transport = acceptingTransport();
    await run(transport, '2026-08-02T16:05:00.000Z');

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.occurrenceLocalDate).toBe('2026-08-02');
    expect((await readSchedule(seeded.scheduleId)).advanceDisposition).toBe('delivered');
  });

  it('sends nothing once the due date is removed', async () => {
    const seeded = await seedTask('gen_removed');
    await stopReminderSchedule(db.prisma, {
      organizationId: org,
      scheduleId: seeded.scheduleId,
      reason: 'due_date_removed',
      stoppedAt: '2026-08-02T12:00:00.000Z',
    });
    const transport = acceptingTransport();

    await run(transport, ADVANCE_MORNING);

    expect(transport.calls).toEqual([]);
  });

  it('gets a fresh advance occurrence when a due date is restored', async () => {
    const seeded = await seedTask('gen_restored');
    await stopReminderSchedule(db.prisma, {
      organizationId: org,
      scheduleId: seeded.scheduleId,
      reason: 'due_date_removed',
      stoppedAt: '2026-08-02T12:00:00.000Z',
    });
    await moveDueDate(seeded.taskId, '2026-08-12', '2026-08-03T12:00:00.000Z');

    const transport = acceptingTransport();
    await run(transport, '2026-08-11T16:05:00.000Z'); // 2026-08-11 09:05 Vancouver.

    expect(transport.calls).toHaveLength(1);
    const schedule = await readSchedule(seeded.scheduleId);
    expect(schedule.status).toBe('active');
    expect(schedule.advanceDisposition).toBe('delivered');
  });

  it('carries an already-delivered advance across a due-date change without resending it', async () => {
    const seeded = await seedTask('gen_after_delivery');
    await run(acceptingTransport(), ADVANCE_MORNING);
    await moveDueDate(seeded.taskId, '2026-08-12', '2026-08-04T18:00:00.000Z');

    const transport = acceptingTransport();
    await run(transport, '2026-08-11T16:05:00.000Z');

    // The new generation gets its own advance morning; the delivered one stays in history.
    expect(transport.calls).toHaveLength(1);
    const advance = await advanceAttempts(seeded.taskId);
    expect(advance).toHaveLength(2);
    expect(advance.every((attempt) => attempt.outcome === 'success')).toBe(true);
    expect(new Set(advance.map((attempt) => attempt.generation)).size).toBe(2);
  });
});

describe('A8.4b.3: eligibility is re-checked immediately before the advance send', () => {
  for (const status of ['completed', 'dismissed'] as const) {
    it(`sends nothing for a ${status} Task`, async () => {
      const seeded = await seedTask(`elig_${status}`);
      await db.prisma.task.update({ where: { id: seeded.taskId }, data: { status } });
      const transport = acceptingTransport();

      await run(transport, ADVANCE_MORNING);

      expect(transport.calls).toEqual([]);
      const [attempt] = await advanceAttempts(seeded.taskId);
      expect(attempt?.outcome).toBe('skipped');
      expect(attempt?.skipReason).toBe('task_not_eligible');
      expect((await readSchedule(seeded.scheduleId)).advanceDisposition).toBe(
        'skipped_not_eligible',
      );
    });
  }

  it('sends nothing when the assignment has been cleared', async () => {
    const seeded = await seedTask('elig_assignment', { capability: false });
    await db.prisma.taskAssignment.deleteMany({ where: { taskId: seeded.taskId } });
    const transport = acceptingTransport();

    await run(transport, ADVANCE_MORNING);

    expect(transport.calls).toEqual([]);
    expect((await advanceAttempts(seeded.taskId))[0]?.skipReason).toBe('no_active_assignment');
  });

  /** D130: the reminder's only instruction points at the original email, so its capability must live. */
  it('sends nothing when the original capability is no longer actionable', async () => {
    const seeded = await seedTask('elig_capability');
    await db.prisma.taskCapability.updateMany({
      where: { taskId: seeded.taskId },
      data: { status: 'revoked', revokedAt: new Date('2026-08-03T12:00:00.000Z') },
    });
    const transport = acceptingTransport();

    await run(transport, ADVANCE_MORNING);

    expect(transport.calls).toEqual([]);
    expect((await advanceAttempts(seeded.taskId))[0]?.skipReason).toBe('no_actionable_capability');
  });
});

describe('A8.4b.3: what advance delivery must not disturb', () => {
  it('leaves the D129 ambiguity rule untouched by an ambiguous advance send', async () => {
    const seeded = await seedTask('regress_d129');
    const ambiguous = new FakeReminderTransport({
      defaultResult: { kind: 'ambiguous', failureCode: 'GMAIL_AMBIGUOUS_SEND' },
    });

    const response = await run(ambiguous, ADVANCE_MORNING);

    expect(response.ambiguous).toBe(1);
    // One generation holds one advance occurrence, so three consecutive advance ambiguities cannot
    // exist. The schedule records the outcome and keeps going.
    expect(response.ambiguityStops).toBe(0);
    const schedule = await readSchedule(seeded.scheduleId);
    expect(schedule.advanceDisposition).toBe('ambiguous');
    expect(schedule.status).toBe('active');
    expect(schedule.stopReason).toBeNull();
  });

  it('does not stop the overdue series when the advance send fails permanently', async () => {
    const seeded = await seedTask('regress_permanent');
    const failing = new FakeReminderTransport({
      defaultResult: { kind: 'permanent', failureCode: 'GMAIL_RECIPIENT_REJECTED' },
    });

    await run(failing, ADVANCE_MORNING);

    const schedule = await readSchedule(seeded.scheduleId);
    expect(schedule.advanceDisposition).toBe('failed_permanent');
    // An advance failure is not evidence about the overdue series, which has not been tried yet.
    expect(schedule.status).toBe('active');
    expect(schedule.nextOverdueOccurrenceAt).not.toBeNull();
  });

  it('makes no provider call and no claim when delivery is disabled', async () => {
    const seeded = await seedTask('regress_flag');
    const transport = acceptingTransport();

    const { response } = await runInternalReminderProcess({
      db: db.prisma,
      requestId: 'req_a8_4b3_off',
      now: ADVANCE_MORNING,
      env: { ...process.env, ENABLE_REMINDER_DELIVERY: undefined } as NodeJS.ProcessEnv,
      transport,
    });

    expect(response.deliveryEnabled).toBe(false);
    expect(transport.calls).toEqual([]);
    expect(await attemptsFor(seeded.taskId)).toEqual([]);
    expect((await readSchedule(seeded.scheduleId)).advanceDisposition).toBe('scheduled');
  });

  it('claims both kinds when a long outage leaves both occurrences owed', async () => {
    const seeded = await seedTask('regress_both');
    const transport = acceptingTransport();

    // Two mornings after the due date: the advance morning is long gone and the overdue series has
    // begun. Both scans return this schedule, and both occurrences are settled truthfully.
    await run(transport, OVERDUE_MORNING);

    expect(transport.calls.map((call) => call.occurrenceKind)).toEqual(['overdue']);
    const attempts = await attemptsFor(seeded.taskId);
    expect(attempts).toHaveLength(2);
    const advance = attempts.find((attempt) => attempt.occurrenceKind === 'advance');
    expect(advance?.skipReason).toBe('advance_window_elapsed');
    const overdue = attempts.find((attempt) => attempt.occurrenceKind === 'overdue');
    expect(overdue?.outcome).toBe('success');
  });
});
