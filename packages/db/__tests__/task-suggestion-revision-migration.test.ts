/**
 * Structural guards for the TaskSuggestion revision-evidence persistence foundation migration.
 *
 * Source/SQL asserts (no producer behaviour). Proves authorized shape, additivity, deny-by-default
 * RLS, legacy TaskSuggestion byte-identity, and that zero revision rows are fabricated.
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
const migrationDir = '20260810220000_task_suggestion_revision_persistence';
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

describe('TaskSuggestion revision migration shape', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const schema = read('packages/db/prisma/schema.prisma');

  it('defines TaskSuggestionRevision with exact authorized fields only', () => {
    expect(schema).toContain('model TaskSuggestionRevision');
    expect(schema).toContain('enum TaskSuggestionRevisionAuthorKind');
    expect(schema).toContain('ai');
    expect(schema).toContain('owner');
    expect(schema).toContain('@@unique([suggestionId, revisionNumber])');
    expect(schema).toContain('@@map("task_suggestion_revisions")');

    const block = schema.match(
      /model TaskSuggestionRevision \{[\s\S]*?@@map\("task_suggestion_revisions"\)/,
    )?.[0];
    expect(block).toBeDefined();
    expect(block).toMatch(/organizationId\s+String\s+@map\("organization_id"\)/);
    expect(block).toMatch(/suggestionId\s+String\s+@map\("suggestion_id"\)/);
    expect(block).toMatch(/revisionNumber\s+Int\s+@map\("revision_number"\)/);
    expect(block).toMatch(/authorKind\s+TaskSuggestionRevisionAuthorKind\s+@map\("author_kind"\)/);
    expect(block).toMatch(/summaryPoints\s+Json\s+@map\("summary_points"\)/);
    expect(block).toMatch(/proposedDueAt\s+DateTime\?\s+@map\("proposed_due_at"\)/);
    expect(block).toMatch(/proposedPriority\s+TaskPriority\?\s+@map\("proposed_priority"\)/);
    expect(block).toMatch(/proposedRecipientId\s+String\?\s+@map\("proposed_recipient_id"\)/);
    expect(block).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("created_at"\)/);

    for (const forbidden of [
      'authoredByOwnerId',
      'authored_by_owner_id',
      'updatedAt',
      'updated_at',
      'status',
      'accepted',
      'acceptedRevisionId',
      'accepted_revision_id',
      'interpretationRunId',
      'interpretation_run_id',
      'peopleHints',
      'deadlineExpression',
      'proposedRecipientHint',
      'promptVersion',
      'modelVersion',
      'policyVersion',
      'confidence',
      'reasoning',
      'auditEventId',
      'sourceReference',
      'voiceOriginated',
      'changedFields',
      'retention',
    ]) {
      expect(block, `foundation must not include ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('does not add acceptedRevisionId or other revision internals onto TaskSuggestion', () => {
    const suggestionBlock = schema.match(
      /model TaskSuggestion \{[\s\S]*?@@map\("task_suggestions"\)/,
    )?.[0];
    expect(suggestionBlock).toBeDefined();
    expect(suggestionBlock).not.toContain('acceptedRevisionId');
    expect(suggestionBlock).not.toContain('accepted_revision_id');
    expect(suggestionBlock).toContain('revisions');
  });

  it('is additive: creates enum + table and never drops, updates, or backfills', () => {
    expect(sql).toContain('CREATE TYPE "TaskSuggestionRevisionAuthorKind"');
    expect(sql).toContain("'ai'");
    expect(sql).toContain("'owner'");
    expect(sql).toContain('CREATE TABLE "task_suggestion_revisions"');
    expect(sql).toContain('task_suggestion_revisions_suggestion_id_revision_number_key');
    expect(sql).toContain('task_suggestion_revisions_org_suggestion_revision_idx');
    expect(sql).toContain('task_suggestion_revisions_revision_number_non_negative');
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
    expect(new Set(altered)).toEqual(new Set(['task_suggestion_revisions']));
  });

  it('enables deny-by-default RLS with no policies', () => {
    expect(sql).toContain('ALTER TABLE "task_suggestion_revisions" ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it('documents that unique numbering is not immutability protection', () => {
    expect(sql).toMatch(/numbering protection,\s+NOT immutability/i);
  });
});

describe('TaskSuggestion revision migration from live baseline (PGlite)', () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
  });

  afterAll(async () => {
    await pglite.close();
  });

  it('leaves representative TaskSuggestions byte-identical and fabricates no revisions', async () => {
    const applied = await applyMigrationsBefore(pglite, migrationDir);
    expect(applied.some((d) => d.includes('a6_suggestion'))).toBe(true);
    expect(applied.some((d) => d.includes('task_suggestion_revision'))).toBe(false);

    await pglite.exec(`
      INSERT INTO tasks (
        id, organization_id, status, summary_points, reminder, retention, version,
        created_at, updated_at
      ) VALUES
        (
          'task_rev_approved', 'org_rev_mig', 'open',
          '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"approved"}]'::jsonb,
          '{"paused":false}'::jsonb, '{}'::jsonb, 1,
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
        ),
        (
          'task_rev_merged', 'org_rev_mig', 'open',
          '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"merged-target"}]'::jsonb,
          '{"paused":false}'::jsonb, '{}'::jsonb, 1,
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
        ),
        (
          'task_rev_origin', 'org_rev_mig', 'open',
          '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"origin"}]'::jsonb,
          '{"paused":false}'::jsonb, '{}'::jsonb, 1,
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
        );

      INSERT INTO communication_accounts (
        id, organization_id, provider, email_address, external_account_id,
        status, history_state, created_at, updated_at
      ) VALUES (
        'acct_rev_mig', 'org_rev_mig', 'gmail', 'owner@rev.example', 'sub_rev_mig',
        'connected', 'valid', '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
      );

      INSERT INTO communication_events (
        id, organization_id, account_id, source_type, provider_message_id, provider_thread_id,
        dedupe_key, internal_date, received_at, from_address, to_addresses, label_ids,
        has_attachments, attachment_metadata, status,
        suggestion_processing_status, created_at, updated_at
      ) VALUES
        (
          'cev_rev_pending', 'org_rev_mig', 'acct_rev_mig', 'gmail', 'msg_rev_pending',
          'thread_rev_pending', 'gmail:msg_rev_pending',
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z',
          'a@example.com', '[]'::jsonb, '["INBOX"]'::jsonb,
          false, '[]'::jsonb, 'active', 'suggestion_created',
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
        ),
        (
          'cev_rev_approved', 'org_rev_mig', 'acct_rev_mig', 'gmail', 'msg_rev_approved',
          'thread_rev_approved', 'gmail:msg_rev_approved',
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z',
          'a@example.com', '[]'::jsonb, '["INBOX"]'::jsonb,
          false, '[]'::jsonb, 'active', 'suggestion_created',
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
        ),
        (
          'cev_rev_dismissed', 'org_rev_mig', 'acct_rev_mig', 'gmail', 'msg_rev_dismissed',
          'thread_rev_dismissed', 'gmail:msg_rev_dismissed',
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z',
          'a@example.com', '[]'::jsonb, '["INBOX"]'::jsonb,
          false, '[]'::jsonb, 'active', 'suggestion_created',
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
        ),
        (
          'cev_rev_merged', 'org_rev_mig', 'acct_rev_mig', 'gmail', 'msg_rev_merged',
          'thread_rev_merged', 'gmail:msg_rev_merged',
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z',
          'a@example.com', '[]'::jsonb, '["INBOX"]'::jsonb,
          false, '[]'::jsonb, 'active', 'suggestion_created',
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
        );

      INSERT INTO task_suggestions (
        id, organization_id, status, summary_points, voice_originated,
        source_communication_event_id, approved_task_id, merged_into_task_id, origin_task_id,
        proposed_due_at, proposed_priority, proposed_recipient_id,
        retention, version, created_at, updated_at
      ) VALUES
        (
          'sug_rev_pending', 'org_rev_mig', 'pending',
          '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"pending"}]'::jsonb,
          false, 'cev_rev_pending', NULL, NULL, NULL,
          '2026-08-05T15:00:00.000Z', 'normal', 'recip_pending',
          '{"class":"pending"}'::jsonb, 1,
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
        ),
        (
          'sug_rev_approved', 'org_rev_mig', 'approved',
          '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"approved"}]'::jsonb,
          false, 'cev_rev_approved', 'task_rev_approved', NULL, NULL,
          NULL, 'high', NULL,
          '{"class":"approved"}'::jsonb, 2,
          '2026-08-01T12:00:00.000Z', '2026-08-01T13:00:00.000Z'
        ),
        (
          'sug_rev_dismissed', 'org_rev_mig', 'dismissed',
          '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"dismissed"}]'::jsonb,
          false, 'cev_rev_dismissed', NULL, NULL, NULL,
          NULL, NULL, NULL,
          '{"class":"dismissed"}'::jsonb, 1,
          '2026-08-01T12:00:00.000Z', '2026-08-01T14:00:00.000Z'
        ),
        (
          'sug_rev_merged', 'org_rev_mig', 'merged',
          '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"merged"}]'::jsonb,
          false, 'cev_rev_merged', NULL, 'task_rev_merged', NULL,
          NULL, 'low', NULL,
          '{"class":"merged"}'::jsonb, 3,
          '2026-08-01T12:00:00.000Z', '2026-08-01T15:00:00.000Z'
        ),
        (
          'sug_rev_work_request', 'org_rev_mig', 'pending',
          '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"work-request"}]'::jsonb,
          false, NULL, NULL, NULL, 'task_rev_origin',
          NULL, 'urgent', 'recip_wr',
          '{"class":"work-request"}'::jsonb, 1,
          '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
        );
    `);

    const before = await pglite.query<{ row_json: string }>(
      `SELECT id || ':' || md5(row_to_json(t)::text) AS row_json
       FROM task_suggestions t
       WHERE organization_id = 'org_rev_mig'
       ORDER BY id`,
    );
    expect(before.rows).toHaveLength(5);

    await pglite.exec(readFileSync(migrationPath, 'utf8'));

    const after = await pglite.query<{ row_json: string }>(
      `SELECT id || ':' || md5(row_to_json(t)::text) AS row_json
       FROM task_suggestions t
       WHERE organization_id = 'org_rev_mig'
       ORDER BY id`,
    );
    expect(after.rows).toEqual(before.rows);

    const fabricated = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM task_suggestion_revisions`,
    );
    expect(fabricated.rows[0]?.n).toBe(0);

    // Legacy reading rules: pending/approved/dismissed/merged with no revisions means
    // "no revision evidence has been recorded" — not fabricated history, and approval remains
    // authoritative through existing status/Task linkage.
    for (const id of [
      'sug_rev_pending',
      'sug_rev_approved',
      'sug_rev_dismissed',
      'sug_rev_merged',
      'sug_rev_work_request',
    ]) {
      const count = await pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM task_suggestion_revisions WHERE suggestion_id = $1`,
        [id],
      );
      expect(count.rows[0]?.n, `${id} must have no fabricated revision evidence`).toBe(0);
    }

    const rls = await pglite.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'task_suggestion_revisions'`,
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);

    const cols = await pglite.query<{ column_name: string; data_type: string; udt_name: string }>(
      `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
       WHERE table_name = 'task_suggestion_revisions'
       ORDER BY ordinal_position`,
    );
    expect(cols.rows.map((c) => c.column_name)).toEqual([
      'id',
      'organization_id',
      'suggestion_id',
      'revision_number',
      'author_kind',
      'summary_points',
      'proposed_due_at',
      'proposed_priority',
      'proposed_recipient_id',
      'created_at',
    ]);
  });
});
