import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  type LocalDate,
  type Recipient,
  type Task,
} from '@aicaa/domain';
import {
  PersistenceError,
  createReminderSchedule,
  createTask,
  findReminderScheduleByTaskId,
  isSerializationFailure,
  openNextReminderGeneration,
  resumeReminderScheduleFromWaiting,
  stopReminderSchedule,
  suspendReminderScheduleForWaiting,
  upsertRecipient,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

/**
 * A8.3b audit remediation F2 and F5: the reminder concurrency token, and the compare-and-set writes
 * that make it mean something.
 *
 * The audit proved on real PostgreSQL that a removal and a due-date change could both report success
 * while the surviving row contradicted one of them, because removal stopped whatever the row had
 * become rather than the state its caller had observed. These tests pin the persistence half of the
 * fix: `reminder_version` moves exactly when reminder-relevant state moves, and a write whose
 * expectation is stale is refused.
 *
 * **PGlite cannot stage a race** — one connection, serialized statements. What it *can* prove is that
 * the preconditions are enforced, which is the part a two-connection test then relies on. The race
 * itself is proven in `a8-3b-owner-reminder-concurrency.pg.test.ts` against a real server.
 */

const org = 'org_reminder_token';
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

function taskFixture(id: string, organizationId: string): Task {
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

async function rejectionCode(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(PersistenceError);
    return (error as PersistenceError).code;
  }
  throw new Error('Expected the operation to be refused, but it succeeded.');
}

/**
 * The classifier that keeps a database serialization refusal from escaping as a 500.
 *
 * Unit-tested rather than provoked, because a single consistent lock order makes a real deadlock hard
 * to stage on purpose — which is the point of the lock order. The classifier remains as
 * defence-in-depth for the interleavings PostgreSQL may still refuse, so it must be known-correct
 * rather than merely present.
 */
describe('isSerializationFailure', () => {
  it('recognises the Prisma write-conflict code', () => {
    const error = Object.assign(new Error('Transaction failed'), { code: 'P2034' });

    expect(isSerializationFailure(error)).toBe(true);
  });

  it('recognises raw SQLSTATE deadlock and serialization failures', () => {
    expect(isSerializationFailure(new Error('ERROR: 40P01 deadlock detected'))).toBe(true);
    expect(isSerializationFailure(new Error('code 40001 could not serialize access'))).toBe(true);
    expect(isSerializationFailure(new Error('deadlock detected while locking rows'))).toBe(true);
  });

  it('does not mistake an unrelated error for a race', () => {
    expect(isSerializationFailure(new Error('column reminder_version does not exist'))).toBe(false);
    // The digits appear, but not as a SQLSTATE token — a substring match would have been wrong here.
    expect(isSerializationFailure(new Error('task_1440001 not found'))).toBe(false);
    expect(isSerializationFailure(Object.assign(new Error('nope'), { code: 'P2002' }))).toBe(false);
    expect(isSerializationFailure('40P01')).toBe(false);
    expect(isSerializationFailure(null)).toBe(false);
  });
});

describe('A8.3b reminder concurrency token (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  let sequence = 0;

  async function seed(dueLocalDate: LocalDate = parseLocalDate('2026-08-10')) {
    sequence += 1;
    const taskId = `task_token_${sequence}`;
    await upsertRecipient(db.prisma, {
      organizationId: org,
      recipient: recipientFixture(`rcp_${taskId}`),
    });
    const task = taskFixture(taskId, org);
    await createTask(db.prisma, org, task, task.assignment);

    const advance = decideAdvanceReminder({ dueLocalDate, establishedAt: at });
    const nextOverdue = selectNextOverdueOccurrence({ dueLocalDate, now: at });
    return {
      taskId,
      dueLocalDate,
      scheduleId: `sched_${taskId}`,
      input: {
        id: `sched_${taskId}`,
        organizationId: org,
        taskId,
        dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt: at,
        advanceDisposition: 'scheduled' as const,
        advanceOccurrence: {
          occurrenceLocalDate: advance.occurrenceLocalDate,
          occurrenceAt: advance.occurrenceAt,
        },
        nextOverdueOccurrence: {
          occurrenceLocalDate: nextOverdue.occurrenceLocalDate,
          occurrenceAt: nextOverdue.occurrenceAt,
        },
      },
    };
  }

  function generationInput(seeded: Awaited<ReturnType<typeof seed>>, dueLocalDate: LocalDate) {
    const advance = decideAdvanceReminder({ dueLocalDate, establishedAt: at });
    const nextOverdue = selectNextOverdueOccurrence({ dueLocalDate, now: at });
    return {
      organizationId: org,
      taskId: seeded.taskId,
      dueLocalDate,
      schedulingTimeZone: zone,
      establishedAt: at,
      advanceDisposition: 'scheduled' as const,
      advanceOccurrence: {
        occurrenceLocalDate: advance.occurrenceLocalDate,
        occurrenceAt: advance.occurrenceAt,
      },
      nextOverdueOccurrence: {
        occurrenceLocalDate: nextOverdue.occurrenceLocalDate,
        occurrenceAt: nextOverdue.occurrenceAt,
      },
    };
  }

  describe('version movement', () => {
    it('starts a new schedule at version 1', async () => {
      const seeded = await seed();

      const schedule = await createReminderSchedule(db.prisma, seeded.input);

      expect(schedule.reminderVersion).toBe(1);
      expect(schedule.generation).toBe(1);
    });

    it('increments on each generation opened', async () => {
      const seeded = await seed();
      await createReminderSchedule(db.prisma, seeded.input);

      const second = await openNextReminderGeneration(db.prisma, {
        ...generationInput(seeded, parseLocalDate('2026-09-01')),
        expectedGeneration: 1,
        expectedReminderVersion: 1,
      });
      const third = await openNextReminderGeneration(db.prisma, {
        ...generationInput(seeded, parseLocalDate('2026-10-01')),
        expectedGeneration: 2,
        expectedReminderVersion: 2,
      });

      expect([second.reminderVersion, third.reminderVersion]).toEqual([2, 3]);
      expect([second.generation, third.generation]).toEqual([2, 3]);
    });

    it('increments on stop, suspend, and resume', async () => {
      const suspended = await seed();
      await createReminderSchedule(db.prisma, suspended.input);

      const afterSuspend = await suspendReminderScheduleForWaiting(db.prisma, {
        organizationId: org,
        scheduleId: suspended.scheduleId,
        suspendedAt: at,
      });
      expect(afterSuspend.reminderVersion).toBe(2);

      const afterResume = await resumeReminderScheduleFromWaiting(db.prisma, {
        organizationId: org,
        scheduleId: suspended.scheduleId,
        nextOverdueOccurrence: null,
      });
      expect(afterResume.reminderVersion).toBe(3);

      const afterStop = await stopReminderSchedule(db.prisma, {
        organizationId: org,
        scheduleId: suspended.scheduleId,
        reason: 'due_date_removed',
        stoppedAt: at,
      });
      expect(afterStop.reminderVersion).toBe(4);
    });

    it('does not increment for a delivery count or an attention flag', async () => {
      const seeded = await seed();
      await createReminderSchedule(db.prisma, seeded.input);

      // A worker recording its own progress must not invalidate an Owner's in-flight edit, so these
      // two columns are deliberately outside the token.
      await db.prisma.taskReminderSchedule.update({
        where: { id: seeded.scheduleId },
        data: { overdueDeliveredCount: 3, requiresOwnerAttention: true },
      });

      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.reminderVersion).toBe(1);
    });
  });

  describe('compare-and-set on generation change', () => {
    it('refuses a stale reminder version even when the generation still matches', async () => {
      const seeded = await seed();
      await createReminderSchedule(db.prisma, seeded.input);
      // Suspension moves the version without moving the generation — exactly the case a
      // generation-only precondition cannot see.
      await suspendReminderScheduleForWaiting(db.prisma, {
        organizationId: org,
        scheduleId: seeded.scheduleId,
        suspendedAt: at,
      });

      const code = await rejectionCode(() =>
        openNextReminderGeneration(db.prisma, {
          ...generationInput(seeded, parseLocalDate('2026-09-01')),
          expectedGeneration: 1,
          expectedReminderVersion: 1,
        }),
      );

      expect(code).toBe('OPTIMISTIC_CONCURRENCY');
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.generation).toBe(1);
      expect(schedule?.dueLocalDate).toBe('2026-08-10');
    });

    it('refuses to overwrite a schedule that was stopped since the caller read it', async () => {
      const seeded = await seed();
      await createReminderSchedule(db.prisma, seeded.input);
      await stopReminderSchedule(db.prisma, {
        organizationId: org,
        scheduleId: seeded.scheduleId,
        reason: 'due_date_removed',
        stoppedAt: at,
      });

      const code = await rejectionCode(() =>
        openNextReminderGeneration(db.prisma, {
          ...generationInput(seeded, parseLocalDate('2026-09-01')),
          expectedGeneration: 1,
          expectedReminderVersion: 1,
        }),
      );

      expect(code).toBe('OPTIMISTIC_CONCURRENCY');
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.status).toBe('stopped');
    });

    it('allows a change whose expectation is current', async () => {
      const seeded = await seed();
      await createReminderSchedule(db.prisma, seeded.input);

      const changed = await openNextReminderGeneration(db.prisma, {
        ...generationInput(seeded, parseLocalDate('2026-09-01')),
        expectedGeneration: 1,
        expectedReminderVersion: 1,
      });

      expect(changed.dueLocalDate).toBe('2026-09-01');
      expect(changed.reminderVersion).toBe(2);
    });
  });

  describe('compare-and-set on removal', () => {
    it('refuses to stop a schedule that changed since the caller read it', async () => {
      const seeded = await seed();
      await createReminderSchedule(db.prisma, seeded.input);
      await openNextReminderGeneration(db.prisma, {
        ...generationInput(seeded, parseLocalDate('2026-09-01')),
        expectedGeneration: 1,
        expectedReminderVersion: 1,
      });

      const code = await rejectionCode(() =>
        stopReminderSchedule(db.prisma, {
          organizationId: org,
          scheduleId: seeded.scheduleId,
          reason: 'due_date_removed',
          stoppedAt: at,
          expectedReminderVersion: 1,
        }),
      );

      expect(code).toBe('OPTIMISTIC_CONCURRENCY');
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.status).toBe('active');
      expect(schedule?.dueLocalDate).toBe('2026-09-01');
    });

    it('stays idempotent for an already-stopped schedule when the expectation is current', async () => {
      const seeded = await seed();
      await createReminderSchedule(db.prisma, seeded.input);
      const stopped = await stopReminderSchedule(db.prisma, {
        organizationId: org,
        scheduleId: seeded.scheduleId,
        reason: 'due_date_removed',
        stoppedAt: at,
        expectedReminderVersion: 1,
      });

      const repeat = await stopReminderSchedule(db.prisma, {
        organizationId: org,
        scheduleId: seeded.scheduleId,
        reason: 'due_date_removed',
        stoppedAt: at,
        expectedReminderVersion: stopped.reminderVersion,
      });

      expect(repeat.reminderVersion).toBe(stopped.reminderVersion);
      expect(repeat.status).toBe('stopped');
    });

    it('keeps the unconditional stop for lifecycle and worker callers', async () => {
      const seeded = await seed();
      await createReminderSchedule(db.prisma, seeded.input);
      await openNextReminderGeneration(db.prisma, {
        ...generationInput(seeded, parseLocalDate('2026-09-01')),
        expectedGeneration: 1,
        expectedReminderVersion: 1,
      });

      // "Stop this, whatever it is now" is genuinely what completion means, so omitting the
      // expectation must keep working.
      const stopped = await stopReminderSchedule(db.prisma, {
        organizationId: org,
        scheduleId: seeded.scheduleId,
        reason: 'task_completed',
        stoppedAt: at,
      });

      expect(stopped.status).toBe('stopped');
      expect(stopped.stopReason).toBe('task_completed');
    });
  });

  describe('schedules born suspended (F1)', () => {
    it('creates generation 1 suspended, with no claimable occurrence', async () => {
      const seeded = await seed();

      const schedule = await createReminderSchedule(db.prisma, {
        ...seeded.input,
        status: 'suspended_waiting',
        suspendedAt: at,
      });

      expect(schedule.status).toBe('suspended_waiting');
      expect(schedule.generation).toBe(1);
      expect(schedule.reminderVersion).toBe(1);
      expect(schedule.suspendedAt).not.toBeNull();
      expect(schedule.nextOverdueOccurrenceLocalDate).toBeNull();
      expect(schedule.nextOverdueOccurrenceAt).toBeNull();
      // The advance decision is still made once at establishment (D105).
      expect(schedule.advanceDisposition).toBe('scheduled');
      expect(schedule.advanceOccurrenceLocalDate).toBe('2026-08-09');
    });

    it('opens a superseding generation that stays suspended', async () => {
      const seeded = await seed();
      await createReminderSchedule(db.prisma, {
        ...seeded.input,
        status: 'suspended_waiting',
        suspendedAt: at,
      });

      const changed = await openNextReminderGeneration(db.prisma, {
        ...generationInput(seeded, parseLocalDate('2026-09-01')),
        expectedGeneration: 1,
        expectedReminderVersion: 1,
        status: 'suspended_waiting',
        suspendedAt: at,
      });

      expect(changed.status).toBe('suspended_waiting');
      expect(changed.generation).toBe(2);
      expect(changed.nextOverdueOccurrenceAt).toBeNull();
      expect(changed.dueLocalDate).toBe('2026-09-01');
    });

    it('refuses a suspended schedule with no suspension instant', async () => {
      const seeded = await seed();

      const code = await rejectionCode(() =>
        createReminderSchedule(db.prisma, { ...seeded.input, status: 'suspended_waiting' }),
      );

      expect(code).toBe('VALIDATION');
    });

    it('is refused by the database if a suspended row is given a next occurrence directly', async () => {
      const seeded = await seed();
      await createReminderSchedule(db.prisma, {
        ...seeded.input,
        status: 'suspended_waiting',
        suspendedAt: at,
      });

      // The CHECK is the backstop for a caller that bypasses the repository: a suspended row sitting
      // in the worker's due-scan index is the failure this prevents.
      await expect(
        db.pglite.query(
          `UPDATE task_reminder_schedules
             SET next_overdue_occurrence_local_date = '2026-08-11',
                 next_overdue_occurrence_at = now()
           WHERE id = '${seeded.scheduleId}'`,
        ),
      ).rejects.toThrow(/task_reminder_schedules_suspended_has_no_next_occurrence/);
    });
  });
});
