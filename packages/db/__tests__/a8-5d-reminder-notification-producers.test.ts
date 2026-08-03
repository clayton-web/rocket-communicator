/**
 * A8.5d reminder producers: four events captured inside A8.4b settlement (D133).
 *
 * These four are the ones most at risk of quietly changing something they must not. Reminder
 * settlement is where D106's ceiling, D129's ambiguity rule, and the schedule-stop semantics all
 * live, and A8.5d adds a row to that transaction. So each test below asserts two things at once:
 * that the right event was captured, and that the reminder decision underneath it is the decision
 * A8.4b already made. A stop that stopped differently would fail here even if its notification was
 * perfect.
 *
 * The fourth event, `reminder.no_active_assignment`, is not a stop at all. Its policy — at most one
 * per generation, only while the schedule is still active and nobody is assigned — is decided in the
 * settlement transaction under the Task lock, and the cases it must stay silent about get as much
 * attention here as the case it must fire for.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
} from '@aicaa/domain';
import {
  claimReminderOccurrence,
  createTask,
  finalizeReminderOccurrence,
  listOwnerNotificationIntentsForSubject,
  markProviderCallStarted,
  persistEstablishedReminderSchedule,
  settleReminderOccurrenceSchedule,
  stopReminderSchedule,
  upsertRecipient,
  type OwnerNotificationSystemCapture,
  type PersistedReminderSchedule,
} from '../src/index.js';
// Phase A is deliberately off the barrel (A8.4a audit H1). Reached directly here for the one case
// that needs the schedule to change between an occurrence terminalizing and its settlement.
import { terminalizeReminderOccurrence } from '../src/transactions/a8-4a-occurrence-transactions.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const org = 'org_a85d_rem';
const zone = REMINDER_SCHEDULING_TIME_ZONE;
const FOREVER = '2099-01-01T00:00:00.000Z';
const REMINDER_ENGINE = 'reminder_engine';

let seq = 0;
function nextIntentId(): string {
  seq += 1;
  return `onint_a85d_rem_${seq}`;
}

function capture(): OwnerNotificationSystemCapture {
  return { id: nextIntentId(), systemId: REMINDER_ENGINE };
}

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

describe('A8.5d reminder notification producers', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.prisma.ownerNotificationIntent.deleteMany();
  });

  async function seedSchedule(key: string): Promise<{
    taskId: string;
    schedule: PersistedReminderSchedule;
    overdue: { occurrenceLocalDate: LocalDate; occurrenceAt: string };
  }> {
    const taskId = `task_${key}`;
    const establishedAt = '2026-08-01T12:00:00.000Z';
    await upsertRecipient(db.prisma, {
      organizationId: org,
      recipient: recipientFixture(`rcp_${taskId}`),
    });
    const task = taskFixture(taskId, establishedAt);
    await createTask(db.prisma, org, task, task.assignment);

    const dueLocalDate = parseLocalDate('2026-08-10');
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

    return { taskId, schedule, overdue: nextOverdue };
  }

  async function claimOverdue(
    key: string,
    seeded: Awaited<ReturnType<typeof seedSchedule>>,
    suffix = 'a',
  ) {
    return claimReminderOccurrence(db.prisma, {
      id: `att_${key}_${suffix}`,
      organizationId: org,
      scheduleId: seeded.schedule.id,
      generation: seeded.schedule.generation,
      occurrenceKind: 'overdue',
      occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
      occurrenceAt: seeded.overdue.occurrenceAt,
      claimedBy: `worker_${suffix}`,
      claimedAt: seeded.overdue.occurrenceAt,
      claimExpiresAt: FOREVER,
      now: seeded.overdue.occurrenceAt,
      maxAttempts: 3,
    });
  }

  async function intentsForSchedule(scheduleId: string) {
    return listOwnerNotificationIntentsForSubject(
      db.prisma,
      org,
      'task_reminder_schedule',
      scheduleId,
    );
  }

  async function readSchedule(id: string) {
    return db.prisma.taskReminderSchedule.findUniqueOrThrow({ where: { id } });
  }

  // -----------------------------------------------------------------------------------------
  // reminder.schedule.stopped.permanent_failure
  // -----------------------------------------------------------------------------------------

  describe('permanent failure', () => {
    async function failPermanently(
      key: string,
      ownerNotification?: OwnerNotificationSystemCapture,
    ) {
      const seeded = await seedSchedule(key);
      const claim = await claimOverdue(key, seeded);
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: claim.attempt.id,
        claimSequence: claim.attempt.claimSequence,
        startedAt: seeded.overdue.occurrenceAt,
      });
      // Terminalize and settle in one call, which is what the worker does. Settlement is where the
      // stop is applied and therefore where capture belongs.
      const settled = await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId: claim.attempt.id,
        scheduleId: seeded.schedule.id,
        expectedGeneration: seeded.schedule.generation,
        claimSequence: claim.attempt.claimSequence,
        outcome: 'permanent_failure',
        completedAt: seeded.overdue.occurrenceAt,
        failureCode: 'recipient_rejected',
        nextOverdueOccurrence: null,
        ownerNotification,
      });
      return { seeded, attemptId: claim.attempt.id, settled };
    }

    it('captures the stop, keyed by generation and attributed to the reminder engine', async () => {
      const { seeded, settled } = await failPermanently('perm_fail', capture());

      // The reminder decision underneath, unchanged.
      const schedule = await readSchedule(seeded.schedule.id);
      expect(schedule.status).toBe('stopped');
      expect(schedule.stopReason).toBe('permanent_delivery_failure');
      expect(schedule.requiresOwnerAttention).toBe(true);
      expect(settled.scheduleAdvanced).toBe(true);

      const [intent] = await intentsForSchedule(seeded.schedule.id);
      expect(intent).toMatchObject({
        eventType: 'reminder_schedule_stopped_permanent_failure',
        subjectKind: 'task_reminder_schedule',
        subjectId: seeded.schedule.id,
        occurrenceKey: String(seeded.schedule.generation),
        actorKind: 'system',
        systemId: REMINDER_ENGINE,
        // A8.4a settlement writes no audit row, so there is none to point at rather than one
        // invented here.
        auditEventId: null,
      });
      // When the failure happened, matching `stoppedAt`, not when a sweep noticed it.
      expect(intent.occurredAt).toBe(seeded.overdue.occurrenceAt);
    });

    it('captures nothing on a replayed settlement', async () => {
      const { seeded, attemptId } = await failPermanently('perm_replay', capture());

      const again = await settleReminderOccurrenceSchedule({
        db: db.prisma,
        organizationId: org,
        attemptId,
        settledAt: '2026-08-11T18:00:00.000Z',
        nextOverdueOccurrence: null,
        ownerNotification: capture(),
      });

      expect(again.alreadySettled).toBe(true);
      expect(await intentsForSchedule(seeded.schedule.id)).toHaveLength(1);
    });

    it('stops the schedule identically when capture is off', async () => {
      const { seeded } = await failPermanently('perm_nocapture', undefined);

      const schedule = await readSchedule(seeded.schedule.id);
      expect(schedule.status).toBe('stopped');
      expect(schedule.stopReason).toBe('permanent_delivery_failure');
      expect(await intentsForSchedule(seeded.schedule.id)).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------------------------
  // reminder.schedule.stopped.ceiling_reached and .repeated_ambiguous
  // -----------------------------------------------------------------------------------------

  describe('the other two stop reasons', () => {
    /** The `index`-th overdue morning of a generation. */
    function overdueOccurrence(dueLocalDate: LocalDate, index: number) {
      let cursor = selectNextOverdueOccurrence({ dueLocalDate, now: '2026-08-01T12:00:00.000Z' });
      for (let step = 0; step < index; step += 1) {
        cursor = selectNextOverdueOccurrence({
          dueLocalDate,
          now: new Date(Date.parse(cursor.occurrenceAt) + 1).toISOString(),
        });
      }
      return cursor;
    }

    /** One delivered morning, carrying its own capture identifier as the worker would. */
    async function morning(
      key: string,
      seeded: Awaited<ReturnType<typeof seedSchedule>>,
      index: number,
      outcome: 'success' | 'ambiguous',
    ) {
      const dueLocalDate = parseLocalDate('2026-08-10');
      const occurrence = overdueOccurrence(dueLocalDate, index);
      const attemptId = `att_${key}_${index}`;

      const claim = await claimReminderOccurrence(db.prisma, {
        id: attemptId,
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: seeded.schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: occurrence.occurrenceLocalDate,
        occurrenceAt: occurrence.occurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: occurrence.occurrenceAt,
        claimExpiresAt: FOREVER,
        now: occurrence.occurrenceAt,
        maxAttempts: 3,
      });
      if (!claim.claimed) throw new Error(`could not claim morning ${index}`);

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
        expectedGeneration: seeded.schedule.generation,
        failureCode: outcome === 'ambiguous' ? 'GMAIL_AMBIGUOUS_SEND' : null,
        providerAcceptedAt: outcome === 'success' ? occurrence.occurrenceAt : null,
        providerMessageRef: outcome === 'success' ? `msg_${index}` : null,
        nextOverdueOccurrence: overdueOccurrence(dueLocalDate, index + 1),
        ownerNotification: capture(),
      });
    }

    it('captures the ceiling stop, and only on the morning that reached it', async () => {
      const seeded = await seedSchedule('ceiling');

      // D106 stops a generation at fourteen successful overdue deliveries. Every morning before the
      // fourteenth carries a capture identifier and must use none of them.
      for (let index = 0; index < OVERDUE_SUCCESSFUL_DELIVERY_CEILING - 1; index += 1) {
        await morning('ceiling', seeded, index, 'success');
      }
      expect(await intentsForSchedule(seeded.schedule.id)).toHaveLength(0);

      const last = await morning(
        'ceiling',
        seeded,
        OVERDUE_SUCCESSFUL_DELIVERY_CEILING - 1,
        'success',
      );
      expect(last.ceilingReached).toBe(true);

      const intents = await intentsForSchedule(seeded.schedule.id);
      expect(intents).toHaveLength(1);
      expect(intents[0]).toMatchObject({
        eventType: 'reminder_schedule_stopped_ceiling_reached',
        occurrenceKey: String(seeded.schedule.generation),
        actorKind: 'system',
        systemId: REMINDER_ENGINE,
      });

      const schedule = await readSchedule(seeded.schedule.id);
      expect(schedule.stopReason).toBe('overdue_ceiling_reached');
    });

    it('captures the ambiguity stop on the third consecutive uncertain morning', async () => {
      const seeded = await seedSchedule('ambiguous');

      await morning('ambiguous', seeded, 0, 'ambiguous');
      await morning('ambiguous', seeded, 1, 'ambiguous');
      expect(await intentsForSchedule(seeded.schedule.id)).toHaveLength(0);

      const third = await morning('ambiguous', seeded, 2, 'ambiguous');
      expect(third.repeatedAmbiguityStop).toBe(true);

      const intents = await intentsForSchedule(seeded.schedule.id);
      expect(intents).toHaveLength(1);
      expect(intents[0]).toMatchObject({
        eventType: 'reminder_schedule_stopped_repeated_ambiguous',
        occurrenceKey: String(seeded.schedule.generation),
        actorKind: 'system',
      });

      const schedule = await readSchedule(seeded.schedule.id);
      expect(schedule.stopReason).toBe('repeated_ambiguous_outcomes');
    });
  });

  // -----------------------------------------------------------------------------------------
  // reminder.no_active_assignment
  // -----------------------------------------------------------------------------------------

  describe('no active assignment', () => {
    async function skipUnassigned(
      key: string,
      options: {
        clearAssignment?: boolean;
        ownerNotification?: OwnerNotificationSystemCapture;
      } = {},
    ) {
      const seeded = await seedSchedule(key);
      if (options.clearAssignment !== false) {
        await db.prisma.taskAssignment.updateMany({
          where: { organizationId: org, taskId: seeded.taskId, clearedAt: null },
          data: { clearedAt: new Date(seeded.overdue.occurrenceAt) },
        });
      }
      const claim = await claimOverdue(key, seeded);
      const settled = await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId: claim.attempt.id,
        scheduleId: seeded.schedule.id,
        expectedGeneration: seeded.schedule.generation,
        claimSequence: claim.attempt.claimSequence,
        outcome: 'skipped',
        completedAt: seeded.overdue.occurrenceAt,
        skipReason: 'no_active_assignment',
        nextOverdueOccurrence: null,
        ownerNotification: 'ownerNotification' in options ? options.ownerNotification : capture(),
      });
      return { seeded, settled };
    }

    it('captures once when an active schedule has nobody assigned', async () => {
      const { seeded } = await skipUnassigned('unassigned');

      const [intent] = await intentsForSchedule(seeded.schedule.id);
      expect(intent).toMatchObject({
        eventType: 'reminder_no_active_assignment',
        subjectId: seeded.schedule.id,
        occurrenceKey: String(seeded.schedule.generation),
        actorKind: 'system',
        systemId: REMINDER_ENGINE,
      });

      // A skip is not a stop. The schedule is still running, which is exactly why the Owner is
      // being asked to do something about it.
      const schedule = await readSchedule(seeded.schedule.id);
      expect(schedule.status).toBe('active');
    });

    it('stays silent when the gap closed before settlement', async () => {
      // The occurrence truthfully skipped for `no_active_assignment`, and then somebody assigned a
      // Recipient. Nothing is owed from the Owner, so nothing is sent.
      const { seeded } = await skipUnassigned('gap_closed', { clearAssignment: false });

      expect(await intentsForSchedule(seeded.schedule.id)).toHaveLength(0);
    });

    it('captures nothing when the schedule is no longer active', async () => {
      const seeded = await seedSchedule('unassigned_stopped');
      await db.prisma.taskAssignment.updateMany({
        where: { organizationId: org, taskId: seeded.taskId, clearedAt: null },
        data: { clearedAt: new Date(seeded.overdue.occurrenceAt) },
      });
      const claim = await claimOverdue('unassigned_stopped', seeded);
      // Phase A alone, so the schedule can change before settlement observes it.
      await terminalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId: claim.attempt.id,
        scheduleId: seeded.schedule.id,
        expectedGeneration: seeded.schedule.generation,
        claimSequence: claim.attempt.claimSequence,
        outcome: 'skipped',
        completedAt: seeded.overdue.occurrenceAt,
        skipReason: 'no_active_assignment',
        nextOverdueOccurrence: null,
      });
      // The schedule stopped between the skip and its settlement. A stopped schedule owes no
      // reminders, so there is nothing left for the Owner to unblock.
      await stopReminderSchedule(db.prisma, {
        organizationId: org,
        scheduleId: seeded.schedule.id,
        reason: 'task_completed',
        stoppedAt: seeded.overdue.occurrenceAt,
      });

      await settleReminderOccurrenceSchedule({
        db: db.prisma,
        organizationId: org,
        attemptId: claim.attempt.id,
        settledAt: seeded.overdue.occurrenceAt,
        nextOverdueOccurrence: null,
        ownerNotification: capture(),
      });

      expect(await intentsForSchedule(seeded.schedule.id)).toHaveLength(0);
    });

    it('captures nothing for a skip that means something else', async () => {
      const seeded = await seedSchedule('other_skip');
      const claim = await claimOverdue('other_skip', seeded);
      await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId: claim.attempt.id,
        scheduleId: seeded.schedule.id,
        expectedGeneration: seeded.schedule.generation,
        claimSequence: claim.attempt.claimSequence,
        outcome: 'skipped',
        completedAt: seeded.overdue.occurrenceAt,
        // A Waiting or terminal Task, not an unassigned one.
        skipReason: 'task_not_eligible',
        nextOverdueOccurrence: null,
        ownerNotification: capture(),
      });

      expect(await intentsForSchedule(seeded.schedule.id)).toHaveLength(0);
    });

    it('writes no intent when capture is off', async () => {
      const { seeded } = await skipUnassigned('unassigned_nocapture', {
        ownerNotification: undefined,
      });
      expect(await intentsForSchedule(seeded.schedule.id)).toHaveLength(0);
    });
  });
});
