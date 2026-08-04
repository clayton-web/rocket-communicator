// @vitest-environment node
/**
 * A8.5e: the two-phase worker against a real PostgreSQL 17 server.
 *
 * `a8-5e-notification-worker.test.ts` establishes what one invocation does. It runs on PGlite, which
 * serializes every statement onto one connection, so two workers there are never actually
 * simultaneous and always agree. Everything below needs genuine simultaneity, because what A8.5e
 * adds is a phase that two overlapping invocations can enter at the same moment:
 *
 *  - Two sweeps racing one lapsed capability must produce one transition, one audit row, one intent.
 *  - A Recipient presenting the token while a sweep scans it must produce the same.
 *  - A loser must write nothing at all, and must be counted as a lost race rather than as an error.
 *  - A bounded scan must be deterministic, so overlapping workers do not both take the same page and
 *    leave the tail unswept.
 *
 * The flag-matrix rows are re-proved here too. They are cheap, and a matrix that holds on PGlite but
 * not against a real connection pool would be the more interesting result.
 *
 * ## Running it
 *
 * Skipped unless `AICAA_PG_CONCURRENCY_URL` names a **loopback** PostgreSQL 17 with the migrations
 * applied. Not part of `pnpm verify`, which must stay Docker-free. A skipped run is not evidence.
 *
 *   pnpm db:docker:up
 *   AICAA_LOCAL_DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     node packages/db/scripts/run-local-prisma.mjs migrate deploy
 *   AICAA_PG_CONCURRENCY_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     pnpm --filter @aicaa/web exec vitest run a8-5e-worker-concurrency
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient, type DbClient } from '@aicaa/db';
import { installDbTestRuntime, clearDbTestRuntime } from './helpers/db-test-runtime';
import { runCapabilityExpirySweep } from '@/lib/capability/expiry';
import { ENABLE_OWNER_EVENT_CAPTURE_ENV } from '@/lib/notifications/capture-config';
import { ENABLE_OWNER_EVENT_DELIVERY_ENV } from '@/lib/notifications/process-config';
import { FakeOwnerNotificationTransport } from '@/lib/notifications/transport';
import { runOwnerNotificationWorker } from '@/lib/notifications/worker';

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

const runId = randomBytes(4).toString('hex');
const org = `org_a85e_pg_${runId}`;

/** Recent enough to sit inside the 24-hour delivery horizon relative to {@link NOW}. */
const EXPIRED_AT = '2026-08-06T11:00:00.000Z';
const NOW = '2026-08-06T12:00:00.000Z';

/** A race that fails one time in ten passes once and looks fixed. */
const ROUNDS = 20;

function envFor(capture: boolean, delivery: boolean): NodeJS.ProcessEnv {
  return {
    ...(capture ? { [ENABLE_OWNER_EVENT_CAPTURE_ENV]: 'true' } : {}),
    ...(delivery ? { [ENABLE_OWNER_EVENT_DELIVERY_ENV]: 'true' } : {}),
  } as NodeJS.ProcessEnv;
}

let seq = 0;
function nextSuffix(): string {
  seq += 1;
  return `${runId}_${seq}`;
}

describeMaybe('A8.5e two-phase worker on PostgreSQL 17', () => {
  /** Independent connections. Two workers are two processes; two clients is the closest analogue. */
  let a: DbClient;
  let b: DbClient;

  beforeAll(async () => {
    const url = assertLoopback(RAW_URL!);
    a = createPrismaClient(url);
    b = createPrismaClient(url);
    await Promise.all([a.$connect(), b.$connect()]);
    installDbTestRuntime(a);
  });

  /**
   * Everything this run created, in dependency order.
   *
   * Scoped to this run's organization, so a long-lived local database keeps no debris and a
   * parallel run of another suite is untouched.
   */
  async function purge(): Promise<void> {
    await a.ownerNotificationAttempt.deleteMany({ where: { organizationId: org } });
    await a.ownerNotificationIntent.deleteMany({ where: { organizationId: org } });
    await a.auditEvent.deleteMany({ where: { organizationId: org } });
    await a.taskCapability.deleteMany({ where: { organizationId: org } });
    await a.taskAssignment.deleteMany({ where: { organizationId: org } });
    await a.task.deleteMany({ where: { organizationId: org } });
    await a.recipient.deleteMany({ where: { organizationId: org } });
  }

  /**
   * Both scans are deliberately global — expiry and delivery are properties of the clock, not of a
   * tenant — so a fixture one test leaves behind is work the next test's worker legitimately does.
   * Clearing between tests is what makes an absolute count assertable at all.
   */
  beforeEach(purge);

  afterAll(async () => {
    try {
      await purge();
    } finally {
      clearDbTestRuntime();
      await Promise.all([a.$disconnect(), b.$disconnect()]);
    }
  });

  it('runs against PostgreSQL 17', async () => {
    const [{ version }] = await a.$queryRawUnsafe<{ version: string }[]>('SELECT version()');
    expect(version).toMatch(/PostgreSQL 17\./);
  });

  /** One capability whose expiry has already passed, with the rows it cannot exist without. */
  async function seedExpiredCapability(expiresAt = EXPIRED_AT): Promise<string> {
    const suffix = nextSuffix();
    const recipientId = `rcp_${suffix}`;
    const taskId = `task_${suffix}`;
    const assignmentId = `asg_${suffix}`;
    const capabilityId = `cap_${suffix}`;
    const email = `${recipientId}@example.com`;

    await a.recipient.create({
      data: {
        id: recipientId,
        organizationId: org,
        displayName: 'Alex R.',
        email,
        emailNormalized: email,
        active: true,
      },
    });
    await a.task.create({
      data: {
        id: taskId,
        organizationId: org,
        status: 'open',
        summaryPoints: [],
        reminder: {},
        retention: {},
        version: 1,
      },
    });
    await a.taskAssignment.create({
      data: {
        id: assignmentId,
        organizationId: org,
        taskId,
        recipientId,
        intendedRecipientEmail: email,
        assignedAt: new Date(expiresAt),
        assignedByOwnerId: `owner_${runId}`,
        allowedCapabilityActions: [],
        capabilityStatus: 'active',
        deliveryStatus: 'pending',
      },
    });
    await a.taskCapability.create({
      data: {
        id: capabilityId,
        organizationId: org,
        taskId,
        assignmentId,
        intendedRecipientEmail: email,
        scope: [],
        status: 'active',
        tokenHash: `hash_${suffix}`,
        issuedAt: new Date(expiresAt),
        expiresAt: new Date(expiresAt),
      },
    });
    return capabilityId;
  }

  async function factsFor(capabilityId: string) {
    const [capability, audits, intents] = await Promise.all([
      a.taskCapability.findUniqueOrThrow({ where: { id: capabilityId } }),
      a.auditEvent.count({ where: { organizationId: org, capabilityId } }),
      a.ownerNotificationIntent.count({
        where: { organizationId: org, subjectKind: 'task_capability', subjectId: capabilityId },
      }),
    ]);
    return { status: capability.status, audits, intents };
  }

  function worker(db: DbClient, overrides: Record<string, unknown> = {}) {
    return runOwnerNotificationWorker({
      openDb: async () => db,
      composeTransport: async () => undefined,
      requestId: `req_${nextSuffix()}`,
      now: NOW,
      env: envFor(true, false),
      ...overrides,
    } as Parameters<typeof runOwnerNotificationWorker>[0]);
  }

  // -------------------------------------------------------------------------------------------
  // Racing observers
  // -------------------------------------------------------------------------------------------

  describe('overlapping invocations', () => {
    it('gives two racing workers one transition, one audit event, and one intent', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const capabilityId = await seedExpiredCapability();

        const [first, second] = await Promise.all([worker(a), worker(b)]);

        const observed = first.response.expiryObserved + second.response.expiryObserved;
        expect(observed, `round ${round}`).toBe(1);
        // The loser did not fail; it looked, found the work already done, and said so.
        expect(
          first.response.expiryLostRaces + second.response.expiryLostRaces,
          `round ${round}`,
        ).toBe(1);

        expect(await factsFor(capabilityId), `round ${round}`).toEqual({
          status: 'expired',
          audits: 1,
          intents: 1,
        });
      }
    });

    it('gives a sweep racing a Recipient-triggered observation the same single set of facts', async () => {
      const { observeCapabilityExpiryForOrganization } = await import('@/lib/capability/expiry');

      for (let round = 0; round < ROUNDS; round += 1) {
        const capabilityId = await seedExpiredCapability();
        const capability = await a.taskCapability.findUniqueOrThrow({
          where: { id: capabilityId },
        });

        // The wired sweep on one connection; the lazy validation path a Recipient's click takes on
        // the other. Both converge on one transaction, which is why this is a race and not a bug.
        const [sweepResult, lazyResult] = await Promise.all([
          worker(a),
          observeCapabilityExpiryForOrganization({
            db: b,
            organizationId: org,
            capabilityId,
            taskId: capability.taskId,
            expiredAt: EXPIRED_AT,
            observedAt: NOW,
            env: envFor(true, false),
          }),
        ]);

        const winners = sweepResult.response.expiryObserved + (lazyResult.expired ? 1 : 0);
        expect(winners, `round ${round}`).toBe(1);
        expect(await factsFor(capabilityId), `round ${round}`).toEqual({
          status: 'expired',
          audits: 1,
          intents: 1,
        });
      }
    });

    it('counts lost races truthfully across a batch', async () => {
      const capabilityIds = await Promise.all(
        Array.from({ length: 6 }, () => seedExpiredCapability()),
      );

      const [first, second] = await Promise.all([worker(a), worker(b)]);

      for (const result of [first.response, second.response]) {
        // The arithmetic the field promises: everything looked at either won or lost.
        expect(result.expiryScanned).toBe(result.expiryObserved + result.expiryLostRaces);
      }
      expect(first.response.expiryObserved + second.response.expiryObserved).toBe(
        capabilityIds.length,
      );

      for (const capabilityId of capabilityIds) {
        expect(await factsFor(capabilityId)).toEqual({
          status: 'expired',
          audits: 1,
          intents: 1,
        });
      }
    });
  });

  // -------------------------------------------------------------------------------------------
  // Bounding
  // -------------------------------------------------------------------------------------------

  describe('bounded, deterministic scanning', () => {
    it('takes the oldest expiries first and leaves the rest for the next invocation', async () => {
      const ordered: string[] = [];
      for (const minute of ['11:01', '11:02', '11:03', '11:04']) {
        ordered.push(await seedExpiredCapability(`2026-08-06T${minute}:00.000Z`));
      }

      const first = await runCapabilityExpirySweep({
        db: a,
        now: NOW,
        limit: 2,
        env: envFor(true, false),
      });
      expect(first).toMatchObject({ scanned: 2, observed: 2, batchFilled: true });
      expect((await factsFor(ordered[0]!)).status).toBe('expired');
      expect((await factsFor(ordered[1]!)).status).toBe('expired');
      expect((await factsFor(ordered[2]!)).status).toBe('active');

      const second = await runCapabilityExpirySweep({
        db: a,
        now: NOW,
        limit: 2,
        env: envFor(true, false),
      });
      expect(second).toMatchObject({ scanned: 2, observed: 2 });
      expect((await factsFor(ordered[3]!)).status).toBe('expired');
    });

    it('starts no transition after the stop instant, and commits what it already did', async () => {
      const capabilityId = await seedExpiredCapability();

      const result = await runCapabilityExpirySweep({
        db: a,
        now: NOW,
        stopAtMs: Date.now() - 1,
        env: envFor(true, false),
      });

      expect(result).toMatchObject({ scanned: 0, observed: 0, deadlineStopped: true });
      expect((await factsFor(capabilityId)).status).toBe('active');
    });
  });

  // -------------------------------------------------------------------------------------------
  // The flag matrix, against a real connection
  // -------------------------------------------------------------------------------------------

  describe('flag matrix', () => {
    it('touches no database delegate at all when both flags are off', async () => {
      await seedExpiredCapability();

      // The strongest available statement of the invariant: if anything reaches for the database,
      // this throws rather than quietly succeeding.
      const refuse = async (): Promise<DbClient> => {
        throw new Error('the worker opened the database with both flags off');
      };

      const { response } = await runOwnerNotificationWorker({
        openDb: refuse,
        composeTransport: async () => {
          throw new Error('the worker composed a transport with both flags off');
        },
        requestId: `req_${nextSuffix()}`,
        now: NOW,
        env: envFor(false, false),
      });

      expect(response).toMatchObject({
        captureEnabled: false,
        deliveryEnabled: false,
        transportConfigured: false,
        expiryScanned: 0,
        scanned: 0,
      });
    });

    it('observes expiry and claims nothing when only capture is enabled', async () => {
      const capabilityId = await seedExpiredCapability();
      let composed = 0;

      const { response } = await runOwnerNotificationWorker({
        openDb: async () => a,
        composeTransport: async () => {
          composed += 1;
          return undefined;
        },
        requestId: `req_${nextSuffix()}`,
        now: NOW,
        env: envFor(true, false),
      });

      expect(composed).toBe(0);
      expect(response).toMatchObject({ expiryObserved: 1, claimed: 0, scanned: 0 });

      const intent = await a.ownerNotificationIntent.findFirstOrThrow({
        where: { organizationId: org, subjectId: capabilityId },
      });
      expect(intent.state).toBe('pending');
      expect(intent.claimSequence).toBe(0);
      expect(await a.ownerNotificationAttempt.count({ where: { intentId: intent.id } })).toBe(0);
    });

    it('performs no expiry scan when only delivery is enabled', async () => {
      const capabilityId = await seedExpiredCapability();

      const { response } = await runOwnerNotificationWorker({
        openDb: async () => a,
        composeTransport: async () => new FakeOwnerNotificationTransport(),
        requestId: `req_${nextSuffix()}`,
        now: NOW,
        env: envFor(false, true),
      });

      expect(response).toMatchObject({ captureEnabled: false, expiryScanned: 0 });
      expect(await factsFor(capabilityId)).toEqual({
        status: 'active',
        audits: 0,
        intents: 0,
      });
    });

    it('observes an expiry and delivers its intent in one invocation, fencing intact', async () => {
      const capabilityId = await seedExpiredCapability();
      const transport = new FakeOwnerNotificationTransport([
        { kind: 'accepted', providerMessageRef: `m_${runId}` },
      ]);

      const { response } = await runOwnerNotificationWorker({
        openDb: async () => a,
        composeTransport: async () => transport,
        requestId: `req_${nextSuffix()}`,
        now: NOW,
        env: envFor(true, true),
      });

      expect(response).toMatchObject({ expiryObserved: 1, claimed: 1, sent: 1 });

      const intent = await a.ownerNotificationIntent.findFirstOrThrow({
        where: { organizationId: org, subjectId: capabilityId },
      });
      expect(intent.state).toBe('sent');
      // One claim, one attempt: the intent being seconds old does not let it be claimed twice.
      expect(intent.claimSequence).toBe(1);
      expect(intent.attemptCount).toBe(1);
      const attempts = await a.ownerNotificationAttempt.findMany({
        where: { intentId: intent.id },
      });
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.outcome).toBe('sent');
    });
  });

  // -------------------------------------------------------------------------------------------
  // Phase isolation
  // -------------------------------------------------------------------------------------------

  describe('phase isolation', () => {
    it('does not start delivery when the capture phase exhausts the budget', async () => {
      const capabilityId = await seedExpiredCapability();
      let composed = 0;

      const { response } = await runOwnerNotificationWorker({
        openDb: async () => a,
        composeTransport: async () => {
          composed += 1;
          return new FakeOwnerNotificationTransport();
        },
        requestId: `req_${nextSuffix()}`,
        now: NOW,
        // A budget already spent, so the sweep's stop instant is in the past.
        startedAtMs: Date.now() - 120_000,
        env: envFor(true, true),
      });

      expect(composed).toBe(0);
      expect(response).toMatchObject({
        expiryDeadlineStopped: true,
        deadlineStopped: true,
        transportConfigured: false,
        sent: 0,
      });
      // Nothing was observed either, because the stop is checked before the first transition.
      expect((await factsFor(capabilityId)).status).toBe('active');
    });

    it('keeps observed expiry committed when the transport cannot be composed', async () => {
      const capabilityId = await seedExpiredCapability();

      const { response } = await runOwnerNotificationWorker({
        openDb: async () => a,
        // Exactly what an absent or invalid application base URL produces.
        composeTransport: async () => undefined,
        requestId: `req_${nextSuffix()}`,
        now: NOW,
        env: envFor(true, true),
      });

      expect(response).toMatchObject({
        expiryObserved: 1,
        deliveryEnabled: true,
        transportConfigured: false,
        sent: 0,
      });
      // Committed, because the phases share no transaction.
      expect(await factsFor(capabilityId)).toEqual({
        status: 'expired',
        audits: 1,
        intents: 1,
      });
    });

    it('leaves an expired capability expired when notification capture is off', async () => {
      const capabilityId = await seedExpiredCapability();

      await runOwnerNotificationWorker({
        openDb: async () => a,
        composeTransport: async () => undefined,
        requestId: `req_${nextSuffix()}`,
        now: NOW,
        env: envFor(true, false),
      });
      expect((await factsFor(capabilityId)).intents).toBe(1);

      // And a capability observed with capture off gets the transition and the audit without an
      // intent: authorization truth never depends on a notification being recordable.
      const second = await seedExpiredCapability();
      await runCapabilityExpirySweep({
        db: a,
        now: NOW,
        env: {} as NodeJS.ProcessEnv,
      });
      expect(await factsFor(second)).toEqual({ status: 'expired', audits: 1, intents: 0 });
    });
  });

  // -------------------------------------------------------------------------------------------
  // Planner evidence
  // -------------------------------------------------------------------------------------------

  describe('the expiry scan is cheap enough to leave unindexed', () => {
    /**
     * The scan is deliberately global across organizations — expiry is a property of the clock, not
     * of a tenant — so the existing `(organization_id, status, expires_at)` index cannot serve it:
     * without a predicate on the leading column PostgreSQL can neither range-scan it nor take the
     * ordering from it. The plan is therefore a sequential scan and a top-N heapsort.
     *
     * That is recorded rather than fixed. A capability row is written once per handoff, so the table
     * grows with delivery history and not with traffic, and at the volumes this product produces the
     * scan is well inside a five-minute worker's budget. Adding a partial
     * `(expires_at, id) WHERE status = 'active'` index is the obvious remedy if that stops being
     * true; A8.5e deliberately does not introduce schema work on speculation.
     *
     * This asserts the plan is *bounded and sorted*, not that it is an index scan. If the cost ever
     * becomes interesting the reason will be visible here rather than surprising.
     */
    it('produces a bounded top-N plan', async () => {
      const plan = await a.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT "id" FROM "task_capabilities"
          WHERE "status" = 'active' AND "expires_at" <= now()
          ORDER BY "expires_at", "id" LIMIT 50`,
      );
      const text = plan.map((row) => row['QUERY PLAN']).join('\n');

      expect(text, text).toContain('Limit');
      // No unbounded materialization: the sort is a top-N over the batch size.
      expect(text, text).not.toContain('Materialize');
    });
  });
});
