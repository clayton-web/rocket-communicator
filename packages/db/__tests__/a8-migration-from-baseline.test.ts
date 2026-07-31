import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * A8.3a migration correctness over a pre-A8 database.
 *
 * The production database already holds Tasks with `due_at` values that predate the Follow-up
 * Engine. D109 forbids that historical data from activating reminders, so the interesting question
 * is not only "does the migration apply" but "does applying it leave every existing Task
 * reminder-inert". This suite answers both against representative pre-A8 rows.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(packageRoot, 'prisma', 'migrations');
const a8Dir = '20260731040000_a8_reminder_persistence';

async function applyMigrationsBeforeA8(client: PGlite): Promise<string[]> {
  const dirs = readdirSync(migrationsDir)
    .filter((name) => statSync(path.join(migrationsDir, name)).isDirectory())
    .sort()
    .filter((name) => name < a8Dir);
  for (const dir of dirs) {
    await client.exec(readFileSync(path.join(migrationsDir, dir, 'migration.sql'), 'utf8'));
  }
  return dirs;
}

describe('A8.3a migration from pre-A8 schema (PGlite)', () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
  });

  afterAll(async () => {
    await pglite.close();
  });

  it('applies additively and leaves historical due dates reminder-inert (D109)', async () => {
    const applied = await applyMigrationsBeforeA8(pglite);
    expect(applied.some((d) => d.includes('a7_handoff'))).toBe(true);
    expect(applied.some((d) => d.includes('a8_reminder'))).toBe(false);

    // A pre-A8 Task carrying an instant-typed due date, exactly as production holds today.
    await pglite.exec(`
      INSERT INTO tasks (
        id, organization_id, status, summary_points, reminder, retention, version,
        due_at, created_at, updated_at
      ) VALUES (
        'task_pre_a8', 'org_pre_a8', 'open',
        '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"x"}]'::jsonb,
        '{"paused":false}'::jsonb, '{}'::jsonb, 1,
        '2026-07-01T23:59:59.999Z', NOW(), NOW()
      );
    `);

    const before = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'tasks' AND column_name = 'due_local_date'`,
    );
    expect(before.rows[0]?.n).toBe(0);

    await pglite.exec(readFileSync(path.join(migrationsDir, a8Dir, 'migration.sql'), 'utf8'));

    // The pre-existing row survives with its instant intact and no canonical local date. That null
    // is the whole safety property: no schedule can be established from it without an Owner acting.
    const task = await pglite.query<{ due_at: Date | null; due_local_date: string | null }>(
      `SELECT due_at, due_local_date FROM tasks WHERE id = 'task_pre_a8'`,
    );
    expect(task.rows[0]?.due_at).not.toBeNull();
    expect(task.rows[0]?.due_local_date).toBeNull();

    // And no schedule was conjured for it.
    const schedules = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM task_reminder_schedules`,
    );
    expect(schedules.rows[0]?.n).toBe(0);
  });

  it('creates both reminder tables with their integrity constraints', async () => {
    const tables = await pglite.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name IN ('task_reminder_schedules', 'reminder_delivery_attempts')
       ORDER BY table_name`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      'reminder_delivery_attempts',
      'task_reminder_schedules',
    ]);

    const indexes = await pglite.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename IN ('task_reminder_schedules', 'reminder_delivery_attempts')
       ORDER BY indexname`,
    );
    const names = indexes.rows.map((r) => r.indexname);
    expect(names).toContain('reminder_delivery_attempts_occurrence_identity_key');
    expect(names).toContain('reminder_delivery_attempts_one_success_per_local_day_idx');
    expect(names).toContain('task_reminder_schedules_task_id_key');
    expect(names).toContain('task_reminder_schedules_org_status_next_overdue_idx');

    const checks = await pglite.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE contype = 'c'
         AND conrelid::regclass::text IN
             ('task_reminder_schedules', 'reminder_delivery_attempts', 'tasks')
       ORDER BY conname`,
    );
    const constraints = checks.rows.map((r) => r.conname);
    expect(constraints).toContain('tasks_due_local_date_canonical');
    expect(constraints).toContain('task_reminder_schedules_overdue_delivered_count_bounded');
    expect(constraints).toContain('task_reminder_schedules_stop_reason_matches_status');
    expect(constraints).toContain('reminder_delivery_attempts_skip_reason_matches_outcome');
  });

  it('rejects a duplicate occurrence identity at the database level (D109)', async () => {
    await pglite.exec(`
      INSERT INTO task_reminder_schedules (
        id, organization_id, task_id, due_local_date, scheduling_time_zone, generation, status,
        advance_disposition, advance_occurrence_local_date, advance_occurrence_at,
        established_at, updated_at
      ) VALUES (
        'sched_baseline', 'org_pre_a8', 'task_pre_a8', '2026-07-01', 'America/Vancouver', 1,
        'active', 'skipped_window_elapsed', '2026-06-30', '2026-06-30T16:00:00Z',
        NOW(), NOW()
      );

      INSERT INTO reminder_delivery_attempts (
        id, organization_id, schedule_id, task_id, generation, occurrence_kind,
        occurrence_local_date, occurrence_at, outcome, completed_at, updated_at
      ) VALUES (
        'att_baseline_1', 'org_pre_a8', 'sched_baseline', 'task_pre_a8', 1, 'overdue',
        '2026-07-02', '2026-07-02T16:00:00Z', 'success', NOW(), NOW()
      );
    `);

    // Same schedule, generation, kind, and local day: a different row id cannot buy a second send.
    await expect(
      pglite.exec(`
        INSERT INTO reminder_delivery_attempts (
          id, organization_id, schedule_id, task_id, generation, occurrence_kind,
          occurrence_local_date, occurrence_at, outcome, completed_at, updated_at
        ) VALUES (
          'att_baseline_2', 'org_pre_a8', 'sched_baseline', 'task_pre_a8', 1, 'overdue',
          '2026-07-02', '2026-07-02T16:00:00Z', 'claimed', NULL, NOW()
        );
      `),
    ).rejects.toThrow();
  });

  it('refuses to drop a Task that still has reminder history', async () => {
    // Reminder history is preserved, never deleted (D107, D109). RESTRICT is what makes that
    // structural rather than a convention someone can forget.
    await expect(pglite.exec(`DELETE FROM tasks WHERE id = 'task_pre_a8'`)).rejects.toThrow();
  });
});
