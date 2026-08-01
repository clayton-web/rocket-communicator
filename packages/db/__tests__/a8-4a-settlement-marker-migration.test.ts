import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * A8.4a settlement-marker migration correctness (`20260802094500_a8_4a_settlement_marker`).
 *
 * The remediation re-audit found this migration had no test of any kind. `a8-4a-migration-from-a8.ts`
 * stops at migration nine and asserts that it does — so the settlement column, its backfill, its
 * validated CHECK, and both partial recovery indexes shipped with no regression guard at all. They
 * were verified by hand against real PostgreSQL 16 once. This is the guard that verifies them on
 * every run.
 *
 * Two directions matter and they fail differently. Applying from empty proves the DDL is well
 * formed. Applying over migration nine with rows already in the table proves the backfill does what
 * the sweep depends on and that the validated CHECK accepts data that already exists — a constraint
 * that is true of an empty table and false of a populated one is a migration that passes CI and
 * fails deployment.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(packageRoot, 'prisma', 'migrations');

const MIGRATION_NINE = '20260801120000_a8_4a_worker_safety';
const MIGRATION_TEN = '20260802094500_a8_4a_settlement_marker';

const SETTLEMENT_CHECK = 'reminder_delivery_attempts_settlement_only_when_terminal';
const UNSETTLED_INDEX = 'reminder_delivery_attempts_unsettled_idx';
const RETRY_BUDGET_INDEX = 'reminder_delivery_attempts_retry_budget_idx';

function migrationDirectories(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => statSync(path.join(migrationsDir, name)).isDirectory())
    .sort();
}

async function apply(client: PGlite, dir: string): Promise<void> {
  await client.exec(readFileSync(path.join(migrationsDir, dir, 'migration.sql'), 'utf8'));
}

/** Applies every migration strictly before the settlement marker, in recorded order. */
async function applyThroughMigrationNine(client: PGlite): Promise<string[]> {
  const prior = migrationDirectories().filter((name) => name < MIGRATION_TEN);
  for (const dir of prior) {
    await apply(client, dir);
  }
  return prior;
}

interface ColumnFacts {
  readonly data_type: string;
  readonly is_nullable: string;
  readonly column_default: string | null;
}

async function settlementColumn(client: PGlite): Promise<ColumnFacts | undefined> {
  const result = await client.query<ColumnFacts>(
    `SELECT data_type, is_nullable, column_default FROM information_schema.columns
     WHERE table_name = 'reminder_delivery_attempts' AND column_name = 'schedule_settled_at'`,
  );
  return result.rows[0];
}

async function indexDefinition(client: PGlite, name: string): Promise<string | undefined> {
  const result = await client.query<{ indexdef: string }>(
    `SELECT indexdef FROM pg_indexes WHERE indexname = $1`,
    [name],
  );
  return result.rows[0]?.indexdef;
}

/**
 * A representative pre-migration table: one row per outcome the prior migrations could produce.
 *
 * Occurrence dates are distinct per row so the D109 identity index and the one-success-per-local-day
 * index are satisfied and the backfill is the only thing under test.
 */
async function seedPreMigrationRows(client: PGlite): Promise<void> {
  await client.exec(`
    INSERT INTO tasks (
      id, organization_id, status, summary_points, reminder, retention, version,
      due_local_date, created_at, updated_at
    ) VALUES (
      'task_marker', 'org_marker', 'open',
      '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"x"}]'::jsonb,
      '{"paused":false}'::jsonb, '{}'::jsonb, 1,
      '2026-08-20', NOW(), NOW()
    );
    INSERT INTO task_reminder_schedules (
      id, organization_id, task_id, due_local_date, scheduling_time_zone, status, generation,
      advance_disposition, advance_occurrence_local_date, advance_occurrence_at,
      next_overdue_occurrence_local_date, next_overdue_occurrence_at,
      overdue_delivered_count, requires_owner_attention, established_at, created_at, updated_at
    ) VALUES (
      'sched_marker', 'org_marker', 'task_marker', '2026-08-20', 'America/Vancouver', 'active', 1,
      'scheduled', '2026-08-19', '2026-08-19T16:00:00Z',
      '2026-08-21', '2026-08-21T16:00:00Z', 0, false, NOW(), NOW(), NOW()
    );
  `);

  // Terminal rows, one per terminal outcome. Every one carries `completed_at`, because
  // `completed_at_matches_outcome` (A8.3a) requires it of anything that is not `claimed`.
  const terminal = [
    { id: 'att_success', outcome: 'success', date: '2026-08-21', skip: null, failure: null },
    {
      id: 'att_skipped',
      outcome: 'skipped',
      date: '2026-08-22',
      skip: 'task_not_eligible',
      failure: null,
    },
    {
      id: 'att_permanent',
      outcome: 'permanent_failure',
      date: '2026-08-23',
      skip: null,
      failure: 'provider_permanent',
    },
    {
      id: 'att_ambiguous',
      outcome: 'ambiguous',
      date: '2026-08-24',
      skip: null,
      failure: 'lease_expired_in_flight',
    },
    // Not terminal in the domain's sense, but the migration settles it: a retryable failure has
    // already had whatever schedule effect it was going to have, and retry takeover clears the
    // marker again. The CHECK bars only `claimed`.
    {
      id: 'att_retryable',
      outcome: 'retryable_failure',
      date: '2026-08-25',
      skip: null,
      failure: 'provider_5xx',
    },
  ] as const;

  for (const row of terminal) {
    // Reason and failure code go in the INSERT: `skip_reason_matches_outcome` and
    // `failure_code_only_on_failure` are row-level CHECKs, so a two-step write cannot satisfy them.
    await client.query(
      `INSERT INTO reminder_delivery_attempts (
         id, organization_id, schedule_id, task_id, generation, occurrence_kind,
         occurrence_local_date, occurrence_at, outcome, skip_reason, failure_code, completed_at,
         attempt_count, created_at, updated_at
       ) VALUES ($1, 'org_marker', 'sched_marker', 'task_marker', 1, 'overdue', $2, $3, $4::"ReminderDeliveryOutcome",
         $5::"ReminderSkipReason", $6, $7, 1, NOW(), NOW())`,
      [
        row.id,
        row.date,
        `${row.date}T16:00:00Z`,
        row.outcome,
        row.skip,
        row.failure,
        `${row.date}T16:00:05Z`,
      ],
    );
  }

  // A live lease: the one shape that must come out of the migration unsettled.
  await client.exec(`
    INSERT INTO reminder_delivery_attempts (
      id, organization_id, schedule_id, task_id, generation, occurrence_kind,
      occurrence_local_date, occurrence_at, outcome, claimed_by, claimed_at, claim_expires_at,
      claim_sequence, attempt_count, created_at, updated_at
    ) VALUES (
      'att_claimed', 'org_marker', 'sched_marker', 'task_marker', 1, 'overdue',
      '2026-08-26', '2026-08-26T16:00:00Z', 'claimed', 'worker_live', NOW(),
      NOW() + interval '5 minutes', 1, 1, NOW(), NOW()
    );
  `);

  // A legacy half-written claim: A8.3b wrote an owner with no expiry, and migration nine backfilled
  // its `claim_sequence` to 1 without inventing a lease. Migration ten must not settle it either.
  await client.exec(`
    INSERT INTO reminder_delivery_attempts (
      id, organization_id, schedule_id, task_id, generation, occurrence_kind,
      occurrence_local_date, occurrence_at, outcome, claimed_by, claimed_at,
      claim_sequence, attempt_count, created_at, updated_at
    ) VALUES (
      'att_legacy', 'org_marker', 'sched_marker', 'task_marker', 1, 'advance',
      '2026-08-19', '2026-08-19T16:00:00Z', 'claimed', 'worker_gone', NOW(),
      1, 1, NOW(), NOW()
    );
  `);
}

describe('A8.4a settlement-marker migration, from empty (PGlite)', () => {
  it('applies from empty and installs the column, the validated CHECK, and both indexes', async () => {
    const pglite = new PGlite();
    try {
      const dirs = migrationDirectories();
      expect(dirs, 'the settlement marker must be in the recorded history').toContain(
        MIGRATION_TEN,
      );
      expect(
        dirs[dirs.indexOf(MIGRATION_TEN) - 1],
        'migration ten applies directly onto migration nine',
      ).toBe(MIGRATION_NINE);

      for (const dir of dirs.filter((name) => name <= MIGRATION_TEN)) {
        await apply(pglite, dir);
      }

      // Nullable and defaultless. A default would settle every future row at insert and make the
      // debt sweep permanently blind.
      const column = await settlementColumn(pglite);
      expect(column?.data_type).toBe('timestamp with time zone');
      expect(column?.is_nullable).toBe('YES');
      expect(column?.column_default).toBeNull();

      // `NOT VALID` followed by `VALIDATE CONSTRAINT` must end validated, or the constraint is
      // advisory for existing rows and the migration only looks safe.
      const constraint = await pglite.query<{ convalidated: boolean }>(
        `SELECT convalidated FROM pg_constraint WHERE conname = $1`,
        [SETTLEMENT_CHECK],
      );
      expect(constraint.rows).toHaveLength(1);
      expect(constraint.rows[0]?.convalidated, 'the CHECK must be validated, not NOT VALID').toBe(
        true,
      );

      const unsettled = await indexDefinition(pglite, UNSETTLED_INDEX);
      expect(unsettled, `${UNSETTLED_INDEX} is missing`).toBeDefined();
      // Partial on exactly the sweep predicate, so it holds only rows currently owed a settlement.
      expect(unsettled).toMatch(/WHERE/);
      expect(unsettled).toContain('schedule_settled_at IS NULL');
      expect(unsettled).toMatch(/outcome <> 'claimed'/);

      const retryBudget = await indexDefinition(pglite, RETRY_BUDGET_INDEX);
      expect(retryBudget, `${RETRY_BUDGET_INDEX} is missing`).toBeDefined();
      expect(retryBudget).toMatch(/WHERE/);
      expect(retryBudget).toContain('provider_call_started_at IS NULL');
      // A marked row belongs to the ambiguous-recovery class, so the predicate must exclude it.
      expect(retryBudget).toMatch(/claimed/);
      expect(retryBudget).toMatch(/retryable_failure/);
    } finally {
      await pglite.close();
    }
  });
});

describe('A8.4a settlement-marker migration, over migration nine with rows (PGlite)', () => {
  it('backfills terminal rows, leaves leases unsettled, and validates against what is there', async () => {
    const pglite = new PGlite();
    try {
      const prior = await applyThroughMigrationNine(pglite);
      expect(prior).toHaveLength(9);
      expect(prior.at(-1)).toBe(MIGRATION_NINE);

      await seedPreMigrationRows(pglite);

      // The column does not exist yet, so nothing seeded above could have set it.
      expect(await settlementColumn(pglite)).toBeUndefined();

      // The migration itself. A CHECK the pre-existing rows violate fails right here, and so does a
      // backfill that touches a row it must not.
      await apply(pglite, MIGRATION_TEN);

      const rows = await pglite.query<{
        id: string;
        outcome: string;
        completed_at: Date | null;
        schedule_settled_at: Date | null;
      }>(
        `SELECT id, outcome::text AS outcome, completed_at, schedule_settled_at
         FROM reminder_delivery_attempts ORDER BY id`,
      );

      const byId = new Map(rows.rows.map((row) => [row.id, row]));
      expect([...byId.keys()]).toEqual([
        'att_ambiguous',
        'att_claimed',
        'att_legacy',
        'att_permanent',
        'att_retryable',
        'att_skipped',
        'att_success',
      ]);

      // Every non-`claimed` row is settled, at its own completion instant rather than at a single
      // migration timestamp — the marker records when the effect happened, not when it was noticed.
      for (const id of [
        'att_success',
        'att_skipped',
        'att_permanent',
        'att_ambiguous',
        'att_retryable',
      ]) {
        const row = byId.get(id);
        expect(row?.schedule_settled_at, `${id} must be backfilled settled`).not.toBeNull();
        expect(
          row?.schedule_settled_at?.toISOString(),
          `${id} must be settled at its completion instant`,
        ).toBe(row?.completed_at?.toISOString());
      }

      // A lease is not a result, so neither claim shape has anything to have settled.
      expect(
        byId.get('att_claimed')?.schedule_settled_at,
        'a live lease is not settled',
      ).toBeNull();
      expect(
        byId.get('att_legacy')?.schedule_settled_at,
        'a legacy half-written claim is not settled either',
      ).toBeNull();

      const constraint = await pglite.query<{ convalidated: boolean }>(
        `SELECT convalidated FROM pg_constraint WHERE conname = $1`,
        [SETTLEMENT_CHECK],
      );
      expect(
        constraint.rows[0]?.convalidated,
        'validation must succeed against the rows already in the table',
      ).toBe(true);

      // And the CHECK governs writes made after it: settling a lease is the state the two-phase
      // design must never produce, and retry takeover depends on the database refusing it.
      await expect(
        pglite.exec(`
          UPDATE reminder_delivery_attempts SET schedule_settled_at = NOW()
          WHERE id = 'att_claimed'
        `),
      ).rejects.toThrow(/settlement_only_when_terminal/);

      // The inverse is permitted: a terminal row may be settled, and re-settling is the sweep's
      // ordinary idempotent write rather than a constraint violation.
      await pglite.exec(`
        UPDATE reminder_delivery_attempts SET schedule_settled_at = NOW() WHERE id = 'att_success'
      `);

      // Clearing the marker must stay legal, because that is exactly what retry takeover does.
      await pglite.exec(`
        UPDATE reminder_delivery_attempts SET schedule_settled_at = NULL WHERE id = 'att_retryable'
      `);
      expect(
        (
          await pglite.query<{ schedule_settled_at: Date | null }>(
            `SELECT schedule_settled_at FROM reminder_delivery_attempts WHERE id = 'att_retryable'`,
          )
        ).rows[0]?.schedule_settled_at,
      ).toBeNull();

      // Both sweeps' indexes exist on a populated table too, and the debt index is the one the
      // settlement query plans against.
      expect(await indexDefinition(pglite, UNSETTLED_INDEX)).toBeDefined();
      expect(await indexDefinition(pglite, RETRY_BUDGET_INDEX)).toBeDefined();

      // The debt query the worker runs finds the row whose marker was just cleared, and nothing the
      // backfill settled. This is the migration and the sweep agreeing on one predicate.
      const debt = await pglite.query<{ id: string }>(
        `SELECT id FROM reminder_delivery_attempts
         WHERE schedule_settled_at IS NULL AND outcome <> 'claimed' ORDER BY completed_at, id`,
      );
      expect(debt.rows.map((row) => row.id)).toEqual(['att_retryable']);
    } finally {
      await pglite.close();
    }
  });
});
