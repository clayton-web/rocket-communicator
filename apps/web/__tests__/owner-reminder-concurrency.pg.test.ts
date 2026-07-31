// @vitest-environment node
/**
 * Concurrent reminder writes against a real PostgreSQL server (A8.3b audit F2, re-audit H1/M1/M2).
 *
 * This file exists because PGlite could not have caught the bugs. PGlite runs one connection and
 * serializes every statement, so two "concurrent" requests are really sequential and always agree.
 * On a real server three distinct failures were demonstrated:
 *
 * 1. **Lost update.** A `PUT` and a `DELETE` issued from the same observed state both returned 200.
 *    The committed audit trail contained `reminder.due_date.removed` while the surviving row was
 *    active with a new due date, so the history described something that had not happened.
 * 2. **Deadlock.** Establishment and generation-change wrote `task_reminder_schedules` before
 *    `tasks`; removal wrote `tasks` first. PostgreSQL detected the cycle, aborted the victim, and the
 *    error escaped unmapped as a 500 — telling the Owner the server was broken when the truth was
 *    "someone else got there first".
 * 3. **Unconditional removal (re-audit H1).** When the caller's pre-lock read saw no *live* schedule,
 *    the removal transaction cleared `tasks.due_local_date` and wrote `reminder.due_date.removed`
 *    with no precondition at all. Racing a reactivation, both committed, and the surviving state was
 *    an active schedule holding a claimable occurrence behind a `NULL` due date and a removal event.
 *
 * The tests stage each interleaving repeatedly and assert the properties that make a race safe: at
 * most one incompatible intent wins, the loser is told so with a typed conflict rather than a 500, and
 * the **whole** audit trail — not merely its last entry — is consistent with the state that survived.
 *
 * ## Running it
 *
 * Skipped unless `AICAA_PG_CONCURRENCY_URL` names a **loopback** PostgreSQL with the migrations
 * applied. It is not part of `pnpm verify`, which must not require Docker.
 *
 * Use the committed Compose environment, which serves PostgreSQL 16 on `127.0.0.1:5433` and creates
 * the `prisma_test` database for exactly this purpose. Do not hand-run a container on another port:
 *
 *   pnpm db:docker:up
 *   AICAA_LOCAL_DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     node packages/db/scripts/run-local-prisma.mjs migrate deploy
 *   AICAA_PG_CONCURRENCY_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     pnpm --filter @aicaa/web exec vitest run owner-reminder-concurrency
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOrganizationId, asOwnerId, formatETag, ownerActor } from '@aicaa/domain';
import {
  createPrismaClient,
  findReminderScheduleByTaskId,
  getTaskDueLocalDate,
  persistDueDateRemoval,
  persistEstablishedReminderSchedule,
  stopReminderSchedule,
  type DbClient,
} from '@aicaa/db';
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
import { POST as resumeTask } from '@/app/api/v1/tasks/[taskId]/resume/route';
import { POST as waitTask } from '@/app/api/v1/tasks/[taskId]/waiting/route';

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
    options: { outOfBandVersionBumps?: number } = {},
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

    const reminderEvents = await readReminderEvents(taskId);
    await assertAuditTrailIsConsistent(taskId, reminderEvents, options);

    return { final, reminderEvents, mutators };
  }

  async function readReminderEvents(taskId: string) {
    const events = await prisma.auditEvent.findMany({
      where: { organizationId: org, taskId },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });
    return events.filter((event) => event.action.startsWith('reminder.'));
  }

  /**
   * Assert the full event sequence against the surviving state (A8.3b re-audit M2).
   *
   * The original helper checked only the *last* reminder event, which is far too weak: a losing
   * transaction that leaked an event, or a committed mutation that recorded none, both leave the last
   * event looking perfectly correct. These assertions are over the whole history.
   *
   * The load-bearing one is the version count. Every reminder mutation increments `reminder_version`
   * by exactly one and writes exactly one event, in the same transaction — so the surviving row's
   * version must equal the number of reminder events. An extra event means a loser wrote history it had
   * no right to; a missing one means a mutation committed unrecorded. One equality catches both, and it
   * cannot be satisfied by accident.
   *
   * `outOfBandVersionBumps` accounts for transitions a test staged through persistence directly, which
   * bump the version without writing an event because they bypass the audit layer. Only the H1 setup
   * needs it, and it must be stated explicitly rather than inferred, so the accounting stays exact.
   */
  async function assertAuditTrailIsConsistent(
    taskId: string,
    reminderEvents: ReadonlyArray<{
      action: string;
      note: string | null;
      recordedAt: Date;
      resourceVersion: number | null;
    }>,
    options: { outOfBandVersionBumps?: number } = {},
  ) {
    const schedule = await prisma.taskReminderSchedule.findFirst({
      where: { organizationId: org, taskId },
    });

    if (schedule) {
      const accounted = reminderEvents.length + (options.outOfBandVersionBumps ?? 0);
      expect(
        accounted,
        `reminder_version ${schedule.reminderVersion} vs ${accounted} accounted transitions: ` +
          reminderEvents.map((event) => event.action).join(','),
      ).toBe(schedule.reminderVersion);
    }

    // No removal event may be the final word on a schedule that survived live. If one appears, a later
    // event permitted by the scenario must truthfully reverse it.
    const lastRemoval = reminderEvents
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.action === 'reminder.due_date.removed')
      .pop();
    if (lastRemoval && schedule && schedule.status !== 'stopped') {
      const laterReversal = reminderEvents
        .slice(lastRemoval.index + 1)
        .some((event) => event.action !== 'reminder.due_date.removed');
      expect(
        laterReversal,
        `removal event survives behind a ${schedule.status} schedule with no later reversal`,
      ).toBe(true);
    }

    // Commit order is observable through `recorded_at`, which is the transaction's own instant.
    const instants = reminderEvents.map((event) => event.recordedAt.getTime());
    expect([...instants].sort((a, b) => a - b)).toEqual(instants);

    await assertScheduleInvariants(taskId);
  }

  /**
   * The invariants that must hold whatever raced, checked in the database rather than through the API.
   *
   * The first is the H1 invariant: a live schedule and a `NULL` Task due date is the impossible pairing
   * the re-audit produced. The others are what "nothing claimable" means for a paused or finished Task
   * — a future worker scans on `next_overdue_occurrence_at`, so a stopped or suspended schedule
   * holding one is a delivery waiting to happen against a Task that should never receive it.
   */
  async function assertScheduleInvariants(taskId: string) {
    const [task, schedule] = await Promise.all([
      prisma.task.findFirst({ where: { organizationId: org, id: taskId } }),
      prisma.taskReminderSchedule.findFirst({ where: { organizationId: org, taskId } }),
    ]);
    if (!schedule) {
      return;
    }

    if (schedule.status !== 'stopped') {
      expect(
        task?.dueLocalDate ?? null,
        `${schedule.status} schedule behind a null task due date`,
      ).not.toBeNull();
    }
    if (schedule.status !== 'active') {
      expect(
        schedule.nextOverdueOccurrenceAt,
        `${schedule.status} schedule holds a claimable occurrence`,
      ).toBeNull();
    }
    if (task && (task.status === 'completed' || task.status === 'dismissed')) {
      expect(schedule.status, 'terminal task with a live schedule').toBe('stopped');
    }
    if (task?.status === 'waiting') {
      expect(['suspended_waiting', 'stopped']).toContain(schedule.status);
      expect(
        schedule.nextOverdueOccurrenceAt,
        'waiting task holds a claimable occurrence',
      ).toBeNull();
    }
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

  /**
   * The exact H1 sequence the re-audit reproduced (A8.3b re-audit H1).
   *
   * Staged through persistence rather than the API, because the API cannot produce it in one step: the
   * schedule is stopped while `tasks.due_local_date` stays set, which is what a lifecycle stop or a
   * future worker ceiling-stop leaves behind. A `DELETE` then observes "no live schedule" before the
   * lock — the pre-lock read that the old contract trusted — while a concurrent `PUT` reactivates.
   *
   * Before the fix both committed and the survivor was an active schedule with a `NULL` due date and a
   * removal event standing behind it. Now the removal re-reads under the Task lock, finds the version
   * moved, and refuses.
   */
  async function stageStoppedScheduleWithLiveDueDate(taskId: string) {
    await put(taskId, '2026-04-01', (await readState(taskId)).etag);
    const schedule = await findReminderScheduleByTaskId(prisma, org, taskId);
    await stopReminderSchedule(prisma, {
      organizationId: org,
      scheduleId: schedule!.id,
      reason: 'overdue_ceiling_reached',
      stoppedAt: new Date().toISOString(),
    });
    // The staging itself must produce the H1 precondition: stopped schedule, due date intact.
    expect(await getTaskDueLocalDate(prisma, org, taskId)).toBe('2026-04-01');
  }

  it('refuses a removal staged on a stale non-live observation (H1 regression)', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const taskId = await seedTask();
      await stageStoppedScheduleWithLiveDueDate(taskId);
      const token = (await readState(taskId)).etag;

      const outcomes = await Promise.all([
        del(taskId, token).then(settle),
        put(taskId, '2026-05-20', token).then(settle),
      ]);

      // The staging stop bumped the version without an event, since it bypassed the audit layer.
      await assertRaceIsSafe(taskId, outcomes, token, { outOfBandVersionBumps: 1 });
      // Exactly one may commit: the two intents are incompatible, unlike the already-removed case
      // where a no-op DELETE can honestly succeed beside a reactivation.
      expect(outcomes.filter((outcome) => outcome.status === 200)).toHaveLength(1);
    }
  });

  it('refuses a removal staged on a stale non-live observation, opposite arrival order', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const taskId = await seedTask();
      await stageStoppedScheduleWithLiveDueDate(taskId);
      const token = (await readState(taskId)).etag;

      const outcomes = await Promise.all([
        put(taskId, '2026-05-20', token).then(settle),
        del(taskId, token).then(settle),
      ]);

      await assertRaceIsSafe(taskId, outcomes, token, { outOfBandVersionBumps: 1 });
      expect(outcomes.filter((outcome) => outcome.status === 200)).toHaveLength(1);
    }
  });

  it('never leaves an active schedule behind a null task due date under H1 contention', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const taskId = await seedTask();
      await stageStoppedScheduleWithLiveDueDate(taskId);
      const token = (await readState(taskId)).etag;

      // A wider burst from the same stale token, so the interleaving is not a single fixed pairing.
      const outcomes = await Promise.all([
        del(taskId, token).then(settle),
        put(taskId, '2026-05-20', token).then(settle),
        del(taskId, token).then(settle),
        put(taskId, '2026-06-30', token).then(settle),
      ]);

      expect(outcomes.map((outcome) => outcome.status)).not.toContain(500);
      // Exactly one, including the two removals. Both used to be able to answer 200 — the winner
      // truthfully, and a loser whose torn pre-lock read looked like "already removed" while its
      // token was stale, handing back a superseded ETag.
      expect(outcomes.filter((outcome) => outcome.status === 200)).toHaveLength(1);
      await assertScheduleInvariants(taskId);
      await assertAuditTrailIsConsistent(taskId, await readReminderEvents(taskId), {
        outOfBandVersionBumps: 1,
      });
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

  /**
   * Task lifecycle transitions racing Owner reminder mutations (A8 lifecycle wiring).
   *
   * Both sides now write the schedule *and* the Task inside one transaction, so this is the pairing
   * with the most opportunity to deadlock or to commit an impossible combination. Every case asserts
   * the schedule invariants directly, because the failure that matters is not a bad status code — it is
   * a terminal or Waiting Task left holding an occurrence a worker would claim.
   */
  describe('lifecycle versus Owner mutation', () => {
    /** A lifecycle route call, settled to a plain outcome so it can be raced against a reminder call. */
    async function lifecycle(
      handler: (
        request: Request,
        context: { params: Promise<{ taskId: string }> },
      ) => Promise<Response>,
      taskId: string,
      path: string,
      body: unknown,
    ): Promise<Outcome> {
      const taskEtag = await currentTaskEtag(taskId);
      const response = await handler(
        new Request(`http://localhost/api/v1/tasks/${taskId}/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'if-match': taskEtag },
          body: JSON.stringify(body),
        }),
        params(taskId),
      );
      return settle(response);
    }

    async function currentTaskEtag(taskId: string): Promise<string> {
      const task = await prisma.task.findFirstOrThrow({
        where: { organizationId: org, id: taskId },
        select: { version: true },
      });
      return formatETag('task', taskId, task.version);
    }

    const enterWaiting = (taskId: string) =>
      lifecycle(waitTask, taskId, 'waiting', { waitingUntil: '2026-04-20T17:00:00.000Z' });
    const leaveWaiting = (taskId: string) => lifecycle(resumeTask, taskId, 'resume', {});
    const complete = (taskId: string) =>
      lifecycle(completeTask, taskId, 'complete', { outcomeType: 'completed' });
    const dismiss = (taskId: string) => lifecycle(dismissTask, taskId, 'dismiss', { reason: 'no' });

    /**
     * Lifecycle and reminder requests use different preconditions — a Task ETag and a reminder ETag —
     * so unlike the reminder-versus-reminder races both may legitimately succeed. What may never happen
     * is a 500, an untyped conflict, or a surviving combination the invariants forbid.
     */
    async function assertLifecycleRaceIsSafe(taskId: string, outcomes: readonly Outcome[]) {
      const statuses = outcomes.map((outcome) => outcome.status);
      expect(statuses, `statuses ${statuses.join(',')}`).not.toContain(500);
      for (const loser of outcomes.filter((outcome) => ![200, 201].includes(outcome.status))) {
        expect([409, 412], `loser status ${loser.status}`).toContain(loser.status);
      }
      await assertScheduleInvariants(taskId);
      await assertAuditTrailIsConsistent(taskId, await readReminderEvents(taskId));
    }

    async function seedWithSchedule(): Promise<{ taskId: string; token: string }> {
      const taskId = await seedTask();
      await put(taskId, '2026-04-01', (await readState(taskId)).etag);
      return { taskId, token: (await readState(taskId)).etag };
    }

    it('survives entering waiting versus an Owner PUT', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const { taskId, token } = await seedWithSchedule();

        const outcomes = await Promise.all([
          enterWaiting(taskId),
          put(taskId, '2026-05-20', token).then(settle),
        ]);

        await assertLifecycleRaceIsSafe(taskId, outcomes);
        // Whichever order they land in, a Waiting Task cannot end up armed: the suspension clears the
        // occurrence, and a PUT that lands after it produces a suspended generation.
        const schedule = await findReminderScheduleByTaskId(prisma, org, taskId);
        expect(schedule?.status).not.toBe('active');
      }
    });

    it('survives leaving waiting versus an Owner DELETE', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const { taskId } = await seedWithSchedule();
        await enterWaiting(taskId);
        const token = (await readState(taskId)).etag;

        const outcomes = await Promise.all([leaveWaiting(taskId), del(taskId, token).then(settle)]);

        await assertLifecycleRaceIsSafe(taskId, outcomes);
        // A resume must never revive a schedule the removal stopped, and a removal must never leave a
        // resumed schedule behind a cleared due date.
        const schedule = await findReminderScheduleByTaskId(prisma, org, taskId);
        if (schedule?.status === 'stopped') {
          expect(schedule.nextOverdueOccurrenceAt).toBeNull();
        } else {
          expect(await getTaskDueLocalDate(prisma, org, taskId)).not.toBeNull();
        }
      }
    });

    it('survives completion versus an Owner PUT', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const { taskId, token } = await seedWithSchedule();

        const outcomes = await Promise.all([
          complete(taskId),
          put(taskId, '2026-05-20', token).then(settle),
        ]);

        await assertLifecycleRaceIsSafe(taskId, outcomes);
        const task = await prisma.task.findFirstOrThrow({
          where: { organizationId: org, id: taskId },
        });
        const schedule = await findReminderScheduleByTaskId(prisma, org, taskId);
        // The completion may lose its precondition, but if it committed the schedule is stopped —
        // there is no interleaving in which a completed Task keeps a live schedule.
        if (task.status === 'completed') {
          expect(schedule?.status).toBe('stopped');
          expect(schedule?.nextOverdueOccurrenceAt).toBeNull();
        }
      }
    });

    it('survives dismissal versus a reactivation', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const { taskId } = await seedWithSchedule();
        await del(taskId, (await readState(taskId)).etag);
        const token = (await readState(taskId)).etag;

        const outcomes = await Promise.all([
          dismiss(taskId),
          put(taskId, '2026-06-30', token).then(settle),
        ]);

        await assertLifecycleRaceIsSafe(taskId, outcomes);
        const task = await prisma.task.findFirstOrThrow({
          where: { organizationId: org, id: taskId },
        });
        if (task.status === 'dismissed') {
          const schedule = await findReminderScheduleByTaskId(prisma, org, taskId);
          expect(schedule?.status).toBe('stopped');
        }
      }
    });

    it('survives a lifecycle stop versus another lifecycle stop', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const { taskId } = await seedWithSchedule();

        // Both hold the same Task ETag, so exactly one status transition may commit.
        const outcomes = await Promise.all([complete(taskId), dismiss(taskId)]);

        await assertLifecycleRaceIsSafe(taskId, outcomes);
        expect(outcomes.filter((outcome) => outcome.status === 200)).toHaveLength(1);
        const schedule = await findReminderScheduleByTaskId(prisma, org, taskId);
        expect(schedule?.status).toBe('stopped');
        // One transition, so one stop reason — and it must match the transition that actually won.
        const task = await prisma.task.findFirstOrThrow({
          where: { organizationId: org, id: taskId },
        });
        expect(schedule?.stopReason).toBe(
          task.status === 'completed' ? 'task_completed' : 'task_dismissed',
        );
      }
    });

    it('survives a resume versus a completion', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const { taskId } = await seedWithSchedule();
        await enterWaiting(taskId);

        const outcomes = await Promise.all([leaveWaiting(taskId), complete(taskId)]);

        await assertLifecycleRaceIsSafe(taskId, outcomes);
        expect(outcomes.filter((outcome) => outcome.status === 200)).toHaveLength(1);
        const task = await prisma.task.findFirstOrThrow({
          where: { organizationId: org, id: taskId },
        });
        const schedule = await findReminderScheduleByTaskId(prisma, org, taskId);
        // A completion that wins must not leave the resume's occurrence armed behind it.
        if (task.status === 'completed') {
          expect(schedule?.status).toBe('stopped');
          expect(schedule?.nextOverdueOccurrenceAt).toBeNull();
        } else {
          expect(schedule?.status).toBe('active');
        }
      }
    });

    it('survives a burst of lifecycle and Owner writes without deadlocking', async () => {
      for (let round = 0; round < 4; round += 1) {
        const { taskId, token } = await seedWithSchedule();

        const outcomes = await Promise.all([
          enterWaiting(taskId),
          put(taskId, '2026-05-20', token).then(settle),
          complete(taskId),
          del(taskId, token).then(settle),
          dismiss(taskId),
          put(taskId, '2026-07-15', token).then(settle),
        ]);

        await assertLifecycleRaceIsSafe(taskId, outcomes);
      }
    });
  });

  /**
   * The former A8.3a establishment path, raced against Owner mutations (A8.3b re-audit M1).
   *
   * `persistEstablishedReminderSchedule` and `persistDueDateRemoval` are the two transactions the
   * re-audit found still outside the universal order: establishment wrote the schedule before the Task
   * and took no Task lock, while removal wrote the Task first. That is the precise cycle PostgreSQL
   * reported as `deadlock detected`, and it was reachable from A8.4 rather than from A8.3b, which is why
   * it had to be closed before any worker could call either.
   *
   * These tests drive the persistence transactions directly, since no route reaches them, and assert
   * that no deadlock survives anywhere in the pairing.
   */
  describe('lock-order proof for the A8.3a paths', () => {
    /** Deadlocks must not merely be mapped to a typed error — with one lock order, none may occur. */
    function assertNoDeadlock(results: readonly PromiseSettledResult<unknown>[]) {
      for (const result of results) {
        if (result.status === 'rejected') {
          const message = String(result.reason?.message ?? result.reason);
          expect(message.toLowerCase(), `unexpected deadlock: ${message}`).not.toContain(
            'deadlock',
          );
          expect(message, `unexpected serialization abort: ${message}`).not.toContain('40P01');
        }
      }
    }

    it('survives A8.3a establishment racing an Owner establishment', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const taskId = await seedTask();
        const token = (await readState(taskId)).etag;

        const results = await Promise.allSettled([
          persistEstablishedReminderSchedule({
            db: prisma,
            schedule: {
              id: `trs_race_${round}`,
              organizationId: org,
              taskId,
              dueLocalDate: '2026-04-01' as never,
              schedulingTimeZone: 'America/Chicago',
              establishedAt: new Date().toISOString(),
              advanceDisposition: 'scheduled',
              advanceOccurrence: {
                occurrenceLocalDate: '2026-03-31' as never,
                occurrenceAt: '2026-03-31T14:00:00.000Z',
              },
              nextOverdueOccurrence: {
                occurrenceLocalDate: '2026-04-02' as never,
                occurrenceAt: '2026-04-02T14:00:00.000Z',
              },
              status: 'active',
            },
          }),
          put(taskId, '2026-05-20', token).then(settle),
        ]);

        assertNoDeadlock(results);
        // The unique index on `task_id` still admits exactly one schedule, whichever path won.
        const schedules = await prisma.taskReminderSchedule.findMany({
          where: { organizationId: org, taskId },
        });
        expect(schedules).toHaveLength(1);
        await assertScheduleInvariants(taskId);
      }
    });

    it('survives the A8.3a removal racing an Owner generation change', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const taskId = await seedTask();
        await put(taskId, '2026-04-01', (await readState(taskId)).etag);
        const schedule = await findReminderScheduleByTaskId(prisma, org, taskId);
        const token = (await readState(taskId)).etag;

        // The original cycle: this transaction wrote `tasks` first, the Owner path wrote the schedule
        // first. Both now lock the Task row before either.
        const results = await Promise.allSettled([
          persistDueDateRemoval({
            db: prisma,
            organizationId: org,
            taskId,
            scheduleId: schedule!.id,
            stoppedAt: new Date().toISOString(),
          }),
          put(taskId, '2026-05-20', token).then(settle),
        ]);

        assertNoDeadlock(results);
        await assertScheduleInvariants(taskId);
      }
    });

    it('survives the A8.3a removal racing a lifecycle completion', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const taskId = await seedTask();
        await put(taskId, '2026-04-01', (await readState(taskId)).etag);
        const schedule = await findReminderScheduleByTaskId(prisma, org, taskId);
        const taskRow = await prisma.task.findFirstOrThrow({
          where: { organizationId: org, id: taskId },
          select: { version: true },
        });

        const results = await Promise.allSettled([
          persistDueDateRemoval({
            db: prisma,
            organizationId: org,
            taskId,
            scheduleId: schedule!.id,
            stoppedAt: new Date().toISOString(),
          }),
          completeTask(
            new Request(`http://localhost/api/v1/tasks/${taskId}/complete`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'if-match': formatETag('task', taskId, taskRow.version),
              },
              body: JSON.stringify({ outcomeType: 'completed' }),
            }),
            params(taskId),
          ).then(settle),
        ]);

        assertNoDeadlock(results);
        await assertScheduleInvariants(taskId);
        // Both intents stop the schedule, so it must end stopped whichever committed first.
        const after = await findReminderScheduleByTaskId(prisma, org, taskId);
        expect(after?.status).toBe('stopped');
        expect(after?.nextOverdueOccurrenceAt).toBeNull();
      }
    });
  });
});
