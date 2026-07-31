// @vitest-environment node
/**
 * A8.3b audit remediation F2: concurrent Owner reminder writes, against a real PostgreSQL server.
 *
 * This file exists because PGlite could not have caught the bug. PGlite runs one connection and
 * serializes every statement, so two "concurrent" requests are really sequential and always agree.
 * On a real server the A8.3b audit demonstrated two distinct failures:
 *
 * 1. **Lost update.** A `PUT` and a `DELETE` issued from the same observed state both returned 200.
 *    The committed audit trail contained `reminder.due_date.removed` while the surviving row was
 *    active with a new due date, so the history described something that had not happened.
 * 2. **Deadlock.** Establishment and generation-change wrote `task_reminder_schedules` before
 *    `tasks`; removal wrote `tasks` first. PostgreSQL detected the cycle, aborted the victim, and the
 *    error escaped unmapped as a 500 — telling the Owner the server was broken when the truth was
 *    "someone else got there first".
 *
 * The tests below stage each interleaving repeatedly and assert the three properties that make a race
 * safe: at most one incompatible intent wins, the loser is told so with a typed conflict rather than a
 * 500, and the audit trail describes only what survived.
 *
 * ## Running it
 *
 * Skipped unless `AICAA_PG_CONCURRENCY_URL` names a **loopback** PostgreSQL with the migrations
 * applied. It is not part of `pnpm verify`, which must not require Docker.
 *
 *   docker run -d --name aicaa-a83b-pg16 -p 127.0.0.1:5434:5432 \
 *     -e POSTGRES_USER=prisma -e POSTGRES_PASSWORD=prisma -e POSTGRES_DB=prisma postgres:16
 *   AICAA_LOCAL_DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:5434/prisma?schema=public \
 *     node packages/db/scripts/run-local-prisma.mjs migrate deploy
 *   AICAA_PG_CONCURRENCY_URL=postgresql://prisma:prisma@127.0.0.1:5434/prisma?schema=public \
 *     pnpm --filter @aicaa/web exec vitest run owner-reminder-concurrency
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOrganizationId, asOwnerId, ownerActor } from '@aicaa/domain';
import { createPrismaClient, type DbClient } from '@aicaa/db';
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

const RAW_URL = process.env.AICAA_PG_CONCURRENCY_URL;

/**
 * Refuse anything but loopback. `packages/db/.env` holds a production URL, and a concurrency test
 * that hammers two transactions at a database is the last thing that should ever reach it.
 */
function assertLoopback(raw: string): string {
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())) {
    throw new Error(`AICAA_PG_CONCURRENCY_URL must be loopback, got ${url.hostname}.`);
  }
  return raw;
}

const describeMaybe = RAW_URL ? describe : describe.skip;

const org = 'org_reminder_race';
const owner = ownerActor(asOwnerId('owner_race'), asOrganizationId(org));

/** How many times each interleaving runs. A race that only fails sometimes still fails. */
const ROUNDS = 12;

function params(taskId: string) {
  return { params: Promise.resolve({ taskId }) };
}

function reminderRequest(
  taskId: string,
  method: 'GET' | 'PUT' | 'DELETE',
  options: { body?: unknown; ifMatch?: string } = {},
): Request {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (options.ifMatch) {
    headers['if-match'] = options.ifMatch;
  }
  return new Request(`http://localhost/api/v1/tasks/${taskId}/reminder`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

describeMaybe('A8.3b Owner reminder concurrency (real PostgreSQL)', () => {
  let prisma: DbClient;

  beforeAll(async () => {
    prisma = createPrismaClient(assertLoopback(RAW_URL!));
    await prisma.$connect();
    installDbTestRuntime(prisma);
    vi.mocked(getAuthenticatedOwner).mockResolvedValue({
      user: { id: owner.ownerId } as never,
      actor: owner,
      session: {
        ownerId: owner.ownerId,
        organizationId: owner.organizationId,
        role: 'owner',
        displayName: 'Owner',
      },
    });
  });

  afterAll(async () => {
    clearDbTestRuntime();
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    // Real clocks, real connections: nothing here is faked, because the point is to reproduce what
    // the server actually does under contention.
    await prisma.reminderDeliveryAttempt.deleteMany({ where: { organizationId: org } });
    await prisma.taskReminderSchedule.deleteMany({ where: { organizationId: org } });
    await prisma.auditEvent.deleteMany({ where: { organizationId: org } });
    await prisma.taskCapability.deleteMany({ where: { organizationId: org } });
    await prisma.taskNote.deleteMany({ where: { organizationId: org } });
    await prisma.taskAssignment.deleteMany({ where: { organizationId: org } });
    await prisma.taskSuggestion.deleteMany({ where: { organizationId: org } });
    await prisma.task.deleteMany({ where: { organizationId: org } });
    await prisma.recipient.deleteMany({ where: { organizationId: org } });
  });

  async function seedTask(): Promise<string> {
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
    return (await created.json()).id;
  }

  async function readState(taskId: string) {
    const response = await readReminder(reminderRequest(taskId, 'GET'), params(taskId));
    expect(response.status).toBe(200);
    return response.json();
  }

  const put = (taskId: string, dueLocalDate: string, ifMatch: string) =>
    setReminder(
      reminderRequest(taskId, 'PUT', { body: { dueLocalDate }, ifMatch }),
      params(taskId),
    );

  const del = (taskId: string, ifMatch: string) =>
    removeReminder(reminderRequest(taskId, 'DELETE', { ifMatch }), params(taskId));

  interface Outcome {
    readonly status: number;
    readonly body: Record<string, unknown>;
  }

  async function settle(response: Response): Promise<Outcome> {
    return { status: response.status, body: await response.json() };
  }

  /**
   * The invariants every interleaving must satisfy, whatever order the two requests land in.
   *
   * The central rule is stated in terms of what each winner *changed*, not in terms of arrival order,
   * because arrival order is not observable from here. A request that mutated returns a new token; a
   * request that was a no-op returns the token it was given. So:
   *
   * - a winner that mutated must describe the state that actually survived;
   * - a winner that mutated nothing may only report the state it observed.
   *
   * That admits the honest case where a `DELETE` against an already-stopped schedule succeeds without
   * writing while a concurrent reactivation does the real work, and still forbids the failure the
   * audit found — two requests both claiming to have changed the same row in incompatible ways.
   */
  async function assertRaceIsSafe(
    taskId: string,
    outcomes: readonly Outcome[],
    priorToken: string,
  ) {
    const statuses = outcomes.map((outcome) => outcome.status);

    // No unhandled deadlock or serialization failure ever surfaces as a server fault.
    expect(statuses, `statuses ${statuses.join(',')}`).not.toContain(500);

    const winners = outcomes.filter((outcome) => outcome.status === 200);
    const losers = outcomes.filter((outcome) => outcome.status !== 200);
    expect(winners.length).toBeGreaterThanOrEqual(1);

    // A loser is told it lost, in the vocabulary the contract documents.
    for (const loser of losers) {
      expect([409, 412], `loser status ${loser.status}`).toContain(loser.status);
    }

    const final = await readState(taskId);
    const mutators = winners.filter((winner) => winner.body.etag !== priorToken);

    // At most one request may have mutated the row.
    expect(mutators.length, `mutators ${mutators.length}`).toBeLessThanOrEqual(1);

    for (const winner of mutators) {
      expect(winner.body.etag).toBe(final.etag);
      expect(winner.body.state).toBe(final.state);
      expect(winner.body.dueLocalDate).toBe(final.dueLocalDate);
      expect(winner.body.generation).toBe(final.generation);
    }

    // The audit trail describes only what survived: no phantom removal behind an active schedule,
    // and no phantom schedule behind a removal.
    const events = await prisma.auditEvent.findMany({
      where: { organizationId: org, taskId },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });
    const reminderEvents = events.filter((event) => event.action.startsWith('reminder.'));
    const last = reminderEvents[reminderEvents.length - 1];
    if (final.state === 'stopped' || final.state === 'no_due_date') {
      expect(last?.action).toBe('reminder.due_date.removed');
    } else {
      expect(last?.action).not.toBe('reminder.due_date.removed');
    }

    return { final, reminderEvents, mutators };
  }

  it('survives PUT versus PUT from the same observed state', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const taskId = await seedTask();
      await put(taskId, '2026-04-01', (await readState(taskId)).etag);
      const token = (await readState(taskId)).etag;

      const outcomes = await Promise.all([
        put(taskId, '2026-05-20', token).then(settle),
        put(taskId, '2026-06-30', token).then(settle),
      ]);

      const { final } = await assertRaceIsSafe(taskId, outcomes, token);
      // Exactly one generation opened: the loser did not also advance it.
      expect(final.generation).toBe(2);
      expect(['2026-05-20', '2026-06-30']).toContain(final.dueLocalDate);
      await prisma.task.deleteMany({ where: { organizationId: org } }).catch(() => undefined);
    }
  });

  it('survives establishment versus establishment', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const taskId = await seedTask();
      const token = (await readState(taskId)).etag;

      const outcomes = await Promise.all([
        put(taskId, '2026-05-20', token).then(settle),
        put(taskId, '2026-06-30', token).then(settle),
      ]);

      // The unique index on `task_id` is what makes this safe: only one row can exist (D104).
      const { final } = await assertRaceIsSafe(taskId, outcomes, token);
      expect(final.generation).toBe(1);
      const schedules = await prisma.taskReminderSchedule.findMany({
        where: { organizationId: org, taskId },
      });
      expect(schedules).toHaveLength(1);
    }
  });

  it('survives PUT then DELETE from the same observed state', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const taskId = await seedTask();
      await put(taskId, '2026-04-01', (await readState(taskId)).etag);
      const token = (await readState(taskId)).etag;

      const outcomes = await Promise.all([
        put(taskId, '2026-05-20', token).then(settle),
        del(taskId, token).then(settle),
      ]);

      await assertRaceIsSafe(taskId, outcomes, token);
    }
  });

  it('survives DELETE then PUT from the same observed state', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const taskId = await seedTask();
      await put(taskId, '2026-04-01', (await readState(taskId)).etag);
      const token = (await readState(taskId)).etag;

      const outcomes = await Promise.all([
        del(taskId, token).then(settle),
        put(taskId, '2026-05-20', token).then(settle),
      ]);

      await assertRaceIsSafe(taskId, outcomes, token);
    }
  });

  it('survives DELETE versus DELETE', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const taskId = await seedTask();
      await put(taskId, '2026-04-01', (await readState(taskId)).etag);
      const token = (await readState(taskId)).etag;

      const outcomes = await Promise.all([
        del(taskId, token).then(settle),
        del(taskId, token).then(settle),
      ]);

      // Both ask for the same end state, so two successes would be honest — but only one removal may
      // be recorded, because only one actually stopped anything.
      const { final, reminderEvents, mutators } = await assertRaceIsSafe(taskId, outcomes, token);
      expect(final.state).toBe('stopped');
      expect(mutators).toHaveLength(1);
      expect(
        reminderEvents.filter((event) => event.action === 'reminder.due_date.removed'),
      ).toHaveLength(1);
    }
  });

  it('survives reactivation versus DELETE', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const taskId = await seedTask();
      await put(taskId, '2026-04-01', (await readState(taskId)).etag);
      await del(taskId, (await readState(taskId)).etag);
      const token = (await readState(taskId)).etag;

      const outcomes = await Promise.all([
        put(taskId, '2026-04-01', token).then(settle),
        del(taskId, token).then(settle),
      ]);

      // The DELETE is a no-op against an already-stopped schedule with no due date: it writes
      // nothing, so it may legitimately succeed alongside the reactivation. What must not happen is
      // a reactivation that a removal then silently cancels, or a `reminder.due_date.removed` event
      // recorded behind a surviving active schedule.
      const { final } = await assertRaceIsSafe(taskId, outcomes, token);
      expect(['active', 'stopped']).toContain(final.state);
    }
  });

  it('never returns 500 across a burst of mixed writes', async () => {
    const taskId = await seedTask();
    await put(taskId, '2026-04-01', (await readState(taskId)).etag);
    const token = (await readState(taskId)).etag;

    const outcomes = await Promise.all([
      put(taskId, '2026-05-20', token).then(settle),
      put(taskId, '2026-06-30', token).then(settle),
      del(taskId, token).then(settle),
      put(taskId, '2026-07-15', token).then(settle),
      del(taskId, token).then(settle),
      put(taskId, '2026-08-01', token).then(settle),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).not.toContain(500);
    expect(outcomes.filter((outcome) => outcome.status === 200)).toHaveLength(1);
    for (const loser of outcomes.filter((outcome) => outcome.status !== 200)) {
      expect([409, 412]).toContain(loser.status);
    }
  });
});
