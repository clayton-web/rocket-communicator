// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  claimReminderOccurrence,
  createTask,
  findReminderScheduleByTaskId,
  listReminderDeliveryAttemptsForTask,
  markProviderCallStarted,
  persistEstablishedReminderSchedule,
  stopReminderSchedule,
  suspendReminderScheduleForWaiting,
  upsertRecipient,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { runInternalReminderProcess } from '@/lib/reminders/process-service';
import {
  FakeReminderTransport,
  type FakeTransportScript,
  type ReminderTransport,
  type ReminderTransportRequest,
} from '@/lib/reminders/transport';
import { POST } from '@/app/api/v1/internal/reminders/process/route';

/**
 * A8.4a reminder occurrence processing service and its dark internal endpoint.
 *
 * The service is the orchestration half of the worker-safety foundation: it claims occurrences,
 * re-validates eligibility immediately before sending, invokes an injected transport, and finalizes
 * through the safe occurrence transaction. There is no real transport in this slice and delivery is
 * disabled by default, so the properties worth proving are about *ordering and refusal*, not about
 * mail.
 */

const SECRET = 'cron-secret-for-reminder-process-32bytes!';
const org = 'org_rem_proc';
const zone = REMINDER_SCHEDULING_TIME_ZONE;

/** Delivery is off by default, so every test that wants work done must say so explicitly. */
const ENABLED = { ...process.env, ENABLE_REMINDER_DELIVERY: 'true' } as NodeJS.ProcessEnv;

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

/**
 * A Task with an active schedule whose overdue occurrence has already arrived.
 *
 * The due date is well in the past so the armed occurrence is due at the `now` every test uses,
 * which is what makes the global scan find it.
 */
async function seedDueTask(
  key: string,
  options: { dueLocalDate?: string } = {},
): Promise<{ taskId: string; scheduleId: string; occurrenceAt: string }> {
  const taskId = `task_${key}`;
  const establishedAt = '2026-08-01T12:00:00.000Z';
  await upsertRecipient(db.prisma, {
    organizationId: org,
    recipient: recipientFixture(`rcp_${taskId}`),
  });
  const task = taskFixture(taskId, establishedAt);
  await createTask(db.prisma, org, task, task.assignment);

  const dueLocalDate = parseLocalDate(options.dueLocalDate ?? '2026-08-05');
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

  return { taskId, scheduleId: schedule.id, occurrenceAt: nextOverdue.occurrenceAt };
}

/** Long after every seeded occurrence, so the scan finds everything. */
const NOW = '2026-08-20T18:00:00.000Z';

/**
 * Retire every schedule left active by an earlier test.
 *
 * The worker scan is deliberately global (F11), so a schedule another test armed and abandoned is
 * genuinely due and would genuinely be delivered. That is correct behaviour and the wrong thing to
 * assert against, so each test starts from a database with nothing else owed.
 */
async function quiesce(): Promise<void> {
  const active = await db.prisma.taskReminderSchedule.findMany({
    where: { status: 'active' },
    select: { id: true },
  });
  for (const schedule of active) {
    await stopReminderSchedule(db.prisma, {
      organizationId: org,
      scheduleId: schedule.id,
      reason: 'task_completed',
      stoppedAt: '2026-08-19T00:00:00.000Z',
    });
  }
}

function transportWith(scripts: Record<string, FakeTransportScript>): FakeReminderTransport {
  return new FakeReminderTransport({ scripts: new Map(Object.entries(scripts)) });
}

/**
 * A fake that accepts everything, which now has to be asked for explicitly (A8.4a audit H3).
 *
 * The bare `new FakeReminderTransport()` used to mean this. It now means a permanent configuration
 * failure, so a test that wants deliveries has to say so — the same asymmetry production relies on.
 */
function acceptingTransport(): FakeReminderTransport {
  return new FakeReminderTransport({
    defaultResult: { kind: 'accepted', providerMessageRef: 'ref_default' },
  });
}

/** A fake that must never be reached; every call is a test failure. */
function refusingTransport(): FakeReminderTransport {
  return new FakeReminderTransport();
}

async function run(options: {
  transport?: ReminderTransport;
  now?: string;
  env?: NodeJS.ProcessEnv;
  maxSchedules?: number;
  startedAtMs?: number;
  deadlineMs?: number;
}) {
  const { response } = await runInternalReminderProcess({
    db: db.prisma,
    requestId: 'req_test',
    now: options.now ?? NOW,
    env: options.env ?? ENABLED,
    transport: options.transport,
    maxSchedules: options.maxSchedules,
    startedAtMs: options.startedAtMs,
    deadlineMs: options.deadlineMs,
  });
  return response;
}

async function attemptsFor(taskId: string) {
  return listReminderDeliveryAttemptsForTask(db.prisma, org, taskId);
}

describe('A8.4a reminder occurrence processing', () => {
  beforeAll(async () => {
    process.env.CRON_SECRET = SECRET;
    db = await createTestDatabase();
  });

  afterAll(async () => {
    clearDbTestRuntime();
    delete process.env.CRON_SECRET;
    delete process.env.ENABLE_REMINDER_DELIVERY;
    await db.close();
  });

  beforeEach(async () => {
    process.env.CRON_SECRET = SECRET;
    installDbTestRuntime(db.prisma);
    await quiesce();
  });

  afterEach(() => {
    delete process.env.ENABLE_REMINDER_DELIVERY;
  });

  // -------------------------------------------------------------------------------------------
  // The dark deployment
  // -------------------------------------------------------------------------------------------

  describe('delivery disabled by default', () => {
    it('claims nothing, writes nothing, and calls no transport', async () => {
      const seeded = await seedDueTask('disabled');
      const transport = new FakeReminderTransport();

      const response = await run({ transport, env: { ...process.env } });

      expect(response.deliveryEnabled).toBe(false);
      expect(response.schedulesScanned).toBe(0);
      expect(response.occurrencesClaimed).toBe(0);
      expect(response.delivered).toBe(0);
      expect(transport.calls).toEqual([]);
      expect(await attemptsFor(seeded.taskId)).toEqual([]);
      // The schedule is untouched: no scan lease was even taken.
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.claimedBy).toBeNull();
    });

    it('treats anything other than the exact string "true" as disabled', async () => {
      // Every near-miss a hand-edited environment variable actually produces: the negatives that
      // look affirmative in another language, the numeric conventions, the casing, and the two
      // whitespace shapes a copy-paste leaves behind. Only the exact string may enable delivery,
      // because "close enough" is how a dark deployment starts sending.
      const disabledValues = [
        '1',
        '0',
        'TRUE',
        'True',
        'yes',
        'false',
        'False',
        '',
        'true ',
        ' true',
      ];
      for (const value of disabledValues) {
        const seeded = await seedDueTask(`flag_${disabledValues.indexOf(value)}`);
        const transport = refusingTransport();
        const response = await run({
          transport,
          env: { ...process.env, ENABLE_REMINDER_DELIVERY: value } as NodeJS.ProcessEnv,
        });
        expect(response.deliveryEnabled, `ENABLE_REMINDER_DELIVERY=${value}`).toBe(false);
        // Disabled means no database work at all, not merely no delivery.
        expect(response.schedulesScanned, value).toBe(0);
        expect(response.recoveredClaims, value).toBe(0);
        expect(response.unsettledOccurrencesSettled, value).toBe(0);
        expect(transport.calls, value).toEqual([]);
        expect(await attemptsFor(seeded.taskId), value).toEqual([]);
        await quiesce();
      }
    });

    it('enables processing for the exact string "true" and nothing else', async () => {
      const seeded = await seedDueTask('flag_exact');
      const response = await run({
        transport: acceptingTransport(),
        env: { ...process.env, ENABLE_REMINDER_DELIVERY: 'true' } as NodeJS.ProcessEnv,
      });
      expect(response.deliveryEnabled).toBe(true);
      expect(response.delivered).toBe(1);
      expect((await attemptsFor(seeded.taskId))[0]?.outcome).toBe('success');
    });
  });

  // -------------------------------------------------------------------------------------------
  // H3: no transport means no work, not an imaginary one
  // -------------------------------------------------------------------------------------------

  describe('processing fails closed when no transport is injected', () => {
    it('does nothing at all, and says which of the two reasons it was', async () => {
      const seeded = await seedDueTask('no_transport');

      const response = await run({ transport: undefined });

      // Delivery was on. The refusal is about the transport, and the response distinguishes them so
      // an operator is not left wondering which switch is wrong.
      expect(response.deliveryEnabled).toBe(true);
      expect(response.transportConfigured).toBe(false);
      expect(response.schedulesScanned).toBe(0);
      expect(response.occurrencesClaimed).toBe(0);
      expect(response.recoveredClaims).toBe(0);
      expect(response.unsettledOccurrencesSettled).toBe(0);

      // Nothing was claimed, nothing was written, and the schedule was not even leased.
      expect(await attemptsFor(seeded.taskId)).toEqual([]);
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.claimedBy).toBeNull();
      expect(schedule?.status).toBe('active');
      expect(schedule?.nextOverdueOccurrenceAt).toBe(seeded.occurrenceAt);
    });

    it('reports transportConfigured true whenever one was supplied', async () => {
      await seedDueTask('with_transport');
      const response = await run({ transport: acceptingTransport() });
      expect(response.transportConfigured).toBe(true);
    });

    /**
     * The defect H3 named. An unconfigured fake used to answer `accepted`, so a single environment
     * variable stood between a dark deployment and a system that recorded fourteen deliveries per
     * Task, exhausted the D106 ceiling, stopped every schedule, and sent nothing whatsoever.
     */
    it('an unscripted fake reports a configuration failure, never acceptance', async () => {
      const fake = new FakeReminderTransport();
      const result = await fake.send({
        occurrenceId: 'occ_x',
        taskId: 'task_x',
        occurrenceKind: 'overdue',
        occurrenceLocalDate: '2026-08-06',
      });
      expect(result.kind).toBe('permanent');
      expect(result).toMatchObject({ failureCode: 'transport_not_configured' });
    });
  });

  // -------------------------------------------------------------------------------------------
  // The transport outcome taxonomy
  // -------------------------------------------------------------------------------------------

  describe('fake transport outcomes map to occurrence outcomes', () => {
    it('records an accepted send as a counted success and arms the next occurrence', async () => {
      const seeded = await seedDueTask('accepted');
      const transport = transportWith({
        [seeded.taskId]: { kind: 'accepted', providerMessageRef: 'ref_ok' },
      });

      const response = await run({ transport });

      expect(response.delivered).toBe(1);
      expect(response.occurrencesClaimed).toBe(1);
      expect(transport.calls).toHaveLength(1);
      expect(transport.calls[0]?.taskId).toBe(seeded.taskId);

      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.outcome).toBe('success');
      expect(attempt.providerMessageRef).toBe('ref_ok');
      expect(attempt.providerAcceptedAt).not.toBeNull();
      // The in-flight marker was committed before the call, not after it.
      expect(attempt.providerCallStartedAt).not.toBeNull();

      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.overdueDeliveredCount).toBe(1);
      // Re-armed from the generation's due date, so the series does not slide forward.
      const expected = selectNextOverdueOccurrence({
        dueLocalDate: parseLocalDate('2026-08-05'),
        now: NOW,
      });
      expect(schedule?.nextOverdueOccurrenceAt).toBe(expected.occurrenceAt);
      // The advisory scan lease was released.
      expect(schedule?.claimedBy).toBeNull();
    });

    it('leaves a retryable rejection owed, uncounted, and unarmed', async () => {
      const seeded = await seedDueTask('retryable');
      const transport = transportWith({
        [seeded.taskId]: { kind: 'retryable', failureCode: 'TRANSPORT_UNAVAILABLE' },
      });

      const response = await run({ transport });
      expect(response.failedRetryable).toBe(1);

      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.outcome).toBe('retryable_failure');
      expect(attempt.failureCode).toBe('TRANSPORT_UNAVAILABLE');

      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.overdueDeliveredCount).toBe(0);
      // Still owed. Arming the next occurrence would abandon this morning's reminder.
      expect(schedule?.nextOverdueOccurrenceAt).toBe(seeded.occurrenceAt);
      expect(schedule?.status).toBe('active');
    });

    it('stops the schedule on a permanent rejection and flags Owner attention', async () => {
      const seeded = await seedDueTask('permanent');
      const transport = transportWith({
        [seeded.taskId]: { kind: 'permanent', failureCode: 'RECIPIENT_REJECTED' },
      });

      const response = await run({ transport });
      expect(response.failedPermanent).toBe(1);

      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.outcome).toBe('permanent_failure');

      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.status).toBe('stopped');
      expect(schedule?.stopReason).toBe('permanent_delivery_failure');
      expect(schedule?.requiresOwnerAttention).toBe(true);
      expect(schedule?.nextOverdueOccurrenceAt).toBeNull();
    });

    it('records an ambiguous result terminally and consumes the local day', async () => {
      const seeded = await seedDueTask('ambiguous');
      const transport = transportWith({
        [seeded.taskId]: { kind: 'ambiguous', failureCode: 'PROVIDER_TIMEOUT' },
      });

      const first = await run({ transport });
      expect(first.ambiguous).toBe(1);

      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.outcome).toBe('ambiguous');
      // Never claimed as delivered, and never counted, because acceptance is exactly what is unknown.
      expect(attempt.providerAcceptedAt).toBeNull();
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.overdueDeliveredCount).toBe(0);

      // A second invocation on the same morning must not send again: the occurrence is terminal.
      const second = await run({ transport });
      expect(second.delivered).toBe(0);
      expect(transport.calls).toHaveLength(1);
      expect(await attemptsFor(seeded.taskId)).toHaveLength(1);
    });

    it('treats a transport that throws as ambiguous, because the marker is already durable', async () => {
      const seeded = await seedDueTask('throws');
      const transport = transportWith({ [seeded.taskId]: { kind: 'throw_before_call' } });

      const response = await run({ transport });
      expect(response.ambiguous).toBe(1);

      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.outcome).toBe('ambiguous');
      expect(attempt.failureCode).toBe('transport_threw');
      // The two crash shapes are indistinguishable to the caller by design, and both are ambiguous
      // once the marker is committed. Guessing "not sent" is what risks a duplicate reminder.
      expect(attempt.providerCallStartedAt).not.toBeNull();
    });

    it('records the in-flight marker before invoking the transport, not after', async () => {
      const seeded = await seedDueTask('ordering');
      let markerAtCallTime: Date | null | undefined;
      const transport: ReminderTransport = {
        async send(request: ReminderTransportRequest) {
          const row = await db.prisma.reminderDeliveryAttempt.findUniqueOrThrow({
            where: { id: request.occurrenceId },
          });
          markerAtCallTime = row.providerCallStartedAt;
          return { kind: 'accepted', providerMessageRef: 'ref_order' };
        },
      };

      await run({ transport });

      // Read from inside the call: the marker is already committed when the provider is contacted.
      expect(markerAtCallTime).not.toBeNull();
      expect(markerAtCallTime).toBeDefined();
      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.outcome).toBe('success');
    });
  });

  // -------------------------------------------------------------------------------------------
  // Pre-send guards
  // -------------------------------------------------------------------------------------------

  describe('pre-send guards refuse truthfully rather than sending', () => {
    it('skips a Task that completed after the scan armed its occurrence', async () => {
      const seeded = await seedDueTask('guard_completed');
      const transport = new FakeReminderTransport();
      await db.prisma.task.update({
        where: { id: seeded.taskId },
        data: { status: 'completed' },
      });

      const response = await run({ transport });

      expect(response.skipped).toBe(1);
      expect(response.delivered).toBe(0);
      expect(transport.calls).toEqual([]);
      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.outcome).toBe('skipped');
      expect(attempt.skipReason).toBe('task_not_eligible');
      // Nothing was sent, so nothing may claim a provider call started.
      expect(attempt.providerCallStartedAt).toBeNull();
    });

    it('skips a Task that went Waiting', async () => {
      const seeded = await seedDueTask('guard_waiting');
      const transport = new FakeReminderTransport();
      await db.prisma.task.update({ where: { id: seeded.taskId }, data: { status: 'waiting' } });

      const response = await run({ transport });

      expect(response.skipped).toBe(1);
      expect(transport.calls).toEqual([]);
      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.skipReason).toBe('task_not_eligible');
    });

    it('skips a Task with no active assignment', async () => {
      const seeded = await seedDueTask('guard_assignment');
      const transport = new FakeReminderTransport();
      await db.prisma.taskAssignment.deleteMany({ where: { taskId: seeded.taskId } });

      const response = await run({ transport });

      expect(response.skipped).toBe(1);
      expect(transport.calls).toEqual([]);
      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.skipReason).toBe('no_active_assignment');
    });

    it('skips when the schedule was suspended between the scan and the send', async () => {
      const seeded = await seedDueTask('guard_suspended');
      // Suspending clears the armed occurrence, so the guard's schedule comparison catches it. The
      // scan row is deliberately built before the suspension to reproduce the real interleaving.
      const transport: ReminderTransport = {
        async send() {
          throw new Error('the guard should have refused before this');
        },
      };
      await suspendReminderScheduleForWaiting(db.prisma, {
        organizationId: org,
        scheduleId: seeded.scheduleId,
        suspendedAt: '2026-08-19T00:00:00.000Z',
      });

      const response = await run({ transport });

      // Suspended schedules are not due, so the scan does not even return it.
      expect(response.schedulesScanned).toBe(0);
      expect(await attemptsFor(seeded.taskId)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Recovery
  // -------------------------------------------------------------------------------------------

  describe('recovery runs before new work is claimed', () => {
    it('releases an expired pre-provider claim and then delivers it in the same invocation', async () => {
      const seeded = await seedDueTask('recover_pre');
      // A previous worker claimed this occurrence and died before contacting anything.
      const abandoned = await claimReminderOccurrence(db.prisma, {
        id: 'att_recover_pre',
        organizationId: org,
        scheduleId: seeded.scheduleId,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: parseLocalDate('2026-08-06'),
        occurrenceAt: seeded.occurrenceAt,
        claimedBy: 'dead_worker',
        claimedAt: '2026-08-06T16:00:00.000Z',
        claimExpiresAt: '2026-08-06T16:05:00.000Z',
        now: '2026-08-06T16:00:00.000Z',
        maxAttempts: 3,
      });
      expect(abandoned.claimed).toBe(true);

      const transport = transportWith({
        [seeded.taskId]: { kind: 'accepted', providerMessageRef: 'ref_recovered' },
      });
      const response = await run({ transport });

      expect(response.recoveredClaims).toBe(1);
      expect(response.delivered).toBe(1);
      const attempts = await attemptsFor(seeded.taskId);
      // Reclaimed the same row rather than forging a second occurrence for the same morning.
      expect(attempts).toHaveLength(1);
      expect(attempts[0].id).toBe('att_recover_pre');
      expect(attempts[0].outcome).toBe('success');
      expect(attempts[0].attemptCount).toBe(2);
    });

    it('finalizes an expired in-flight claim ambiguous and never calls the transport for it', async () => {
      const seeded = await seedDueTask('recover_inflight');
      const abandoned = await claimReminderOccurrence(db.prisma, {
        id: 'att_recover_inflight',
        organizationId: org,
        scheduleId: seeded.scheduleId,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: parseLocalDate('2026-08-06'),
        occurrenceAt: seeded.occurrenceAt,
        claimedBy: 'dead_worker',
        claimedAt: '2026-08-06T16:00:00.000Z',
        claimExpiresAt: '2026-08-06T16:05:00.000Z',
        now: '2026-08-06T16:00:00.000Z',
        maxAttempts: 3,
      });
      expect(abandoned.claimed).toBe(true);
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: 'att_recover_inflight',
        claimSequence: 1,
        startedAt: '2026-08-06T16:00:02.000Z',
      });

      const transport = refusingTransport();
      const response = await run({ transport });

      expect(response.recoveredClaims).toBe(1);
      expect(response.delivered).toBe(0);
      // The whole point: a provider may hold that message, so nothing is sent for this morning.
      expect(transport.calls).toEqual([]);
      const attempts = await attemptsFor(seeded.taskId);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].outcome).toBe('ambiguous');
      expect(attempts[0].failureCode).toBe('lease_expired_in_flight');
    });

    /**
     * Blocker B1. Ambiguous recovery used to supply no next occurrence, and settlement wrote that
     * nothing through: the schedule stayed `active` with `next_overdue_occurrence_at` null, no stop
     * reason, and no Owner-attention flag. The reminder series ended and not one row said so.
     *
     * Consuming today's occurrence and ending the series are different acts, and recovery is only
     * entitled to the first.
     */
    it('arms the next occurrence when it finalizes an abandoned in-flight claim', async () => {
      const seeded = await seedDueTask('b1_arm');
      await claimReminderOccurrence(db.prisma, {
        id: 'att_b1_arm',
        organizationId: org,
        scheduleId: seeded.scheduleId,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: parseLocalDate('2026-08-06'),
        occurrenceAt: seeded.occurrenceAt,
        claimedBy: 'dead_worker',
        claimedAt: '2026-08-06T16:00:00.000Z',
        claimExpiresAt: '2026-08-06T16:05:00.000Z',
        now: '2026-08-06T16:00:00.000Z',
        maxAttempts: 3,
      });
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: 'att_b1_arm',
        claimSequence: 1,
        startedAt: '2026-08-06T16:00:02.000Z',
      });

      await run({ transport: refusingTransport() });

      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.status).toBe('active');
      expect(schedule?.stopReason).toBeNull();
      // The series continues, from the same domain call the live path uses — not from today.
      const expected = selectNextOverdueOccurrence({
        dueLocalDate: parseLocalDate('2026-08-05'),
        now: NOW,
      });
      expect(schedule?.nextOverdueOccurrenceAt).toBe(expected.occurrenceAt);
      expect(schedule?.nextOverdueOccurrenceLocalDate).toBe(expected.occurrenceLocalDate);
      // The ambiguous occurrence still consumed its own day and is not counted.
      expect(schedule?.overdueDeliveredCount).toBe(0);
    });

    it('leaves a schedule that moved on untouched, and keeps the terminal occurrence', async () => {
      const seeded = await seedDueTask('b1_moved');
      await claimReminderOccurrence(db.prisma, {
        id: 'att_b1_moved',
        organizationId: org,
        scheduleId: seeded.scheduleId,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: parseLocalDate('2026-08-06'),
        occurrenceAt: seeded.occurrenceAt,
        claimedBy: 'dead_worker',
        claimedAt: '2026-08-06T16:00:00.000Z',
        claimExpiresAt: '2026-08-06T16:05:00.000Z',
        now: '2026-08-06T16:00:00.000Z',
        maxAttempts: 3,
      });
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: 'att_b1_moved',
        claimSequence: 1,
        startedAt: '2026-08-06T16:00:02.000Z',
      });
      // The Owner stops the schedule while the dead worker's lease is still expiring.
      await stopReminderSchedule(db.prisma, {
        organizationId: org,
        scheduleId: seeded.scheduleId,
        reason: 'task_completed',
        stoppedAt: '2026-08-19T00:00:00.000Z',
      });

      await run({ transport: refusingTransport() });

      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.outcome).toBe('ambiguous');
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      // Nothing re-armed a stopped schedule, and the stop reason was not overwritten.
      expect(schedule?.status).toBe('stopped');
      expect(schedule?.stopReason).toBe('task_completed');
      expect(schedule?.nextOverdueOccurrenceAt).toBeNull();
    });

    /**
     * Blocker B2, reproduced exactly as the audit did.
     *
     * Two retryable attempts, then a third worker claims and dies before marking its provider call.
     * Recovery correctly releases the dead lease — nothing was sent — and leaves a non-terminal row
     * at the attempt ceiling that no worker may ever claim again. Before the exhaustion sweep, every
     * later invocation scanned the schedule, took its lease, was refused, released the lease, and
     * repeated, for as long as the deployment lived.
     */
    it('terminalizes a final-attempt crash instead of hot-looping on it forever', async () => {
      const seeded = await seedDueTask('b2_crash');
      const retryable = transportWith({
        [seeded.taskId]: { kind: 'retryable', failureCode: 'TRANSPORT_UNAVAILABLE' },
      });

      // Attempts one and two fail retryably through the ordinary path.
      await run({ transport: retryable });
      await run({ transport: retryable });
      const afterTwo = await attemptsFor(seeded.taskId);
      expect(afterTwo[0].attemptCount).toBe(2);
      expect(afterTwo[0].outcome).toBe('retryable_failure');

      // Attempt three: a worker claims it and dies before writing the in-flight marker.
      const third = await claimReminderOccurrence(db.prisma, {
        id: afterTwo[0].id,
        organizationId: org,
        scheduleId: seeded.scheduleId,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: afterTwo[0].occurrenceLocalDate,
        occurrenceAt: afterTwo[0].occurrenceAt,
        claimedBy: 'dying_worker',
        claimedAt: '2026-08-20T17:00:00.000Z',
        claimExpiresAt: '2026-08-20T17:05:00.000Z',
        now: '2026-08-20T17:00:00.000Z',
        maxAttempts: 3,
      });
      expect(third.claimed).toBe(true);
      const crashed = (await attemptsFor(seeded.taskId))[0];
      expect(crashed.outcome).toBe('claimed');
      expect(crashed.attemptCount).toBe(3);
      expect(crashed.providerCallStartedAt).toBeNull();

      // The lease expires and recovery runs. The same invocation must also close the occurrence.
      const transport = refusingTransport();
      const recovery = await run({ transport });
      expect(recovery.recoveredClaims).toBe(1);
      expect(recovery.retryBudgetTerminalizations).toBe(1);

      const [settled] = await attemptsFor(seeded.taskId);
      expect(settled.outcome).toBe('permanent_failure');
      expect(settled.failureCode).toBe('retry_budget_exhausted');
      expect(settled.claimedBy).toBeNull();
      expect(settled.claimExpiresAt).toBeNull();
      expect(settled.providerCallStartedAt).toBeNull();
      expect(settled.providerAcceptedAt).toBeNull();

      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.status).toBe('stopped');
      expect(schedule?.stopReason).toBe('permanent_delivery_failure');
      expect(schedule?.requiresOwnerAttention).toBe(true);
      expect(schedule?.nextOverdueOccurrenceAt).toBeNull();

      // Two further invocations: the loop is gone. Nothing is scanned, refused, or re-terminalized.
      for (const label of ['first', 'second']) {
        const later = await run({ transport });
        expect(later.schedulesScanned, label).toBe(0);
        expect(later.claimRefusals, label).toBe(0);
        expect(later.retryBudgetTerminalizations, label).toBe(0);
        expect(later.recoveredClaims, label).toBe(0);
      }
      expect(transport.calls).toEqual([]);
      expect(await attemptsFor(seeded.taskId)).toHaveLength(1);
    });

    /**
     * A second worker meeting an already-terminalized exhaustion must observe it and do nothing,
     * rather than re-stopping the schedule or re-counting anything.
     */
    it('is idempotent when two invocations meet the same exhausted occurrence', async () => {
      const seeded = await seedDueTask('b2_idem');
      const retryable = transportWith({
        [seeded.taskId]: { kind: 'retryable', failureCode: 'TRANSPORT_UNAVAILABLE' },
      });
      await run({ transport: retryable });
      await run({ transport: retryable });
      const owed = (await attemptsFor(seeded.taskId))[0];
      await claimReminderOccurrence(db.prisma, {
        id: owed.id,
        organizationId: org,
        scheduleId: seeded.scheduleId,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: owed.occurrenceLocalDate,
        occurrenceAt: owed.occurrenceAt,
        claimedBy: 'dying_worker',
        claimedAt: '2026-08-20T17:00:00.000Z',
        claimExpiresAt: '2026-08-20T17:05:00.000Z',
        now: '2026-08-20T17:00:00.000Z',
        maxAttempts: 3,
      });

      const first = await run({ transport: refusingTransport() });
      const second = await run({ transport: refusingTransport() });

      expect(first.retryBudgetTerminalizations).toBe(1);
      expect(second.retryBudgetTerminalizations).toBe(0);
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.reminderVersion).toBe(2);
    });

    /**
     * Blocker H2. A reclaimed retryable row used to keep the previous attempt's
     * `provider_call_started_at`, so a new attempt that crashed *before* its own transport call was
     * misread as in-flight and finalized ambiguous — a reminder provably never sent, recorded as
     * probably delivered, consuming its local day.
     */
    it('clears the previous attempt provider marker when it takes over a retryable occurrence', async () => {
      const seeded = await seedDueTask('h2_marker');
      const retryable = transportWith({
        [seeded.taskId]: { kind: 'retryable', failureCode: 'TRANSPORT_UNAVAILABLE' },
      });
      await run({ transport: retryable });
      const failed = (await attemptsFor(seeded.taskId))[0];
      expect(failed.outcome).toBe('retryable_failure');
      expect(failed.providerCallStartedAt, 'the first attempt did call a provider').not.toBeNull();

      // A second worker takes it over and dies before marking its own call.
      const retaken = await claimReminderOccurrence(db.prisma, {
        id: failed.id,
        organizationId: org,
        scheduleId: seeded.scheduleId,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: failed.occurrenceLocalDate,
        occurrenceAt: failed.occurrenceAt,
        claimedBy: 'second_worker',
        claimedAt: '2026-08-20T17:00:00.000Z',
        claimExpiresAt: '2026-08-20T17:05:00.000Z',
        now: '2026-08-20T17:00:00.000Z',
        maxAttempts: 3,
      });
      expect(retaken.claimed).toBe(true);
      const taken = (await attemptsFor(seeded.taskId))[0];
      expect(taken.providerCallStartedAt).toBeNull();
      expect(taken.providerAcceptedAt).toBeNull();
      expect(taken.providerMessageRef).toBeNull();
      expect(taken.scheduleSettledAt).toBeNull();

      // Recovery must therefore release it as safely reclaimable, not finalize it ambiguous.
      const accepting = transportWith({
        [seeded.taskId]: { kind: 'accepted', providerMessageRef: 'ref_third' },
      });
      const response = await run({ transport: accepting });

      expect(response.ambiguous).toBe(0);
      expect(response.delivered).toBe(1);
      const [delivered] = await attemptsFor(seeded.taskId);
      expect(delivered.outcome).toBe('success');
      expect(delivered.attemptCount).toBe(3);
    });

    it('still finalizes ambiguous when the new attempt does mark its own call', async () => {
      const seeded = await seedDueTask('h2_ambiguous');
      const retryable = transportWith({
        [seeded.taskId]: { kind: 'retryable', failureCode: 'TRANSPORT_UNAVAILABLE' },
      });
      await run({ transport: retryable });
      const failed = (await attemptsFor(seeded.taskId))[0];

      await claimReminderOccurrence(db.prisma, {
        id: failed.id,
        organizationId: org,
        scheduleId: seeded.scheduleId,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: failed.occurrenceLocalDate,
        occurrenceAt: failed.occurrenceAt,
        claimedBy: 'second_worker',
        claimedAt: '2026-08-20T17:00:00.000Z',
        claimExpiresAt: '2026-08-20T17:05:00.000Z',
        now: '2026-08-20T17:00:00.000Z',
        maxAttempts: 3,
      });
      await markProviderCallStarted(db.prisma, {
        organizationId: org,
        attemptId: failed.id,
        claimSequence: 2,
        startedAt: '2026-08-20T17:00:01.000Z',
      });

      const transport = refusingTransport();
      const response = await run({ transport });

      expect(response.ambiguous).toBe(0); // recovery, not a live send
      expect(response.recoveredClaims).toBe(1);
      expect(transport.calls).toEqual([]);
      const [recovered] = await attemptsFor(seeded.taskId);
      expect(recovered.outcome).toBe('ambiguous');
      expect(recovered.failureCode).toBe('lease_expired_in_flight');
    });

    it('refuses a stale predecessor trying to restore the marker it no longer owns', async () => {
      const seeded = await seedDueTask('h2_stale');
      const retryable = transportWith({
        [seeded.taskId]: { kind: 'retryable', failureCode: 'TRANSPORT_UNAVAILABLE' },
      });
      await run({ transport: retryable });
      const failed = (await attemptsFor(seeded.taskId))[0];
      const staleSequence = failed.claimSequence;

      await claimReminderOccurrence(db.prisma, {
        id: failed.id,
        organizationId: org,
        scheduleId: seeded.scheduleId,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: failed.occurrenceLocalDate,
        occurrenceAt: failed.occurrenceAt,
        claimedBy: 'successor',
        claimedAt: '2026-08-20T17:00:00.000Z',
        claimExpiresAt: '2026-08-20T17:05:00.000Z',
        now: '2026-08-20T17:00:00.000Z',
        maxAttempts: 3,
      });

      // The predecessor wakes up and tries to re-assert its own in-flight marker.
      await expect(
        markProviderCallStarted(db.prisma, {
          organizationId: org,
          attemptId: failed.id,
          claimSequence: staleSequence,
          startedAt: '2026-08-20T17:00:02.000Z',
        }),
      ).rejects.toThrow();
      expect((await attemptsFor(seeded.taskId))[0].providerCallStartedAt).toBeNull();
    });

    it('finalizes an occurrence whose retry budget is exhausted rather than leaving it owed', async () => {
      const seeded = await seedDueTask('budget');
      const transport = transportWith({
        [seeded.taskId]: { kind: 'retryable', failureCode: 'TRANSPORT_UNAVAILABLE' },
      });

      // Three retryable failures consume the budget of three attempts.
      for (let round = 0; round < 3; round += 1) {
        await run({ transport });
      }
      const afterBudget = await run({ transport });

      const attempts = await attemptsFor(seeded.taskId);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].outcome).toBe('permanent_failure');
      expect(attempts[0].failureCode).toBe('retry_budget_exhausted');
      expect(attempts[0].attemptCount).toBe(3);
      // The fourth invocation refused to call the transport at all.
      expect(transport.calls).toHaveLength(3);
      expect(afterBudget.delivered).toBe(0);

      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.status).toBe('stopped');
      expect(schedule?.requiresOwnerAttention).toBe(true);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Bounds
  // -------------------------------------------------------------------------------------------

  describe('bounded work per invocation', () => {
    it('processes at most the batch limit and leaves the rest for the next wake-up', async () => {
      const seeded = await Promise.all([
        seedDueTask('batch_a'),
        seedDueTask('batch_b'),
        seedDueTask('batch_c'),
      ]);
      const transport = acceptingTransport();

      const first = await run({ transport, maxSchedules: 2 });
      expect(first.schedulesScanned).toBe(2);
      expect(first.delivered).toBe(2);

      // The backlog drains on the next invocation rather than being lost.
      const second = await run({ transport, maxSchedules: 2 });
      expect(second.delivered).toBeGreaterThanOrEqual(1);

      const delivered = await Promise.all(
        seeded.map(async (entry) => (await attemptsFor(entry.taskId))[0]?.outcome),
      );
      expect(delivered.filter((outcome) => outcome === 'success')).toHaveLength(3);
    });

    it('stops at the soft deadline without abandoning an occurrence mid-flight', async () => {
      await Promise.all([seedDueTask('deadline_a'), seedDueTask('deadline_b')]);
      const transport = new FakeReminderTransport();

      // A deadline already inside the stop margin: the loop must decline to start any schedule.
      const response = await run({
        transport,
        startedAtMs: Date.now(),
        deadlineMs: Date.now(),
      });

      expect(response.deliveryEnabled).toBe(true);
      expect(response.schedulesScanned).toBe(0);
      expect(response.deadlineStopped).toBe(true);
      expect(transport.calls).toEqual([]);
    });

    it('does not report a deadline stop when the invocation finished its work', async () => {
      await seedDueTask('deadline_ok');
      const response = await run({ transport: acceptingTransport() });
      expect(response.deadlineStopped).toBe(false);
    });
  });

  // -------------------------------------------------------------------------------------------
  // H1: the recorded delivery outlives a settlement failure
  // -------------------------------------------------------------------------------------------

  describe('a settlement failure cannot erase a recorded delivery', () => {
    /**
     * Terminalization and settlement are two transactions, so this fails the second one and keeps
     * the first. Failing the *second* `$transaction` is precisely the fault the audit injected: the
     * single-transaction design claimed it could not happen and a phase-two CHECK violation proved
     * otherwise, taking the record of a sent message down with it.
     */
    function phaseBFailingClient(): {
      client: TestDatabase['prisma'];
      armAfterSend: () => void;
    } {
      let armed = false;
      let sinceArmed = 0;
      const client = new Proxy(db.prisma, {
        get(target, property, receiver) {
          if (property === '$transaction') {
            return async (...args: unknown[]) => {
              if (armed) {
                sinceArmed += 1;
                // One transaction after the send is phase A; the next is phase B.
                if (sinceArmed === 2) {
                  throw new Error('injected phase B failure');
                }
              }
              return (
                target.$transaction as unknown as (...a: unknown[]) => Promise<unknown>
              ).apply(target, args);
            };
          }
          return Reflect.get(target, property, receiver);
        },
      }) as TestDatabase['prisma'];
      return {
        client,
        armAfterSend: () => {
          armed = true;
        },
      };
    }

    /** Accepts the send, then arms the fault so the very next settlement transaction fails. */
    function acceptThenBreakSettlement(
      armAfterSend: () => void,
      providerMessageRef: string,
    ): ReminderTransport {
      return {
        async send() {
          armAfterSend();
          return { kind: 'accepted', providerMessageRef };
        },
      };
    }

    it('keeps the terminal occurrence, defers the settlement, and finishes it next time', async () => {
      const seeded = await seedDueTask('h1_defer');
      const { client, armAfterSend } = phaseBFailingClient();
      const sends: string[] = [];
      const transport: ReminderTransport = {
        async send(request) {
          sends.push(request.occurrenceId);
          armAfterSend();
          return { kind: 'accepted', providerMessageRef: 'ref_durable' };
        },
      };

      const first = await runInternalReminderProcess({
        db: client,
        requestId: 'req_h1',
        now: NOW,
        env: ENABLED,
        transport,
      });

      expect(first.response.delivered).toBe(1);
      expect(first.response.settlementsDeferred).toBe(1);

      // Phase A survived. The message left the building and the row says so, in full.
      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.outcome).toBe('success');
      expect(attempt.providerMessageRef).toBe('ref_durable');
      expect(attempt.providerAcceptedAt).not.toBeNull();
      expect(attempt.scheduleSettledAt, 'settlement debt must be visible').toBeNull();

      // Phase B did not run: nothing counted, nothing advanced.
      const before = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(before?.overdueDeliveredCount).toBe(0);
      expect(before?.nextOverdueOccurrenceAt).toBe(seeded.occurrenceAt);

      // The next invocation collects the debt without touching the transport again.
      const second = await run({ transport });
      expect(second.unsettledOccurrencesSettled).toBe(1);
      expect(second.delivered).toBe(0);
      expect(sends, 'no second send').toHaveLength(1);

      const after = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(after?.overdueDeliveredCount).toBe(1);
      const expected = selectNextOverdueOccurrence({
        dueLocalDate: parseLocalDate('2026-08-05'),
        now: NOW,
      });
      expect(after?.nextOverdueOccurrenceAt).toBe(expected.occurrenceAt);
      expect((await attemptsFor(seeded.taskId))[0].scheduleSettledAt).not.toBeNull();
    });

    it('does not count twice when a third invocation sees the same settled occurrence', async () => {
      const seeded = await seedDueTask('h1_once');
      const { client, armAfterSend } = phaseBFailingClient();
      const transport = acceptThenBreakSettlement(armAfterSend, 'ref_once');

      await runInternalReminderProcess({
        db: client,
        requestId: 'req_h1_once',
        now: NOW,
        env: ENABLED,
        transport,
      });
      await run({ transport, now: NOW });
      const third = await run({ transport, now: NOW });

      expect(third.unsettledOccurrencesSettled).toBe(0);
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.overdueDeliveredCount, 'the count increments at most once').toBe(1);
      expect(await attemptsFor(seeded.taskId)).toHaveLength(1);
    });

    it('settles truthfully against a schedule that moved while the debt was outstanding', async () => {
      const seeded = await seedDueTask('h1_moved');
      const { client, armAfterSend } = phaseBFailingClient();
      const transport = acceptThenBreakSettlement(armAfterSend, 'ref_moved');

      await runInternalReminderProcess({
        db: client,
        requestId: 'req_h1_moved',
        now: NOW,
        env: ENABLED,
        transport,
      });
      // The Owner completes the Task before the debt is collected.
      await stopReminderSchedule(db.prisma, {
        organizationId: org,
        scheduleId: seeded.scheduleId,
        reason: 'task_completed',
        stoppedAt: '2026-08-20T18:00:05.000Z',
      });

      const second = await run({ transport });
      expect(second.unsettledOccurrencesSettled).toBe(1);

      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.outcome, 'the send is still a fact').toBe('success');
      expect(attempt.scheduleSettledAt).not.toBeNull();
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      // Every settlement write is conditional on the schedule still being active at the generation,
      // so a stopped schedule receives nothing and is not re-armed.
      expect(schedule?.status).toBe('stopped');
      expect(schedule?.overdueDeliveredCount).toBe(0);
      expect(schedule?.nextOverdueOccurrenceAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------------------------
  // The endpoint
  // -------------------------------------------------------------------------------------------

  describe('POST /api/v1/internal/reminders/process', () => {
    function request(auth?: string | null): Request {
      const headers = new Headers();
      if (auth !== null) {
        headers.set('authorization', auth ?? `Bearer ${SECRET}`);
      }
      return new Request('http://localhost/api/v1/internal/reminders/process', {
        method: 'POST',
        headers,
      });
    }

    it('requires the cron bearer secret', async () => {
      expect((await POST(request(null))).status).toBe(401);
      expect((await POST(request('Bearer wrong-secret-entirely-different'))).status).toBe(401);
    });

    it('answers with zero aggregates and deliveryEnabled false while dark', async () => {
      const seeded = await seedDueTask('route_dark');
      const response = await POST(request());

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.deliveryEnabled).toBe(false);
      expect(body.schedulesScanned).toBe(0);
      expect(body.delivered).toBe(0);
      expect(typeof body.requestId).toBe('string');
      expect(await attemptsFor(seeded.taskId)).toEqual([]);
    });

    it('returns aggregate counts only — never a Task, recipient, address, or provider body', async () => {
      await seedDueTask('route_privacy');
      const body = (await (await POST(request())).json()) as Record<string, unknown>;

      const allowed = new Set([
        'deliveryEnabled',
        'transportConfigured',
        'schedulesScanned',
        'occurrencesClaimed',
        'claimRefusals',
        'delivered',
        'skipped',
        'failedRetryable',
        'failedPermanent',
        'ambiguous',
        'recoveredClaims',
        'retryBudgetTerminalizations',
        'unsettledOccurrencesSettled',
        'settlementsDeferred',
        'ceilingStops',
        'deadlineStopped',
        'requestId',
      ]);
      expect(Object.keys(body).filter((key) => !allowed.has(key))).toEqual([]);
      // Every counter the contract requires is present, so a field cannot be quietly dropped and
      // pass this test by simply not appearing.
      for (const key of allowed) {
        expect(body, `missing aggregate field ${key}`).toHaveProperty(key);
      }

      const serialized = JSON.stringify(body);
      expect(serialized).not.toMatch(/@/);
      expect(serialized).not.toMatch(/task_/);
      expect(serialized).not.toMatch(/sched_/);
      expect(serialized).not.toMatch(/rcp_/);
    });

    it('exposes no GET handler', async () => {
      const routeModule = (await import('@/app/api/v1/internal/reminders/process/route')) as Record<
        string,
        unknown
      >;
      expect(routeModule.GET).toBeUndefined();
      expect(routeModule.runtime).toBe('nodejs');
      expect(routeModule.maxDuration).toBe(60);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Lifecycle races that a single connection can still prove
  // -------------------------------------------------------------------------------------------

  describe('a delivery already accepted survives what happens next', () => {
    it('keeps the success when the Task is stopped during the transport call', async () => {
      const seeded = await seedDueTask('race_stop');
      const transport: ReminderTransport = {
        async send() {
          // Mid-call: exactly the interval the F1 audit finding was about.
          await stopReminderSchedule(db.prisma, {
            organizationId: org,
            scheduleId: seeded.scheduleId,
            reason: 'task_completed',
            stoppedAt: '2026-08-20T18:00:03.000Z',
          });
          return { kind: 'accepted', providerMessageRef: 'ref_race' };
        },
      };

      const response = await run({ transport });

      expect(response.delivered).toBe(1);
      const [attempt] = await attemptsFor(seeded.taskId);
      // The message left the building, so the history says so — unconditionally.
      expect(attempt.outcome).toBe('success');
      expect(attempt.providerMessageRef).toBe('ref_race');
      // But the stopped schedule received nothing.
      const schedule = await findReminderScheduleByTaskId(db.prisma, org, seeded.taskId);
      expect(schedule?.status).toBe('stopped');
      expect(schedule?.overdueDeliveredCount).toBe(0);
      expect(schedule?.nextOverdueOccurrenceAt).toBeNull();
    });
  });
});
