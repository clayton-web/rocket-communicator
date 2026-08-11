/**
 * InterpretationRun -> 0..N TaskSuggestion ownership edge (D161).
 *
 * Inert storage only: no producer, service, route, or AI orchestration writes this linkage. These
 * tests prove the edge's cardinality, its coexistence with the untouched A6 source-event unique
 * index, and that repository read/write preserves it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asCommunicationEventId,
  asOrganizationId,
  asTaskSuggestionId,
  type TaskSuggestion,
} from '@aicaa/domain';
import {
  createInterpretationRun,
  createOrUpdatePendingCommunicationAccount,
  createTaskSuggestion,
  getTaskSuggestionById,
  getTaskSuggestionWithInterpretationRunById,
  listTaskSuggestionsByInterpretationRunId,
  persistConnectedCommunicationAccount,
  updateTaskSuggestionWithExpectedVersion,
  upsertCommunicationEvent,
  type CreateInterpretationRunInput,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testDir, '..');
const migrationsDir = path.join(packageRoot, 'prisma', 'migrations');
const migrationDir = '20260810230000_interpretation_run_suggestion_ownership';
const migrationPath = path.join(migrationsDir, migrationDir, 'migration.sql');
const schemaPath = path.join(packageRoot, 'prisma', 'schema.prisma');

const org = 'org_interp_own';
const now = '2026-08-10T12:00:00.000Z';

function runInput(
  overrides: Partial<CreateInterpretationRunInput> = {},
): CreateInterpretationRunInput {
  return {
    id: 'irun_own_1',
    organizationId: org,
    idempotencyKey: 'idem_own_1',
    requestFingerprint: 'fp_own_1',
    sourceKind: 'owner_manual_capture',
    outcome: 'proposals_created',
    modelVersion: 'fixture-model',
    policyVersion: 'interpretation-policy-v1',
    requestId: 'req_own_1',
    ...overrides,
  };
}

function pendingSuggestion(
  id: string,
  eventId: string | null,
  overrides: Partial<TaskSuggestion> = {},
): TaskSuggestion {
  return {
    id: asTaskSuggestionId(id),
    organizationId: asOrganizationId(org),
    status: 'pending',
    summaryPoints: [{ id: 'sp1', kind: 'next_action', label: 'Act', order: 0, value: 'Follow up' }],
    voiceOriginated: false,
    sourceCommunicationEventId: eventId ? asCommunicationEventId(eventId) : null,
    retention: {},
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('InterpretationRun ownership edge persistence (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    // Proposals first: the ownership foreign key is RESTRICT.
    await db.prisma.taskSuggestion.deleteMany();
    await db.prisma.interpretationRun.deleteMany();
  });

  it('links one occurrence to multiple sibling proposals that all have a null source event', async () => {
    const run = await createInterpretationRun(db.prisma, runInput());

    for (const id of ['sug_sib_1', 'sug_sib_2', 'sug_sib_3']) {
      await createTaskSuggestion(db.prisma, org, pendingSuggestion(id, null), undefined, run.id);
    }

    const owned = await listTaskSuggestionsByInterpretationRunId(db.prisma, org, run.id);
    expect(owned.map((item) => item.id)).toEqual(['sug_sib_1', 'sug_sib_2', 'sug_sib_3']);
    for (const sibling of owned) {
      expect(sibling.interpretationRunId).toBe(run.id);
      // The A6 unique index on source_communication_event_id tolerates many NULLs, so siblings
      // from one occurrence coexist without any Gmail origin.
      expect(sibling.sourceCommunicationEventId).toBeNull();
    }
  });

  it('reads back the linkage through the repository mapper after writing it', async () => {
    const run = await createInterpretationRun(db.prisma, runInput({ id: 'irun_map' }));
    await createTaskSuggestion(
      db.prisma,
      org,
      pendingSuggestion('sug_map', null),
      undefined,
      run.id,
    );

    const loaded = await getTaskSuggestionWithInterpretationRunById(db.prisma, org, 'sug_map');
    expect(loaded.interpretationRunId).toBe('irun_map');
    expect(loaded.status).toBe('pending');
    expect(loaded.version).toBe(1);

    const row = await db.prisma.taskSuggestion.findUniqueOrThrow({ where: { id: 'sug_map' } });
    expect(row.interpretationRunId).toBe('irun_map');
  });

  it('keeps suggestions created without an occurrence valid and unlinked', async () => {
    await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_unlinked', null));

    const loaded = await getTaskSuggestionWithInterpretationRunById(db.prisma, org, 'sug_unlinked');
    expect(loaded.interpretationRunId).toBeNull();

    // The domain-entity read path is unchanged by the new column.
    const domainRead = await getTaskSuggestionById(db.prisma, org, 'sug_unlinked');
    expect(domainRead.id).toBe('sug_unlinked');
    expect(domainRead).not.toHaveProperty('interpretationRunId');
  });

  it('returns no proposals for an occurrence that produced none', async () => {
    const run = await createInterpretationRun(
      db.prisma,
      runInput({ id: 'irun_zero', outcome: 'no_proposals' }),
    );

    expect(await listTaskSuggestionsByInterpretationRunId(db.prisma, org, run.id)).toEqual([]);
  });

  it('scopes the occupancy read by organization', async () => {
    const run = await createInterpretationRun(db.prisma, runInput({ id: 'irun_scoped' }));
    await createTaskSuggestion(
      db.prisma,
      org,
      pendingSuggestion('sug_scoped', null),
      undefined,
      run.id,
    );

    expect(
      await listTaskSuggestionsByInterpretationRunId(db.prisma, 'org_other', 'irun_scoped'),
    ).toEqual([]);
  });

  it('preserves the linkage across a version-checked snapshot update', async () => {
    const run = await createInterpretationRun(db.prisma, runInput({ id: 'irun_update' }));
    const suggestion = pendingSuggestion('sug_update', null);
    await createTaskSuggestion(db.prisma, org, suggestion, undefined, run.id);

    await updateTaskSuggestionWithExpectedVersion(db.prisma, org, 1, {
      ...suggestion,
      status: 'dismissed',
      version: 2,
      updatedAt: '2026-08-10T13:00:00.000Z',
    });

    const loaded = await getTaskSuggestionWithInterpretationRunById(db.prisma, org, 'sug_update');
    expect(loaded.status).toBe('dismissed');
    expect(loaded.version).toBe(2);
    expect(loaded.interpretationRunId).toBe('irun_update');
  });

  it('still enforces the A6 one-suggestion-per-source-event unique index', async () => {
    await createOrUpdatePendingCommunicationAccount(db.prisma, {
      organizationId: org,
      accountId: 'acct_own',
      emailAddress: 'owner@own.example',
      externalAccountId: 'google-sub-own',
    });
    await persistConnectedCommunicationAccount(db.prisma, {
      organizationId: org,
      accountId: 'acct_own',
      emailAddress: 'owner@own.example',
      externalAccountId: 'google-sub-own',
      connectedAt: now,
      historyId: 'hist_own',
    });
    await upsertCommunicationEvent(db.prisma, {
      organizationId: org,
      accountId: 'acct_own',
      message: {
        eventId: 'evt_own',
        providerMessageId: 'msg_own',
        providerThreadId: 'thread_own',
        internalDate: now,
        fromAddress: 'sender@example.com',
        toAddresses: ['owner@own.example'],
        subject: 'Action needed',
        snippet: 'Please review',
        labelIds: ['INBOX'],
        hasAttachments: false,
        attachmentMetadata: [],
      },
    });
    const run = await createInterpretationRun(db.prisma, runInput({ id: 'irun_a6' }));

    await createTaskSuggestion(
      db.prisma,
      org,
      pendingSuggestion('sug_a6_1', 'evt_own'),
      undefined,
      run.id,
    );
    await expect(
      createTaskSuggestion(
        db.prisma,
        org,
        pendingSuggestion('sug_a6_2', 'evt_own'),
        undefined,
        run.id,
      ),
    ).rejects.toMatchObject({ code: 'UNIQUE_VIOLATION' });
  });

  it('rejects a linkage to an occurrence that does not exist', async () => {
    await expect(
      createTaskSuggestion(
        db.prisma,
        org,
        pendingSuggestion('sug_missing_run', null),
        undefined,
        'irun_absent',
      ),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('refuses to delete an occurrence that still owns proposals', async () => {
    const run = await createInterpretationRun(db.prisma, runInput({ id: 'irun_restrict' }));
    await createTaskSuggestion(
      db.prisma,
      org,
      pendingSuggestion('sug_restrict', null),
      undefined,
      run.id,
    );

    await expect(
      db.prisma.interpretationRun.delete({ where: { id: 'irun_restrict' } }),
    ).rejects.toThrow();
  });

  it('requires source_kind on every occurrence at the database', async () => {
    await expect(
      db.pglite.query(
        `INSERT INTO interpretation_runs (
           id, organization_id, idempotency_key, request_fingerprint,
           outcome, model_version, policy_version, request_id
         ) VALUES (
           'irun_no_kind', $1, 'idem_no_kind', 'fp_x',
           'no_proposals', 'm', 'p', 'req_x'
         )`,
        [org],
      ),
    ).rejects.toThrow();
  });

  it('indexes the ownership lookup without making it unique', async () => {
    const indexes = await db.pglite.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE tablename = 'task_suggestions'
         AND indexname = 'task_suggestions_organization_id_interpretation_run_id_idx'`,
    );
    expect(indexes.rows).toHaveLength(1);
    expect(indexes.rows[0]?.indexdef).not.toMatch(/UNIQUE/i);
  });
});

describe('InterpretationRun ownership edge migration shape', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const schema = readFileSync(schemaPath, 'utf8');
  // The header deliberately names what this slice does not do; matching that prose would fail the
  // guards for saying the right thing.
  const statements = sql.replace(/^\s*--.*$/gm, '');

  it('adds a nullable, non-unique interpretationRunId to TaskSuggestion', () => {
    const block = schema.match(/model TaskSuggestion \{[\s\S]*?@@map\("task_suggestions"\)/)?.[0];
    expect(block).toBeDefined();
    expect(block).toMatch(/interpretationRunId\s+String\?\s+@map\("interpretation_run_id"\)/);
    expect(block).not.toMatch(/interpretationRunId\s+String\?\s+@unique/);
    expect(block).toContain('@@index([organizationId, interpretationRunId])');
    expect(sql).toMatch(/ADD COLUMN "interpretation_run_id" VARCHAR\(64\);/);
    expect(sql).not.toMatch(/interpretation_run_id"?\s+VARCHAR\(64\)\s+NOT NULL/);
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX[\s\S]*interpretation_run_id/);
  });

  it('keeps the A6 source-event link and its unique index untouched', () => {
    const block = schema.match(/model TaskSuggestion \{[\s\S]*?@@map\("task_suggestions"\)/)?.[0];
    expect(block).toMatch(/sourceCommunicationEventId\s+String\?\s+@unique/);
    expect(statements).not.toContain('source_communication_event_id');
  });

  it('declares source_kind as a required enum column', () => {
    expect(schema).toContain('enum InterpretationSourceKind');
    expect(schema).toMatch(/sourceKind\s+InterpretationSourceKind\s+@map\("source_kind"\)/);
    expect(schema).not.toMatch(/sourceKind\s+InterpretationSourceKind\?/);
    expect(sql).toContain('CREATE TYPE "InterpretationSourceKind"');
    expect(sql).toMatch(/ADD COLUMN "source_kind" "InterpretationSourceKind" NOT NULL;/);
    expect(sql).not.toMatch(/"source_kind"[\s\S]{0,40}DEFAULT/);
  });

  it('restricts deletion of an occupied occurrence', () => {
    expect(sql).toContain('"task_suggestions_interpretation_run_id_fkey"');
    expect(sql).toContain('REFERENCES "interpretation_runs"("id")');
    expect(sql).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
  });

  it('is additive: no drop, truncate, backfill, or row rewrite', () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b\s+"/i);
    expect(sql).not.toMatch(/\bDELETE\b\s+FROM/i);
    expect(sql).not.toMatch(/\bINSERT\b\s+INTO\s+"/i);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    const altered = [...sql.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((match) => match[1]);
    expect(new Set(altered)).toEqual(new Set(['interpretation_runs', 'task_suggestions']));
  });

  it('adds no acceptance-outcome, responsibility, revision, or raw-input persistence', () => {
    for (const forbidden of [
      'kept',
      'assigned',
      'accepted_revision_id',
      'acceptance_outcome',
      'responsible',
      'raw_input',
      'communication_event_id',
      'proposal_count',
    ]) {
      expect(statements, `ownership edge must not include ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('InterpretationRun ownership edge from live baseline (PGlite)', () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
  });

  afterAll(async () => {
    await pglite.close();
  });

  it('leaves existing suggestions unchanged and unlinked', async () => {
    const dirs = readdirSync(migrationsDir)
      .filter((name) => statSync(path.join(migrationsDir, name)).isDirectory())
      .sort()
      .filter((name) => name < migrationDir);
    for (const dir of dirs) {
      await pglite.exec(readFileSync(path.join(migrationsDir, dir, 'migration.sql'), 'utf8'));
    }
    expect(dirs.some((dir) => dir.includes('interpretation_run_persistence'))).toBe(true);

    await pglite.exec(`
      INSERT INTO task_suggestions (
        id, organization_id, status, summary_points, voice_originated,
        retention, version, created_at, updated_at
      ) VALUES (
        'sug_pre_link', 'org_pre_link', 'pending',
        '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"x"}]'::jsonb,
        false, '{}'::jsonb, 1,
        '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
      );
    `);

    const before = await pglite.query<{ status: string; version: number; updated_at: Date }>(
      `SELECT status, version, updated_at FROM task_suggestions WHERE id = 'sug_pre_link'`,
    );

    await pglite.exec(readFileSync(migrationPath, 'utf8'));

    const after = await pglite.query<{
      status: string;
      version: number;
      updated_at: Date;
      interpretation_run_id: string | null;
    }>(
      `SELECT status, version, updated_at, interpretation_run_id
       FROM task_suggestions WHERE id = 'sug_pre_link'`,
    );

    expect(after.rows[0]).toMatchObject(before.rows[0] ?? {});
    expect(after.rows[0]?.interpretation_run_id).toBeNull();

    const runs = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM interpretation_runs`,
    );
    expect(runs.rows[0]?.n).toBe(0);
  });
});
