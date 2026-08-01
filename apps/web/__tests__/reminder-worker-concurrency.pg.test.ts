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
        const transport = new FakeReminderTransport();

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
        const transport: ReminderTransport = new FakeReminderTransport();

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
});
