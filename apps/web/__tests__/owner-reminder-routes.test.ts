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
 *
 * **PGlite cannot prove concurrency.** It serializes every statement on one connection, so a race
 * between two Owner requests is impossible to stage here — which is exactly how the A8.3b audit's
 * lost update and deadlock went unnoticed. Two-connection proof lives in
 * `packages/db/__tests__/a8-3b-owner-reminder-concurrency.pg.test.ts`, which runs only against a real
 * PostgreSQL server.
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
  listDueAdvanceReminderSchedulesGlobally,
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
import { POST as dismissTask } from '@/app/api/v1/tasks/[taskId]/dismiss/route';
import { POST as startTask } from '@/app/api/v1/tasks/[taskId]/start/route';
import { POST as waitTask } from '@/app/api/v1/tasks/[taskId]/waiting/route';
import { POST as resumeTask } from '@/app/api/v1/tasks/[taskId]/resume/route';

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
  options: { body?: unknown; ifMatch?: string | null; rawBody?: string } = {},
): Request {
  const headers: Record<string, string> = {};
  if (options.body !== undefined || options.rawBody !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (options.ifMatch) {
    headers['if-match'] = options.ifMatch;
  }
  const body =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return new Request(url(taskId), {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
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

/** Read the current reminder state. */
async function read(taskId: string) {
  const response = await readReminder(request(taskId, 'GET'), params(taskId));
  return { response, body: await response.json() };
}

/** The reminder ETag a mutation must present, read the way a client would. */
async function reminderEtag(taskId: string): Promise<string> {
  const { body } = await read(taskId);
  return body.etag;
}

/**
 * Establish or change a due date using the current reminder token.
 *
 * Fetching the token rather than accepting one is what a well-behaved client does, and it keeps the
 * tests from encoding version arithmetic that the ETag is deliberately opaque about.
 */
async function establish(taskId: string, dueLocalDate: string, ifMatch?: string) {
  const token = ifMatch ?? (await reminderEtag(taskId));
  const response = await setReminder(
    request(taskId, 'PUT', { body: { dueLocalDate }, ifMatch: token }),
    params(taskId),
  );
  return { response, body: await response.json() };
}

async function establishWithPreference(
  taskId: string,
  dueLocalDate: string,
  advanceEnabled: boolean,
  ifMatch?: string,
) {
  const token = ifMatch ?? (await reminderEtag(taskId));
  const response = await setReminder(
    request(taskId, 'PUT', { body: { dueLocalDate, advanceEnabled }, ifMatch: token }),
    params(taskId),
  );
  return { response, body: await response.json() };
}

async function remove(taskId: string, ifMatch?: string) {
  const token = ifMatch ?? (await reminderEtag(taskId));
  const response = await removeReminder(
    request(taskId, 'DELETE', { ifMatch: token }),
    params(taskId),
  );
  return { response, body: await response.json() };
}

/** Drive a Task through a lifecycle route, returning its new Task ETag. */
async function taskAction(
  handler: (
    request: Request,
    context: { params: Promise<{ taskId: string }> },
  ) => Promise<Response>,
  taskId: string,
  path: string,
  taskEtag: string,
  body: unknown,
): Promise<string> {
  const response = await handler(
    new Request(`http://localhost/api/v1/tasks/${taskId}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': taskEtag },
      body: JSON.stringify(body),
    }),
    params(taskId),
  );
  expect(response.status, `${path}: ${await response.clone().text()}`).toBe(200);
  return (await response.json()).etag;
}

const toWaiting = (taskId: string, etag: string) =>
  taskAction(waitTask, taskId, 'waiting', etag, { waitingUntil: '2026-04-20T17:00:00.000Z' });
const toInProgress = (taskId: string, etag: string) =>
  taskAction(startTask, taskId, 'start', etag, {});
const toCompleted = (taskId: string, etag: string) =>
  taskAction(completeTask, taskId, 'complete', etag, { outcomeType: 'completed' });
const toDismissed = (taskId: string, etag: string) =>
  taskAction(dismissTask, taskId, 'dismiss', etag, { reason: 'not needed' });
/**
 * Leave Waiting, optionally at a later instant.
 *
 * `at` advances the fake clock so the resume genuinely happens after the waiting period, which is the
 * only way to test that resume computes forward instead of replaying elapsed mornings.
 */
const toResumed = (taskId: string, etag: string, at?: string) => {
  if (at) {
    vi.setSystemTime(new Date(at));
  }
  return taskAction(resumeTask, taskId, 'resume', etag, {});
};

async function reminderAudits(taskId: string) {
  const events = await listAuditEventsForTask(db.prisma, org, taskId);
  return events.filter((event) => event.action.startsWith('reminder.'));
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
    const token = await reminderEtag(task.id);
    unauthenticated();

    const response = await setReminder(
      request(task.id, 'PUT', { body: { dueLocalDate: '2026-04-01' }, ifMatch: token }),
      params(task.id),
    );

    expect(response.status).toBe(401);
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('rejects an unauthenticated removal', async () => {
    const task = await seedTask();
    const token = await reminderEtag(task.id);
    unauthenticated();

    const response = await removeReminder(
      request(task.id, 'DELETE', { ifMatch: token }),
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
    const token = await reminderEtag(task.id);
    authOwner(otherOwner);

    const response = await setReminder(
      request(task.id, 'PUT', { body: { dueLocalDate: '2026-04-01' }, ifMatch: token }),
      params(task.id),
    );

    expect(response.status).toBe(404);
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
    expect(await findReminderScheduleByTaskId(db.prisma, otherOrg, task.id)).toBeNull();
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBeNull();
  });

  it('refuses a cross-organization removal and leaves the schedule intact', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const token = await reminderEtag(task.id);

    authOwner(otherOwner);
    const response = await removeReminder(
      request(task.id, 'DELETE', { ifMatch: token }),
      params(task.id),
    );

    expect(response.status).toBe(404);
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(schedule?.status).toBe('active');
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBe('2026-04-01');
  });

  it('never reveals a foreign task through the organization the caller claims', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');

    authOwner(otherOwner);
    const response = await readReminder(request(task.id, 'GET'), params(task.id));

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('2026-04-01');
  });

  it('does not let a cross-organization caller use the token as an existence oracle', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const token = await reminderEtag(task.id);

    authOwner(otherOwner);
    // A valid current token, a forged one, and a token for a Task that does not exist must be
    // indistinguishable: all 404, so nothing confirms the Task or its schedule exists.
    const real = await removeReminder(
      request(task.id, 'DELETE', { ifMatch: token }),
      params(task.id),
    );
    const forged = await removeReminder(
      request(task.id, 'DELETE', { ifMatch: formatETag('task-reminder', task.id, 99) }),
      params(task.id),
    );
    const absent = await removeReminder(
      request('task_missing', 'DELETE', {
        ifMatch: formatETag('task-reminder', 'task_missing', 1),
      }),
      params('task_missing'),
    );

    expect([real.status, forged.status, absent.status]).toEqual([404, 404, 404]);
  });
});

describe('A8.3b Owner reminder routes: route: GET reminder', () => {
  it('reports no_due_date for a task the Owner never scheduled', async () => {
    const task = await seedTask();

    const { response, body } = await read(task.id);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      taskId: task.id,
      etag: formatETag('task-reminder', task.id, 0),
      dueLocalDate: null,
      schedulingTimeZone: null,
      state: 'no_due_date',
      generation: null,
      advance: null,
      nextOverdueOccurrence: null,
      overdueDeliveredCount: null,
      requiresOwnerAttention: false,
      stopReason: null,
      advanceEnabled: null,
    });
  });

  it('reports an active schedule with the derived occurrences', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');

    const { body } = await read(task.id);

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
    expect(body.advanceEnabled).toBe(true);
  });

  it('reports a stopped schedule with its recorded reason', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    await remove(task.id);

    const { body } = await read(task.id);

    expect(body.state).toBe('stopped');
    expect(body.stopReason).toBe('due_date_removed');
    expect(body.dueLocalDate).toBeNull();
    expect(body.nextOverdueOccurrence).toBeNull();
  });

  it('reports an advance skipped because its window had already elapsed', async () => {
    const task = await seedTask();
    // Due today: the day before 09:00 local is long past, so D105 forbids an advance reminder.
    await establish(task.id, '2026-03-10');

    const { body } = await read(task.id);

    expect(body.advance.disposition).toBe('skipped_window_elapsed');
    expect(body.advance.occurrence.localDate).toBe('2026-03-09');
    expect(body.state).toBe('active');
  });

  it('reports a suspended schedule as suspended_waiting', async () => {
    const task = await seedTask();
    const waiting = await toWaiting(task.id, task.etag);
    expect(waiting).toBeDefined();
    await establish(task.id, '2026-04-01');

    const { body } = await read(task.id);

    expect(body.state).toBe('suspended_waiting');
  });

  it('reports requiresOwnerAttention truthfully', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    await db.prisma.taskReminderSchedule.update({
      where: { id: schedule!.id },
      data: { requiresOwnerAttention: true },
    });

    const { body } = await read(task.id);

    expect(body.requiresOwnerAttention).toBe(true);
  });

  it('exposes no worker internals, row identifiers, lease state, or the raw version', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    await db.prisma.taskReminderSchedule.update({
      where: { id: schedule!.id },
      data: { claimedBy: 'worker-7', claimedAt: new Date(NOW), claimExpiresAt: new Date(NOW) },
    });

    const response = await readReminder(request(task.id, 'GET'), params(task.id));
    const text = await response.text();
    const body = JSON.parse(text);

    for (const leaked of [
      'claimedBy',
      'claimedAt',
      'claimExpiresAt',
      'id',
      'scheduleId',
      'reminderVersion',
    ]) {
      expect(Object.keys(body)).not.toContain(leaked);
    }
    expect(text).not.toContain('worker-7');
    expect(text).not.toContain(schedule!.id);
    expect(text).not.toContain('task_reminder_schedules');
  });

  it('is allowed for a completed task so the history stays readable', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    await toCompleted(task.id, task.etag);

    const { response, body } = await read(task.id);

    expect(response.status).toBe(200);
    expect(body.dueLocalDate).toBe('2026-04-01');
  });

  it('is not cacheable', async () => {
    const task = await seedTask();

    const { response } = await read(task.id);

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('A8.3b Owner reminder routes: route: PUT reminder', () => {
  it('establishes generation 1, the canonical due date, and the domain-derived occurrences', async () => {
    const task = await seedTask();

    const { response, body } = await establish(task.id, '2026-04-01');

    expect(response.status).toBe(200);
    expect(body.state).toBe('active');
    expect(body.generation).toBe(1);
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBe('2026-04-01');

    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(schedule?.schedulingTimeZone).toBe(REMINDER_SCHEDULING_TIME_ZONE);
    expect(schedule?.advanceOccurrenceLocalDate).toBe('2026-03-31');
    expect(schedule?.nextOverdueOccurrenceLocalDate).toBe('2026-04-02');
  });

  it('records a skipped advance attempt when the advance window had elapsed', async () => {
    const task = await seedTask();

    const { body } = await establish(task.id, '2026-03-10');

    expect(body.advance.disposition).toBe('skipped_window_elapsed');
    const attempts = await listReminderDeliveryAttemptsForTask(db.prisma, org, task.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.occurrenceKind).toBe('advance');
    expect(attempts[0]?.outcome).toBe('skipped');
    expect(attempts[0]?.skipReason).toBe('advance_window_elapsed');
  });

  it('rejects an impossible Gregorian date', async () => {
    const task = await seedTask();

    const { response } = await establish(task.id, '2026-02-30');

    expect(response.status).toBe(400);
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBeNull();
  });

  it('rejects a non-leap-year February 29', async () => {
    const task = await seedTask();

    const { response } = await establish(task.id, '2025-02-29');

    expect(response.status).toBe(400);
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('rejects a noncanonical date', async () => {
    const task = await seedTask();
    const token = await reminderEtag(task.id);

    for (const dueLocalDate of ['2026-4-01', '2026/04/01', '20260401', '2026-04-01T00:00:00Z']) {
      const { response } = await establish(task.id, dueLocalDate, token);
      expect(response.status, dueLocalDate).toBe(400);
    }
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('is idempotent for an immaterial repeat, opens no generation, and keeps the token stable', async () => {
    const task = await seedTask();
    const first = await establish(task.id, '2026-04-01');

    const second = await establish(task.id, '2026-04-01', first.body.etag);

    expect(second.response.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(second.body.etag).toBe(first.body.etag);
    expect(second.body.generation).toBe(1);
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(schedule?.generation).toBe(1);
  });

  it('opens exactly one generation for a material change and preserves prior attempts', async () => {
    const task = await seedTask();
    // Establish with an elapsed advance window so generation 1 owns a real attempt row.
    await establish(task.id, '2026-03-10');
    const before = await listReminderDeliveryAttemptsForTask(db.prisma, org, task.id);
    expect(before).toHaveLength(1);

    const { body } = await establish(task.id, '2026-05-20');

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
    await establish(task.id, '2026-04-01');
    await remove(task.id);

    // Same date as before: immaterial as a date change, but the schedule was stopped, so D109
    // requires this explicit re-save to reactivate reminders rather than silently no-op.
    const { body } = await establish(task.id, '2026-04-01');

    expect(body.state).toBe('active');
    expect(body.generation).toBe(2);
    expect(body.stopReason).toBeNull();
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBe('2026-04-01');
  });

  it('is not cacheable', async () => {
    const task = await seedTask();

    const { response } = await establish(task.id, '2026-04-01');

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

/**
 * F1: which Task states may carry reminder scheduling (D107).
 *
 * The audit found no gate at all — a completed Task could acquire a live schedule with claimable
 * occurrences. Every status in the `TaskStatus` enum is covered here so a future status cannot be
 * added without a decision.
 */
describe('A8.3b Owner reminder routes: task-state eligibility', () => {
  it('allows establishment on an open task', async () => {
    const task = await seedTask();

    const { response, body } = await establish(task.id, '2026-04-01');

    expect(response.status).toBe(200);
    expect(body.state).toBe('active');
  });

  it('allows establishment on an in_progress task', async () => {
    const task = await seedTask();
    await toInProgress(task.id, task.etag);

    const { response, body } = await establish(task.id, '2026-04-01');

    expect(response.status).toBe(200);
    expect(body.state).toBe('active');
  });

  it('creates a suspended generation 1 for a waiting task, with no claimable occurrence', async () => {
    const task = await seedTask();
    await toWaiting(task.id, task.etag);

    const { response, body } = await establish(task.id, '2026-04-01');

    expect(response.status).toBe(200);
    expect(body.state).toBe('suspended_waiting');
    expect(body.generation).toBe(1);
    expect(body.dueLocalDate).toBe('2026-04-01');
    // The advance decision is still recorded — D105 decides it once at establishment — but nothing
    // is claimable while suspended.
    expect(body.advance.disposition).toBe('scheduled');
    expect(body.nextOverdueOccurrence).toBeNull();

    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(schedule?.status).toBe('suspended_waiting');
    expect(schedule?.suspendedAt).not.toBeNull();
    expect(schedule?.nextOverdueOccurrenceAt).toBeNull();
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBe('2026-04-01');
  });

  it('records no skipped advance attempt for a suspended establishment', async () => {
    const task = await seedTask();
    await toWaiting(task.id, task.etag);

    // Due today, so the advance window has elapsed — but a suspended schedule owes no occurrence,
    // so there is no delivery outcome to record.
    await establish(task.id, '2026-03-10');

    expect(await listReminderDeliveryAttemptsForTask(db.prisma, org, task.id)).toHaveLength(0);
  });

  it('keeps a waiting task suspended across a material change and increments once', async () => {
    const task = await seedTask();
    await toWaiting(task.id, task.etag);
    await establish(task.id, '2026-04-01');

    const { response, body } = await establish(task.id, '2026-05-20');

    expect(response.status).toBe(200);
    expect(body.state).toBe('suspended_waiting');
    expect(body.generation).toBe(2);
    expect(body.nextOverdueOccurrence).toBeNull();
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(schedule?.generation).toBe(2);
    expect(schedule?.status).toBe('suspended_waiting');
  });

  it('treats an immaterial repeat while waiting as a no-op', async () => {
    const task = await seedTask();
    await toWaiting(task.id, task.etag);
    const first = await establish(task.id, '2026-04-01');

    const second = await establish(task.id, '2026-04-01', first.body.etag);

    expect(second.response.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(second.body.generation).toBe(1);
    expect(await reminderAudits(task.id)).toHaveLength(1);
  });

  it('refuses establishment on a completed task and writes nothing', async () => {
    const task = await seedTask();
    await toCompleted(task.id, task.etag);

    const { response, body } = await establish(task.id, '2026-04-01');

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('DOMAIN_CONFLICT');
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBeNull();
    expect(await reminderAudits(task.id)).toHaveLength(0);
  });

  it('refuses a material change and a reactivation on a completed task', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const stopped = await remove(task.id);
    await toCompleted(task.id, task.etag);

    const change = await establish(task.id, '2026-05-20', stopped.body.etag);
    expect(change.response.status).toBe(409);

    const reactivate = await establish(task.id, '2026-04-01', stopped.body.etag);
    expect(reactivate.response.status).toBe(409);

    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(schedule?.status).toBe('stopped');
    expect(schedule?.generation).toBe(1);
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBeNull();
  });

  it('refuses establishment on a dismissed task and writes nothing', async () => {
    const task = await seedTask();
    await toDismissed(task.id, task.etag);

    const { response, body } = await establish(task.id, '2026-04-01');

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('DOMAIN_CONFLICT');
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBeNull();
  });

  it('refuses a material change on a dismissed task, whose schedule dismissal already stopped', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    await toDismissed(task.id, task.etag);

    // A8 lifecycle wiring: the token is re-read *after* dismissal, because dismissal stopped the
    // schedule and moved the reminder version. Presenting the pre-dismissal token would fail the
    // precondition first and never reach the eligibility gate, which is a weaker assertion — this
    // proves the gate itself refuses a terminal Task even when the caller is perfectly current.
    const { response } = await establish(task.id, '2026-05-20', await reminderEtag(task.id));

    expect(response.status).toBe(409);
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(schedule?.dueLocalDate).toBe('2026-04-01');
    expect(schedule?.generation).toBe(1);
    expect(schedule?.status).toBe('stopped');
    expect(schedule?.stopReason).toBe('task_dismissed');
  });

  it('allows removal on a completed task, preserving the truthful completion stop reason', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    await toCompleted(task.id, task.etag);

    const { response, body } = await remove(task.id);

    expect(response.status).toBe(200);
    expect(body.state).toBe('stopped');
    // Not `due_date_removed`: completion is what stopped these reminders, and the later removal of
    // the date does not get to overwrite why they ended. Before lifecycle wiring the schedule was
    // still active here and the removal stopped it, so this reason changed with the wiring.
    expect(body.stopReason).toBe('task_completed');
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBeNull();
  });

  it('allows an idempotent removal on a dismissed task', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    await toDismissed(task.id, task.etag);

    const first = await remove(task.id);
    const second = await remove(task.id);

    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it('refuses a stale immaterial repeat on a completed task, because completion moved the version', async () => {
    const task = await seedTask();
    const established = await establish(task.id, '2026-04-01');
    await toCompleted(task.id, task.etag);

    const { response } = await establish(task.id, '2026-04-01', established.body.etag);

    // This closes the A8.3b re-audit's L2 observation without a special case. That audit noted an
    // immaterial repeat on a terminal Task returned 200, which read oddly next to the 409 a material
    // change got. Lifecycle wiring makes it moot: completion stopped the schedule and bumped the
    // reminder version, so a token minted before completion is genuinely stale and 412 is the honest
    // answer. There is no longer a reachable state in which a terminal Task holds a live schedule
    // that an Owner has a current token for.
    expect(response.status).toBe(412);
    // The two events are the establishment and the stop completion derived from it. The refused
    // request added nothing: a loser writes no history.
    expect((await reminderAudits(task.id)).map((event) => event.action)).toEqual([
      'reminder.schedule.established',
      'reminder.schedule.stopped',
    ]);
  });

  it('refuses an immaterial repeat on a completed task even with a current token', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    await toCompleted(task.id, task.etag);

    const { response, body } = await establish(task.id, '2026-04-01', await reminderEtag(task.id));

    // With a current token the eligibility gate is what answers, and it refuses: re-establishing a
    // schedule on a completed Task would contradict the stop D107 just performed.
    expect(response.status).toBe(409);
    expect(body.error.code).toBe('DOMAIN_CONFLICT');
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(schedule?.status).toBe('stopped');
    expect(schedule?.generation).toBe(1);
  });
});

/** F3: the request body accepts exactly `dueLocalDate`. */
describe('A8.3b Owner reminder routes: request strictness', () => {
  const rejected = [
    { totallyUnknown: true },
    { reminderTime: '09:00' },
    { presetInterval: 'weekly' },
    { taskId: 'task_other' },
    { data: { dueLocalDate: '2026-04-01' } },
    { nested: { anything: 1 } },
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
    { schedulingTimeZone: 'UTC' },
    { claimedBy: 'worker-1' },
    { dueAt: NOW },
    { reminderVersion: 9 },
    { etag: 'forged' },
  ];

  it('rejects every property other than dueLocalDate and advanceEnabled', async () => {
    const task = await seedTask();
    const token = await reminderEtag(task.id);

    for (const extra of rejected) {
      const response = await setReminder(
        request(task.id, 'PUT', {
          body: { dueLocalDate: '2026-04-01', ...extra },
          ifMatch: token,
        }),
        params(task.id),
      );
      expect(response.status, JSON.stringify(extra)).toBe(400);
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    }
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('rejects a body with no dueLocalDate at all', async () => {
    const task = await seedTask();
    const token = await reminderEtag(task.id);

    const response = await setReminder(
      request(task.id, 'PUT', { body: {}, ifMatch: token }),
      params(task.id),
    );

    expect(response.status).toBe(400);
  });

  it('accepts standard last-wins behaviour for duplicate JSON keys', async () => {
    const task = await seedTask();
    const token = await reminderEtag(task.id);

    const response = await setReminder(
      request(task.id, 'PUT', {
        rawBody: '{"dueLocalDate":"2026-04-01","dueLocalDate":"2026-05-20"}',
        ifMatch: token,
      }),
      params(task.id),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).dueLocalDate).toBe('2026-05-20');
  });
});

/** F5: the reminder resource supplies the token required to mutate it. */
describe('A8.3b Owner reminder routes: reminder ETag and If-Match', () => {
  it('emits a strong reminder ETag on GET, in the header and the body', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');

    const { response, body } = await read(task.id);

    expect(response.headers.get('etag')).toBe(body.etag);
    expect(body.etag).toMatch(/^"task-reminder-[^"]+-v\d+"$/);
    expect(body.etag).toBe(formatETag('task-reminder', task.id, 1));
  });

  it('emits a stable v0 token before any schedule exists', async () => {
    const task = await seedTask();

    const first = await read(task.id);
    const second = await read(task.id);

    expect(first.body.etag).toBe(formatETag('task-reminder', task.id, 0));
    expect(second.body.etag).toBe(first.body.etag);
  });

  it('emits a new token after each material mutation', async () => {
    const task = await seedTask();

    const established = await establish(task.id, '2026-04-01');
    const changed = await establish(task.id, '2026-05-20', established.body.etag);
    const removed = await remove(task.id, changed.body.etag);
    const reactivated = await establish(task.id, '2026-06-01', removed.body.etag);

    const tokens = [
      formatETag('task-reminder', task.id, 0),
      established.body.etag,
      changed.body.etag,
      removed.body.etag,
      reactivated.body.etag,
    ];
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(reactivated.body.etag).toBe(formatETag('task-reminder', task.id, 4));
  });

  it('returns the mutation response ETag in the header too', async () => {
    const task = await seedTask();

    const { response, body } = await establish(task.id, '2026-04-01');

    expect(response.headers.get('etag')).toBe(body.etag);
  });

  it('requires If-Match on PUT and DELETE', async () => {
    const task = await seedTask();

    const put = await setReminder(
      request(task.id, 'PUT', { body: { dueLocalDate: '2026-04-01' } }),
      params(task.id),
    );
    const del = await removeReminder(request(task.id, 'DELETE'), params(task.id));

    expect(put.status).toBe(428);
    expect((await put.json()).error.code).toBe('PRECONDITION_REQUIRED');
    expect(del.status).toBe(428);
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('rejects a stale token on PUT and writes nothing', async () => {
    const task = await seedTask();
    const stale = await reminderEtag(task.id);
    await establish(task.id, '2026-04-01', stale);

    const { response, body } = await establish(task.id, '2026-05-20', stale);

    expect(response.status).toBe(412);
    expect(body.error.code).toBe('PRECONDITION_FAILED');
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(schedule?.dueLocalDate).toBe('2026-04-01');
    expect(schedule?.generation).toBe(1);
  });

  it('rejects a stale token on DELETE and leaves the schedule live', async () => {
    const task = await seedTask();
    const established = await establish(task.id, '2026-04-01');
    await establish(task.id, '2026-05-20', established.body.etag);

    const { response } = await remove(task.id, established.body.etag);

    expect(response.status).toBe(412);
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(schedule?.status).toBe('active');
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBe('2026-05-20');
  });

  it('rejects replaying a successful mutation with its pre-mutation token', async () => {
    const task = await seedTask();
    const token = await reminderEtag(task.id);
    const first = await establish(task.id, '2026-04-01', token);
    expect(first.response.status).toBe(200);

    const replay = await establish(task.id, '2026-04-01', token);

    expect(replay.response.status).toBe(412);
    expect((await findReminderScheduleByTaskId(db.prisma, org, task.id))?.generation).toBe(1);
  });

  it('refuses a Task ETag, so an unrelated Task edit cannot authorize a reminder write', async () => {
    const task = await seedTask();

    const response = await setReminder(
      request(task.id, 'PUT', { body: { dueLocalDate: '2026-04-01' }, ifMatch: task.etag }),
      params(task.id),
    );

    expect(response.status).toBe(412);
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('rejects weak, wildcard, multiple, malformed, and wrong-resource tokens', async () => {
    const task = await seedTask();
    const valid = await reminderEtag(task.id);

    const bad = [
      `W/${valid}`,
      '*',
      `${valid}, "task-reminder-other-v1"`,
      'not-an-etag',
      '"task-reminder-missing-version"',
      formatETag('task-suggestion', task.id, 0),
      formatETag('task-reminder', 'task_someone_else', 0),
    ];

    for (const ifMatch of bad) {
      const response = await setReminder(
        request(task.id, 'PUT', { body: { dueLocalDate: '2026-04-01' }, ifMatch }),
        params(task.id),
      );
      expect(response.status, ifMatch).toBe(412);
    }
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('keeps the token stable across an idempotent removal', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const removed = await remove(task.id);

    const repeat = await remove(task.id, removed.body.etag);

    expect(repeat.response.status).toBe(200);
    expect(repeat.body.etag).toBe(removed.body.etag);
  });
});

/** F6: every response is `no-store`, including the ones the service throws. */
describe('A8.3b Owner reminder routes: cache-control', () => {
  it('applies no-store to success and to every error class', async () => {
    const task = await seedTask();
    const token = await reminderEtag(task.id);

    const responses: Array<[string, Response]> = [];

    responses.push(['200 GET', await readReminder(request(task.id, 'GET'), params(task.id))]);
    responses.push([
      '200 PUT',
      await setReminder(
        request(task.id, 'PUT', { body: { dueLocalDate: '2026-04-01' }, ifMatch: token }),
        params(task.id),
      ),
    ]);
    responses.push([
      '400 validation',
      await setReminder(
        request(task.id, 'PUT', { body: { dueLocalDate: '2026-02-30' }, ifMatch: 'ignored' }),
        params(task.id),
      ),
    ]);
    responses.push([
      '400 malformed json',
      await setReminder(
        request(task.id, 'PUT', { rawBody: '{bad', ifMatch: 'ignored' }),
        params(task.id),
      ),
    ]);
    responses.push([
      '412 stale',
      await setReminder(
        request(task.id, 'PUT', { body: { dueLocalDate: '2026-05-20' }, ifMatch: token }),
        params(task.id),
      ),
    ]);
    responses.push([
      '428 missing',
      await setReminder(
        request(task.id, 'PUT', { body: { dueLocalDate: '2026-05-20' } }),
        params(task.id),
      ),
    ]);
    responses.push([
      '404 bad task id',
      await readReminder(request('task_missing', 'GET'), params('task_missing')),
    ]);

    unauthenticated();
    responses.push(['401', await readReminder(request(task.id, 'GET'), params(task.id))]);
    authOwner();

    for (const [label, response] of responses) {
      expect(response.headers.get('cache-control'), label).toBe('no-store');
    }
    // The list above is only meaningful if it really covered those statuses.
    expect(responses.map(([label]) => label.split(' ')[0])).toEqual([
      '200',
      '200',
      '400',
      '400',
      '412',
      '428',
      '404',
      '401',
    ]);
  });

  it('applies no-store to a domain conflict thrown by the service', async () => {
    const task = await seedTask();
    await toCompleted(task.id, task.etag);
    const token = await reminderEtag(task.id);

    const response = await setReminder(
      request(task.id, 'PUT', { body: { dueLocalDate: '2026-04-01' }, ifMatch: token }),
      params(task.id),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('A8.3b Owner reminder routes: route: DELETE reminder', () => {
  it('stops the schedule, clears the due date, and leaves no future occurrence', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');

    const { response, body } = await remove(task.id);

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
    await establish(task.id, '2026-03-10');
    const before = await listReminderDeliveryAttemptsForTask(db.prisma, org, task.id);
    expect(before).toHaveLength(1);

    await remove(task.id);

    const after = await listReminderDeliveryAttemptsForTask(db.prisma, org, task.id);
    expect(after).toHaveLength(before.length);
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).not.toBeNull();
  });

  it('is idempotent when repeated with the current token', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');

    const first = await remove(task.id);
    const second = await remove(task.id, first.body.etag);

    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it('is idempotent when the task never had a due date', async () => {
    const task = await seedTask();

    const { response, body } = await remove(task.id);

    expect(response.status).toBe(200);
    expect(body.state).toBe('no_due_date');
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('stops a suspended schedule', async () => {
    const task = await seedTask();
    await toWaiting(task.id, task.etag);
    await establish(task.id, '2026-04-01');

    const { response, body } = await remove(task.id);

    expect(response.status).toBe(200);
    expect(body.state).toBe('stopped');
    expect(body.stopReason).toBe('due_date_removed');
  });

  it('is not cacheable', async () => {
    const task = await seedTask();

    const { response } = await remove(task.id);

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

/** F4: the audit trail must say what changed, not merely that something did. */
describe('A8.3b Owner reminder routes: audit events', () => {
  it('records establishment attributed to the Owner, with the new date and generation', async () => {
    const task = await seedTask();

    await establish(task.id, '2026-04-01');

    const audits = await reminderAudits(task.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('reminder.schedule.established');
    expect(audits[0]?.actorKind).toBe('owner');
    expect(audits[0]?.ownerId).toBe(owner.ownerId);
    expect(audits[0]?.outcome).toBe('succeeded');
    expect(audits[0]?.taskStatus).toBe('open');
    expect(audits[0]?.resourceVersion).toBe(1);
    expect(audits[0]?.note).toBe(
      'dueLocalDate=2026-04-01 generation=1 state=active advanceEnabled=true',
    );
  });

  it('records an explicit D178 OFF preference as advanceEnabled=false', async () => {
    const task = await seedTask();

    await establishWithPreference(task.id, '2026-04-01', false);

    const audits = await reminderAudits(task.id);
    expect(audits[0]?.note).toBe(
      'dueLocalDate=2026-04-01 generation=1 state=active advanceEnabled=false',
    );
  });

  it('records a suspended establishment as suspended', async () => {
    const task = await seedTask();
    await toWaiting(task.id, task.etag);

    await establish(task.id, '2026-04-01');

    const audits = await reminderAudits(task.id);
    expect(audits[0]?.note).toBe(
      'dueLocalDate=2026-04-01 generation=1 state=suspended_waiting advanceEnabled=true',
    );
    expect(audits[0]?.taskStatus).toBe('waiting');
  });

  it('records both the prior and the new due date on a material change', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');

    await establish(task.id, '2026-05-20');

    const audits = await reminderAudits(task.id);
    expect(audits.map((event) => event.action)).toEqual([
      'reminder.schedule.established',
      'reminder.schedule.changed',
    ]);
    expect(audits[1]?.note).toBe(
      'priorDueLocalDate=2026-04-01 dueLocalDate=2026-05-20 priorGeneration=1 generation=2 state=active advanceEnabled=true',
    );
    expect(audits[1]?.resourceVersion).toBe(2);
  });

  it('records a reactivation under its own action, with the reason it had stopped', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    await remove(task.id);

    await establish(task.id, '2026-04-01');

    const audits = await reminderAudits(task.id);
    expect(audits.map((event) => event.action)).toEqual([
      'reminder.schedule.established',
      'reminder.due_date.removed',
      'reminder.schedule.reactivated',
    ]);
    expect(audits[2]?.note).toBe(
      'priorDueLocalDate=2026-04-01 dueLocalDate=2026-04-01 priorGeneration=1 generation=2 priorStopReason=due_date_removed state=active advanceEnabled=true',
    );
  });

  it('records a removal with the date removed and the resulting stop reason', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');

    await remove(task.id);

    const audits = await reminderAudits(task.id);
    expect(audits.map((event) => event.action)).toEqual([
      'reminder.schedule.established',
      'reminder.due_date.removed',
    ]);
    expect(audits[1]?.note).toBe(
      'dueLocalDate=2026-04-01 generation=1 priorState=active stopReason=due_date_removed state=stopped',
    );
    expect(audits[1]?.resourceVersion).toBe(2);
  });

  it('emits no event for an immaterial repeat', async () => {
    const task = await seedTask();
    const first = await establish(task.id, '2026-04-01');

    await establish(task.id, '2026-04-01', first.body.etag);
    await establish(task.id, '2026-04-01', first.body.etag);

    expect(await reminderAudits(task.id)).toHaveLength(1);
  });

  it('emits no event for a repeated removal', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const removed = await remove(task.id);

    await remove(task.id, removed.body.etag);

    const audits = await reminderAudits(task.id);
    expect(audits.filter((event) => event.action === 'reminder.due_date.removed')).toHaveLength(1);
  });

  it('emits no event when the request is rejected', async () => {
    const task = await seedTask();
    const token = await reminderEtag(task.id);

    await establish(task.id, '2026-02-30', token);
    await establish(task.id, '2026-04-01', formatETag('task-reminder', task.id, 42));
    authOwner(otherOwner);
    await establish(task.id, '2026-04-01', token);
    authOwner();

    expect(await reminderAudits(task.id)).toHaveLength(0);
  });

  it('records no worker internals or content in the note', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    await remove(task.id);
    await establish(task.id, '2026-06-01');
    // Include the lifecycle-derived events, whose notes are built in `packages/db` rather than by the
    // reminder service and so would otherwise escape this check entirely.
    const waiting = await toWaiting(task.id, task.etag);
    const resumed = await toResumed(task.id, waiting);
    await toCompleted(task.id, resumed);

    const audits = await reminderAudits(task.id);
    expect(audits.length).toBeGreaterThan(4);
    for (const event of audits) {
      // Every note is `key=value` pairs of scheduling facts. Values allow the punctuation an ISO
      // instant and a local date need, and nothing that could carry a sentence.
      expect(event.note ?? '').toMatch(
        /^[A-Za-z_]+=[A-Za-z0-9_:.-]+(?: [A-Za-z_]+=[A-Za-z0-9_:.-]+)*$/,
      );
      expect(event.note ?? '').not.toContain('Do work');
      expect(event.note ?? '').not.toContain('claim');
    }
  });

  it('records the route-scoped request id on reminder events', async () => {
    const task = await seedTask();

    await establish(task.id, '2026-04-01');
    await establish(task.id, '2026-05-20');

    // The request id is minted per request by the route context, not accepted from a caller, so the
    // assertion is that each event carries its own and none is missing.
    const audits = await reminderAudits(task.id);
    expect(audits).toHaveLength(2);
    for (const event of audits) {
      expect(event.requestId).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(audits[0]?.requestId).not.toBe(audits[1]?.requestId);
  });
});

describe('A8 Owner reminder routes: task lifecycle wiring', () => {
  it('stops reminders when a task completes', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const current = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(current?.status).toBe('active');

    await toCompleted(task.id, task.etag);

    // The inversion of the A8.3b deferred-boundary test, which asserted this schedule stayed active
    // because nothing reacted to the Task moving. D107 requires completion to stop reminders, and it
    // now does, in the same transaction that commits the status.
    const after = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(after?.status).toBe('stopped');
    expect(after?.stopReason).toBe('task_completed');
    expect(after?.nextOverdueOccurrenceAt).toBeNull();
    expect(after?.generation).toBe(1);
  });

  it('stops reminders when a task is dismissed, with a reason distinct from completion', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');

    await toDismissed(task.id, task.etag);

    const after = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(after?.status).toBe('stopped');
    expect(after?.stopReason).toBe('task_dismissed');
    expect(after?.nextOverdueOccurrenceAt).toBeNull();
  });

  it('suspends an existing active schedule when a task enters Waiting', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const before = await findReminderScheduleByTaskId(db.prisma, org, task.id);

    await toWaiting(task.id, task.etag);

    const after = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(after?.status).toBe('suspended_waiting');
    // No claimable occurrence survives the suspension, and the generation is untouched: entering
    // Waiting is a pause, not a new scheduling decision (D107).
    expect(after?.nextOverdueOccurrenceAt).toBeNull();
    expect(after?.generation).toBe(before?.generation);
  });

  it('preserves the task due date and generation across a waiting round trip', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const waiting = await toWaiting(task.id, task.etag);

    await toResumed(task.id, waiting);

    const after = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(after?.status).toBe('active');
    expect(after?.generation).toBe(1);
    expect(after?.dueLocalDate).toBe('2026-04-01');
    // The Owner never asked for a new schedule, so the Task's canonical due date must survive both
    // halves of the round trip untouched.
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBe('2026-04-01');
  });

  it('resumes to a strictly future occurrence without replaying the waiting period', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const waiting = await toWaiting(task.id, task.etag);

    // Resume long after every overdue morning between the due date and now has elapsed. A backlog
    // implementation would arm one of them, or arm many; D107 requires exactly one, in the future.
    const resumeAt = '2026-09-15T18:00:00.000Z';
    await toResumed(task.id, waiting, resumeAt);

    const after = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(after?.status).toBe('active');
    expect(new Date(after!.nextOverdueOccurrenceAt!).getTime()).toBeGreaterThan(
      new Date(resumeAt).getTime(),
    );
    // Nothing is due at the resume instant merely because time passed while the Task waited.
    expect(after?.nextOverdueOccurrenceLocalDate).not.toBe('2026-04-02');
    expect(after?.overdueDeliveredCount).toBe(0);
  });

  it('does not revive a terminally stopped schedule when the task leaves Waiting', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const waiting = await toWaiting(task.id, task.etag);
    // Remove the due date while the Task waits, which stops the schedule for its own reason.
    await remove(task.id);

    await toResumed(task.id, waiting);

    // Resume reactivates only a Waiting suspension. Reactivating a stopped schedule is an explicit
    // Owner act (D109), and leaving Waiting is not that act.
    const after = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(after?.status).toBe('stopped');
    expect(after?.stopReason).toBe('due_date_removed');
    expect(after?.nextOverdueOccurrenceAt).toBeNull();
  });

  it('does not convert a terminally stopped schedule into a waiting suspension', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    await remove(task.id);

    await toWaiting(task.id, task.etag);

    const after = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    expect(after?.status).toBe('stopped');
    expect(after?.stopReason).toBe('due_date_removed');
  });

  it('leaves a task with no schedule alone through every lifecycle transition', async () => {
    const task = await seedTask();

    const waiting = await toWaiting(task.id, task.etag);
    const resumed = await toResumed(task.id, waiting);
    await toCompleted(task.id, resumed);

    // The reconciler must be a no-op rather than an error for the overwhelmingly common case of a
    // Task that never had a reminder, and must not invent a schedule row to stop.
    expect(await findReminderScheduleByTaskId(db.prisma, org, task.id)).toBeNull();
  });

  it('suspends on the next material change once the task is Waiting', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    await toWaiting(task.id, task.etag);

    const { body } = await establish(task.id, '2026-05-20');

    expect(body.state).toBe('suspended_waiting');
    expect(body.nextOverdueOccurrence).toBeNull();
  });

  it('still refuses to resurrect a schedule that persistence suspended', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const schedule = await findReminderScheduleByTaskId(db.prisma, org, task.id);
    // Seeded through persistence: no A8.3b route suspends an existing schedule.
    await suspendReminderScheduleForWaiting(db.prisma, {
      organizationId: org,
      scheduleId: schedule!.id,
      suspendedAt: NOW,
    });

    // The Task is still `open`, so eligibility says active — the Owner explicitly re-scheduling an
    // actionable Task resumes it, which is the same act D109 uses to reactivate a stopped schedule.
    const { response, body } = await establish(task.id, '2026-05-20');

    expect(response.status).toBe(200);
    expect(body.state).toBe('active');
    expect(body.generation).toBe(2);
  });
});

describe('D178 optional D105 advance preference', () => {
  it('defaults a new establishment without an explicit preference to ON', async () => {
    const task = await seedTask();
    const { body } = await establish(task.id, '2026-04-01');

    expect(body.advanceEnabled).toBe(true);
    expect(body.advance.disposition).toBe('scheduled');
    expect(body.dueLocalDate).toBe('2026-04-01');
    expect(body.nextOverdueOccurrence.localDate).toBe('2026-04-02');
  });

  it('retains the deadline when the Owner sets OFF and does not arm D105', async () => {
    const task = await seedTask();
    const { body } = await establishWithPreference(task.id, '2026-04-01', false);

    expect(body.advanceEnabled).toBe(false);
    expect(body.dueLocalDate).toBe('2026-04-01');
    expect(body.state).toBe('active');
    expect(body.advance.disposition).toBe('not_enabled');
    expect(body.nextOverdueOccurrence.localDate).toBe('2026-04-02');
    expect(await getTaskDueLocalDate(db.prisma, org, task.id)).toBe('2026-04-01');

    const due = await listDueAdvanceReminderSchedulesGlobally(db.prisma, {
      dueAtOrBefore: '2026-04-02T00:00:00.000Z',
      limit: 10,
    });
    expect(due.filter((row) => row.taskId === task.id)).toEqual([]);
  });

  it('still schedules D106 overdue when advance is OFF', async () => {
    const task = await seedTask();
    const { body } = await establishWithPreference(task.id, '2026-04-01', false);

    expect(body.nextOverdueOccurrence).toEqual({
      localDate: '2026-04-02',
      at: expect.any(String),
    });
    expect(body.state).toBe('active');
    expect(body.stopReason).toBeNull();
  });

  it('preserves OFF across a due-date change and does not re-arm D105', async () => {
    const task = await seedTask();
    await establishWithPreference(task.id, '2026-04-01', false);

    const { body } = await establish(task.id, '2026-05-20');

    expect(body.generation).toBe(2);
    expect(body.advanceEnabled).toBe(false);
    expect(body.advance.disposition).toBe('not_enabled');
    expect(body.dueLocalDate).toBe('2026-05-20');
    expect(body.nextOverdueOccurrence.localDate).toBe('2026-05-21');
  });

  it('preserves ON across a due-date change and recalculates D105', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');

    const { body } = await establish(task.id, '2026-05-20');

    expect(body.generation).toBe(2);
    expect(body.advanceEnabled).toBe(true);
    expect(body.advance).toEqual({
      disposition: 'scheduled',
      occurrence: { localDate: '2026-05-19', at: expect.any(String) },
    });
  });

  it('defaults re-establishment after deadline removal to ON', async () => {
    const task = await seedTask();
    await establishWithPreference(task.id, '2026-04-01', false);
    await remove(task.id);

    const { body } = await establish(task.id, '2026-05-20');

    expect(body.generation).toBe(2);
    expect(body.advanceEnabled).toBe(true);
    expect(body.advance.disposition).toBe('scheduled');
    expect(body.dueLocalDate).toBe('2026-05-20');
  });

  it('lets an explicit OFF win on the same re-establishment act', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    await remove(task.id);

    const { body } = await establishWithPreference(task.id, '2026-05-20', false);

    expect(body.advanceEnabled).toBe(false);
    expect(body.advance.disposition).toBe('not_enabled');
  });

  it('does not turn OFF back ON when Waiting suspends and resumes', async () => {
    const task = await seedTask();
    await establishWithPreference(task.id, '2026-04-01', false);
    const waiting = await toWaiting(task.id, task.etag);

    const suspended = await read(task.id);
    expect(suspended.body.state).toBe('suspended_waiting');
    expect(suspended.body.advanceEnabled).toBe(false);

    await toResumed(task.id, waiting);
    const { body } = await read(task.id);

    expect(body.state).toBe('active');
    expect(body.advanceEnabled).toBe(false);
    expect(body.advance.disposition).toBe('not_enabled');
    expect(body.nextOverdueOccurrence.localDate).toBe('2026-04-02');
  });

  it('keeps completed lifecycle truthful, including the preference', async () => {
    const task = await seedTask();
    await establishWithPreference(task.id, '2026-04-01', false);
    await toCompleted(task.id, task.etag);

    const { body } = await read(task.id);
    expect(body.state).toBe('stopped');
    expect(body.stopReason).toBe('task_completed');
    expect(body.advanceEnabled).toBe(false);
    expect(body.dueLocalDate).toBe('2026-04-01');
  });

  it('exposes the preference on GET and mutates it under the reminder ETag', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const before = await read(task.id);
    expect(before.body.advanceEnabled).toBe(true);

    const { response, body } = await establishWithPreference(task.id, '2026-04-01', false);
    expect(response.status).toBe(200);
    expect(body.advanceEnabled).toBe(false);
    expect(body.generation).toBe(1);
    expect(body.etag).not.toBe(before.body.etag);
    expect(body.overdueDeliveredCount).toBe(0);
  });

  it('still produces 412 for a stale reminder ETag when changing the preference', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const stale = await reminderEtag(task.id);
    await establishWithPreference(task.id, '2026-04-01', false);

    const { response, body } = await establishWithPreference(task.id, '2026-04-01', true, stale);
    expect(response.status).toBe(412);
    expect(body.error.code).toBe('PRECONDITION_FAILED');
  });

  it('keeps an old-style PUT of only dueLocalDate backwards compatible', async () => {
    const task = await seedTask();
    await establish(task.id, '2026-04-01');
    const etag = await reminderEtag(task.id);

    const { response, body } = await establish(task.id, '2026-04-01', etag);
    expect(response.status).toBe(200);
    expect(body.advanceEnabled).toBe(true);
    expect(body.generation).toBe(1);
    expect(body.etag).toBe(etag);
  });

  it('does not infer the preference from TaskAssignment or D168 evidence', async () => {
    const task = await seedTask();
    const { body } = await establishWithPreference(task.id, '2026-04-01', false);

    expect(body.advanceEnabled).toBe(false);
    const assignments = await db.prisma.taskAssignment.findMany({ where: { taskId: task.id } });
    expect(assignments).toEqual([]);
    const evidence = await db.prisma.taskSuggestionResponsibilitySelection.findMany({
      where: { taskId: task.id },
    });
    expect(evidence).toEqual([]);
  });
});
