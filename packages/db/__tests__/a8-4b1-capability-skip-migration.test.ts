import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * A8.4b.1 capability skip-reason migration (`20260802173000_a8_4b1_capability_skip_reason`).
 *
 * One `ALTER TYPE ... ADD VALUE`, which is exactly the kind of migration that looks too small to test
 * and has two specific ways to be wrong.
 *
 * The first is ordering. PostgreSQL permits `ALTER TYPE ... ADD VALUE` inside a transaction block but
 * restricts *using* the new value in that same transaction, so keeping enum introduction separate from
 * anything that consumes it avoids enum-visibility and deployment-order hazards. A file that added the
 * value and then referenced it — in an index predicate, a CHECK, or a backfill — can apply cleanly from
 * empty in a test harness that runs statements outside a transaction and still fail on a real
 * deployment. So this asserts the file contains that one statement and nothing else, which is a
 * property of the file rather than of the resulting schema.
 *
 * The second is the CHECK. `reminder_delivery_attempts_skip_reason_matches_outcome` constrains skip
 * reasons, and a constraint that enumerated values would have to be dropped and rebuilt to accept a
 * new one. It does not enumerate them, and that is worth proving rather than remembering: the proof is
 * that a row carrying the new value inserts successfully, over a populated table, without the
 * migration having touched the constraint.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(packageRoot, 'prisma', 'migrations');

const MIGRATION_ELEVEN = '20260802173000_a8_4b1_capability_skip_reason';
const NEW_VALUE = 'no_actionable_capability';
const SKIP_CHECK = 'reminder_delivery_attempts_skip_reason_matches_outcome';

function migrationDirectories(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => statSync(path.join(migrationsDir, name)).isDirectory())
    .sort();
}

function migrationSql(dir: string): string {
  return readFileSync(path.join(migrationsDir, dir, 'migration.sql'), 'utf8');
}

async function apply(client: PGlite, dir: string): Promise<void> {
  await client.exec(migrationSql(dir));
}

/** Every migration strictly before this one, in recorded order. */
async function applyThroughMigrationTen(client: PGlite): Promise<string[]> {
  const prior = migrationDirectories().filter((name) => name < MIGRATION_ELEVEN);
  for (const dir of prior) {
    await apply(client, dir);
  }
  return prior;
}

async function skipReasonValues(client: PGlite): Promise<string[]> {
  const result = await client.query<{ enumlabel: string }>(
    `SELECT enumlabel FROM pg_enum
     JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
     WHERE pg_type.typname = 'ReminderSkipReason'
     ORDER BY pg_enum.enumsortorder`,
  );
  return result.rows.map((row) => row.enumlabel);
}

async function checkClause(client: PGlite, name: string): Promise<string | undefined> {
  const result = await client.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = $1`,
    [name],
  );
  return result.rows[0]?.definition;
}

/**
 * A Task, a schedule, and one existing skipped occurrence.
 *
 * The pre-existing skipped row is the point: it proves the new value joins a table that already
 * contains other skip reasons, under a constraint that was validated against them.
 */
async function seedPreMigrationRows(client: PGlite): Promise<void> {
  await client.exec(`
    INSERT INTO tasks (
      id, organization_id, status, summary_points, reminder, retention, version,
      due_local_date, created_at, updated_at
    ) VALUES (
      'task_cap_skip', 'org_cap_skip', 'open',
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
      'sched_cap_skip', 'org_cap_skip', 'task_cap_skip', '2026-08-20', 'America/Vancouver',
      'active', 1, 'scheduled', '2026-08-19', '2026-08-19T16:00:00Z',
      '2026-08-21', '2026-08-21T16:00:00Z', 0, false, NOW(), NOW(), NOW()
    );
    INSERT INTO reminder_delivery_attempts (
      id, organization_id, schedule_id, task_id, generation, occurrence_kind,
      occurrence_local_date, occurrence_at, outcome, skip_reason, completed_at,
      attempt_count, created_at, updated_at
    ) VALUES (
      'att_existing_skip', 'org_cap_skip', 'sched_cap_skip', 'task_cap_skip', 1, 'overdue',
      '2026-08-21', '2026-08-21T16:00:00Z', 'skipped', 'task_not_eligible',
      '2026-08-21T16:00:05Z', 1, NOW(), NOW()
    );
  `);
}

/** Insert one occurrence carrying the new reason. Returns the error message, or null on success. */
async function insertCapabilitySkip(
  client: PGlite,
  options: { readonly id: string; readonly date: string; readonly outcome?: string },
): Promise<string | null> {
  try {
    await client.query(
      `INSERT INTO reminder_delivery_attempts (
         id, organization_id, schedule_id, task_id, generation, occurrence_kind,
         occurrence_local_date, occurrence_at, outcome, skip_reason, completed_at,
         attempt_count, created_at, updated_at
       ) VALUES ($1, 'org_cap_skip', 'sched_cap_skip', 'task_cap_skip', 1, 'overdue', $2, $3,
         $4::"ReminderDeliveryOutcome", $5::"ReminderSkipReason", $6, 1, NOW(), NOW())`,
      [
        options.id,
        options.date,
        `${options.date}T16:00:00Z`,
        options.outcome ?? 'skipped',
        NEW_VALUE,
        `${options.date}T16:00:05Z`,
      ],
    );
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('A8.4b.1 capability skip-reason migration: the file itself', () => {
  const sql = migrationSql(MIGRATION_ELEVEN);

  it('exists in the recorded migration sequence, after the settlement marker', () => {
    const directories = migrationDirectories();
    expect(directories).toContain(MIGRATION_ELEVEN);
    // Eleventh, not last: A8.4b.2 added a twelfth. What matters is its position relative to what
    // came before it, since that is what `applyThroughMigrationTen` reconstructs.
    expect(directories.indexOf(MIGRATION_ELEVEN)).toBe(10);
  });

  it('adds the value idempotently', () => {
    expect(sql).toMatch(
      /ALTER TYPE "ReminderSkipReason" ADD VALUE IF NOT EXISTS 'no_actionable_capability';/,
    );
  });

  /**
   * The ordering hazard, checked on the file rather than on the outcome.
   *
   * PostgreSQL rejects a *use* of a freshly added enum value in the same transaction that added it, so
   * a second statement referencing the value is a deployment-order hazard that no from-empty schema
   * assertion would catch. Keeping the file to the enum alteration alone removes the hazard entirely.
   */
  it('contains exactly one statement and never uses the value it adds', () => {
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^ALTER TYPE/);

    const executable = statements[0];
    for (const forbidden of [/CREATE\s+INDEX/i, /ALTER\s+TABLE/i, /UPDATE/i, /CHECK/i]) {
      expect(executable.match(forbidden)?.[0] ?? null).toBe(null);
    }
    // The value appears once: in the ADD VALUE itself and nowhere else.
    expect((executable.match(new RegExp(NEW_VALUE, 'g')) ?? []).length).toBe(1);
  });
});

describe('A8.4b.1 capability skip-reason migration, from empty (PGlite)', () => {
  it('adds the value and leaves every prior value in place', async () => {
    const client = new PGlite();
    try {
      const prior = await applyThroughMigrationTen(client);
      expect(prior.length).toBeGreaterThanOrEqual(10);

      const before = await skipReasonValues(client);
      expect(before).not.toContain(NEW_VALUE);

      await apply(client, MIGRATION_ELEVEN);

      const after = await skipReasonValues(client);
      expect(after).toContain(NEW_VALUE);
      // Additive: every value that existed still exists, in the same relative order.
      expect(after.filter((value) => before.includes(value))).toEqual(before);
      expect(after).toEqual([...before, NEW_VALUE]);
    } finally {
      await client.close();
    }
  });

  it('is idempotent, so a re-applied migration is not a failed deployment', async () => {
    const client = new PGlite();
    try {
      await applyThroughMigrationTen(client);
      await apply(client, MIGRATION_ELEVEN);
      await apply(client, MIGRATION_ELEVEN);
      expect(await skipReasonValues(client)).toContain(NEW_VALUE);
    } finally {
      await client.close();
    }
  });

  it('leaves the skip-reason CHECK untouched and value-agnostic', async () => {
    const client = new PGlite();
    try {
      await applyThroughMigrationTen(client);
      const before = await checkClause(client, SKIP_CHECK);
      expect(before, `expected ${SKIP_CHECK} to exist before migration eleven`).toBeDefined();

      await apply(client, MIGRATION_ELEVEN);

      // Byte-identical: the migration neither drops, rebuilds, nor revalidates it.
      expect(await checkClause(client, SKIP_CHECK)).toBe(before);
      // And it constrains presence rather than membership, which is why no rebuild was needed.
      expect(before).not.toContain('task_not_eligible');
      expect(before).not.toContain(NEW_VALUE);
    } finally {
      await client.close();
    }
  });
});

describe('A8.4b.1 capability skip-reason migration, over migration ten with rows (PGlite)', () => {
  it('accepts the new reason on a skipped occurrence beside existing skip reasons', async () => {
    const client = new PGlite();
    try {
      await applyThroughMigrationTen(client);
      await seedPreMigrationRows(client);
      await apply(client, MIGRATION_ELEVEN);

      expect(
        await insertCapabilitySkip(client, { id: 'att_cap_skip', date: '2026-08-22' }),
      ).toBeNull();

      const rows = await client.query<{ skip_reason: string; outcome: string }>(
        `SELECT skip_reason, outcome FROM reminder_delivery_attempts WHERE id = 'att_cap_skip'`,
      );
      expect(rows.rows[0]).toEqual({ skip_reason: NEW_VALUE, outcome: 'skipped' });

      // The pre-existing row is untouched, so the migration rewrote nothing.
      const existing = await client.query<{ skip_reason: string }>(
        `SELECT skip_reason FROM reminder_delivery_attempts WHERE id = 'att_existing_skip'`,
      );
      expect(existing.rows[0]?.skip_reason).toBe('task_not_eligible');
    } finally {
      await client.close();
    }
  });

  /**
   * The constraint the new value must still obey. A skip reason is only meaningful on a `skipped`
   * outcome, and D130's reason is no exception — a capability verdict attached to a success would be
   * a row asserting two contradictory things about the same occurrence.
   */
  it('still refuses the new reason on a non-skipped outcome', async () => {
    const client = new PGlite();
    try {
      await applyThroughMigrationTen(client);
      await seedPreMigrationRows(client);
      await apply(client, MIGRATION_ELEVEN);

      const message = await insertCapabilitySkip(client, {
        id: 'att_cap_skip_bad',
        date: '2026-08-23',
        outcome: 'success',
      });
      expect(message).toContain(SKIP_CHECK);
    } finally {
      await client.close();
    }
  });

  it('still refuses a skipped outcome carrying no reason at all', async () => {
    const client = new PGlite();
    try {
      await applyThroughMigrationTen(client);
      await seedPreMigrationRows(client);
      await apply(client, MIGRATION_ELEVEN);

      let message: string | null = null;
      try {
        await client.exec(`
          INSERT INTO reminder_delivery_attempts (
            id, organization_id, schedule_id, task_id, generation, occurrence_kind,
            occurrence_local_date, occurrence_at, outcome, completed_at,
            attempt_count, created_at, updated_at
          ) VALUES (
            'att_no_reason', 'org_cap_skip', 'sched_cap_skip', 'task_cap_skip', 1, 'overdue',
            '2026-08-24', '2026-08-24T16:00:00Z', 'skipped', '2026-08-24T16:00:05Z', 1, NOW(), NOW()
          );
        `);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain(SKIP_CHECK);
    } finally {
      await client.close();
    }
  });

  it('applies over a populated table without rewriting or revalidating anything else', async () => {
    const client = new PGlite();
    try {
      await applyThroughMigrationTen(client);
      await seedPreMigrationRows(client);

      const before = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM reminder_delivery_attempts`,
      );
      await apply(client, MIGRATION_ELEVEN);
      const after = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM reminder_delivery_attempts`,
      );

      expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    } finally {
      await client.close();
    }
  });
});
