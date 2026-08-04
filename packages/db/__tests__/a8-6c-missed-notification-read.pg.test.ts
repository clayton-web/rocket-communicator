/**
 * A8.6c undelivered Owner notification read, on real PostgreSQL 16.
 *
 * `a8-6c-missed-notification-read.test.ts` proves the read's behaviour on PGlite and that is the
 * right place for it. Three things it cannot prove:
 *
 *  1. The tie-break order. `ORDER BY "id" DESC` is a text comparison, and text comparison is
 *     collation-dependent. PGlite is not the collation Production runs, so the expectation that
 *     "descending by identifier" means the same thing to the database and to the caller is an
 *     assumption until the real engine agrees with it.
 *  2. That the bound is applied by the database rather than by the mapping above it.
 *  3. Whether the query needs an index. PGlite's planner is not the one that will run this, and
 *     A8.6c ships no migration, so the claim "no index is needed" has to be measured somewhere.
 *
 * ## Running it
 *
 * Skipped unless `AICAA_PG_CONCURRENCY_URL` names a **loopback** PostgreSQL 16. Not part of
 * `pnpm verify`, which must stay Docker-free. A skipped run is not evidence.
 *
 *   pnpm db:docker:up
 *   AICAA_LOCAL_DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     node packages/db/scripts/run-local-prisma.mjs migrate deploy
 *   AICAA_PG_CONCURRENCY_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     pnpm --filter @aicaa/db exec vitest run a8-6c-missed-notification-read.pg
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPrismaClient,
  listUndeliveredOwnerNotifications,
  type DbClient,
} from '../src/index.js';

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

const org = `org_a86c_pg_${randomBytes(4).toString('hex')}`;
/** Isolated from `org` so the planner backlog cannot perturb the row assertions above it. */
const plannerOrg = `${org}_planner`;

const NOW = new Date('2026-09-01T12:00:00.000Z');
const WINDOW_START = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
const INSIDE_WINDOW = '2026-08-20T09:00:00.000Z';

describeMaybe('A8.6c undelivered Owner notification read on PostgreSQL 16', () => {
  // Resolved in `beforeAll`, not here: `describe.skip` still evaluates this body, and a
  // Docker-free `pnpm verify` run has no URL to validate.
  let db: DbClient;

  beforeAll(async () => {
    db = createPrismaClient(assertLoopback(RAW_URL!));
    await db.$connect();
  });

  afterAll(async () => {
    await db.ownerNotificationIntent.deleteMany({ where: { organizationId: org } });
    await db.ownerNotificationIntent.deleteMany({ where: { organizationId: plannerOrg } });
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.ownerNotificationIntent.deleteMany({ where: { organizationId: org } });
  });

  /**
   * One terminal intent, written through Prisma.
   *
   * The subject names no Task on purpose: what is under test here is ordering, bounding, and the
   * planner, none of which involve subject resolution, and an unresolvable subject is a state the
   * read must survive anyway.
   */
  async function seedIntent(id: string, occurredAt: string): Promise<string> {
    await db.ownerNotificationIntent.create({
      data: {
        id,
        organizationId: org,
        eventType: 'task_completed_by_recipient',
        subjectKind: 'task',
        subjectId: `task_${id}`,
        occurrenceKey: id,
        state: 'failed_permanent',
        occurredAt: new Date(occurredAt),
        settledAt: new Date(occurredAt),
        actorKind: 'capability',
        capabilityId: 'cap_ref',
      },
    });
    return id;
  }

  function read(limit = 50) {
    return listUndeliveredOwnerNotifications(db, {
      organizationId: org,
      occurredAtOrAfter: WINDOW_START,
      limit,
    });
  }

  it('runs against PostgreSQL 16', async () => {
    const [{ version }] = await db.$queryRawUnsafe<{ version: string }[]>('SELECT version()');
    expect(version).toMatch(/PostgreSQL 16\./);
  });

  /**
   * The tie-break has to mean the same thing to PostgreSQL as it does to the caller.
   *
   * The identifiers differ in the characters collations disagree about — an underscore against a
   * digit and a letter in the same position — so a database collating punctuation differently from
   * JavaScript's code-unit order would produce a different sequence here and fail. This is the
   * expectation the PGlite test encodes; the point of repeating it is that the two engines agree.
   */
  it('orders by identifier the way the caller expects, on the real collation', async () => {
    const tied = ['onint_a86c_pg_a1', 'onint_a86c_pg_a_9', 'onint_a86c_pg_ab'];
    for (const id of tied) {
      await seedIntent(id, '2026-08-28T09:00:00.000Z');
    }
    const older = await seedIntent('onint_a86c_pg_older', '2026-08-10T09:00:00.000Z');

    const ids = (await read()).map((row) => row.id);

    expect(ids).toEqual([...[...tied].sort().reverse(), older]);
    // An unchanged database returns the identical sequence, which is what makes two navigations
    // to `/attention` agree with each other.
    expect((await read()).map((row) => row.id)).toEqual(ids);
  });

  it('never returns another organization’s notification', async () => {
    await db.ownerNotificationIntent.create({
      data: {
        id: 'onint_a86c_pg_foreign',
        organizationId: `${org}_other`,
        eventType: 'task_completed_by_recipient',
        subjectKind: 'task',
        subjectId: 'task_foreign',
        occurrenceKey: 'foreign',
        state: 'failed_permanent',
        occurredAt: new Date(INSIDE_WINDOW),
        settledAt: new Date(INSIDE_WINDOW),
        actorKind: 'system',
        systemId: 'worker_1',
      },
    });
    try {
      await seedIntent('onint_a86c_pg_mine', INSIDE_WINDOW);
      expect((await read()).map((row) => row.id)).toEqual(['onint_a86c_pg_mine']);
    } finally {
      await db.ownerNotificationIntent.deleteMany({
        where: { organizationId: `${org}_other` },
      });
    }
  });

  describe('the planner', () => {
    /**
     * Enough rows that a sequential scan is no longer the cheap option, so the plan below is a
     * choice the planner made rather than one the table size forced.
     */
    const PLANNER_ROWS = 20_000;

    /** The statement the repository issues, written out so `EXPLAIN` can be pointed at it. */
    const READ_SQL = `
      SELECT "id","event_type","subject_kind","subject_id","state","suppression_reason",
             "actor_kind","occurred_at","settled_at"
        FROM "owner_notification_intents"
       WHERE "organization_id" = '${plannerOrg}'
         AND "occurred_at" >= TIMESTAMPTZ '${WINDOW_START}'
         AND "state" IN ('suppressed','failed_permanent','ambiguous','requires_owner_attention')
         AND "event_type" NOT IN ('reminder.schedule.stopped.ceiling_reached',
                                  'reminder.schedule.stopped.permanent_failure',
                                  'reminder.schedule.stopped.repeated_ambiguous')
       ORDER BY "occurred_at" DESC, "id" DESC
       LIMIT 50`;

    beforeAll(async () => {
      await db.ownerNotificationIntent.deleteMany({ where: { organizationId: plannerOrg } });
      await db.ownerNotificationIntent.createMany({
        data: Array.from({ length: PLANNER_ROWS }, (_, index) => ({
          id: `${plannerOrg}_${index}`,
          organizationId: plannerOrg,
          eventType: 'task_completed_by_recipient' as const,
          subjectKind: 'task' as const,
          subjectId: `task_plan_${index}`,
          occurrenceKey: String(index),
          // One row in twenty went undelivered, which is already far more failure than a working
          // deployment produces; the rest are delivered and must be skipped cheaply.
          state: (index % 20 === 0 ? 'failed_permanent' : 'sent') as 'failed_permanent' | 'sent',
          occurredAt: new Date(NOW.getTime() - index * 60_000),
          settledAt: new Date(NOW.getTime() - index * 60_000),
          actorKind: 'system' as const,
          systemId: 'worker_1',
        })),
      });
      await db.$executeRawUnsafe('ANALYZE "owner_notification_intents"');
    });

    afterAll(async () => {
      // Always: a backlog left behind skews the statistics the next run reads, which is how a
      // planner assertion becomes order-dependent.
      await db.ownerNotificationIntent.deleteMany({ where: { organizationId: plannerOrg } });
      await db.$executeRawUnsafe('ANALYZE "owner_notification_intents"');
    });

    /**
     * No index was added for this read, and this is the evidence for that.
     *
     * The existing `owner_notification_intents_occurred_at_idx` on `(occurred_at, id)` already
     * carries the ordering, so `LIMIT 50` stops the scan early instead of sorting the window. A
     * candidate `(organization_id, occurred_at, id)` index was built and measured during the
     * A8.6c review: it improves the populated case and the planner declines it in the steady
     * state, where everything was delivered and no index covers `state`. Sub-millisecond at a
     * hundredfold Production's row count did not justify a permanent write cost.
     */
    it('reaches the existing occurred-at index rather than scanning the table', async () => {
      const plan = await db.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN (ANALYZE, BUFFERS) ${READ_SQL}`,
      );
      const text = plan.map((row) => row['QUERY PLAN']).join('\n');

      expect(text, `A8.6c must not sequentially scan the intent table:\n${text}`).not.toContain(
        'Seq Scan',
      );
      expect(text).toContain('owner_notification_intents_occurred_at_idx');
      // The index supplies the order, so the bound stops the scan rather than discarding the
      // remainder of a sorted window.
      expect(text, `the LIMIT must not sit above a Sort:\n${text}`).not.toContain('Sort Key');
    });

    /** The bound belongs to the database. A mapping that sliced afterwards would still read it all. */
    it('applies the fifty-row bound in the statement', async () => {
      const plan = await db.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN (ANALYZE) ${READ_SQL}`,
      );
      const text = plan.map((row) => row['QUERY PLAN']).join('\n');

      expect(text).toMatch(/^Limit /);
      expect(text, `the bound must be reached, not merely declared:\n${text}`).toMatch(
        /Limit .*actual time=[^)]*rows=50/,
      );
    });
  });
});
