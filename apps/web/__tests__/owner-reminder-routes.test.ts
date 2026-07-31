// @vitest-environment node
/**
 * A8.3b Owner reminder route inventory
 * ------------------------------------
 *   GET    /api/v1/tasks/{taskId}/reminder → "route: GET reminder"
 *   PUT    /api/v1/tasks/{taskId}/reminder → "route: PUT reminder"
 *   DELETE /api/v1/tasks/{taskId}/reminder → "route: DELETE reminder"
 *
 * These run against a real PostgreSQL engine (PGlite) with the committed migrations applied, so
 * uniqueness, partial indexes, and generation constraints are exercised rather than mocked.
 *
 * A8.3b is configuration only: no worker, scheduler, cron, or delivery path exists, so every
 * assertion below is about stored state and audit truthfulness — never about a reminder being sent.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REMINDER_SCHEDULING_TIME_ZONE,
  asOrganizationId,
  asOwnerId,
  formatETag,
  ownerActor,
} from '@aicaa/domain';
import {
  findReminderScheduleByTaskId,
  getTaskDueLocalDate,
  listAuditEventsForTask,
  listReminderDeliveryAttemptsForTask,
  suspendReminderScheduleForWaiting,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { POST as createTask } from '@/app/api/v1/tasks/route';
import {
  DELETE as removeReminder,
  GET as readReminder,
  PUT as setReminder,
} from '@/app/api/v1/tasks/[taskId]/reminder/route';
import { POST as completeTask } from '@/app/api/v1/tasks/[taskId]/complete/route';

const org = 'org_reminder_api';
const otherOrg = 'org_reminder_other';
const owner = ownerActor(asOwnerId('owner_reminder'), asOrganizationId(org));
const otherOwner = ownerActor(asOwnerId('owner_reminder_other'), asOrganizationId(otherOrg));

/** Fixed clock so advance-window and overdue-selection assertions are deterministic. */
const NOW = '2026-03-10T17:00:00.000Z';

let db: TestDatabase;

function authOwner(actor = owner) {
  vi.mocked(getAuthenticatedOwner).mockResolvedValue({
    user: { id: actor.ownerId } as never,
    actor,
    session: {
      ownerId: actor.ownerId,
      organizationId: actor.organizationId,
      role: 'owner',
      displayName: 'Owner',
    },
  });
}

function unauthenticated() {
  vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
}

function params(taskId: string) {
  return { params: Promise.resolve({ taskId }) };
}

function url(taskId: string) {
  return `http://localhost/api/v1/tasks/${taskId}/reminder`;
}

function request(
  taskId: string,
  method: 'GET' | 'PUT' | 'DELETE',
  options: { body?: unknown; ifMatch?: string | null } = {},
): Request {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (options.ifMatch) {
    headers['if-match'] = options.ifMatch;
  }
  return new Request(url(taskId), {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function seedTask(): Promise<{ id: string; etag: string; version: number }> {
  const created = await createTask(
    new Request('http://localhost/api/v1/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        summaryPoints: [
          { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Do work' },
        ],
      }),
    }),
  );
  expect(created.status).toBe(201);
  const task = await created.json();
  return { id: task.id, etag: task.etag, version: task.version };
}

/** Establish a schedule and return the parsed reminder state. */
async function establish(taskId: string, etag: string, dueLocalDate: string) {
  const response = await setReminder(
    request(taskId, 'PUT', { body: { dueLocalDate }, ifMatch: etag }),
    params(taskId),
  );
  return { response, body: await response.json() };
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
  vi.mocked(getAuthenticatedOwner).mockReset();
  await db.prisma.reminderDeliveryAttempt.deleteMany();
  await db.prisma.taskReminderSchedule.deleteMany();
  await db.prisma.auditEvent.deleteMany();
  await db.prisma.taskCapability.deleteMany();
  await db.prisma.taskNote.deleteMany();
  await db.prisma.taskAssignment.deleteMany();
  await db.prisma.taskSuggestion.deleteMany();
  await db.prisma.task.deleteMany();
  await db.prisma.recipient.deleteMany();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  authOwner();
});

afterAll(() => {
  vi.useRealTimers();
});

describe('A8.3b Owner reminder routes: authentication and authorization', () => {
  it('rejects an unauthenticated read', async () => {
    const task = await seedTask();
    unauthenticated();

    const response = await readReminder(request(task.id, 'GET'), params(task.id));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an unauthenticated establish and writes nothing', async () => {
    const task = await seedTask();
    unauthenticated();

    const response = await setReminder(
      request(task.id, 'PUT', { body: { dueLocalDate: '2026-04-01' }, ifMatch: task.etag }),
      params(task.id),
    );

    expect(response.status).toBe(401);
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('rejects an unauthenticated removal', async () => {
    const task = await seedTask();
    unauthenticated();

    const response = await removeReminder(
      request(task.id, 'DELETE', { ifMatch: task.etag }),
      params(task.id),
    );

    expect(response.status).toBe(401);
  });

  it('reports a foreign-organization task as not found on read', async () => {
    const task = await seedTask();
    authOwner(otherOwner);

    const response = await readReminder(request(task.id, 'GET'), params(task.id));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
  });

  it('refuses a cross-organization establish and leaves no schedule behind', async () => {
    const task = await seedTask();
    authOwner(otherOwner);

    const response = await setReminder(
      request(task.id, 'PUT', { body: { dueLocalDate: '2026-04-01' }, ifMatch: task.etag }),
      params(task.id),
    );

    expect(response.status).toBe(404);
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
    expect(await findReminderScheduleByTaskId(db.prisma, otherOrg, task.id)).toBeNull();
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBeNull();
  });

  it('refuses a cross-organization removal and leaves the schedule intact', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');

    authOwner(otherOwner);
    const response = await removeReminder(
      request(task.id, 'DELETE', { ifMatch: task.etag }),
      params(task.id),
    );

    expect(response.status).toBe(404);
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(schedule?.status).toBe('active');
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBe('2026-04-01');
  });

  it('never reveals a foreign task through the organization the caller claims', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');

    authOwner(otherOwner);
    const response = await readReminder(request(task.id, 'GET'), params(task.id));

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('2026-04-01');
  });
});

describe('A8.3b Owner reminder routes: route: GET reminder', () => {
  it('reports no_due_date for a task the Owner never scheduled', async () => {
    const task = await seedTask();

    const response = await readReminder(request(task.id, 'GET'), params(task.id));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      taskId: task.id,
      dueLocalDate: null,
      schedulingTimeZone: null,
      state: 'no_due_date',
      generation: null,
      advance: null,
      nextOverdueOccurrence: null,
      overdueDeliveredCount: null,
      requiresOwnerAttention: false,
      stopReason: null,
    });
  });

  it('reports an active schedule with the derived occurrences', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');

    const response = await readReminder(request(task.id, 'GET'), params(task.id));
    const body = await response.json();

    expect(body.state).toBe('active');
    expect(body.dueLocalDate).toBe('2026-04-01');
    expect(body.schedulingTimeZone).toBe(REMINDER_SCHEDULING_TIME_ZONE);
    expect(body.generation).toBe(1);
    expect(body.advance).toEqual({
      disposition: 'scheduled',
      occurrence: { localDate: '2026-03-31', at: expect.any(String) },
    });
    expect(body.nextOverdueOccurrence.localDate).toBe('2026-04-02');
    expect(body.overdueDeliveredCount).toBe(0);
    expect(body.requiresOwnerAttention).toBe(false);
    expect(body.stopReason).toBeNull();
  });

  it('reports a stopped schedule with its recorded reason', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');
    await removeReminder(request(task.id, 'DELETE', { ifMatch: task.etag }), params(task.id));

    const body = await (await readReminder(request(task.id, 'GET'), params(task.id))).json();

    expect(body.state).toBe('stopped');
    expect(body.stopReason).toBe('due_date_removed');
    expect(body.dueLocalDate).toBeNull();
    expect(body.nextOverdueOccurrence).toBeNull();
  });

  it('reports an advance skipped because its window had already elapsed', async () => {
    const task = await seedTask();
    // Due today: the day before 09:00 local is long past, so D105 forbids an advance reminder.
    await establish(task.id, task.etag, '2026-03-10');

    const body = await (await readReminder(request(task.id, 'GET'), params(task.id))).json();

    expect(body.advance.disposition).toBe('skipped_window_elapsed');
    expect(body.advance.occurrence.localDate).toBe('2026-03-09');
    expect(body.state).toBe('active');
  });

  it('reports a suspended schedule as suspended_waiting', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    // Seeded through persistence: A8.3b defers Waiting integration, so no route reaches this state.
    await suspendReminderScheduleForWaiting(db.prisma, {
      organizationId: org,
      scheduleId: schedule!.id,
      suspendedAt: NOW,
    });

    const body = await (await readReminder(request(task.id, 'GET'), params(task.id))).json();

    expect(body.state).toBe('suspended_waiting');
  });

  it('reports requiresOwnerAttention truthfully', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    await db.prisma.taskReminderSchedule.update({
      where: { id: schedule!.id },
      data: { requiresOwnerAttention: true },
    });

    const body = await (await readReminder(request(task.id, 'GET'), params(task.id))).json();

    expect(body.requiresOwnerAttention).toBe(true);
  });

  it('exposes no worker internals, row identifiers, or lease state', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    await db.prisma.taskReminderSchedule.update({
      where: { id: schedule!.id },
      data: { claimedBy: 'worker-7', claimedAt: new Date(NOW), claimExpiresAt: new Date(NOW) },
    });

    const response = await readReminder(request(task.id, 'GET'), params(task.id));
    const text = await response.text();
    const body = JSON.parse(text);

    for (const leaked of ['claimedBy', 'claimedAt', 'claimExpiresAt', 'id', 'scheduleId']) {
      expect(Object.keys(body)).not.toContain(leaked);
    }
    expect(text).not.toContain('worker-7');
    expect(text).not.toContain(schedule!.id);
    expect(text).not.toContain('task_reminder_schedules');
  });

  it('is not cacheable', async () => {
    const task = await seedTask();

    const response = await readReminder(request(task.id, 'GET'), params(task.id));

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('A8.3b Owner reminder routes: route: PUT reminder', () => {
  it('establishes generation 1, the canonical due date, and the domain-derived occurrences', async () => {
    const task = await seedTask();

    const { response, body } = await establish(task.id, task.etag, '2026-04-01');

    expect(response.status).toBe(200);
    expect(body.state).toBe('active');
    expect(body.generation).toBe(1);
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBe('2026-04-01');

    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(schedule?.schedulingTimeZone).toBe(REMINDER_SCHEDULING_TIME_ZONE);
    expect(schedule?.advanceOccurrenceLocalDate).toBe('2026-03-31');
    expect(schedule?.nextOverdueOccurrenceLocalDate).toBe('2026-04-02');
  });

  it('derives the organization timezone rather than accepting one', async () => {
    const task = await seedTask();

    const response = await setReminder(
      request(task.id, 'PUT', {
        body: { dueLocalDate: '2026-04-01', schedulingTimeZone: 'UTC' },
        ifMatch: task.etag,
      }),
      params(task.id),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('records a skipped advance attempt when the advance window had elapsed', async () => {
    const task = await seedTask();

    const { body } = await establish(task.id, task.etag, '2026-03-10');

    expect(body.advance.disposition).toBe('skipped_window_elapsed');
    const attempts = await listReminderDeliveryAttemptsForTask(db.prisma, org, task.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.occurrenceKind).toBe('advance');
    expect(attempts[0]?.outcome).toBe('skipped');
    expect(attempts[0]?.skipReason).toBe('advance_window_elapsed');
  });

  it('rejects an impossible Gregorian date', async () => {
    const task = await seedTask();

    const response = await setReminder(
      request(task.id, 'PUT', { body: { dueLocalDate: '2026-02-30' }, ifMatch: task.etag }),
      params(task.id),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBeNull();
  });

  it('rejects a non-leap-year February 29', async () => {
    const task = await seedTask();

    const response = await setReminder(
      request(task.id, 'PUT', { body: { dueLocalDate: '2025-02-29' }, ifMatch: task.etag }),
      params(task.id),
    );

    expect(response.status).toBe(400);
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('rejects a noncanonical date', async () => {
    const task = await seedTask();

    for (const dueLocalDate of ['2026-4-01', '2026/04/01', '20260401', '2026-04-01T00:00:00Z']) {
      const response = await setReminder(
        request(task.id, 'PUT', { body: { dueLocalDate }, ifMatch: task.etag }),
        params(task.id),
      );
      expect(response.status, dueLocalDate).toBe(400);
    }
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('refuses every derived field a client might try to choose', async () => {
    const task = await seedTask();

    const derived = [
      { generation: 5 },
      { occurrenceKind: 'overdue' },
      { occurrenceLocalDate: '2026-04-02' },
      { occurrenceAt: NOW },
      { advanceDisposition: 'scheduled' },
      { nextOverdueOccurrenceLocalDate: '2026-04-02' },
      { state: 'active' },
      { status: 'active' },
      { overdueDeliveredCount: 0 },
      { stopReason: 'due_date_removed' },
      { requiresOwnerAttention: true },
      { organizationId: otherOrg },
      { claimedBy: 'worker-1' },
      { dueAt: NOW },
    ];

    for (const extra of derived) {
      const response = await setReminder(
        request(task.id, 'PUT', {
          body: { dueLocalDate: '2026-04-01', ...extra },
          ifMatch: task.etag,
        }),
        params(task.id),
      );
      expect(response.status, JSON.stringify(extra)).toBe(400);
    }
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('requires If-Match and rejects a stale one', async () => {
    const task = await seedTask();

    const missing = await setReminder(
      request(task.id, 'PUT', { body: { dueLocalDate: '2026-04-01' } }),
      params(task.id),
    );
    expect(missing.status).toBe(428);

    const stale = await setReminder(
      request(task.id, 'PUT', {
        body: { dueLocalDate: '2026-04-01' },
        ifMatch: formatETag('task', task.id, task.version + 7),
      }),
      params(task.id),
    );
    expect(stale.status).toBe(412);
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('is idempotent for an immaterial repeat and does not open a generation', async () => {
    const task = await seedTask();
    const first = await establish(task.id, task.etag, '2026-04-01');

    const second = await establish(task.id, task.etag, '2026-04-01');

    expect(second.response.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(second.body.generation).toBe(1);
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(schedule?.generation).toBe(1);
  });

  it('opens exactly one generation for a material change and preserves prior attempts', async () => {
    const task = await seedTask();
    // Establish with an elapsed advance window so generation 1 owns a real attempt row.
    await establish(task.id, task.etag, '2026-03-10');
    const before = await listReminderDeliveryAttemptsForTask(db.prisma, org, task.id);
    expect(before).toHaveLength(1);

    const { body } = await establish(task.id, task.etag, '2026-05-20');

    expect(body.generation).toBe(2);
    expect(body.dueLocalDate).toBe('2026-05-20');
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(schedule?.generation).toBe(2);
    expect(schedule?.overdueDeliveredCount).toBe(0);
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBe('2026-05-20');

    const after = await listReminderDeliveryAttemptsForTask(db.prisma, org, task.id);
    expect(after.map((attempt) => attempt.id)).toEqual(
      expect.arrayContaining(before.map((attempt) => attempt.id)),
    );
    expect(after.some((attempt) => attempt.generation === 1)).toBe(true);
  });

  it('re-establishes a new generation after a removal, because a stopped schedule is not live', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');
    await removeReminder(request(task.id, 'DELETE', { ifMatch: task.etag }), params(task.id));

    // Same date as before: immaterial as a date change, but the schedule was stopped, so D109
    // requires this explicit re-save to reactivate reminders rather than silently no-op.
    const { body } = await establish(task.id, task.etag, '2026-04-01');

    expect(body.state).toBe('active');
    expect(body.generation).toBe(2);
    expect(body.stopReason).toBeNull();
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBe('2026-04-01');
  });

  it('refuses to reschedule a suspended schedule rather than silently resuming it', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    await suspendReminderScheduleForWaiting(db.prisma, {
      organizationId: org,
      scheduleId: schedule!.id,
      suspendedAt: NOW,
    });

    // Unreachable through A8.3b routes, but opening a generation would return the schedule to
    // `active`, and D107 makes Waiting the only pause mechanism — so a material change must refuse.
    const response = await setReminder(
      request(task.id, 'PUT', { body: { dueLocalDate: '2026-05-20' }, ifMatch: task.etag }),
      params(task.id),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('DOMAIN_CONFLICT');
    const after = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(after?.status).toBe('suspended_waiting');
    expect(after?.generation).toBe(1);
    expect(after?.dueLocalDate).toBe('2026-04-01');
  });

  it('stays idempotent for an immaterial repeat while suspended', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    await suspendReminderScheduleForWaiting(db.prisma, {
      organizationId: org,
      scheduleId: schedule!.id,
      suspendedAt: NOW,
    });

    const { response, body } = await establish(task.id, task.etag, '2026-04-01');

    expect(response.status).toBe(200);
    expect(body.state).toBe('suspended_waiting');
    expect(body.generation).toBe(1);
  });

  it('is not cacheable', async () => {
    const task = await seedTask();

    const { response } = await establish(task.id, task.etag, '2026-04-01');

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('A8.3b Owner reminder routes: route: DELETE reminder', () => {
  it('stops the schedule, clears the due date, and leaves no future occurrence', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');

    const response = await removeReminder(
      request(task.id, 'DELETE', { ifMatch: task.etag }),
      params(task.id),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.state).toBe('stopped');
    expect(body.stopReason).toBe('due_date_removed');
    expect(body.dueLocalDate).toBeNull();
    expect(body.nextOverdueOccurrence).toBeNull();

    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(schedule?.status).toBe('stopped');
    expect(schedule?.nextOverdueOccurrenceLocalDate).toBeNull();
    expect(schedule?.nextOverdueOccurrenceAt).toBeNull();
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBeNull();
  });

  it('preserves reminder history rather than deleting rows', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-03-10');
    const before = await listReminderDeliveryAttemptsForTask(db.prisma, org, task.id);
    expect(before).toHaveLength(1);

    await removeReminder(request(task.id, 'DELETE', { ifMatch: task.etag }), params(task.id));

    const after = await listReminderDeliveryAttemptsForTask(db.prisma, org, task.id);
    expect(after).toHaveLength(before.length);
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).not.toBeNull();
  });

  it('is idempotent when repeated', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');

    const first = await removeReminder(
      request(task.id, 'DELETE', { ifMatch: task.etag }),
      params(task.id),
    );
    const second = await removeReminder(
      request(task.id, 'DELETE', { ifMatch: task.etag }),
      params(task.id),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
  });

  it('is idempotent when the task never had a due date', async () => {
    const task = await seedTask();

    const response = await removeReminder(
      request(task.id, 'DELETE', { ifMatch: task.etag }),
      params(task.id),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.state).toBe('no_due_date');
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('requires If-Match and rejects a stale one', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');

    expect((await removeReminder(request(task.id, 'DELETE'), params(task.id))).status).toBe(428);

    const stale = await removeReminder(
      request(task.id, 'DELETE', { ifMatch: formatETag('task', task.id, task.version + 7) }),
      params(task.id),
    );
    expect(stale.status).toBe(412);
    expect((await findReminderScheduleByTaskId(db.prisma, org, task.id))?.status).toBe('active');
  });
});

describe('A8.3b Owner reminder routes: audit events', () => {
  async function reminderAudits(taskId: string) {
    const events = await listAuditEventsForTask(db.prisma, org, taskId);
    return events.filter((event) => event.action.startsWith('reminder.'));
  }

  it('records establishment attributed to the Owner', async () => {
    const task = await seedTask();

    await establish(task.id, task.etag, '2026-04-01');

    const audits = await reminderAudits(task.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('reminder.schedule.established');
    expect(audits[0]?.actorKind).toBe('owner');
    expect(audits[0]?.ownerId).toBe(owner.ownerId);
    expect(audits[0]?.outcome).toBe('succeeded');
  });

  it('records a material change separately from establishment', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');

    await establish(task.id, task.etag, '2026-05-20');

    const audits = await reminderAudits(task.id);
    expect(audits.map((event) => event.action)).toEqual([
      'reminder.schedule.established',
      'reminder.schedule.changed',
    ]);
  });

  it('records a due-date removal', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');

    await removeReminder(request(task.id, 'DELETE', { ifMatch: task.etag }), params(task.id));

    const audits = await reminderAudits(task.id);
    expect(audits.map((event) => event.action)).toEqual([
      'reminder.schedule.established',
      'reminder.due_date.removed',
    ]);
  });

  it('emits no event for an immaterial repeat', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');

    await establish(task.id, task.etag, '2026-04-01');
    await establish(task.id, task.etag, '2026-04-01');

    expect(await reminderAudits(task.id)).toHaveLength(1);
  });

  it('emits no event for a repeated removal', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');
    await removeReminder(request(task.id, 'DELETE', { ifMatch: task.etag }), params(task.id));

    await removeReminder(request(task.id, 'DELETE', { ifMatch: task.etag }), params(task.id));

    const audits = await reminderAudits(task.id);
    expect(audits.filter((event) => event.action === 'reminder.due_date.removed')).toHaveLength(1);
  });

  it('emits no event when the request is rejected', async () => {
    const task = await seedTask();

    await setReminder(
      request(task.id, 'PUT', { body: { dueLocalDate: '2026-02-30' }, ifMatch: task.etag }),
      params(task.id),
    );
    authOwner(otherOwner);
    await setReminder(
      request(task.id, 'PUT', { body: { dueLocalDate: '2026-04-01' }, ifMatch: task.etag }),
      params(task.id),
    );
    authOwner();

    expect(await reminderAudits(task.id)).toHaveLength(0);
  });
});

describe('A8.3b Owner reminder routes: task lifecycle boundary', () => {
  it('does not stop reminders when a task completes, because Waiting/lifecycle integration is deferred', async () => {
    const task = await seedTask();
    await establish(task.id, task.etag, '2026-04-01');
    const current = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(current?.status).toBe('active');

    const completed = await completeTask(
      new Request(`http://localhost/api/v1/tasks/${task.id}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'if-match': task.etag },
        body: JSON.stringify({ outcomeType: 'completed' }),
      }),
      params(task.id),
    );
    expect(completed.status).toBe(200);

    // Documents the A8.3b boundary rather than endorsing it: D107 requires completion to stop
    // reminders, and that coupling is deferred with the Waiting integration. Nothing sends in this
    // slice, so the schedule staying active has no delivery consequence yet — but a worker must not
    // ship before this is closed.
    const after = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(after?.status).toBe('active');
  });
});
