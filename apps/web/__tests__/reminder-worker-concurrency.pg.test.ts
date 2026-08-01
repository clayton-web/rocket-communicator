// @vitest-environment node
/**
 * A8.4a worker and Owner contention against a real PostgreSQL server (re-audit H-A; audit F1, F11).
 *
 * Two properties need a real server and cannot be shown on PGlite, which serializes every statement
 * onto one connection:
 *
 * 1. **The Owner GET projects one snapshot (H-A).** The pre-fix `GET` read the schedule and the
 *    canonical Task due date as two independent unlocked statements. Raced against a `DELETE` it
 *    returned an `active` schedule behind a `null` due date — each half true, of different moments,
 *    and the pair impossible. The fix reads both inside one `RepeatableRead` transaction.
 * 2. **Two workers on one due schedule deliver once.** The occurrence row is the duplicate-prevention
 *    authority; the schedule lease is only a scan hint. Two full processing runs launched at the same
 *    instant must produce one send.
 *
 * ## Running it
 *
 * Skipped unless `AICAA_PG_CONCURRENCY_URL` names a **loopback** PostgreSQL 16 with the migrations
 * applied. Not part of `pnpm verify`, which must not require Docker.
 *
 *   pnpm db:docker:up
 *   AICAA_LOCAL_DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     node packages/db/scripts/run-local-prisma.mjs migrate deploy
 *   AICAA_PG_CONCURRENCY_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     pnpm --filter @aicaa/web exec vitest run reminder-worker-concurrency
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  REMINDER_SCHEDULING_TIME_ZONE,
  asAssignmentId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  decideAdvanceReminder,
  ownerActor,
  parseLocalDate,
  selectNextOverdueOccurrence,
  type Recipient,
  type Task,
} from '@aicaa/domain';
import {
  createPrismaClient,
  createTask as createTaskRow,
  listReminderDeliveryAttemptsForTask,
  persistEstablishedReminderSchedule,
  upsertRecipient,
  type DbClient,
} from '@aicaa/db';
import { installDbTestRuntime } from './helpers/db-test-runtime';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { runInternalReminderProcess } from '@/lib/reminders/process-service';
import { FakeReminderTransport, type ReminderTransport } from '@/lib/reminders/transport';
import {
  DELETE as removeReminder,
  GET as readReminder,
  PUT as setReminder,
} from '@/app/api/v1/tasks/[taskId]/reminder/route';
import { POST as completeTask } from '@/app/api/v1/tasks/[taskId]/complete/route';
import { POST as waitTask } from '@/app/api/v1/tasks/[taskId]/waiting/route';

const RAW_URL = process.env.AICAA_PG_CONCURRENCY_URL;

/** `packages/db/.env` holds a production URL. A race loop must never reach it. */
function assertLoopback(raw: string): string {
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())) {
    throw new Error(`AICAA_PG_CONCURRENCY_URL must be loopback, got ${url.hostname}.`);
  }
  return raw;
}

const describeMaybe = RAW_URL ? describe : describe.skip;

const org = 'org_worker_race';
const owner = ownerActor(asOwnerId('owner_worker_race'), asOrganizationId(org));
const zone = REMINDER_SCHEDULING_TIME_ZONE;

/** A race that fails one time in ten passes once and looks fixed. */
const ROUNDS = 20;

const ENABLED = { ...process.env, ENABLE_REMINDER_DELIVERY: 'true' } as NodeJS.ProcessEnv;

/**
 * A transport that accepts, stated explicitly (A8.4a audit H3).
 *
 * `new FakeReminderTransport()` used to mean "accepts everything", which is why the audit could
 * point at production orchestration and show it would record fake deliveries against the D106
 * ceiling if the flag were ever enabled without a script. The bare constructor now returns a
 * permanent configuration failure, so a test that wants a send has to ask for one.
 */
function acceptingTransport(): FakeReminderTransport {
  return new FakeReminderTransport({
    defaultResult: { kind: 'accepted', providerMessageRef: 'ref_default' },
  });
}

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
      assignedByOwnerId: asOwnerId('owner_worker_race'),
      allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
    },
  };
}

describeMaybe('A8.4a worker and Owner contention (real PostgreSQL 16)', () => {
  let prisma: DbClient;
  let sequence = 0;

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
    await quiesce();
  });

  /**
   * Unique per process run.
   *
   * Tasks are referenced by schedules, attempts, assignments, and audit events, so deleting last
   * run's rows means getting a dependency order right and keeping it right. Minting fresh ids is
   * simpler and cannot silently half-succeed the way an ordered cascade can.
   */
  const runId = Math.random().toString(36).slice(2, 8);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** A Task with an established, active schedule whose overdue occurrence has already arrived. */
  async function seed(prefix: string): Promise<{ taskId: string; scheduleId: string }> {
    sequence += 1;
    const taskId = `task_${runId}_${prefix}_${sequence}`;
    const establishedAt = '2026-08-01T12:00:00.000Z';
    await upsertRecipient(prisma, {
      organizationId: org,
      recipient: recipientFixture(`rcp_${taskId}`),
    });
    const task = taskFixture(taskId, establishedAt);
    await createTaskRow(prisma, org, task, task.assignment);

    const dueLocalDate = parseLocalDate('2026-08-05');
    const advance = decideAdvanceReminder({ dueLocalDate, establishedAt });
    const overdue = selectNextOverdueOccurrence({ dueLocalDate, now: establishedAt });
    const { schedule } = await persistEstablishedReminderSchedule({
      db: prisma,
      schedule: {
        id: `sched_${runId}_${prefix}_${sequence}`,
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
          occurrenceLocalDate: overdue.occurrenceLocalDate,
          occurrenceAt: overdue.occurrenceAt,
        },
      },
    });
    return { taskId, scheduleId: schedule.id };
  }

  /**
   * Retire every active schedule in the database, so each round's scan sees only its own.
   *
   * Deliberately not scoped to this organization: the worker scan is global by design (F11), so a
   * schedule another suite left behind is genuinely due and would genuinely be delivered. That is
   * correct behaviour and the wrong thing to assert against.
   *
   * Reaching outside this organization is only safe because `vitest.config.ts` serializes the
   * `.pg.test.ts` files whenever the concurrency URL is set. Without that, this would stop rows
   * another suite was still using — and it did, before the config change.
   *
   * It cannot be narrowed to this organization without losing what it is for, and the remediation
   * re-audit checked: the suites deliberately never delete their rows (see `runId` above), so the
   * database always holds another suite's armed schedules, and a global scanner asserting exact
   * counters has to neutralize them. Scoping the write would leave those rows claimable, which does
   * not weaken an assertion so much as invert it — the counters would go up for reasons the test
   * did not arrange. The alternative, relative deltas instead of exact totals, is strictly less
   * coverage.
   *
   * **The trap this sets.** After this file finishes, almost nothing in the database is `active`, so
   * an *unscoped* "every active schedule is armed" sweep run afterwards is nearly vacuous and a
   * poisoned row looks self-healed. The B1 invariant is therefore asserted where it means something:
   * scoped to its own organization, inside `a8-4a-occurrence-concurrency.pg.test.ts`, which never
   * quiesces. Do not move it here and do not read an unscoped post-run sweep as evidence.
   */
  async function quiesce(): Promise<void> {
    await prisma.taskReminderSchedule.updateMany({
      where: { status: 'active' },
      data: {
        status: 'stopped',
        stopReason: 'task_completed',
        stoppedAt: new Date('2026-08-19T00:00:00.000Z'),
        nextOverdueOccurrenceAt: null,
        nextOverdueOccurrenceLocalDate: null,
        claimedBy: null,
        claimedAt: null,
        claimExpiresAt: null,
      },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // H-A — the Owner GET projects one snapshot
  // ---------------------------------------------------------------------------------------------

  describe('H-A: GET never returns a state that never existed', () => {
    /**
     * Every impossible pairing the two-read shape could produce, asserted on every response.
     *
     * The pre-fix defect was not that GET returned stale data — a read racing a write is allowed to
     * be a moment behind. It was that the two halves came from *different* moments, so the pair
     * described a state the database never held.
     */
    interface ReminderBody {
      readonly state: string;
      readonly dueLocalDate: string | null;
      readonly generation: number | null;
      readonly etag: string;
      readonly nextOverdueOccurrence: { localDate: string; at: string } | null;
      readonly overdueDeliveredCount: number | null;
    }

    async function assertCoherent(
      response: Response,
      context: string,
    ): Promise<ReminderBody | null> {
      expect([200, 404], context).toContain(response.status);
      expect(response.headers.get('Cache-Control'), context).toBe('no-store');
      if (response.status !== 200) {
        return null;
      }
      const body = (await response.json()) as ReminderBody;

      if (body.state === 'active' || body.state === 'suspended_waiting') {
        // A live schedule behind a null canonical due date is exactly what the two-read shape
        // produced: the schedule half from before a removal, the due-date half from after it.
        expect(
          body.dueLocalDate,
          `${context}: ${body.state} schedule with no due date`,
        ).not.toBeNull();
        expect(body.generation, `${context}: live schedule with no generation`).not.toBeNull();
      }
      if (body.dueLocalDate === null) {
        expect(
          ['no_due_date', 'stopped'],
          `${context}: state ${body.state} paired with a null due date`,
        ).toContain(body.state);
      }
      // An active schedule always has an armed occurrence; a suspended or stopped one never does.
      if (body.state === 'active') {
        expect(body.nextOverdueOccurrence, `${context}: active with nothing armed`).not.toBeNull();
      }
      if (body.state === 'suspended_waiting' || body.state === 'stopped') {
        expect(
          body.nextOverdueOccurrence,
          `${context}: ${body.state} still holding an armed occurrence`,
        ).toBeNull();
      }
      // The ETag is derived from the projected schedule's own version, so a body with a schedule
      // must carry one and a body without must still be addressable.
      expect(typeof body.etag, context).toBe('string');
      expect(body.etag.length, context).toBeGreaterThan(0);
      return body;
    }

    const RACES = [
      {
        name: 'a concurrent DELETE',
        act: (taskId: string) => removeReminder(reminderRequest(taskId, 'DELETE'), params(taskId)),
      },
      {
        name: 'a concurrent material PUT',
        act: (taskId: string) =>
          setReminder(
            reminderRequest(taskId, 'PUT', { body: { dueLocalDate: '2026-12-24' } }),
            params(taskId),
          ),
      },
      {
        name: 'a concurrent completion',
        act: (taskId: string) =>
          completeTask(
            new Request(`http://localhost/api/v1/tasks/${taskId}/complete`, { method: 'POST' }),
            params(taskId),
          ),
      },
      {
        name: 'a concurrent Waiting transition',
        act: (taskId: string) =>
          waitTask(
            new Request(`http://localhost/api/v1/tasks/${taskId}/waiting`, { method: 'POST' }),
            params(taskId),
          ),
      },
    ] as const;

    for (const race of RACES) {
      it(`stays coherent against ${race.name}`, async () => {
        let projectionsSeen = 0;
        for (let round = 0; round < ROUNDS; round += 1) {
          const { taskId } = await seed('get_race');
          const [beforeRead, , afterRead] = await Promise.all([
            readReminder(reminderRequest(taskId, 'GET'), params(taskId)),
            race.act(taskId).catch(() => undefined),
            readReminder(reminderRequest(taskId, 'GET'), params(taskId)),
          ]);

          const first = await assertCoherent(
            beforeRead,
            `round ${round}: read racing ${race.name}`,
          );
          const second = await assertCoherent(
            afterRead,
            `round ${round}: second read racing ${race.name}`,
          );
          projectionsSeen += [first, second].filter((body) => body !== null).length;
        }
        // A suite that 404s every round would pass every assertion above and prove nothing. This is
        // the guard against the race quietly ceasing to race anything.
        expect(projectionsSeen, 'no GET projection was actually examined').toBeGreaterThan(0);
        await quiesce();
      });
    }

    /**
     * The strongest available statement of "one snapshot": generation and due date must agree.
     *
     * Generation 1 scheduled `2026-08-05` and generation 2 schedules `2027-01-15`. Those pairings
     * are the only two that ever existed, so a response pairing generation 1 with the new date, or
     * generation 2 with the old one, is a projection assembled from two different moments —
     * regardless of which moment is the more recent.
     */
    it('never pairs a generation with another generation\u2019s due date', async () => {
      const NEW_DUE = '2027-01-15';
      const OLD_DUE = '2026-08-05';
      let projectionsSeen = 0;

      for (let round = 0; round < ROUNDS; round += 1) {
        const { taskId } = await seed('get_generation');
        const [read] = await Promise.all([
          readReminder(reminderRequest(taskId, 'GET'), params(taskId)),
          setReminder(
            reminderRequest(taskId, 'PUT', { body: { dueLocalDate: NEW_DUE } }),
            params(taskId),
          ).catch(() => undefined),
        ]);

        const body = await assertCoherent(read, `round ${round}`);
        if (!body || body.generation === null) {
          continue;
        }
        projectionsSeen += 1;
        expect(body.dueLocalDate, `round ${round}: generation ${body.generation}`).toBe(
          body.generation === 1 ? OLD_DUE : NEW_DUE,
        );
      }
      expect(projectionsSeen, 'no GET projection carried a generation to check').toBeGreaterThan(0);
      await quiesce();
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Two workers, one due schedule
  // ---------------------------------------------------------------------------------------------

  describe('two concurrent processing runs deliver once', () => {
    it('sends one reminder for one due schedule, whichever worker wins the scan lease', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await quiesce();
        const { taskId } = await seed('two_workers');
        const transport = acceptingTransport();

        const run = (requestId: string) =>
          runInternalReminderProcess({
            db: prisma,
            requestId,
            now: '2026-08-20T18:00:00.000Z',
            env: ENABLED,
            transport,
          }).catch(() => ({ response: null }));

        const [first, second] = await Promise.all([run('req_a'), run('req_b')]);

        const attempts = await listReminderDeliveryAttemptsForTask(prisma, org, taskId);
        expect(attempts, `round ${round}`).toHaveLength(1);
        expect(attempts[0].outcome, `round ${round}`).toBe('success');

        // One transport call for that morning, not two.
        expect(
          transport.calls.filter((call) => call.taskId === taskId),
          `round ${round}`,
        ).toHaveLength(1);

        const delivered = (first.response?.delivered ?? 0) + (second.response?.delivered ?? 0);
        expect(delivered, `round ${round}`).toBe(1);

        const schedule = await prisma.taskReminderSchedule.findFirstOrThrow({
          where: { organizationId: org, taskId },
        });
        expect(schedule.overdueDeliveredCount, `round ${round}`).toBe(1);
      }
      await quiesce();
    });

    it('never delivers when the Owner completes the Task at the same instant', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await quiesce();
        const { taskId } = await seed('worker_vs_owner');
        const transport: ReminderTransport = acceptingTransport();

        await Promise.all([
          runInternalReminderProcess({
            db: prisma,
            requestId: 'req_worker',
            now: '2026-08-20T18:00:00.000Z',
            env: ENABLED,
            transport,
          }).catch(() => undefined),
          completeTask(
            new Request(`http://localhost/api/v1/tasks/${taskId}/complete`, { method: 'POST' }),
            params(taskId),
          ).catch(() => undefined),
        ]);

        const attempts = await listReminderDeliveryAttemptsForTask(prisma, org, taskId);
        // Either the guard refused before sending, or the send happened and is recorded truthfully.
        // What must never happen is a send with no record of it, or two rows for one morning.
        expect(attempts.length, `round ${round}`).toBeLessThanOrEqual(1);
        if (attempts.length === 1) {
          expect(['success', 'skipped'], `round ${round}: ${attempts[0].outcome}`).toContain(
            attempts[0].outcome,
          );
          if (attempts[0].outcome === 'success') {
            expect(attempts[0].providerAcceptedAt, `round ${round}`).not.toBeNull();
          }
        }

        const schedule = await prisma.taskReminderSchedule.findFirstOrThrow({
          where: { organizationId: org, taskId },
        });
        // A stopped schedule never keeps an armed occurrence, whichever committed first.
        if (schedule.status !== 'active') {
          expect(schedule.nextOverdueOccurrenceAt, `round ${round}`).toBeNull();
        }
      }
      await quiesce();
    });
  });

  // ---------------------------------------------------------------------------------------------
  // A8.4a audit remediation, exercised through the whole worker rather than the transactions alone
  // ---------------------------------------------------------------------------------------------

  describe('remediation: the worker recovers its own wreckage', () => {
    /**
     * These rounds are slower than the ones above: each drives several full invocations and waits
     * out a deliberately hanging transport, twenty times over. The default five-second timeout cuts
     * a round in half, and a half-finished round leaves state the next test then inherits — which
     * is how a timeout here first showed up as an unrelated failure two tests later.
     */
    const REMEDIATION_ROUND_TIMEOUT_MS = 180_000;

    /** A worker that dies mid-call: the send is entered, the process never comes back. */
    const hangingTransport: ReminderTransport = { send: () => new Promise(() => {}) };

    /** Let an invocation reach its transport call, then abandon it where it stands. */
    async function abandonMidSend(requestId: string, now: string): Promise<void> {
      await Promise.race([
        runInternalReminderProcess({
          db: prisma,
          requestId,
          now,
          env: ENABLED,
          transport: hangingTransport,
        }).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 150)),
      ]);
    }

    /** Kill the lease so the next invocation's recovery sweep picks the occurrence up. */
    async function expireClaim(taskId: string): Promise<void> {
      await prisma.reminderDeliveryAttempt.updateMany({
        where: { organizationId: org, taskId, outcome: 'claimed' },
        data: { claimExpiresAt: new Date('2026-08-20T18:00:00.000Z') },
      });
    }

    async function scheduleFor(taskId: string) {
      return prisma.taskReminderSchedule.findFirstOrThrow({
        where: { organizationId: org, taskId },
      });
    }

    it(
      'B1: an in-flight crash leaves the series running, not silently ended',
      async () => {
        for (let round = 0; round < ROUNDS; round += 1) {
          await quiesce();
          const { taskId } = await seed('b1_worker');

          // The crash this recovers from: the in-flight marker is committed, the worker dies inside
          // the provider call, and the lease runs out with nobody able to say what the provider did.
          await abandonMidSend('req_hang', '2026-08-20T18:00:00.000Z');
          await expireClaim(taskId);

          const recovery = await runInternalReminderProcess({
            db: prisma,
            requestId: 'req_recover',
            now: '2026-08-20T19:00:00.000Z',
            env: ENABLED,
            transport: acceptingTransport(),
          });

          const attempts = await listReminderDeliveryAttemptsForTask(prisma, org, taskId);
          const overdue = attempts.filter((row) => row.occurrenceKind === 'overdue');
          expect(overdue, `round ${round}`).toHaveLength(1);
          expect(overdue[0].outcome, `round ${round}`).toBe('ambiguous');
          expect(overdue[0].failureCode, `round ${round}`).toBe('lease_expired_in_flight');
          expect(overdue[0].providerAcceptedAt, `round ${round}`).toBeNull();
          expect(recovery.response.recoveredClaims, `round ${round}`).toBeGreaterThanOrEqual(1);

          // The point of B1: consuming one morning is not ending the series.
          const schedule = await scheduleFor(taskId);
          expect(schedule.status, `round ${round}`).toBe('active');
          expect(schedule.stopReason, `round ${round}`).toBeNull();
          expect(schedule.nextOverdueOccurrenceAt, `round ${round}`).not.toBeNull();
          expect(
            schedule.nextOverdueOccurrenceAt!.toISOString() > '2026-08-20T19:00:00.000Z',
            `round ${round}: the armed occurrence must be in the future`,
          ).toBe(true);
          expect(schedule.overdueDeliveredCount, `round ${round}`).toBe(0);
        }
        await quiesce();
      },
      REMEDIATION_ROUND_TIMEOUT_MS,
    );

    it(
      'B2: a final-attempt crash terminalizes instead of looping forever',
      async () => {
        for (let round = 0; round < ROUNDS; round += 1) {
          await quiesce();
          const { taskId } = await seed('b2_worker');

          // Two retryable rejections spend the budget down to its last attempt.
          const retrying = new FakeReminderTransport({
            defaultResult: { kind: 'retryable', failureCode: 'provider_unavailable' },
          });
          for (const requestId of ['req_r1', 'req_r2']) {
            await runInternalReminderProcess({
              db: prisma,
              requestId,
              now: '2026-08-20T18:00:00.000Z',
              env: ENABLED,
              transport: retrying,
            });
          }

          // The third and last permitted attempt claims, and the worker dies before its transport
          // call. Clearing the marker afterwards is what makes this the B2 case rather than the B1
          // one: nothing left the building, so recovery releases the lease instead of assuming a
          // send — and then no worker can ever claim the occurrence again.
          await abandonMidSend('req_die', '2026-08-20T18:00:00.000Z');
          await prisma.reminderDeliveryAttempt.updateMany({
            where: { organizationId: org, taskId, outcome: 'claimed' },
            data: {
              claimExpiresAt: new Date('2026-08-20T18:00:00.000Z'),
              providerCallStartedAt: null,
            },
          });

          const later = acceptingTransport();
          const runs = [];
          for (const requestId of ['req_after1', 'req_after2', 'req_after3']) {
            runs.push(
              (
                await runInternalReminderProcess({
                  db: prisma,
                  requestId,
                  now: '2026-08-20T20:00:00.000Z',
                  env: ENABLED,
                  transport: later,
                })
              ).response,
            );
          }

          const attempts = await listReminderDeliveryAttemptsForTask(prisma, org, taskId);
          const overdue = attempts.filter((row) => row.occurrenceKind === 'overdue');
          expect(overdue, `round ${round}`).toHaveLength(1);
          expect(overdue[0].outcome, `round ${round}`).toBe('permanent_failure');
          expect(overdue[0].failureCode, `round ${round}`).toBe('retry_budget_exhausted');
          expect(overdue[0].claimExpiresAt, `round ${round}`).toBeNull();

          // Exactly one invocation did the terminalizing; the two after it found nothing to do, which
          // is the difference between a recovery and the hot loop the audit found.
          expect(
            runs.reduce((sum, response) => sum + response.retryBudgetTerminalizations, 0),
            `round ${round}`,
          ).toBe(1);
          expect(
            runs[1].schedulesScanned + runs[2].schedulesScanned,
            `round ${round}: the stopped schedule is gone from the scan, which is what ends the loop`,
          ).toBe(0);
          expect(
            later.calls.filter((call) => call.taskId === taskId),
            `round ${round}`,
          ).toHaveLength(0);

          const schedule = await scheduleFor(taskId);
          expect(schedule.status, `round ${round}`).toBe('stopped');
          expect(schedule.stopReason, `round ${round}`).toBe('permanent_delivery_failure');
          expect(schedule.requiresOwnerAttention, `round ${round}`).toBe(true);
          expect(schedule.nextOverdueOccurrenceAt, `round ${round}`).toBeNull();
        }
        await quiesce();
      },
      REMEDIATION_ROUND_TIMEOUT_MS,
    );

    it(
      'H1: settlement debt from a crashed worker is collected without a second send',
      async () => {
        for (let round = 0; round < ROUNDS; round += 1) {
          await quiesce();
          const { taskId } = await seed('h1_worker');

          const sender = acceptingTransport();
          await runInternalReminderProcess({
            db: prisma,
            requestId: 'req_send',
            now: '2026-08-20T18:00:00.000Z',
            env: ENABLED,
            transport: sender,
          });

          // Rewind settlement to reproduce a crash between the two phases. The occurrence keeps its
          // success and its acceptance proof; the schedule is put back to owing them.
          await prisma.reminderDeliveryAttempt.updateMany({
            where: { organizationId: org, taskId, outcome: 'success' },
            data: { scheduleSettledAt: null },
          });
          await prisma.taskReminderSchedule.updateMany({
            where: { organizationId: org, taskId },
            data: { overdueDeliveredCount: 0 },
          });

          const collector = acceptingTransport();
          const [first, second] = await Promise.all([
            runInternalReminderProcess({
              db: prisma,
              requestId: 'req_settle_a',
              now: '2026-08-20T19:00:00.000Z',
              env: ENABLED,
              transport: collector,
            }).catch(() => ({ response: null })),
            runInternalReminderProcess({
              db: prisma,
              requestId: 'req_settle_b',
              now: '2026-08-20T19:00:00.000Z',
              env: ENABLED,
              transport: collector,
            }).catch(() => ({ response: null })),
          ]);

          const attempts = await listReminderDeliveryAttemptsForTask(prisma, org, taskId);
          const overdue = attempts.filter((row) => row.occurrenceKind === 'overdue');
          expect(overdue, `round ${round}: no second occurrence`).toHaveLength(1);
          expect(overdue[0].outcome, `round ${round}`).toBe('success');
          expect(overdue[0].providerAcceptedAt, `round ${round}`).not.toBeNull();
          expect(overdue[0].scheduleSettledAt, `round ${round}`).not.toBeNull();

          // Settlement needs nothing from a provider, so collecting the debt cannot send anything.
          expect(
            collector.calls.filter((call) => call.taskId === taskId),
            `round ${round}: settlement must never re-send`,
          ).toHaveLength(0);

          const settled =
            (first.response?.unsettledOccurrencesSettled ?? 0) +
            (second.response?.unsettledOccurrencesSettled ?? 0);
          expect(settled, `round ${round}: collected once`).toBe(1);

          const schedule = await scheduleFor(taskId);
          expect(schedule.overdueDeliveredCount, `round ${round}: counted once`).toBe(1);
        }
        await quiesce();
      },
      REMEDIATION_ROUND_TIMEOUT_MS,
    );

    it(
      'H2: a retried occurrence never inherits the previous provider marker',
      async () => {
        for (let round = 0; round < ROUNDS; round += 1) {
          await quiesce();
          const { taskId } = await seed('h2_worker');

          await runInternalReminderProcess({
            db: prisma,
            requestId: 'req_fail',
            now: '2026-08-20T18:00:00.000Z',
            env: ENABLED,
            transport: new FakeReminderTransport({
              defaultResult: { kind: 'retryable', failureCode: 'provider_unavailable' },
            }),
          });

          const failed = await prisma.reminderDeliveryAttempt.findFirstOrThrow({
            where: { organizationId: org, taskId, occurrenceKind: 'overdue' },
          });
          expect(failed.outcome, `round ${round}`).toBe('retryable_failure');
          expect(failed.providerCallStartedAt, `round ${round}`).not.toBeNull();

          // The retry crashes before reaching its own transport call.
          await abandonMidSend('req_retry', '2026-08-20T19:00:00.000Z');

          const retried = await prisma.reminderDeliveryAttempt.findFirstOrThrow({
            where: { organizationId: org, taskId, occurrenceKind: 'overdue' },
          });
          expect(retried.attemptCount, `round ${round}`).toBe(2);
          expect(retried.scheduleSettledAt, `round ${round}`).toBeNull();
          // Before the fix the inherited marker was still set here, so the recovery below finalized
          // this ambiguous — a reminder provably never sent on this attempt, recorded as maybe-sent
          // and its morning consumed.
          expect(
            retried.providerCallStartedAt === null ||
              retried.providerCallStartedAt.toISOString() >= retried.claimedAt!.toISOString(),
            `round ${round}: the marker must belong to this attempt`,
          ).toBe(true);
        }
        await quiesce();
      },
      REMEDIATION_ROUND_TIMEOUT_MS,
    );
  });

  // ---------------------------------------------------------------------------------------------
  // Unscoped invariants over everything every round above produced
  // ---------------------------------------------------------------------------------------------

  describe('invariants, queried directly and deliberately unscoped', () => {
    async function rows(sql: string): Promise<unknown[]> {
      return prisma.$queryRawUnsafe(sql);
    }

    it('has no active schedule without an armed next occurrence (audit B1)', async () => {
      expect(
        await rows(`
          SELECT id FROM task_reminder_schedules
          WHERE status = 'active'
            AND (next_overdue_occurrence_at IS NULL OR next_overdue_occurrence_local_date IS NULL)
        `),
      ).toEqual([]);
    });

    it('has no non-active schedule holding an armed next occurrence', async () => {
      expect(
        await rows(`
          SELECT id FROM task_reminder_schedules
          WHERE status <> 'active'
            AND (next_overdue_occurrence_at IS NOT NULL
              OR next_overdue_occurrence_local_date IS NOT NULL)
        `),
      ).toEqual([]);
    });

    it('has no terminal occurrence holding a live claim', async () => {
      expect(
        await rows(`
          SELECT id FROM reminder_delivery_attempts
          WHERE outcome <> 'claimed' AND claim_expires_at IS NOT NULL
        `),
      ).toEqual([]);
    });

    it('has no successful delivery without acceptance proof, or the reverse', async () => {
      expect(
        await rows(`
          SELECT id FROM reminder_delivery_attempts
          WHERE (outcome = 'success' AND provider_accepted_at IS NULL)
             OR (provider_accepted_at IS NOT NULL AND outcome <> 'success')
        `),
      ).toEqual([]);
    });

    it('has no occurrence past its retry budget still waiting to be finished (audit B2)', async () => {
      expect(
        await rows(`
          SELECT id FROM reminder_delivery_attempts
          WHERE outcome IN ('claimed', 'retryable_failure')
            AND attempt_count >= 3
            AND provider_call_started_at IS NULL
            AND (claim_expires_at IS NULL OR claim_expires_at < NOW())
        `),
      ).toEqual([]);
    });

    it('has no terminal occurrence left permanently unsettled (audit H1)', async () => {
      expect(
        await rows(`
          SELECT id FROM reminder_delivery_attempts
          WHERE outcome <> 'claimed' AND schedule_settled_at IS NULL
        `),
      ).toEqual([]);
    });

    it('has no claim carrying a provider marker from a previous attempt (audit H2)', async () => {
      expect(
        await rows(`
          SELECT id FROM reminder_delivery_attempts
          WHERE outcome = 'claimed'
            AND provider_call_started_at IS NOT NULL
            AND claimed_at IS NOT NULL
            AND provider_call_started_at < claimed_at
        `),
      ).toEqual([]);
    });

    it('has no duplicate successful delivery for one schedule on one local day', async () => {
      expect(
        await rows(`
          SELECT schedule_id FROM reminder_delivery_attempts
          WHERE outcome = 'success'
          GROUP BY schedule_id, occurrence_local_date
          HAVING COUNT(*) > 1
        `),
      ).toEqual([]);
    });

    it('has no count that disagrees with the recorded successful overdue deliveries', async () => {
      expect(
        await rows(`
          SELECT s.id
          FROM task_reminder_schedules s
          WHERE s.status = 'active'
            AND s.overdue_delivered_count <> (
              SELECT COUNT(*) FROM reminder_delivery_attempts att
              WHERE att.schedule_id = s.id
                AND att.generation = s.generation
                AND att.occurrence_kind = 'overdue'
                AND att.outcome = 'success'
            )
        `),
      ).toEqual([]);
    });
  });
});
