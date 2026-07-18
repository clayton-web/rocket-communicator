import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(packageRoot, 'prisma', 'migrations');
const a6Dir = '20260717180000_a6_suggestion_persistence';

async function applyMigrationsBeforeA6(client: PGlite): Promise<string[]> {
  const dirs = readdirSync(migrationsDir)
    .filter((name) => statSync(path.join(migrationsDir, name)).isDirectory())
    .sort()
    .filter((name) => name < a6Dir);
  for (const dir of dirs) {
    await client.exec(readFileSync(path.join(migrationsDir, dir, 'migration.sql'), 'utf8'));
  }
  return dirs;
}

describe('A6.1 migration from pre-A6 schema (PGlite)', () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
  });

  afterAll(async () => {
    await pglite.close();
  });

  it('applies A6.1 additively over representative A5 data', async () => {
    const applied = await applyMigrationsBeforeA6(pglite);
    expect(applied.some((d) => d.includes('a5_gmail'))).toBe(true);
    expect(applied.some((d) => d.includes('a6_suggestion'))).toBe(false);

    // Representative pre-A6 rows via raw SQL (Prisma client already knows A6 columns).
    await pglite.exec(`
      INSERT INTO communication_accounts (
        id, organization_id, provider, email_address, external_account_id,
        status, history_state, created_at, updated_at
      ) VALUES (
        'acct_pre_a6', 'org_pre_a6', 'gmail', 'owner@pre.example', 'sub_pre',
        'connected', 'valid', NOW(), NOW()
      );

      INSERT INTO communication_events (
        id, organization_id, account_id, source_type, provider_message_id, provider_thread_id,
        dedupe_key, internal_date, received_at, from_address, to_addresses, label_ids,
        has_attachments, attachment_metadata, status, created_at, updated_at
      ) VALUES (
        'evt_pre_a6', 'org_pre_a6', 'acct_pre_a6', 'gmail', 'msg_pre', 'thread_pre',
        'gmail:msg_pre', NOW(), NOW(), 'a@example.com', '[]'::jsonb, '["INBOX"]'::jsonb,
        false, '[]'::jsonb, 'active', NOW(), NOW()
      );

      INSERT INTO tasks (
        id, organization_id, status, summary_points, reminder, retention, version, created_at, updated_at
      ) VALUES (
        'task_pre_a6', 'org_pre_a6', 'open',
        '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"x"}]'::jsonb,
        '{"paused":false}'::jsonb, '{}'::jsonb, 1, NOW(), NOW()
      );

      INSERT INTO task_suggestions (
        id, organization_id, status, summary_points, voice_originated, origin_task_id,
        retention, version, created_at, updated_at
      ) VALUES (
        'sug_wr_pre', 'org_pre_a6', 'pending',
        '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"wr"}]'::jsonb,
        false, 'task_pre_a6', '{}'::jsonb, 1, NOW(), NOW()
      );
    `);

    const a6Sql = readFileSync(path.join(migrationsDir, a6Dir, 'migration.sql'), 'utf8');
    await pglite.exec(a6Sql);

    const status = await pglite.query<{ suggestion_processing_status: string }>(
      `SELECT suggestion_processing_status::text AS suggestion_processing_status
       FROM communication_events WHERE id = 'evt_pre_a6'`,
    );
    expect(status.rows[0]?.suggestion_processing_status).toBe('unprocessed');

    const wr = await pglite.query<{ source_communication_event_id: string | null }>(
      `SELECT source_communication_event_id FROM task_suggestions WHERE id = 'sug_wr_pre'`,
    );
    expect(wr.rows[0]?.source_communication_event_id).toBeNull();

    // Multiple nulls allowed on unique source_communication_event_id.
    await pglite.exec(`
      INSERT INTO task_suggestions (
        id, organization_id, status, summary_points, voice_originated,
        retention, version, created_at, updated_at
      ) VALUES (
        'sug_wr_pre_2', 'org_pre_a6', 'pending',
        '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"wr2"}]'::jsonb,
        false, '{}'::jsonb, 1, NOW(), NOW()
      );
    `);

    await pglite.exec(`
      INSERT INTO task_suggestions (
        id, organization_id, status, summary_points, voice_originated,
        source_communication_event_id, retention, version, created_at, updated_at
      ) VALUES (
        'sug_evt_1', 'org_pre_a6', 'pending',
        '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"e1"}]'::jsonb,
        false, 'evt_pre_a6', '{}'::jsonb, 1, NOW(), NOW()
      );
    `);

    let duplicateRejected = false;
    try {
      await pglite.exec(`
        INSERT INTO task_suggestions (
          id, organization_id, status, summary_points, voice_originated,
          source_communication_event_id, retention, version, created_at, updated_at
        ) VALUES (
          'sug_evt_2', 'org_pre_a6', 'pending',
          '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"e2"}]'::jsonb,
          false, 'evt_pre_a6', '{}'::jsonb, 1, NOW(), NOW()
        );
      `);
    } catch {
      duplicateRejected = true;
    }
    expect(duplicateRejected).toBe(true);

    const cols = await pglite.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'task_suggestions'
         AND column_name IN ('source_communication_event_id', 'approved_task_id')
       ORDER BY column_name`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      'approved_task_id',
      'source_communication_event_id',
    ]);
  });
});
