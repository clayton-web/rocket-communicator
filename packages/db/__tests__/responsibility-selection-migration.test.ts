/**
 * Structural guards for the D168 responsibility-selection evidence migration.
 *
 * Source/SQL asserts plus a live PGlite run from the pre-migration baseline. Proves the authorized
 * shape, additivity, deny-by-default RLS, that no responsibility/assignee/custody column appears on
 * `tasks`, that no Owner TaskAssignment is fabricated, and that existing accepted proposals are left
 * byte-identical with zero selection rows.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testDir, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const migrationsDir = path.join(packageRoot, 'prisma', 'migrations');
const migrationDir = '20260811190000_responsibility_selection_evidence';
const migrationPath = path.join(migrationsDir, migrationDir, 'migration.sql');

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

async function applyMigrationsBefore(client: PGlite, beforeDir: string): Promise<string[]> {
  const dirs = readdirSync(migrationsDir)
    .filter((name) => statSync(path.join(migrationsDir, name)).isDirectory())
    .sort()
    .filter((name) => name < beforeDir);
  for (const dir of dirs) {
    await client.exec(readFileSync(path.join(migrationsDir, dir, 'migration.sql'), 'utf8'));
  }
  return dirs;
}

describe('D168 responsibility-selection migration shape', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const schema = read('packages/db/prisma/schema.prisma');

  it('defines the evidence model with exactly the authorized fields', () => {
    expect(schema).toContain('model TaskSuggestionResponsibilitySelection');
    expect(schema).toContain('enum ResponsibilitySelectionPartyKind');
    expect(schema).toContain('@@map("task_suggestion_responsibility_selections")');

    const block = schema.match(
      /model TaskSuggestionResponsibilitySelection \{[\s\S]*?@@map\("task_suggestion_responsibility_selections"\)/,
    )?.[0];
    expect(block).toBeDefined();
    expect(block).toMatch(/organizationId\s+String\s+@map\("organization_id"\)/);
    expect(block).toMatch(/suggestionId\s+String\s+@unique\s+@map\("suggestion_id"\)/);
    expect(block).toMatch(/taskId\s+String\s+@unique\s+@map\("task_id"\)/);
    expect(block).toMatch(/partyKind\s+ResponsibilitySelectionPartyKind\s+@map\("party_kind"\)/);
    expect(block).toMatch(/recipientId\s+String\?\s+@map\("recipient_id"\)/);
    expect(block).toMatch(/selectedByOwnerId\s+String\s+@map\("selected_by_owner_id"\)/);
    expect(block).toMatch(/selectedAt\s+DateTime\s+@map\("selected_at"\)/);
    expect(block).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("created_at"\)/);

    // Anything that would turn initial-acceptance evidence into mutable current state or a
    // responsibility history stream is out of this carrier.
    for (const forbidden of [
      'updatedAt',
      'updated_at',
      'status',
      'current',
      'superseded',
      'clearedAt',
      'cleared_at',
      'assignmentId',
      'capabilityId',
      'handoff',
      'deliveryStatus',
      'delivery_status',
      'auditEventId',
      'audit_event_id',
      'acceptedRevisionId',
      'revisionNumber',
    ]) {
      expect(block, `carrier must not include ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('adds no responsibility, assignee, or custody column to Task (D164, D168)', () => {
    const taskBlock = schema.match(/model Task \{[\s\S]*?@@map\("tasks"\)/)?.[0];
    expect(taskBlock).toBeDefined();
    expect(taskBlock).not.toMatch(/^\s*assignee/m);
    expect(taskBlock).not.toMatch(/^\s*custody/m);
    expect(taskBlock).not.toMatch(/^\s*responsibleParty/m);
    expect(taskBlock).not.toMatch(/^\s*responsibilityKind/m);
    // The only Task-side addition is an optional back-relation to the evidence row, which is not a
    // column and is explicitly documented as historical evidence rather than current responsibility.
    expect(taskBlock).toContain('acceptanceResponsibilitySelection');
    expect(sql).not.toMatch(/ALTER TABLE "tasks"/);
    expect(sql).not.toMatch(/ALTER TABLE "task_assignments"/);
    expect(sql).not.toMatch(/ALTER TABLE "task_suggestions"/);
  });

  it('is additive: creates one enum and one table, dropping and backfilling nothing', () => {
    expect(sql).toContain('CREATE TYPE "ResponsibilitySelectionPartyKind"');
    expect(sql).toContain("'owner'");
    expect(sql).toContain("'recipient'");
    expect(sql).toContain('CREATE TABLE "task_suggestion_responsibility_selections"');
    expect(sql).toContain('task_suggestion_responsibility_selections_suggestion_id_key');
    expect(sql).toContain('task_suggestion_responsibility_selections_task_id_key');
    expect(sql).toContain('task_suggestion_responsibility_selections_org_suggestion_idx');
    expect(sql).toContain('task_suggestion_responsibility_selections_party_kind_recipient');
    expect(sql).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b\s+"/i);
    expect(sql).not.toMatch(/\bDELETE\b\s+FROM/i);
    expect(sql).not.toMatch(/\bINSERT\b\s+INTO\s+"/i);
    expect(sql).not.toMatch(/\bCREATE\s+TRIGGER\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+RULE\b/i);
  });

  it('touches no existing table', () => {
    const altered = [...sql.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((match) => match[1]);
    expect(new Set(altered)).toEqual(new Set(['task_suggestion_responsibility_selections']));
  });

  it('enables deny-by-default RLS with no policies', () => {
    expect(sql).toContain(
      'ALTER TABLE "task_suggestion_responsibility_selections" ENABLE ROW LEVEL SECURITY',
    );
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it('records that party_kind, not absence, is the affirmative signal', () => {
    expect(sql).toMatch(/NEVER be read as evidence that the Owner selected Me/i);
  });
});

describe('D168 responsibility-selection migration from live baseline (PGlite)', () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
  });

  afterAll(async () => {
    await pglite.close();
  });

  it('leaves existing accepted proposals byte-identical and fabricates no selections', async () => {
    const applied = await applyMigrationsBefore(pglite, migrationDir);
    expect(applied.some((d) => d.includes('a6_suggestion'))).toBe(true);
    expect(applied.some((d) => d.includes('responsibility_selection'))).toBe(false);

    await pglite.exec(`
      INSERT INTO tasks (
        id, organization_id, status, summary_points, reminder, retention, version,
        created_at, updated_at
      ) VALUES
        (
          'task_rsel_approved', 'org_rsel_mig', 'open',
          '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"approved"}]'::jsonb,
          '{"paused":false}'::jsonb, '{}'::jsonb, 1,
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
        ),
        (
          'task_rsel_assigned', 'org_rsel_mig', 'open',
          '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"assigned"}]'::jsonb,
          '{"paused":false}'::jsonb, '{}'::jsonb, 1,
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
        );

      INSERT INTO recipients (
        id, organization_id, display_name, email, email_normalized, active,
        created_at, updated_at
      ) VALUES (
        'rcp_rsel_mig', 'org_rsel_mig', 'Existing', 'existing@rsel.example',
        'existing@rsel.example', true,
        '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
      );

      INSERT INTO task_assignments (
        id, organization_id, task_id, recipient_id, intended_recipient_email,
        assigned_at, assigned_by_owner_id, allowed_capability_actions,
        created_at, updated_at
      ) VALUES (
        'asg_rsel_mig', 'org_rsel_mig', 'task_rsel_assigned', 'rcp_rsel_mig',
        'existing@rsel.example', '2026-08-01T12:00:00.000Z', 'owner_rsel_mig',
        '["view_assigned_task"]'::jsonb,
        '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
      );

      INSERT INTO task_suggestions (
        id, organization_id, status, summary_points, voice_originated,
        approved_task_id, retention, version, created_at, updated_at
      ) VALUES
        (
          'sug_rsel_pending', 'org_rsel_mig', 'pending',
          '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"pending"}]'::jsonb,
          false, NULL, '{"class":"pending"}'::jsonb, 1,
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
        ),
        (
          'sug_rsel_approved', 'org_rsel_mig', 'approved',
          '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"approved"}]'::jsonb,
          false, 'task_rsel_approved', '{"class":"approved"}'::jsonb, 2,
          '2026-08-01T12:00:00.000Z', '2026-08-01T13:00:00.000Z'
        );
    `);

    const suggestionsBefore = await pglite.query<{ row_json: string }>(
      `SELECT id || ':' || md5(row_to_json(t)::text) AS row_json
       FROM task_suggestions t WHERE organization_id = 'org_rsel_mig' ORDER BY id`,
    );
    const tasksBefore = await pglite.query<{ row_json: string }>(
      `SELECT id || ':' || md5(row_to_json(t)::text) AS row_json
       FROM tasks t WHERE organization_id = 'org_rsel_mig' ORDER BY id`,
    );
    const assignmentsBefore = await pglite.query<{ row_json: string }>(
      `SELECT id || ':' || md5(row_to_json(t)::text) AS row_json
       FROM task_assignments t WHERE organization_id = 'org_rsel_mig' ORDER BY id`,
    );
    expect(suggestionsBefore.rows).toHaveLength(2);
    expect(tasksBefore.rows).toHaveLength(2);

    await pglite.exec(readFileSync(migrationPath, 'utf8'));

    for (const [label, before, table] of [
      ['task_suggestions', suggestionsBefore, 'task_suggestions'],
      ['tasks', tasksBefore, 'tasks'],
      ['task_assignments', assignmentsBefore, 'task_assignments'],
    ] as const) {
      const after = await pglite.query<{ row_json: string }>(
        `SELECT id || ':' || md5(row_to_json(t)::text) AS row_json
         FROM ${table} t WHERE organization_id = 'org_rsel_mig' ORDER BY id`,
      );
      expect(after.rows, `${label} must be byte-identical after migration`).toEqual(before.rows);
    }

    // An already-accepted proposal gains no fabricated selection: absence of evidence must never be
    // manufactured into an Owner selection (D155, D164).
    const fabricated = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM task_suggestion_responsibility_selections`,
    );
    expect(fabricated.rows[0]?.n).toBe(0);

    // No Owner TaskAssignment is invented for symmetry.
    const assignmentCount = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM task_assignments WHERE organization_id = 'org_rsel_mig'`,
    );
    expect(assignmentCount.rows[0]?.n).toBe(1);

    const taskColumns = await pglite.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'tasks'`,
    );
    const taskColumnNames = taskColumns.rows.map((c) => c.column_name);
    for (const forbidden of ['assignee_id', 'custody', 'responsible_party', 'responsibility']) {
      expect(taskColumnNames, `tasks must not gain ${forbidden}`).not.toContain(forbidden);
    }

    const rls = await pglite.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class
       WHERE relname = 'task_suggestion_responsibility_selections'`,
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);

    const cols = await pglite.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'task_suggestion_responsibility_selections'
       ORDER BY ordinal_position`,
    );
    expect(cols.rows.map((c) => c.column_name)).toEqual([
      'id',
      'organization_id',
      'suggestion_id',
      'task_id',
      'party_kind',
      'recipient_id',
      'selected_by_owner_id',
      'selected_at',
      'created_at',
    ]);
  });
});
