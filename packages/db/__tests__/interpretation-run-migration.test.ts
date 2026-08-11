/**
 * Structural guards for the InterpretationRun persistence foundation migration.
 *
 * Source/SQL asserts (no producer behaviour). Proves additivity, deny-by-default RLS,
 * required non-null identity columns, and that existing tables/data are not rewritten.
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
const migrationDir = '20260810210000_interpretation_run_persistence';
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

describe('InterpretationRun migration shape', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const schema = read('packages/db/prisma/schema.prisma');

  it('defines InterpretationRun with required identity and successful-outcome fields only', () => {
    expect(schema).toContain('model InterpretationRun');
    expect(schema).toContain('enum InterpretationRunOutcome');
    expect(schema).toContain('proposals_created');
    expect(schema).toContain('no_proposals');
    expect(schema).toContain('@@unique([organizationId, idempotencyKey])');
    expect(schema).toContain('@@map("interpretation_runs")');

    const block = schema.match(
      /model InterpretationRun \{[\s\S]*?@@map\("interpretation_runs"\)/,
    )?.[0];
    expect(block).toBeDefined();
    expect(block).toMatch(/idempotencyKey\s+String\s+@map\("idempotency_key"\)/);
    expect(block).toMatch(/requestFingerprint\s+String\s+@map\("request_fingerprint"\)/);
    expect(block).toMatch(/requestId\s+String\s+@map\("request_id"\)/);
    expect(block).not.toMatch(/idempotencyKey\s+String\?/);
    expect(block).not.toMatch(/requestFingerprint\s+String\?/);
    expect(block).not.toMatch(/requestId\s+String\?/);
    // `sourceKind` was deferred by this foundation and is added by the later ownership-edge slice,
    // so it is no longer forbidden on the model; the foundation migration SQL still must not
    // mention it.
    expect(sql).not.toContain('source_kind');
    for (const forbidden of [
      'rawInput',
      'raw_input',
      'trigger',
      'communicationEventId',
      'proposalCount',
      'startedAt',
      'finishedAt',
      'correlationId',
      'promptVersion',
      'acceptedRevisionId',
    ]) {
      expect(block, `foundation must not include ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('is additive: creates enum + table and never drops, updates, or backfills', () => {
    expect(sql).toContain('CREATE TYPE "InterpretationRunOutcome"');
    expect(sql).toContain('CREATE TABLE "interpretation_runs"');
    expect(sql).toContain('interpretation_runs_organization_id_idempotency_key_key');
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b\s+"/i);
    expect(sql).not.toMatch(/\bDELETE\b\s+FROM/i);
    expect(sql).not.toMatch(/\bINSERT\b\s+INTO\s+"/i);
  });

  it('touches no existing table', () => {
    const altered = [...sql.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((match) => match[1]);
    expect(new Set(altered)).toEqual(new Set(['interpretation_runs']));
  });

  it('enables deny-by-default RLS with no policies', () => {
    expect(sql).toContain('ALTER TABLE "interpretation_runs" ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it('requires non-null idempotency_key, request_fingerprint, and request_id in SQL', () => {
    expect(sql).toMatch(/"idempotency_key"\s+VARCHAR\(128\)\s+NOT NULL/);
    expect(sql).toMatch(/"request_fingerprint"\s+VARCHAR\(128\)\s+NOT NULL/);
    expect(sql).toMatch(/"request_id"\s+VARCHAR\(64\)\s+NOT NULL/);
  });
});

describe('InterpretationRun migration from live baseline (PGlite)', () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
  });

  afterAll(async () => {
    await pglite.close();
  });

  it('leaves existing baseline rows unchanged when the additive migration applies', async () => {
    const applied = await applyMigrationsBefore(pglite, migrationDir);
    expect(applied.some((d) => d.includes('a6_suggestion'))).toBe(true);
    expect(applied.some((d) => d.includes('interpretation_run'))).toBe(false);

    await pglite.exec(`
      INSERT INTO tasks (
        id, organization_id, status, summary_points, reminder, retention, version,
        created_at, updated_at
      ) VALUES (
        'task_pre_interp', 'org_pre_interp', 'open',
        '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"x"}]'::jsonb,
        '{"paused":false}'::jsonb, '{}'::jsonb, 1,
        '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
      );

      INSERT INTO communication_accounts (
        id, organization_id, provider, email_address, external_account_id,
        status, history_state, created_at, updated_at
      ) VALUES (
        'acct_pre_interp', 'org_pre_interp', 'gmail', 'owner@pre.example', 'sub_pre_interp',
        'connected', 'valid', '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
      );

      INSERT INTO communication_events (
        id, organization_id, account_id, source_type, provider_message_id, provider_thread_id,
        dedupe_key, internal_date, received_at, from_address, to_addresses, label_ids,
        has_attachments, attachment_metadata, status,
        suggestion_processing_status, created_at, updated_at
      ) VALUES (
        'cev_pre_interp', 'org_pre_interp', 'acct_pre_interp', 'gmail', 'msg_pre_interp',
        'thread_pre_interp', 'gmail:msg_pre_interp',
        '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z',
        'a@example.com', '[]'::jsonb, '["INBOX"]'::jsonb,
        false, '[]'::jsonb, 'active', 'unprocessed',
        '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
      );

      INSERT INTO task_suggestions (
        id, organization_id, status, summary_points, voice_originated,
        source_communication_event_id, retention, version, created_at, updated_at
      ) VALUES (
        'sug_pre_interp', 'org_pre_interp', 'pending',
        '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"x"}]'::jsonb,
        false, 'cev_pre_interp', '{}'::jsonb, 1,
        '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
      );
    `);

    const beforeTask = await pglite.query<{
      status: string;
      version: number;
      updated_at: Date;
    }>(`SELECT status, version, updated_at FROM tasks WHERE id = 'task_pre_interp'`);
    const beforeSuggestion = await pglite.query<{
      status: string;
      version: number;
      source_communication_event_id: string | null;
      updated_at: Date;
    }>(
      `SELECT status, version, source_communication_event_id, updated_at
       FROM task_suggestions WHERE id = 'sug_pre_interp'`,
    );
    const beforeEvent = await pglite.query<{
      suggestion_processing_status: string;
      updated_at: Date;
    }>(
      `SELECT suggestion_processing_status, updated_at
       FROM communication_events WHERE id = 'cev_pre_interp'`,
    );

    expect(beforeTask.rows).toHaveLength(1);
    expect(beforeSuggestion.rows).toHaveLength(1);
    expect(beforeEvent.rows).toHaveLength(1);

    await pglite.exec(readFileSync(migrationPath, 'utf8'));

    const afterTask = await pglite.query<{
      status: string;
      version: number;
      updated_at: Date;
    }>(`SELECT status, version, updated_at FROM tasks WHERE id = 'task_pre_interp'`);
    const afterSuggestion = await pglite.query<{
      status: string;
      version: number;
      source_communication_event_id: string | null;
      updated_at: Date;
    }>(
      `SELECT status, version, source_communication_event_id, updated_at
       FROM task_suggestions WHERE id = 'sug_pre_interp'`,
    );
    const afterEvent = await pglite.query<{
      suggestion_processing_status: string;
      updated_at: Date;
    }>(
      `SELECT suggestion_processing_status, updated_at
       FROM communication_events WHERE id = 'cev_pre_interp'`,
    );
    const fabricatedRuns = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM interpretation_runs`,
    );

    expect(afterTask.rows[0]).toEqual(beforeTask.rows[0]);
    expect(afterSuggestion.rows[0]).toEqual(beforeSuggestion.rows[0]);
    expect(afterEvent.rows[0]).toEqual(beforeEvent.rows[0]);
    expect(fabricatedRuns.rows[0]?.n).toBe(0);

    const rls = await pglite.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'interpretation_runs'`,
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
  });
});
