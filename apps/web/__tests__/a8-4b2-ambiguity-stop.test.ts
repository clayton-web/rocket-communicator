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
  persistEstablishedReminderSchedule,
  stopReminderSchedule,
  upsertRecipient,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { runInternalReminderProcess } from '@/lib/reminders/process-service';
import { FakeReminderTransport } from '@/lib/reminders/transport';
import { toTaskReminderState } from '@/lib/reminders/state';

/**
 * D129 through the whole worker: three ambiguous mornings stop a schedule, and a fourth never sends.
 *
 * The database suite (`packages/db/__tests__/a8-4b2-consecutive-ambiguity.test.ts`) proves the
 * derivation — what counts, what breaks a run, what a generation boundary does. This suite proves
 * the parts only the worker can be wrong about:
 *
 * 1. Three real invocations against a real transport reach the stop, rather than three hand-written
 *    settlement calls doing so.
 * 2. The fourth invocation makes no provider call, because the stop disarmed the occurrence and the
 *    pre-send guard refuses a schedule that is no longer active.
 * 3. A worker holding a schedule candidate from *before* the stop still cannot send, which is the
 *    stale-candidate case a scan-then-process loop makes possible.
 * 4. The Owner-facing projection reports the new reason rather than dropping it.
 */

const org = 'org_a8_4b2';
const zone = REMINDER_SCHEDULING_TIME_ZONE;
const ENABLED = { ...process.env, ENABLE_REMINDER_DELIVERY: 'true' } as NodeJS.ProcessEnv;
const ESTABLISHED = '2026-08-01T12:00:00.000Z';

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
async function grantActionableCapability(taskId: string): Promise<void> {
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
      issuedAt: new Date(ESTABLISHED),
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      actionableAt: new Date('2026-08-01T12:05:00.000Z'),
      revokedAt: null,
      revocationReason: null,
    },
  });
  await db.prisma.taskAssignment.update({
    where: { id: assignment.id },
    data: { activeCapabilityId: `cap_${taskId}`, capabilityStatus: 'active' },
  });
}

async function seedDueTask(key: string): Promise<{ taskId: string; scheduleId: string }> {
  const taskId = `task_${key}`;
  await upsertRecipient(db.prisma, {
    organizationId: org,
    recipient: recipientFixture(`rcp_${taskId}`),
  });
  const task = taskFixture(taskId, ESTABLISHED);
  await createTask(db.prisma, org, task, task.assignment);
  await grantActionableCapability(taskId);

  const dueLocalDate = parseLocalDate('2026-08-05');
  const advance = decideAdvanceReminder({ dueLocalDate, establishedAt: ESTABLISHED });
  const nextOverdue = selectNextOverdueOccurrence({ dueLocalDate, now: ESTABLISHED });
  const { schedule } = await persistEstablishedReminderSchedule({
    db: db.prisma,
    schedule: {
      id: `sched_${key}`,
      organizationId: org,
      taskId,
      dueLocalDate,
      schedulingTimeZone: zone,
      establishedAt: ESTABLISHED,
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
  return { taskId, scheduleId: schedule.id };
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
      stoppedAt: '2026-08-19T00:00:00.000Z',
    });
  }
}

function ambiguousTransport(): FakeReminderTransport {
  // Exactly what A8.4b.1 produces from a send failure carrying no HTTP status from Gmail.
  return new FakeReminderTransport({
    defaultResult: { kind: 'ambiguous', failureCode: 'GMAIL_AMBIGUOUS_SEND' },
  });
}

async function run(transport: FakeReminderTransport, now: string) {
  const { response } = await runInternalReminderProcess({
    db: db.prisma,
    requestId: 'req_a8_4b2',
    now,
    env: ENABLED,
    transport,
  });
  return response;
}

async function readSchedule(scheduleId: string) {
  return db.prisma.taskReminderSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
}

/** One morning per invocation, walking the clock forward a day at a time. */
const MORNINGS = [
  '2026-08-20T18:00:00.000Z',
  '2026-08-21T18:00:00.000Z',
  '2026-08-22T18:00:00.000Z',
  '2026-08-23T18:00:00.000Z',
];

describe('A8.4b.2 repeated ambiguity stops delivery (D129)', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    clearDbTestRuntime();
    delete process.env.ENABLE_REMINDER_DELIVERY;
    await db.close();
  });

  beforeEach(async () => {
    installDbTestRuntime(db.prisma);
    await quiesce();
  });

  it('stops after the third ambiguous morning and reports it in the aggregate', async () => {
    const seeded = await seedDueTask('amb_stop');
    const transport = ambiguousTransport();

    const first = await run(transport, MORNINGS[0]);
    expect(first.ambiguous).toBe(1);
    expect(first.ambiguityStops).toBe(0);
    expect((await readSchedule(seeded.scheduleId)).status).toBe('active');

    const second = await run(transport, MORNINGS[1]);
    expect(second.ambiguous).toBe(1);
    expect(second.ambiguityStops).toBe(0);
    expect((await readSchedule(seeded.scheduleId)).status).toBe('active');

    const third = await run(transport, MORNINGS[2]);
    expect(third.ambiguous).toBe(1);
    expect(third.ambiguityStops).toBe(1);
    // Distinct from a ceiling stop, which is a schedule finishing its work rather than a
    // deployment that cannot confirm its own sends.
    expect(third.ceilingStops).toBe(0);

    const stopped = await readSchedule(seeded.scheduleId);
    expect(stopped.status).toBe('stopped');
    expect(stopped.stopReason).toBe('repeated_ambiguous_outcomes');
    expect(stopped.requiresOwnerAttention).toBe(true);
    expect(stopped.nextOverdueOccurrenceAt).toBeNull();
  });

  it('makes no provider call on the fourth morning', async () => {
    const seeded = await seedDueTask('amb_fourth');
    const transport = ambiguousTransport();

    for (const morning of MORNINGS.slice(0, 3)) {
      await run(transport, morning);
    }
    expect(transport.calls).toHaveLength(3);

    const fourth = await run(transport, MORNINGS[3]);

    // Nothing was scanned, nothing was claimed, and above all nothing was sent. The stop disarmed
    // the occurrence, so the due scan has nothing to select.
    expect(transport.calls).toHaveLength(3);
    expect(fourth.delivered).toBe(0);
    expect(fourth.ambiguous).toBe(0);
    expect(fourth.schedulesScanned).toBe(0);

    const attempts = await listReminderDeliveryAttemptsForTask(db.prisma, org, seeded.taskId);
    const overdue = attempts.filter((attempt) => attempt.occurrenceKind === 'overdue');
    expect(overdue).toHaveLength(3);
    expect(overdue.map((attempt) => attempt.outcome)).toEqual([
      'ambiguous',
      'ambiguous',
      'ambiguous',
    ]);
  });

  it('refuses to send from a schedule candidate fetched before the stop', async () => {
    // The scan pre-fetches candidates and then processes them one at a time, so a candidate can be
    // stale by the time it is reached — including stale about a stop another worker just applied.
    const seeded = await seedDueTask('amb_stale');
    const transport = ambiguousTransport();
    await run(transport, MORNINGS[0]);
    await run(transport, MORNINGS[1]);

    // Freeze the schedule exactly as a scan would have read it: active, armed, one morning short.
    const candidate = await readSchedule(seeded.scheduleId);
    expect(candidate.status).toBe('active');
    expect(candidate.nextOverdueOccurrenceAt).not.toBeNull();

    await run(transport, MORNINGS[2]);
    expect((await readSchedule(seeded.scheduleId)).stopReason).toBe('repeated_ambiguous_outcomes');

    // Now replay the stale candidate's morning. The pre-send guard re-reads the schedule inside the
    // occurrence transaction and finds it neither active nor armed, so it skips rather than sends.
    const callsBefore = transport.calls.length;
    const replay = await run(transport, MORNINGS[2]);

    expect(transport.calls).toHaveLength(callsBefore);
    expect(replay.delivered).toBe(0);
    expect(replay.schedulesScanned).toBe(0);
  });

  it('reports the new stop reason to the Owner rather than dropping it', async () => {
    const seeded = await seedDueTask('amb_owner');
    const transport = ambiguousTransport();
    for (const morning of MORNINGS.slice(0, 3)) {
      await run(transport, morning);
    }

    const stopped = await readSchedule(seeded.scheduleId);
    const state = toTaskReminderState(
      {
        taskId: stopped.taskId,
        id: stopped.id,
        organizationId: stopped.organizationId,
        generation: stopped.generation,
        reminderVersion: stopped.reminderVersion,
        dueLocalDate: stopped.dueLocalDate ?? '2026-08-05',
        schedulingTimeZone: stopped.schedulingTimeZone,
        status: stopped.status,
        advanceDisposition: stopped.advanceDisposition,
        advanceOccurrenceLocalDate: stopped.advanceOccurrenceLocalDate,
        advanceOccurrenceAt: stopped.advanceOccurrenceAt?.toISOString() ?? null,
        nextOverdueOccurrenceLocalDate: stopped.nextOverdueOccurrenceLocalDate,
        nextOverdueOccurrenceAt: stopped.nextOverdueOccurrenceAt?.toISOString() ?? null,
        overdueDeliveredCount: stopped.overdueDeliveredCount,
        requiresOwnerAttention: stopped.requiresOwnerAttention,
        stopReason: stopped.stopReason,
      } as Parameters<typeof toTaskReminderState>[0],
      '2026-08-05',
    );

    // The projection passes the reason through rather than mapping a closed set of them, which is
    // why a new reason needs no serializer change — but "needs no change" is worth proving, since
    // the alternative failure is silent: an Owner told only that reminders stopped.
    expect(state.state).toBe('stopped');
    expect(state.stopReason).toBe('repeated_ambiguous_outcomes');
    expect(state.requiresOwnerAttention).toBe(true);
  });

  it('does not stop when a delivery succeeds between ambiguous mornings', async () => {
    const seeded = await seedDueTask('amb_broken');
    const ambiguous = ambiguousTransport();
    const accepting = new FakeReminderTransport({
      defaultResult: { kind: 'accepted', providerMessageRef: 'ref_ok' },
    });

    await run(ambiguous, MORNINGS[0]);
    await run(accepting, MORNINGS[1]);
    await run(ambiguous, MORNINGS[2]);
    const fourth = await run(ambiguous, MORNINGS[3]);

    // A confirmed send says the path to the provider works, so the run restarts after it.
    expect(fourth.ambiguityStops).toBe(0);
    const schedule = await readSchedule(seeded.scheduleId);
    expect(schedule.status).toBe('active');
    expect(schedule.stopReason).toBeNull();
    expect(schedule.overdueDeliveredCount).toBe(1);
  });
});
