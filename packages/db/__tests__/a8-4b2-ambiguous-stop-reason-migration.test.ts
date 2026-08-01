import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * A8.4b.2 repeated-ambiguity stop-reason migration
 * (`20260802210000_a8_4b2_repeated_ambiguous_stop_reason`).
 *
 * One `ALTER TYPE ... ADD VALUE`, tested the same way A8.4b.1's was, because the two hazards are the
 * same and neither is visible in the resulting schema.
 *
 * The ordering hazard: `ALTER TYPE ... ADD VALUE` is permitted inside a transaction block, but
 * *using* the new value in that same transaction is not, and Prisma wraps each migration file in one
 * transaction. A file that added the value and then referenced it — in a CHECK, an index predicate,
 * a backfill — would apply cleanly in a harness that runs statements outside a transaction and fail
 * on a real deployment. That is a property of the file, so it is asserted on the file.
 *
 * The constraint hazard: `task_reminder_schedules_stop_reason_matches_status` governs stop reasons,
 * and if it enumerated them it would have to be dropped and rebuilt to accept a new one. It does
 * not — it constrains *presence*, not membership. Worth proving rather than remembering, and the
 * proof is a schedule stopping for the new reason over a populated table with the constraint
 * untouched.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(packageRoot, 'prisma', 'migrations');

const MIGRATION_TWELVE = '20260802210000_a8_4b2_repeated_ambiguous_stop_reason';
const NEW_VALUE = 'repeated_ambiguous_outcomes';
const STOP_CHECK = 'task_reminder_schedules_stop_reason_matches_status';

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
async function applyThroughMigrationEleven(client: PGlite): Promise<string[]> {
  const prior = migrationDirectories().filter((name) => name < MIGRATION_TWELVE);
  for (const dir of prior) {
    await apply(client, dir);
  }
  return prior;
}

async function stopReasonValues(client: PGlite): Promise<string[]> {
  const result = await client.query<{ enumlabel: string }>(
    `SELECT enumlabel FROM pg_enum
     JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
     WHERE pg_type.typname = 'ReminderScheduleStopReason'
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
 * A Task and an active schedule already stopped once for an existing reason.
 *
 * The pre-existing stopped schedule is the point: it proves the new value joins a table that
 * already holds other stop reasons, under a constraint validated against them.
 */
async function seedPreMigrationRows(client: PGlite): Promise<void> {
  await client.exec(`
    INSERT INTO tasks (
      id, organization_id, status, summary_points, reminder, retention, version,
      due_local_date, created_at, updated_at
    ) VALUES (
      'task_amb_stop', 'org_amb_stop', 'open',
      '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"x"}]'::jsonb,
      '{"paused":false}'::jsonb, '{}'::jsonb, 1,
      '2026-08-20', NOW(), NOW()
    );
    INSERT INTO task_reminder_schedules (
      id, organization_id, task_id, due_local_date, scheduling_time_zone, status, generation,
      advance_disposition, advance_occurrence_local_date, advance_occurrence_at,
      next_overdue_occurrence_local_date, next_overdue_occurrence_at,
      overdue_delivered_count, requires_owner_attention, stop_reason, stopped_at,
      established_at, created_at, updated_at
    ) VALUES (
      'sched_amb_existing', 'org_amb_stop', 'task_amb_stop', '2026-08-20', 'America/Vancouver',
      'stopped', 1, 'scheduled', '2026-08-19', '2026-08-19T16:00:00Z',
      NULL, NULL, 0, true, 'permanent_delivery_failure', NOW(), NOW(), NOW(), NOW()
    );
    INSERT INTO tasks (
      id, organization_id, status, summary_points, reminder, retention, version,
      due_local_date, created_at, updated_at
    ) VALUES (
      'task_amb_live', 'org_amb_stop', 'open',
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
      'sched_amb_live', 'org_amb_stop', 'task_amb_live', '2026-08-20', 'America/Vancouver',
      'active', 1, 'scheduled', '2026-08-19', '2026-08-19T16:00:00Z',
      '2026-08-21', '2026-08-21T16:00:00Z', 0, false, NOW(), NOW(), NOW()
    );
  `);
}

/** Stop the live schedule for the new reason. Returns the error message, or null on success. */
async function stopForNewReason(
  client: PGlite,
  options: { readonly status?: string; readonly stoppedAt?: string | null } = {},
): Promise<string | null> {
  try {
    await client.query(
      `UPDATE task_reminder_schedules
         SET status = $1::"ReminderScheduleStatus",
             stop_reason = $2::"ReminderScheduleStopReason",
             stopped_at = $3::timestamptz,
             requires_owner_attention = true,
             next_overdue_occurrence_local_date = NULL,
             next_overdue_occurrence_at = NULL
       WHERE id = 'sched_amb_live'`,
      [
        options.status ?? 'stopped',
        NEW_VALUE,
        options.stoppedAt === undefined ? '2026-08-24T16:00:00Z' : options.stoppedAt,
      ],
    );
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('A8.4b.2 repeated-ambiguity stop-reason migration: the file itself', () => {
  const sql = migrationSql(MIGRATION_TWELVE);

  it('is the last migration in the recorded sequence', () => {
    const directories = migrationDirectories();
    expect(directories).toContain(MIGRATION_TWELVE);
    expect(directories.at(-1)).toBe(MIGRATION_TWELVE);
  });

  it('adds the value idempotently', () => {
    expect(sql).toMatch(
      /ALTER TYPE "ReminderScheduleStopReason" ADD VALUE IF NOT EXISTS 'repeated_ambiguous_outcomes';/,
    );
  });

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

describe('A8.4b.2 repeated-ambiguity stop-reason migration, from empty (PGlite)', () => {
  it('adds the value exactly once and leaves every prior value in place', async () => {
    const client = new PGlite();
    try {
      const prior = await applyThroughMigrationEleven(client);
      expect(prior.length).toBeGreaterThanOrEqual(11);

      const before = await stopReasonValues(client);
      expect(before).toEqual([
        'task_completed',
        'task_dismissed',
        'due_date_removed',
        'overdue_ceiling_reached',
        'permanent_delivery_failure',
      ]);

      await apply(client, MIGRATION_TWELVE);

      const after = await stopReasonValues(client);
      // Appended, once, with every prior value unmoved and unrenamed.
      expect(after).toEqual([...before, NEW_VALUE]);
      expect(after.filter((value) => value === NEW_VALUE)).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it('is idempotent, so a re-applied migration is not a failed deployment', async () => {
    const client = new PGlite();
    try {
      await applyThroughMigrationEleven(client);
      await apply(client, MIGRATION_TWELVE);
      await apply(client, MIGRATION_TWELVE);

      const values = await stopReasonValues(client);
      expect(values.filter((value) => value === NEW_VALUE)).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it('leaves the stop-reason CHECK untouched and value-agnostic', async () => {
    const client = new PGlite();
    try {
      await applyThroughMigrationEleven(client);
      const before = await checkClause(client, STOP_CHECK);
      expect(before, `expected ${STOP_CHECK} to exist before migration twelve`).toBeDefined();

      await apply(client, MIGRATION_TWELVE);

      // Byte-identical: the migration neither drops, rebuilds, nor revalidates it.
      expect(await checkClause(client, STOP_CHECK)).toBe(before);
      // And it constrains presence rather than membership, which is why no rebuild was needed.
      expect(before).not.toContain('permanent_delivery_failure');
      expect(before).not.toContain(NEW_VALUE);
    } finally {
      await client.close();
    }
  });
});

describe('A8.4b.2 repeated-ambiguity stop reason, over migration eleven with rows (PGlite)', () => {
  it('accepts the new reason on a stopped schedule beside existing stop reasons', async () => {
    const client = new PGlite();
    try {
      await applyThroughMigrationEleven(client);
      await seedPreMigrationRows(client);
      await apply(client, MIGRATION_TWELVE);

      expect(await stopForNewReason(client)).toBeNull();

      const rows = await client.query<{
        status: string;
        stop_reason: string;
        requires_owner_attention: boolean;
      }>(
        `SELECT status, stop_reason, requires_owner_attention
           FROM task_reminder_schedules WHERE id = 'sched_amb_live'`,
      );
      expect(rows.rows[0]).toEqual({
        status: 'stopped',
        stop_reason: NEW_VALUE,
        requires_owner_attention: true,
      });

      // The pre-existing stopped schedule is untouched, so the migration rewrote nothing.
      const existing = await client.query<{ stop_reason: string }>(
        `SELECT stop_reason FROM task_reminder_schedules WHERE id = 'sched_amb_existing'`,
      );
      expect(existing.rows[0]?.stop_reason).toBe('permanent_delivery_failure');
    } finally {
      await client.close();
    }
  });

  /**
   * The invariant the new reason still owes. A stop reason is meaningful only on a stopped
   * schedule: an active schedule carrying "we could not confirm three sends" would be a row saying
   * two contradictory things about the same generation.
   */
  it('still refuses the new reason on a schedule that is not stopped', async () => {
    const client = new PGlite();
    try {
      await applyThroughMigrationEleven(client);
      await seedPreMigrationRows(client);
      await apply(client, MIGRATION_TWELVE);

      expect(await stopForNewReason(client, { status: 'active' })).toContain(STOP_CHECK);
    } finally {
      await client.close();
    }
  });

  it('still requires a stopped timestamp alongside the new reason', async () => {
    const client = new PGlite();
    try {
      await applyThroughMigrationEleven(client);
      await seedPreMigrationRows(client);
      await apply(client, MIGRATION_TWELVE);

      expect(await stopForNewReason(client, { stoppedAt: null })).toContain(STOP_CHECK);
    } finally {
      await client.close();
    }
  });

  it('applies over populated tables without rewriting anything', async () => {
    const client = new PGlite();
    try {
      await applyThroughMigrationEleven(client);
      await seedPreMigrationRows(client);

      const before = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM task_reminder_schedules`,
      );
      await apply(client, MIGRATION_TWELVE);
      const after = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM task_reminder_schedules`,
      );

      expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    } finally {
      await client.close();
    }
  });
});
