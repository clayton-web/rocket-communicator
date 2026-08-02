/**
 * A8.5a Owner notification storage on real PostgreSQL 16.
 *
 * PGlite proves shape and every constraint reachable on one connection, and
 * `a8-5a-owner-notification-intent.test.ts` does that. It cannot prove the three things here:
 *
 *  1. `prisma migrate deploy` applies the whole migration history to a genuinely empty schema.
 *     PGlite executes the same SQL, but through its own engine and never through Prisma's migration
 *     runner, so it says nothing about whether Production's command would succeed.
 *  2. Two connections inserting the same event identity at the same time produce exactly one winner.
 *     One connection makes them sequential and they always agree — the illusion the A8.3a audit's
 *     findings hid behind.
 *  3. The planner actually reaches for the partial pending index. PGlite's planner is not the one
 *     that will run the A8.5b scan.
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
 *     pnpm --filter @aicaa/db exec vitest run a8-5a-owner-notification.pg
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient, createOwnerNotificationIntent, type DbClient } from '../src/index.js';
import type { CreateOwnerNotificationIntentInput } from '../src/index.js';

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

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const org = `org_a85a_pg_${randomBytes(4).toString('hex')}`;
const occurredAt = new Date('2026-08-03T09:15:00.000Z');

/** Rounds per race. One pass of a race that fails one time in ten looks like a fix. */
const ROUNDS = 20;

function intentInput(
  overrides: Partial<CreateOwnerNotificationIntentInput> = {},
): CreateOwnerNotificationIntentInput {
  return {
    id: `onint_${randomBytes(6).toString('hex')}`,
    organizationId: org,
    eventType: 'task_completed_by_recipient',
    subjectKind: 'task',
    subjectId: 'task_pg_1',
    occurrenceKey: '4',
    occurredAt: occurredAt.toISOString(),
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

describeMaybe('A8.5a owner notification storage on PostgreSQL 16', () => {
  // Resolved in `beforeAll`, not here: `describe.skip` still evaluates this body, and a
  // Docker-free `pnpm verify` run has no URL to validate.
  let url: string;
  let db: DbClient;

  beforeAll(async () => {
    url = assertLoopback(RAW_URL!);
    db = createPrismaClient(url);
    await db.$connect();
  });

  afterAll(async () => {
    await db.ownerNotificationAttempt.deleteMany({ where: { organizationId: org } });
    await db.ownerNotificationIntent.deleteMany({ where: { organizationId: org } });
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.ownerNotificationAttempt.deleteMany({ where: { organizationId: org } });
    await db.ownerNotificationIntent.deleteMany({ where: { organizationId: org } });
  });

  it('runs against PostgreSQL 16', async () => {
    const [{ version }] = await db.$queryRawUnsafe<{ version: string }[]>('SELECT version()');
    expect(version).toMatch(/PostgreSQL 16\./);
  });

  describe('migration', () => {
    /**
     * Applies the whole history to an empty schema through Prisma's own runner, which is the command
     * Production would use. A fresh schema rather than a fresh database: it is additive, it needs no
     * privileges beyond the test role's own, and it is dropped again below whatever the outcome.
     */
    it('applies from an empty schema and creates the A8.5a objects', async () => {
      const schema = `a85a_empty_${randomBytes(4).toString('hex')}`;
      await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

      try {
        const target = new URL(url);
        target.searchParams.set('schema', schema);

        const result = spawnSync(
          'node',
          [path.join(packageRoot, 'scripts', 'run-local-prisma.mjs'), 'migrate', 'deploy'],
          {
            cwd: packageRoot,
            encoding: 'utf8',
            env: { ...process.env, AICAA_LOCAL_DATABASE_URL: target.toString() },
          },
        );

        expect(
          result.status,
          `prisma migrate deploy failed from empty:\n${result.stdout}\n${result.stderr}`,
        ).toBe(0);
        expect(result.stdout).toContain('20260803120000_a8_5a_owner_notification_intents');

        const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(
          `SELECT tablename FROM pg_tables WHERE schemaname = '${schema}'
             AND tablename LIKE 'owner_notification%' ORDER BY tablename`,
        );
        expect(tables.map((row) => row.tablename)).toEqual([
          'owner_notification_attempts',
          'owner_notification_intents',
        ]);

        const enums = await db.$queryRawUnsafe<{ typname: string }[]>(
          `SELECT t.typname FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = '${schema}' AND t.typtype = 'e'
              AND t.typname LIKE 'OwnerNotification%' ORDER BY t.typname`,
        );
        expect(enums.map((row) => row.typname)).toEqual([
          'OwnerNotificationAttemptOutcome',
          'OwnerNotificationEventType',
          'OwnerNotificationState',
          'OwnerNotificationSubjectKind',
          'OwnerNotificationSuppressionReason',
        ]);

        const labels = await db.$queryRawUnsafe<{ enumlabel: string }[]>(
          `SELECT e.enumlabel FROM pg_enum e
             JOIN pg_type t ON t.oid = e.enumtypid
             JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = '${schema}' AND t.typname = 'OwnerNotificationEventType'
            ORDER BY e.enumsortorder`,
        );
        // The stored values are the ratified dotted names (D133), not an internal spelling.
        expect(labels.map((row) => row.enumlabel)).toEqual([
          'task.completed_by_recipient',
          'task.clarification_requested',
          'task.returned_to_owner',
          'handoff.delivery_failed',
          'gmail.disconnected',
          'capability.expired',
          'reminder.schedule.stopped.ceiling_reached',
          'reminder.schedule.stopped.permanent_failure',
          'reminder.schedule.stopped.repeated_ambiguous',
          'reminder.no_active_assignment',
        ]);
      } finally {
        await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    }, 120_000);
  });

  describe('deduplication identity under contention', () => {
    it('lets exactly one of two concurrent writers claim an event occurrence', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const subjectId = `task_race_${round}`;
        const [first, second] = await Promise.allSettled([
          createOwnerNotificationIntent(db, intentInput({ subjectId })),
          createOwnerNotificationIntent(db, intentInput({ subjectId })),
        ]);

        const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
        const rejected = [first, second].filter((r) => r.status === 'rejected');
        expect(fulfilled, `round ${round} must have exactly one winner`).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
          code: 'UNIQUE_VIOLATION',
        });

        const stored = await db.ownerNotificationIntent.count({
          where: { organizationId: org, subjectId },
        });
        expect(stored, `round ${round} must store exactly one row`).toBe(1);
      }
    }, 120_000);

    it('admits a legitimate repeat at a later Task version under the same contention', async () => {
      const subjectId = 'task_race_versions';
      const results = await Promise.allSettled([
        createOwnerNotificationIntent(db, intentInput({ subjectId, occurrenceKey: '4' })),
        createOwnerNotificationIntent(db, intentInput({ subjectId, occurrenceKey: '5' })),
      ]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(
        await db.ownerNotificationIntent.count({ where: { organizationId: org, subjectId } }),
      ).toBe(2);
    });

    it('does not collide across organizations', async () => {
      await createOwnerNotificationIntent(db, intentInput({ subjectId: 'task_cross' }));
      await createOwnerNotificationIntent(
        db,
        intentInput({ subjectId: 'task_cross', organizationId: `${org}_other` }),
      );

      expect(await db.ownerNotificationIntent.count({ where: { subjectId: 'task_cross' } })).toBe(
        2,
      );

      await db.ownerNotificationIntent.deleteMany({ where: { organizationId: `${org}_other` } });
    });
  });

  describe('pending-work scan', () => {
    it('plans the claimable-work query on the partial pending index', async () => {
      const plan = await db.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT "id" FROM "owner_notification_intents"
          WHERE "state" = 'pending' ORDER BY "occurred_at", "id" LIMIT 25`,
      );
      const text = plan.map((row) => row['QUERY PLAN']).join('\n');

      expect(
        text,
        `the A8.5b scan must reach owner_notification_intents_pending_idx, not a sequential scan:\n${text}`,
      ).toContain('owner_notification_intents_pending_idx');
      expect(text).not.toContain('Seq Scan');
    });
  });

  describe('database-enforced invariants', () => {
    it('enables row level security with no policies on both tables', async () => {
      const rows = await db.$queryRawUnsafe<
        { relname: string; relrowsecurity: boolean; policies: bigint }[]
      >(
        `SELECT c.relname, c.relrowsecurity,
                (SELECT COUNT(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema()
            AND c.relname IN ('owner_notification_intents','owner_notification_attempts')
          ORDER BY c.relname`,
      );

      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.relrowsecurity, `${row.relname} must have RLS enabled`).toBe(true);
        expect(Number(row.policies), `${row.relname} must define no policy`).toBe(0);
      }
    });

    it('carries every state-coherence constraint the migration declares', async () => {
      const rows = await db.$queryRawUnsafe<{ conname: string }[]>(
        `SELECT con.conname
           FROM pg_constraint con
           JOIN pg_class c ON c.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema()
            AND con.contype = 'c'
            AND c.relname IN ('owner_notification_intents','owner_notification_attempts')
          ORDER BY con.conname`,
      );
      expect(rows.map((row) => row.conname)).toEqual([
        'owner_notification_attempts_acceptance_matches_outcome',
        'owner_notification_attempts_attempt_number_valid',
        'owner_notification_attempts_failure_code_matches_outcome',
        'owner_notification_attempts_provider_call_recorded',
        'owner_notification_intents_attempt_count_valid',
        'owner_notification_intents_claim_fields_coherent',
        'owner_notification_intents_claim_only_when_claimed',
        'owner_notification_intents_claim_sequence_valid',
        'owner_notification_intents_failure_code_matches_state',
        'owner_notification_intents_identity_present',
        'owner_notification_intents_settled_at_matches_state',
        'owner_notification_intents_suppression_reason_matches_state',
      ]);
    });

    it('refuses an incoherent row on the real engine too', async () => {
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO "owner_notification_intents"
             ("id","organization_id","event_type","subject_kind","subject_id","occurrence_key",
              "occurred_at","actor_kind","state","updated_at")
           VALUES ('onint_bad','${org}','task.completed_by_recipient','task','task_bad','1',
                   NOW(),'capability','sent',NOW())`,
        ),
      ).rejects.toThrow(/owner_notification_intents_settled_at_matches_state/);
    });

    it('holds no foreign key from an intent to a Task', async () => {
      const rows = await db.$queryRawUnsafe<{ confrelid: string }[]>(
        `SELECT confrel.relname AS confrelid
           FROM pg_constraint con
           JOIN pg_class c ON c.oid = con.conrelid
           JOIN pg_class confrel ON confrel.oid = con.confrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema()
            AND con.contype = 'f'
            AND c.relname IN ('owner_notification_intents','owner_notification_attempts')`,
      );
      // The only foreign key stays inside the notification subsystem: attempt → intent.
      expect(rows.map((row) => row.confrelid)).toEqual(['owner_notification_intents']);
    });
  });
});
