import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * A8.4a migration correctness over the existing eight-migration state.
 *
 * Applying from empty is the easy direction and the deploy pipeline never takes it. The real target
 * is a database that already holds A8.3b reminder rows, so the questions are whether the new
 * constraints accept the data already there, and whether the columns they govern default to values
 * that satisfy them. A CHECK that is true of an empty table and false of production is a migration
 * that passes CI and fails deployment.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(packageRoot, 'prisma', 'migrations');
const A8_4A = '20260801120000_a8_4a_worker_safety';

function migrationDirectories(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => statSync(path.join(migrationsDir, name)).isDirectory())
    .sort();
}

async function apply(client: PGlite, dir: string): Promise<void> {
  await client.exec(readFileSync(path.join(migrationsDir, dir, 'migration.sql'), 'utf8'));
}

describe('A8.4a migration over the existing A8 schema (PGlite)', () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
  });

  afterAll(async () => {
    await pglite.close();
  });

  it('applies over the prior eight migrations and accepts the rows already there', async () => {
    const dirs = migrationDirectories();
    const prior = dirs.filter((name) => name < A8_4A);
    expect(prior).toHaveLength(8);
    expect(dirs).toContain(A8_4A);

    for (const dir of prior) {
      await apply(pglite, dir);
    }

    // Representative A8.3b state: an active schedule and both shapes of attempt row the prior
    // migrations could produce — a live claim, and a terminal skip that never took one.
    await pglite.exec(`
      INSERT INTO tasks (
        id, organization_id, status, summary_points, reminder, retention, version,
        due_local_date, created_at, updated_at
      ) VALUES (
        'task_pre_a84a', 'org_pre_a84a', 'open',
        '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"x"}]'::jsonb,
        '{"paused":false}'::jsonb, '{}'::jsonb, 1,
        '2026-08-10', NOW(), NOW()
      );
      INSERT INTO task_reminder_schedules (
        id, organization_id, task_id, due_local_date, scheduling_time_zone, status, generation,
        advance_disposition, advance_occurrence_local_date, advance_occurrence_at,
        next_overdue_occurrence_local_date, next_overdue_occurrence_at,
        overdue_delivered_count, requires_owner_attention, established_at, created_at, updated_at
      ) VALUES (
        'sched_pre_a84a', 'org_pre_a84a', 'task_pre_a84a', '2026-08-10', 'Europe/London', 'active', 1,
        'scheduled', '2026-08-09', '2026-08-09T08:00:00Z',
        '2026-08-11', '2026-08-11T08:00:00Z', 0, false, NOW(), NOW(), NOW()
      );
      INSERT INTO reminder_delivery_attempts (
        id, organization_id, schedule_id, task_id, generation, occurrence_kind,
        occurrence_local_date, occurrence_at, outcome, claimed_by, claimed_at,
        attempt_count, created_at, updated_at
      ) VALUES (
        'att_pre_claimed', 'org_pre_a84a', 'sched_pre_a84a', 'task_pre_a84a', 1, 'overdue',
        '2026-08-11', '2026-08-11T08:00:00Z', 'claimed', 'old_worker', NOW(), 1, NOW(), NOW()
      );
      INSERT INTO reminder_delivery_attempts (
        id, organization_id, schedule_id, task_id, generation, occurrence_kind,
        occurrence_local_date, occurrence_at, outcome, skip_reason, completed_at,
        attempt_count, created_at, updated_at
      ) VALUES (
        'att_pre_skipped', 'org_pre_a84a', 'sched_pre_a84a', 'task_pre_a84a', 1, 'advance',
        '2026-08-09', '2026-08-09T08:00:00Z', 'skipped', 'advance_window_elapsed', NOW(), 1,
        NOW(), NOW()
      );
    `);

    // The migration itself. A CHECK that the pre-existing rows violate fails right here.
    await apply(pglite, A8_4A);

    const attempts = await pglite.query<{
      id: string;
      claim_sequence: number;
      claim_expires_at: Date | null;
      provider_call_started_at: Date | null;
      provider_accepted_at: Date | null;
    }>(`SELECT id, claim_sequence, claim_expires_at, provider_call_started_at, provider_accepted_at
        FROM reminder_delivery_attempts ORDER BY id`);

    expect(attempts.rows.map((row) => row.id)).toEqual(['att_pre_claimed', 'att_pre_skipped']);
    const [claimed, skipped] = attempts.rows;

    // A8.3b's indefinite claim is backfilled to sequence 1 — the token it would have been granted
    // had the lifecycle existed — so the fence works from its very next reclaim.
    expect(claimed.claim_sequence).toBe(1);
    // And the expiry stays null rather than being invented, which reads as "not a live lease" and
    // lets the next worker to reach the occurrence take it over at sequence 2.
    expect(claimed.claim_expires_at).toBeNull();

    // A terminal row that never took a lease keeps sequence zero, which is the truth about it.
    expect(skipped.claim_sequence).toBe(0);

    for (const row of attempts.rows) {
      expect(row.provider_call_started_at).toBeNull();
      expect(row.provider_accepted_at).toBeNull();
    }
  });

  it('enforces the new worker-safety constraints on rows written after it', async () => {
    // A lease with no owner.
    await expect(
      pglite.exec(`
        UPDATE reminder_delivery_attempts SET claim_expires_at = NOW(), claimed_by = NULL,
          claimed_at = NULL WHERE id = 'att_pre_claimed'
      `),
    ).rejects.toThrow(/lease_requires_owner/);

    // A settled occurrence still advertising a live lease.
    await expect(
      pglite.exec(`
        UPDATE reminder_delivery_attempts
        SET claimed_by = 'w', claimed_at = NOW(), claim_expires_at = NOW() + interval '5 minutes',
            claim_sequence = 1
        WHERE id = 'att_pre_skipped'
      `),
    ).rejects.toThrow(/terminal_holds_no_lease/);

    // Provider acceptance on anything but a success.
    await expect(
      pglite.exec(`
        UPDATE reminder_delivery_attempts
        SET provider_call_started_at = NOW(), provider_accepted_at = NOW(), claim_sequence = 1
        WHERE id = 'att_pre_skipped'
      `),
    ).rejects.toThrow(/acceptance_only_for_success/);

    // Acceptance without the in-flight marker that must precede it.
    await expect(
      pglite.exec(`
        UPDATE reminder_delivery_attempts SET provider_accepted_at = NOW(), claim_sequence = 1
        WHERE id = 'att_pre_claimed'
      `),
    ).rejects.toThrow(/acceptance_implies_started/);

    // An in-flight marker on a row nobody ever claimed.
    await expect(
      pglite.exec(`
        UPDATE reminder_delivery_attempts SET provider_call_started_at = NOW()
        WHERE id = 'att_pre_skipped'
      `),
    ).rejects.toThrow(/provider_start_requires_claim/);

    // A schedule that is not active holding a scan lease. All three lease columns are set, so the
    // A8.3b coherence constraint is satisfied and the A8.4a one is the constraint under test.
    await expect(
      pglite.exec(`
        UPDATE task_reminder_schedules
        SET status = 'stopped', stop_reason = 'task_completed', stopped_at = NOW(),
            next_overdue_occurrence_local_date = NULL, next_overdue_occurrence_at = NULL,
            claimed_by = 'w', claimed_at = NOW(), claim_expires_at = NOW() + interval '1 minute'
        WHERE id = 'sched_pre_a84a'
      `),
    ).rejects.toThrow(/claim_requires_active/);
  });

  it('creates the indexes the worker scan and the recovery sweep depend on', async () => {
    const indexes = await pglite.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE indexname IN ('reminder_delivery_attempts_expired_claim_idx',
                           'task_reminder_schedules_due_scan_idx')`,
    );
    expect(indexes.rows.map((row) => row.indexname).sort()).toEqual([
      'reminder_delivery_attempts_expired_claim_idx',
      'task_reminder_schedules_due_scan_idx',
    ]);
  });

  it('adds the terminal advance dispositions without disturbing the existing ones', async () => {
    const values = await pglite.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum
       JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
       WHERE pg_type.typname = 'ReminderAdvanceDisposition'
       ORDER BY enumsortorder`,
    );
    const labels = values.rows.map((row) => row.enumlabel);
    // The A8.3b values keep their positions; the A8.4a terminal outcomes are appended.
    expect(labels).toContain('scheduled');
    expect(labels).toContain('skipped_window_elapsed');
    for (const added of ['delivered', 'skipped_not_eligible', 'failed_permanent', 'ambiguous']) {
      expect(labels, `missing ${added}`).toContain(added);
    }
  });
});
