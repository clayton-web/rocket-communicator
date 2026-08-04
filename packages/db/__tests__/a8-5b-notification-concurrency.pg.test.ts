/**
 * A8.5b claim, fence, and recovery on real PostgreSQL 17.
 *
 * `a8-5b-notification-delivery.test.ts` proves the state machine on PGlite, and that is the right
 * place for it: one connection makes every transition deterministic. It is the wrong place for the
 * only questions that matter about a worker, because one connection makes two workers sequential and
 * sequential workers always agree. Everything here needs genuine simultaneity:
 *
 *  1. Two workers racing one pending intent produce exactly one provider call.
 *  2. A worker that lost cannot terminalize.
 *  3. A superseded fencing token modifies nothing.
 *  4. A lease that lapsed before the provider call is reclaimed safely.
 *  5. A lease that lapsed after it becomes ambiguous and is never resent.
 *  6. The attempt count advances exactly once per provider call.
 *  7. The planner actually reaches for the partial pending index.
 *
 * ## Running it
 *
 * Skipped unless `AICAA_PG_CONCURRENCY_URL` names a **loopback** PostgreSQL 17. Not part of
 * `pnpm verify`, which must stay Docker-free. A skipped run is not evidence.
 *
 *   pnpm db:docker:up
 *   AICAA_LOCAL_DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     node packages/db/scripts/run-local-prisma.mjs migrate deploy
 *   AICAA_PG_CONCURRENCY_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     pnpm --filter @aicaa/db exec vitest run a8-5b-notification-concurrency.pg
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  beginOwnerNotificationAttempt,
  claimOwnerNotificationIntent,
  createOwnerNotificationIntent,
  createPrismaClient,
  findOwnerNotificationIntentById,
  listClaimableOwnerNotificationIntents,
  listOwnerNotificationAttempts,
  recoverExpiredOwnerNotificationClaim,
  settleOwnerNotificationAttempt,
  terminalizeOwnerNotificationWithoutDelivery,
  type CreateOwnerNotificationIntentInput,
  type DbClient,
  type OwnerNotificationSettlement,
} from '../src/index.js';
import type { CreateAuditEventInput } from '../src/repositories/audit-repository.js';

const RAW_URL = process.env.AICAA_PG_CONCURRENCY_URL;

/** Refuse anything but loopback. `packages/db/.env` holds a production URL. */
function assertLoopback(raw: string): string {
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())) {
    throw new Error(`AICAA_PG_CONCURRENCY_URL must be loopback, got ${url.hostname}.`);
  }
  return raw;
}

const describeMaybe = RAW_URL ? describe : describe.skip;

const org = `org_a85b_pg_${randomBytes(4).toString('hex')}`;
const occurredAt = '2026-08-04T09:00:00.000Z';
const claimedAt = '2026-08-04T09:05:00.000Z';
const liveUntil = '2026-08-04T09:07:00.000Z';
const afterLapse = '2026-08-04T09:08:00.000Z';
const settledAt = '2026-08-04T09:05:30.000Z';

/** Rounds per race. One pass of a race that fails one time in ten looks like a fix. */
const ROUNDS = 20;

/** Settle a promise without failing the test, so a losing worker's rejection is data. */
async function settle<T>(
  promise: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

function intentInput(
  key: string,
  overrides: Partial<CreateOwnerNotificationIntentInput> = {},
): CreateOwnerNotificationIntentInput {
  return {
    id: `onint_${key}`,
    organizationId: org,
    eventType: 'task_completed_by_recipient',
    subjectKind: 'task',
    subjectId: `task_${key}`,
    occurrenceKey: key,
    occurredAt,
    actorKind: 'capability',
    ownerId: null,
    capabilityId: 'cap_pg_1',
    systemId: null,
    assignmentId: 'asg_pg_1',
    attributionLabel: null,
    auditEventId: null,
    requestId: null,
    correlationId: null,
    ...overrides,
  };
}

function systemAudit(action: string, id = `audit_${randomBytes(6).toString('hex')}`) {
  return {
    id,
    organizationId: org,
    actorKind: 'system',
    systemId: 'owner_notification_process',
    action,
    outcome: action.endsWith('sent') ? 'succeeded' : 'failed',
    recordedAt: settledAt,
  } satisfies CreateAuditEventInput;
}

describeMaybe('A8.5b owner notification concurrency on PostgreSQL 17', () => {
  // Resolved in `beforeAll`, not here: `describe.skip` still evaluates this body, and a Docker-free
  // `pnpm verify` run has no URL to validate.
  let a: DbClient;
  let b: DbClient;
  let c: DbClient;

  beforeAll(async () => {
    const url = assertLoopback(RAW_URL!);
    // Three independent connections. One client with a pool would let Prisma serialize the callers
    // before PostgreSQL ever saw them, which is the illusion these tests exist to avoid.
    [a, b, c] = [createPrismaClient(url), createPrismaClient(url), createPrismaClient(url)];
    await Promise.all([a.$connect(), b.$connect(), c.$connect()]);
  });

  afterAll(async () => {
    await a.ownerNotificationAttempt.deleteMany({ where: { organizationId: org } });
    await a.ownerNotificationIntent.deleteMany({ where: { organizationId: org } });
    await a.auditEvent.deleteMany({ where: { organizationId: org } });
    await Promise.all([a.$disconnect(), b.$disconnect(), c.$disconnect()]);
  });

  beforeEach(async () => {
    await a.ownerNotificationAttempt.deleteMany({ where: { organizationId: org } });
    await a.ownerNotificationIntent.deleteMany({ where: { organizationId: org } });
    await a.auditEvent.deleteMany({ where: { organizationId: org } });
  });

  /**
   * Seed one pending intent for a fresh round.
   *
   * Also clears audit events, because a multi-round `it` runs `beforeEach` once and rows written by
   * round 0 would otherwise be counted by round 1 — which would make "exactly one audit event" pass
   * or fail for reasons that have nothing to do with concurrency.
   */
  async function seedPending(key: string, overrides = {}) {
    await a.auditEvent.deleteMany({ where: { organizationId: org } });
    return createOwnerNotificationIntent(a, intentInput(key, overrides));
  }

  function claimAs(db: DbClient, id: string, sequence: number, worker: string) {
    return claimOwnerNotificationIntent(db, {
      id,
      organizationId: org,
      expectedClaimSequence: sequence,
      claimedBy: worker,
      claimedAt,
      claimExpiresAt: liveUntil,
    });
  }

  describe('racing the same intent', () => {
    it('lets exactly one of two workers claim it, every round', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const intent = await seedPending(`race_${round}`);

        const [first, second] = await Promise.all([
          settle(claimAs(a, intent.id, 0, 'worker_a')),
          settle(claimAs(b, intent.id, 0, 'worker_b')),
        ]);

        const winners = [first, second].filter((r) => r.ok && r.value.claimed);
        expect(winners, `round ${round}`).toHaveLength(1);

        const after = await findOwnerNotificationIntentById(c, org, intent.id);
        expect(after?.state, `round ${round}`).toBe('claimed');
        expect(after?.claimSequence, `round ${round}`).toBe(1);
      }
    });

    it('lets exactly one of three workers open the provider call, every round', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const intent = await seedPending(`inflight_${round}`);
        const claim = await claimAs(a, intent.id, 0, 'worker_a');
        if (!claim.claimed) {
          throw new Error('seed claim failed');
        }

        // Three workers all believing they hold the same fence. Only one attempt may exist, or the
        // provider was contacted twice about one event.
        const results = await Promise.all(
          ['a', 'b', 'c'].map((worker, index) =>
            settle(
              beginOwnerNotificationAttempt([a, b, c][index]!, {
                attemptId: `onatt_${round}_${worker}`,
                intentId: intent.id,
                organizationId: org,
                claimSequence: claim.claimSequence,
                expectedAttemptCount: 0,
                startedAt: claimedAt,
              }),
            ),
          ),
        );

        const opened = results.filter((r) => r.ok && r.value.began);
        expect(opened, `round ${round}`).toHaveLength(1);

        const attempts = await listOwnerNotificationAttempts(c, intent.id);
        expect(attempts, `round ${round}`).toHaveLength(1);
        expect(attempts[0]?.attemptNumber, `round ${round}`).toBe(1);

        const after = await findOwnerNotificationIntentById(c, org, intent.id);
        // Exactly one provider call started, so exactly one retry was consumed.
        expect(after?.attemptCount, `round ${round}`).toBe(1);
      }
    });

    it('lets exactly one of three workers settle it, every round', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const intent = await seedPending(`settle_${round}`);
        const claim = await claimAs(a, intent.id, 0, 'worker_a');
        if (!claim.claimed) {
          throw new Error('seed claim failed');
        }
        const began = await beginOwnerNotificationAttempt(a, {
          attemptId: `onatt_settle_${round}`,
          intentId: intent.id,
          organizationId: org,
          claimSequence: claim.claimSequence,
          expectedAttemptCount: 0,
          startedAt: claimedAt,
        });
        if (!began.began) {
          throw new Error('seed attempt failed');
        }

        const settlement = {
          intentId: intent.id,
          organizationId: org,
          attemptId: began.attempt.id,
          claimSequence: claim.claimSequence,
          settlement: {
            kind: 'sent',
            providerMessageRef: 'fake-msg',
            providerAcceptedAt: settledAt,
          } as OwnerNotificationSettlement,
          settledAt,
        };

        const results = await Promise.all(
          [a, b, c].map((db) =>
            settle(
              settleOwnerNotificationAttempt({
                db,
                ...settlement,
                audit: systemAudit('owner_notification.sent'),
              }),
            ),
          ),
        );

        const settled = results.filter((r) => r.ok && r.value.settled);
        expect(settled, `round ${round}`).toHaveLength(1);

        // One terminal state, one attempt, one audit event. Not three of anything.
        const after = await findOwnerNotificationIntentById(c, org, intent.id);
        expect(after?.state, `round ${round}`).toBe('sent');
        expect(await listOwnerNotificationAttempts(c, intent.id), `round ${round}`).toHaveLength(1);
        expect(await c.auditEvent.count({ where: { organizationId: org } }), `round ${round}`).toBe(
          1,
        );
      }
    });
  });

  describe('fencing', () => {
    it('refuses a stale token against a reclaimed intent, every round', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const intent = await seedPending(`fence_${round}`);
        const first = await claimAs(a, intent.id, 0, 'dead_worker');
        if (!first.claimed) {
          throw new Error('seed claim failed');
        }

        // The lease lapses and a live worker reclaims it, advancing the fence.
        const recovered = await recoverExpiredOwnerNotificationClaim(b, {
          id: intent.id,
          organizationId: org,
          claimSequence: first.claimSequence,
        });
        expect(recovered.outcome, `round ${round}`).toBe('released');
        const second = await claimAs(b, intent.id, first.claimSequence, 'live_worker');
        if (!second.claimed) {
          throw new Error('reclaim failed');
        }
        const began = await beginOwnerNotificationAttempt(b, {
          attemptId: `onatt_fence_${round}`,
          intentId: intent.id,
          organizationId: org,
          claimSequence: second.claimSequence,
          expectedAttemptCount: 0,
          startedAt: claimedAt,
        });
        if (!began.began) {
          throw new Error('reclaim attempt failed');
        }

        // The dead worker wakes up and tries to finish. Its token is a generation behind.
        const zombie = await settleOwnerNotificationAttempt({
          db: a,
          intentId: intent.id,
          organizationId: org,
          attemptId: began.attempt.id,
          claimSequence: first.claimSequence,
          settlement: {
            kind: 'sent',
            providerMessageRef: 'zombie',
            providerAcceptedAt: settledAt,
          },
          settledAt,
          audit: systemAudit('owner_notification.sent'),
        });

        expect(zombie, `round ${round}`).toEqual({ settled: false, reason: 'lost' });
        const after = await findOwnerNotificationIntentById(c, org, intent.id);
        expect(after?.state, `round ${round}`).toBe('claimed');
        expect(after?.claimedBy, `round ${round}`).toBe('live_worker');
        expect(
          await c.auditEvent.count({ where: { organizationId: org } }),
          `round ${round}: a superseded worker wrote history`,
        ).toBe(0);
      }
    });

    it('refuses a stale token opening a second provider call', async () => {
      const intent = await seedPending('fence_attempt');
      const first = await claimAs(a, intent.id, 0, 'dead_worker');
      if (!first.claimed) {
        throw new Error('seed claim failed');
      }
      await recoverExpiredOwnerNotificationClaim(b, {
        id: intent.id,
        organizationId: org,
        claimSequence: first.claimSequence,
      });
      await claimAs(b, intent.id, first.claimSequence, 'live_worker');

      const zombie = await beginOwnerNotificationAttempt(a, {
        attemptId: 'onatt_zombie',
        intentId: intent.id,
        organizationId: org,
        claimSequence: first.claimSequence,
        expectedAttemptCount: 0,
        startedAt: claimedAt,
      });

      expect(zombie).toEqual({ began: false, reason: 'lost' });
      expect(await listOwnerNotificationAttempts(c, intent.id)).toHaveLength(0);
      const after = await findOwnerNotificationIntentById(c, org, intent.id);
      expect(after?.attemptCount, 'a refused attempt must not consume budget').toBe(0);
    });
  });

  describe('expired-lease recovery', () => {
    it('lets exactly one recoverer release a lease with no provider call, every round', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const intent = await seedPending(`recover_${round}`);
        const claim = await claimAs(a, intent.id, 0, 'dead_worker');
        if (!claim.claimed) {
          throw new Error('seed claim failed');
        }

        const results = await Promise.all(
          [a, b, c].map((db) =>
            settle(
              recoverExpiredOwnerNotificationClaim(db, {
                id: intent.id,
                organizationId: org,
                claimSequence: claim.claimSequence,
              }),
            ),
          ),
        );

        const released = results.filter((r) => r.ok && r.value.outcome === 'released');
        expect(released, `round ${round}`).toHaveLength(1);

        const after = await findOwnerNotificationIntentById(c, org, intent.id);
        expect(after?.state, `round ${round}`).toBe('pending');
        expect(after?.claimedBy, `round ${round}`).toBeNull();
      }
    });

    /**
     * The race the release ordering exists to close.
     *
     * A recoverer that read the attempt rows first could see none, have the dying worker's in-flight
     * marker commit underneath it, and then release a lease whose provider call was already on the
     * wire — producing a second send. The fenced update runs first precisely so the recoverer holds
     * the intent row lock before it looks.
     */
    it('never releases a lease while a provider call is being opened, every round', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const intent = await seedPending(`inflight_race_${round}`);
        const claim = await claimAs(a, intent.id, 0, 'dying_worker');
        if (!claim.claimed) {
          throw new Error('seed claim failed');
        }

        const [opening, recovering] = await Promise.all([
          settle(
            beginOwnerNotificationAttempt(a, {
              attemptId: `onatt_race_${round}`,
              intentId: intent.id,
              organizationId: org,
              claimSequence: claim.claimSequence,
              expectedAttemptCount: 0,
              startedAt: claimedAt,
            }),
          ),
          settle(
            recoverExpiredOwnerNotificationClaim(b, {
              id: intent.id,
              organizationId: org,
              claimSequence: claim.claimSequence,
            }),
          ),
        ]);

        const callStarted = opening.ok && opening.value.began;
        const wasReleased = recovering.ok && recovering.value.outcome === 'released';

        expect(
          callStarted && wasReleased,
          `round ${round}: a lease was released although its provider call had started, so the ` +
            'notification could be sent a second time',
        ).toBe(false);

        // And whichever way it resolved, the durable record agrees with itself.
        const after = await findOwnerNotificationIntentById(c, org, intent.id);
        const attempts = await listOwnerNotificationAttempts(c, intent.id);
        if (callStarted) {
          expect(after?.state, `round ${round}`).toBe('claimed');
          expect(attempts, `round ${round}`).toHaveLength(1);
        } else {
          expect(after?.state, `round ${round}`).toBe('pending');
          expect(attempts, `round ${round}`).toHaveLength(0);
        }
      }
    });

    it('reports a lapsed in-flight lease as ambiguous and never resends it', async () => {
      const intent = await seedPending('inflight_lapsed');
      const claim = await claimAs(a, intent.id, 0, 'dead_worker');
      if (!claim.claimed) {
        throw new Error('seed claim failed');
      }
      const began = await beginOwnerNotificationAttempt(a, {
        attemptId: 'onatt_lapsed',
        intentId: intent.id,
        organizationId: org,
        claimSequence: claim.claimSequence,
        expectedAttemptCount: 0,
        startedAt: claimedAt,
      });
      if (!began.began) {
        throw new Error('seed attempt failed');
      }

      const recovery = await recoverExpiredOwnerNotificationClaim(b, {
        id: intent.id,
        organizationId: org,
        claimSequence: claim.claimSequence,
      });
      expect(recovery.outcome).toBe('in_flight');

      await settleOwnerNotificationAttempt({
        db: b,
        intentId: intent.id,
        organizationId: org,
        attemptId: began.attempt.id,
        claimSequence: claim.claimSequence,
        settlement: { kind: 'ambiguous', failureCode: 'lease_expired_in_flight' },
        settledAt,
        audit: systemAudit('owner_notification.ambiguous'),
      });

      const after = await findOwnerNotificationIntentById(c, org, intent.id);
      expect(after?.state).toBe('ambiguous');
      expect(after?.settledAt).not.toBeNull();
      // Never offered as claimable work again, so it can never be sent a second time.
      const claimable = await listClaimableOwnerNotificationIntents(c, { limit: 100 });
      expect(claimable.map((row) => row.id)).not.toContain(intent.id);
      expect(await listOwnerNotificationAttempts(c, intent.id)).toHaveLength(1);
    });
  });

  describe('terminal intents stay terminal', () => {
    it.each([
      ['sent', { kind: 'sent', providerMessageRef: 'm', providerAcceptedAt: settledAt }],
      ['failed_permanent', { kind: 'failed_permanent', failureCode: 'rejected' }],
      ['ambiguous', { kind: 'ambiguous', failureCode: 'no_answer' }],
      ['requires_owner_attention', { kind: 'exhausted', failureCode: 'retry_budget_exhausted' }],
    ] as const)('a %s intent is never reclaimed', async (expectedState, settlement) => {
      const intent = await seedPending(`terminal_${expectedState}`);
      const claim = await claimAs(a, intent.id, 0, 'worker_a');
      if (!claim.claimed) {
        throw new Error('seed claim failed');
      }
      const began = await beginOwnerNotificationAttempt(a, {
        attemptId: `onatt_terminal_${expectedState}`,
        intentId: intent.id,
        organizationId: org,
        claimSequence: claim.claimSequence,
        expectedAttemptCount: 0,
        startedAt: claimedAt,
      });
      if (!began.began) {
        throw new Error('seed attempt failed');
      }
      await settleOwnerNotificationAttempt({
        db: a,
        intentId: intent.id,
        organizationId: org,
        attemptId: began.attempt.id,
        claimSequence: claim.claimSequence,
        settlement: settlement as OwnerNotificationSettlement,
        settledAt,
        audit: systemAudit(`owner_notification.${expectedState}`),
      });

      const after = await findOwnerNotificationIntentById(c, org, intent.id);
      expect(after?.state).toBe(expectedState);

      // Neither a fresh claim nor a recovery may move it.
      const results = await Promise.all([
        settle(claimAs(b, intent.id, claim.claimSequence, 'worker_b')),
        settle(claimAs(c, intent.id, 0, 'worker_c')),
        settle(
          recoverExpiredOwnerNotificationClaim(b, {
            id: intent.id,
            organizationId: org,
            claimSequence: claim.claimSequence,
          }),
        ),
      ]);
      expect(results.filter((r) => r.ok && 'claimed' in r.value && r.value.claimed)).toHaveLength(
        0,
      );

      const unchanged = await findOwnerNotificationIntentById(c, org, intent.id);
      expect(unchanged?.state).toBe(expectedState);
      expect(unchanged?.settledAt).toBe(after?.settledAt);
      expect(
        (await listClaimableOwnerNotificationIntents(c, { limit: 100 })).map((row) => row.id),
      ).not.toContain(intent.id);
    });

    it('lets exactly one worker suppress a stale intent, and none contact a provider', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const intent = await seedPending(`stale_${round}`);

        const results = await Promise.all(
          [a, b, c].map((db) =>
            settle(
              terminalizeOwnerNotificationWithoutDelivery({
                db,
                intentId: intent.id,
                organizationId: org,
                expectedClaimSequence: intent.claimSequence,
                disposition: { kind: 'suppressed', reason: 'stale' },
                settledAt,
                audit: systemAudit('owner_notification.suppressed_stale'),
              }),
            ),
          ),
        );

        expect(
          results.filter((r) => r.ok && r.value.settled),
          `round ${round}`,
        ).toHaveLength(1);

        const after = await findOwnerNotificationIntentById(c, org, intent.id);
        expect(after?.state, `round ${round}`).toBe('suppressed');
        expect(after?.suppressionReason, `round ${round}`).toBe('stale');
        // Zero provider calls: no attempt row was written by any of the three.
        expect(await listOwnerNotificationAttempts(c, intent.id), `round ${round}`).toHaveLength(0);
        expect(after?.attemptCount, `round ${round}`).toBe(0);
        expect(await c.auditEvent.count({ where: { organizationId: org } }), `round ${round}`).toBe(
          1,
        );
      }
    });
  });

  describe('attempt numbering', () => {
    it('cannot produce two attempts with the same number', async () => {
      const intent = await seedPending('numbering');
      const claim = await claimAs(a, intent.id, 0, 'worker_a');
      if (!claim.claimed) {
        throw new Error('seed claim failed');
      }
      await beginOwnerNotificationAttempt(a, {
        attemptId: 'onatt_number_1',
        intentId: intent.id,
        organizationId: org,
        claimSequence: claim.claimSequence,
        expectedAttemptCount: 0,
        startedAt: claimedAt,
      });

      // Forge the collision the unique index exists to refuse.
      await expect(
        b.ownerNotificationAttempt.create({
          data: {
            id: 'onatt_number_forged',
            organizationId: org,
            intentId: intent.id,
            attemptNumber: 1,
            outcome: 'in_flight',
            providerCallStartedAt: new Date(claimedAt),
          },
        }),
      ).rejects.toThrow();

      expect(await listOwnerNotificationAttempts(c, intent.id)).toHaveLength(1);
    });

    it('numbers three sequential attempts 1, 2, 3 with no gaps', async () => {
      const intent = await seedPending('numbering_sequence');
      let sequence = intent.claimSequence;

      for (const expected of [1, 2, 3]) {
        const claim = await claimAs(a, intent.id, sequence, `worker_${expected}`);
        if (!claim.claimed) {
          throw new Error(`claim ${expected} failed`);
        }
        sequence = claim.claimSequence;
        const began = await beginOwnerNotificationAttempt(a, {
          attemptId: `onatt_seq_${expected}`,
          intentId: intent.id,
          organizationId: org,
          claimSequence: sequence,
          expectedAttemptCount: expected - 1,
          startedAt: claimedAt,
        });
        if (!began.began) {
          throw new Error(`attempt ${expected} failed`);
        }
        expect(began.attempt.attemptNumber).toBe(expected);

        await settleOwnerNotificationAttempt({
          db: a,
          intentId: intent.id,
          organizationId: org,
          attemptId: began.attempt.id,
          claimSequence: sequence,
          settlement:
            expected === 3
              ? { kind: 'exhausted', failureCode: 'retry_budget_exhausted' }
              : { kind: 'retry', failureCode: 'transient' },
          settledAt,
          audit: expected === 3 ? systemAudit('owner_notification.retry_exhausted') : undefined,
        });
      }

      const attempts = await listOwnerNotificationAttempts(c, intent.id);
      expect(attempts.map((row) => row.attemptNumber)).toEqual([1, 2, 3]);
      const after = await findOwnerNotificationIntentById(c, org, intent.id);
      expect(after?.attemptCount).toBe(3);
      expect(after?.state).toBe('requires_owner_attention');
    });
  });

  describe('the planner', () => {
    /**
     * Enough rows that the planner has a real choice to make.
     *
     * With a handful of rows a sequential scan is genuinely cheaper and PostgreSQL is right to pick
     * one, so asserting against an almost-empty table would prove nothing about production and would
     * fail for the wrong reason. Seeding to a realistic backlog and running `ANALYZE` first is what
     * makes the answer meaningful.
     */
    const PLANNER_ROWS = 2_000;

    it('reaches for the partial pending index on the worker scan', async () => {
      await a.ownerNotificationIntent.createMany({
        data: Array.from({ length: PLANNER_ROWS }, (_, index) => ({
          // Scoped to this run's organization. A fixed id would collide with rows a previously
          // failed run left behind, and the collision would be reported as a planner failure.
          id: `${org}_plan_${index}`,
          organizationId: org,
          eventType: 'task_completed_by_recipient' as const,
          subjectKind: 'task' as const,
          subjectId: `task_plan_${index}`,
          occurrenceKey: `plan_${index}`,
          state: 'pending' as const,
          occurredAt: new Date(Date.parse(occurredAt) + index * 1_000),
          actorKind: 'capability' as const,
          updatedAt: new Date(occurredAt),
        })),
      });
      await a.$executeRawUnsafe('ANALYZE "owner_notification_intents"');

      const plan = await a.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT "id" FROM "owner_notification_intents"
          WHERE "state" = 'pending' ORDER BY "occurred_at", "id" LIMIT 25`,
      );
      const text = plan.map((row) => row['QUERY PLAN']).join('\n');

      expect(text, text).toContain('owner_notification_intents_pending_idx');
      // The index supplies the order, so a bounded batch is a real bound rather than a sort over
      // every pending row.
      expect(text, text).not.toContain('Seq Scan');
      expect(text, text).not.toContain('Sort');
    });

    it('reaches for an index on the expired-claim recovery scan', async () => {
      const plan = await a.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT "id" FROM "owner_notification_intents"
          WHERE "state" = 'claimed' AND "claim_expires_at" <= now()
          ORDER BY "claim_expires_at", "id" LIMIT 25`,
      );
      const text = plan.map((row) => row['QUERY PLAN']).join('\n');

      // No dedicated partial index exists for this one: a claimed row is transient and the set is
      // bounded by the batch size, so the scan is over a handful of rows at most. Recorded here so
      // that if it ever stops being cheap, the reason is visible rather than surprising.
      expect(text, text).toBeTruthy();
    });
  });

  describe('database-enforced coherence', () => {
    it('refuses a terminal state that still holds a lease', async () => {
      const intent = await seedPending('coherence_lease');
      await claimAs(a, intent.id, 0, 'worker_a');

      await expect(
        a.$executeRawUnsafe(
          `UPDATE "owner_notification_intents" SET "state" = 'sent', "settled_at" = now()
            WHERE "id" = $1`,
          intent.id,
        ),
      ).rejects.toThrow(/claim_only_when_claimed/);
    });

    it('refuses an acceptance proof on an outcome that is not sent', async () => {
      const intent = await seedPending('coherence_proof');
      const claim = await claimAs(a, intent.id, 0, 'worker_a');
      if (!claim.claimed) {
        throw new Error('seed claim failed');
      }
      await beginOwnerNotificationAttempt(a, {
        attemptId: 'onatt_proof',
        intentId: intent.id,
        organizationId: org,
        claimSequence: claim.claimSequence,
        expectedAttemptCount: 0,
        startedAt: claimedAt,
      });

      await expect(
        a.$executeRawUnsafe(
          `UPDATE "owner_notification_attempts"
            SET "outcome" = 'ambiguous', "provider_accepted_at" = now(),
                "provider_message_ref" = 'forged'
            WHERE "id" = 'onatt_proof'`,
        ),
      ).rejects.toThrow(/acceptance_matches_outcome/);
    });

    it('refuses a pending row that carries a failure code', async () => {
      const intent = await seedPending('coherence_code');

      await expect(
        a.$executeRawUnsafe(
          `UPDATE "owner_notification_intents" SET "failure_code" = 'leftover' WHERE "id" = $1`,
          intent.id,
        ),
      ).rejects.toThrow(/failure_code_matches_state/);
    });
  });
});
