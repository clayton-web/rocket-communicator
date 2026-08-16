/**
 * D082 Review excerpt linkage: migration shape, A6 non-regression, and the sibling-aware
 * entitlement resolver at the persistence seam.
 *
 * The A6 assertions here are the equivalence proof required before routing A6 through the shared
 * resolver: every A6 transition must still write the same concrete `purgeAt` it wrote before, and
 * `sourceCommunicationEventId` must remain populated, unique, and Gmail-only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asCommunicationEventId,
  asOrganizationId,
  asOwnerId,
  asTaskId,
  asTaskSuggestionId,
  asTemporaryCommunicationExcerptId,
  computeExcerptEntitlementPurgeAt,
  computeExcerptPurgeAt,
  computeWorkflowSafetyCeilingPurgeAt,
  createStandaloneTask,
  ownerActor,
  resolveExcerptPurgeAt,
  type ExcerptEntitlementHolder,
  type ParsedGmailMessageFixture,
  type TaskSuggestion,
} from '@aicaa/domain';
import {
  applyD082ExcerptRetention,
  createOrUpdatePendingCommunicationAccount,
  createTask,
  createTaskSuggestion,
  excerptRetentionTargetFor,
  getTemporaryCommunicationExcerptByEventId,
  persistApproveTaskSuggestion,
  persistConnectedCommunicationAccount,
  persistDismissTaskSuggestion,
  persistOwnerTaskMutation,
  purgeTemporaryCommunicationExcerpt,
  upsertCommunicationEvent,
  upsertGoogleMessagesReviewEvent,
  upsertTemporaryCommunicationExcerpt,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testDir, '..');
const migrationsDir = path.join(packageRoot, 'prisma', 'migrations');
const migrationDir = '20260814020000_d082_review_excerpt_linkage';
const migrationPath = path.join(migrationsDir, migrationDir, 'migration.sql');

const org = 'org_d082_link';
const now = '2026-08-03T12:00:00.000Z';
const ingestPurgeAt = '2026-08-10T12:00:00.000Z';
const owner = ownerActor(asOwnerId('owner_d082_link'), asOrganizationId(org));

function migrationDirsBefore(beforeDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => statSync(path.join(migrationsDir, name)).isDirectory())
    .sort()
    .filter((name) => name < beforeDir);
}

describe('D082 Review excerpt linkage migration shape', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  // The migration's rationale is a long comment header that names the things it deliberately does
  // not do, so "this migration drops nothing" has to be asked of the statements, not of the prose.
  const statements = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  const schema = readFileSync(path.join(packageRoot, 'prisma', 'schema.prisma'), 'utf8');

  it('adds one nullable, non-unique column with an organization-scoped index', () => {
    expect(statements).toMatch(/ADD COLUMN "source_excerpt_id" VARCHAR\(64\)/);
    expect(statements).not.toMatch(/"source_excerpt_id"[^;]*NOT NULL/);
    expect(statements).not.toMatch(/CREATE UNIQUE INDEX[^;]*source_excerpt_id/i);
    expect(statements).toContain(
      'CREATE INDEX "task_suggestions_organization_id_source_excerpt_id_idx"\n  ON "task_suggestions"("organization_id", "source_excerpt_id")',
    );
  });

  it('references the temporary excerpt with ON DELETE SET NULL', () => {
    expect(statements).toContain(
      'FOREIGN KEY ("source_excerpt_id") REFERENCES "temporary_communication_excerpts"("id")',
    );
    expect(statements).toContain('ON DELETE SET NULL ON UPDATE CASCADE');
  });

  it('is additive: no drop, rewrite, or backfill', () => {
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
    expect(statements).not.toMatch(/\bUPDATE\b\s+"/i);
    expect(statements).not.toMatch(/\bDELETE\b\s+FROM/i);
    expect(statements).not.toMatch(/\bINSERT\b\s+INTO\s+"/i);
  });

  it('touches only task_suggestions, leaving A6 linkage and the excerpt table alone', () => {
    const altered = [...statements.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((match) => match[1]);
    expect(new Set(altered)).toEqual(new Set(['task_suggestions']));
    expect(statements).not.toContain('source_communication_event_id');
    // No new table, so no new RLS surface to enable.
    expect(statements).not.toMatch(/CREATE TABLE/i);
    expect(statements).not.toMatch(/CREATE POLICY/i);
  });

  it('orders after the D181 Messages Review migration it builds on', () => {
    const before = migrationDirsBefore(migrationDir);
    expect(before.some((dir) => dir.includes('d181_messages_review_persistence'))).toBe(true);
    expect(before.some((dir) => dir.includes('a6_suggestion_persistence'))).toBe(true);
    const after = readdirSync(migrationsDir)
      .filter((name) => statSync(path.join(migrationsDir, name)).isDirectory())
      .filter((name) => name > migrationDir);
    expect(after).toEqual([]);
  });

  it('keeps sourceCommunicationEventId unique and A6-only in the schema', () => {
    const block = schema.match(/model TaskSuggestion \{[\s\S]*?@@map\("task_suggestions"\)/)?.[0];
    expect(block).toBeDefined();
    expect(block).toMatch(
      /sourceCommunicationEventId\s+String\?\s+@unique @map\("source_communication_event_id"\)/,
    );
    expect(block).toMatch(/sourceExcerptId\s+String\?\s+@map\("source_excerpt_id"\)/);
    expect(block).not.toMatch(/sourceExcerptId\s+String\?\s+@unique/);
    expect(block).toContain('@@index([organizationId, sourceExcerptId])');
  });
});

describe('D082 Review excerpt linkage migration over existing A6 rows (PGlite)', () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
  });

  afterAll(async () => {
    await pglite.close();
  });

  it('leaves an existing A6 suggestion byte-identical and needs no backfill', async () => {
    for (const dir of migrationDirsBefore(migrationDir)) {
      await pglite.exec(readFileSync(path.join(migrationsDir, dir, 'migration.sql'), 'utf8'));
    }

    await pglite.exec(`
      INSERT INTO communication_accounts (
        id, organization_id, provider, email_address, external_account_id,
        status, history_state, created_at, updated_at
      ) VALUES (
        'acct_pre_d082', 'org_pre_d082', 'gmail', 'owner@pre.example', 'sub_pre_d082',
        'connected', 'valid', '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
      );

      INSERT INTO communication_events (
        id, organization_id, account_id, source_type, provider_message_id, provider_thread_id,
        dedupe_key, internal_date, received_at, from_address, to_addresses, label_ids,
        has_attachments, attachment_metadata, status,
        suggestion_processing_status, created_at, updated_at
      ) VALUES (
        'cev_pre_d082', 'org_pre_d082', 'acct_pre_d082', 'gmail', 'msg_pre_d082',
        'thread_pre_d082', 'gmail:msg_pre_d082',
        '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z',
        'a@example.com', '[]'::jsonb, '["INBOX"]'::jsonb,
        false, '[]'::jsonb, 'active', 'suggestion_created',
        '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
      );

      INSERT INTO temporary_communication_excerpts (
        id, organization_id, communication_event_id, content, byte_length,
        purge_at, created_at, updated_at
      ) VALUES (
        'ex_pre_d082', 'org_pre_d082', 'cev_pre_d082', 'legacy body', 11,
        '2026-08-31T12:00:00.000Z', '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
      );

      INSERT INTO task_suggestions (
        id, organization_id, status, summary_points, voice_originated,
        source_communication_event_id, retention, version, created_at, updated_at
      ) VALUES (
        'sug_pre_d082', 'org_pre_d082', 'pending',
        '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"x"}]'::jsonb,
        false, 'cev_pre_d082', '{}'::jsonb, 1,
        '2026-08-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'
      );
    `);

    const suggestionColumns = `id, status, version, source_communication_event_id, created_at, updated_at`;
    const before = await pglite.query(
      `SELECT ${suggestionColumns} FROM task_suggestions WHERE id = 'sug_pre_d082'`,
    );
    const excerptBefore = await pglite.query(
      `SELECT purge_at, purged_at, content FROM temporary_communication_excerpts
       WHERE id = 'ex_pre_d082'`,
    );

    await pglite.exec(readFileSync(migrationPath, 'utf8'));

    const after = await pglite.query(
      `SELECT ${suggestionColumns} FROM task_suggestions WHERE id = 'sug_pre_d082'`,
    );
    const excerptAfter = await pglite.query(
      `SELECT purge_at, purged_at, content FROM temporary_communication_excerpts
       WHERE id = 'ex_pre_d082'`,
    );
    const linkage = await pglite.query<{ source_excerpt_id: string | null }>(
      `SELECT source_excerpt_id FROM task_suggestions WHERE id = 'sug_pre_d082'`,
    );

    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(excerptAfter.rows[0]).toEqual(excerptBefore.rows[0]);
    // Nothing to backfill: the historical A6 proposal keeps reaching its excerpt through the event.
    expect(linkage.rows[0]?.source_excerpt_id).toBeNull();
  });

  it('still refuses a second A6 suggestion for the same CommunicationEvent', async () => {
    await expect(
      pglite.exec(`
        INSERT INTO task_suggestions (
          id, organization_id, status, summary_points, voice_originated,
          source_communication_event_id, retention, version, created_at, updated_at
        ) VALUES (
          'sug_pre_d082_dup', 'org_pre_d082', 'pending',
          '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"x"}]'::jsonb,
          false, 'cev_pre_d082', '{}'::jsonb, 1,
          '2026-08-02T12:00:00.000Z', '2026-08-02T12:00:00.000Z'
        );
      `),
    ).rejects.toThrow(/source_communication_event_id/);
  });

  it('accepts sibling proposals sharing one excerpt', async () => {
    await pglite.exec(`
      INSERT INTO task_suggestions (
        id, organization_id, status, summary_points, voice_originated,
        source_excerpt_id, retention, version, created_at, updated_at
      ) VALUES (
        'sug_sib_a', 'org_pre_d082', 'pending',
        '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"a"}]'::jsonb,
        false, 'ex_pre_d082', '{}'::jsonb, 1,
        '2026-08-03T12:00:00.000Z', '2026-08-03T12:00:00.000Z'
      ),
      (
        'sug_sib_b', 'org_pre_d082', 'pending',
        '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"b"}]'::jsonb,
        false, 'ex_pre_d082', '{}'::jsonb, 1,
        '2026-08-03T12:00:00.000Z', '2026-08-03T12:00:00.000Z'
      );
    `);

    const siblings = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM task_suggestions WHERE source_excerpt_id = 'ex_pre_d082'`,
    );
    expect(siblings.rows[0]?.n).toBe(2);
  });

  it('refuses a linkage to an excerpt that does not exist', async () => {
    await expect(
      pglite.exec(`
        INSERT INTO task_suggestions (
          id, organization_id, status, summary_points, voice_originated,
          source_excerpt_id, retention, version, created_at, updated_at
        ) VALUES (
          'sug_sib_ghost', 'org_pre_d082', 'pending',
          '[{"id":"p1","kind":"next_action","label":"Act","order":0,"value":"g"}]'::jsonb,
          false, 'ex_does_not_exist', '{}'::jsonb, 1,
          '2026-08-03T12:00:00.000Z', '2026-08-03T12:00:00.000Z'
        );
      `),
    ).rejects.toThrow(/source_excerpt_id/);
  });

  it('nulls the linkage rather than blocking the excerpt cascade', async () => {
    await pglite.exec(`DELETE FROM temporary_communication_excerpts WHERE id = 'ex_pre_d082'`);
    const siblings = await pglite.query<{ id: string; source_excerpt_id: string | null }>(
      `SELECT id, source_excerpt_id FROM task_suggestions
       WHERE id IN ('sug_sib_a', 'sug_sib_b') ORDER BY id`,
    );
    expect(siblings.rows).toHaveLength(2);
    for (const row of siblings.rows) {
      expect(row.source_excerpt_id).toBeNull();
    }
  });
});

describe('D082 entitlement resolver (pure)', () => {
  function holder(overrides: Partial<ExcerptEntitlementHolder>): ExcerptEntitlementHolder {
    return {
      suggestionId: 'sug_1',
      status: 'pending',
      associatedAt: now,
      suggestionTerminalAt: null,
      approvedAt: null,
      taskTerminalAt: null,
      ...overrides,
    };
  }

  it('derives each D082 status entitlement from its own anchor', () => {
    expect(computeExcerptEntitlementPurgeAt(holder({}))).toBe(
      computeWorkflowSafetyCeilingPurgeAt(now),
    );
    expect(
      computeExcerptEntitlementPurgeAt(
        holder({ status: 'dismissed', suggestionTerminalAt: '2026-08-05T09:00:00.000Z' }),
      ),
    ).toBe(computeExcerptPurgeAt('2026-08-05T09:00:00.000Z'));
    expect(
      computeExcerptEntitlementPurgeAt(
        holder({ status: 'merged', suggestionTerminalAt: '2026-08-05T09:00:00.000Z' }),
      ),
    ).toBe(computeExcerptPurgeAt('2026-08-05T09:00:00.000Z'));
    expect(
      computeExcerptEntitlementPurgeAt(
        holder({ status: 'approved', approvedAt: '2026-08-06T09:00:00.000Z' }),
      ),
    ).toBe(computeWorkflowSafetyCeilingPurgeAt('2026-08-06T09:00:00.000Z'));
    expect(
      computeExcerptEntitlementPurgeAt(
        holder({
          status: 'approved',
          approvedAt: '2026-08-06T09:00:00.000Z',
          taskTerminalAt: '2026-08-11T09:00:00.000Z',
        }),
      ),
    ).toBe(computeExcerptPurgeAt('2026-08-11T09:00:00.000Z'));
  });

  it('reduces a single A6 holder to that holder’s own caller-supplied value', () => {
    const ceiling = computeWorkflowSafetyCeilingPurgeAt(now);
    expect(
      resolveExcerptPurgeAt({
        holders: [holder({ suggestionId: 'sug_a6' })],
        transitionEntitlements: new Map([['sug_a6', ceiling]]),
      }),
    ).toBe(ceiling);
  });

  it('returns null when nothing holds a claim', () => {
    expect(resolveExcerptPurgeAt({ holders: [] })).toBeNull();
  });

  it('takes the maximum across siblings regardless of transition order', () => {
    const dismissed = holder({
      suggestionId: 'sug_a',
      status: 'dismissed',
      suggestionTerminalAt: '2026-08-30T09:00:00.000Z',
    });
    const approvedThenTerminal = holder({
      suggestionId: 'sug_b',
      status: 'approved',
      approvedAt: '2026-08-06T09:00:00.000Z',
      taskTerminalAt: '2026-08-11T09:00:00.000Z',
    });

    expect(resolveExcerptPurgeAt({ holders: [dismissed, approvedThenTerminal] })).toBe(
      computeExcerptPurgeAt('2026-08-30T09:00:00.000Z'),
    );
    expect(resolveExcerptPurgeAt({ holders: [approvedThenTerminal, dismissed] })).toBe(
      computeExcerptPurgeAt('2026-08-30T09:00:00.000Z'),
    );
  });

  it('honours a transition entitlement for a holder the read did not return', () => {
    const ceiling = computeWorkflowSafetyCeilingPurgeAt(now);
    expect(
      resolveExcerptPurgeAt({
        holders: [],
        transitionEntitlements: new Map([['sug_unseen', ceiling]]),
      }),
    ).toBe(ceiling);
  });
});

describe('excerptRetentionTargetFor', () => {
  it('names the excerpt for Review linkage and the event for A6 linkage', () => {
    expect(excerptRetentionTargetFor({ sourceExcerptId: 'ex_1' })).toEqual({
      kind: 'excerpt',
      excerptId: 'ex_1',
    });
    expect(excerptRetentionTargetFor({ sourceCommunicationEventId: 'cev_1' })).toEqual({
      kind: 'communication_event',
      communicationEventId: 'cev_1',
    });
    expect(excerptRetentionTargetFor({})).toBeNull();
    expect(
      excerptRetentionTargetFor({ sourceCommunicationEventId: null, sourceExcerptId: null }),
    ).toBeNull();
  });
});

describe('D082 shared retention at the persistence seam', () => {
  let db: TestDatabase;

  function inboxMessage(eventId: string, providerMessageId: string): ParsedGmailMessageFixture {
    return {
      eventId: asCommunicationEventId(eventId),
      providerMessageId,
      providerThreadId: `thread_${providerMessageId}`,
      internalDate: now,
      fromAddress: 'sender@example.com',
      toAddresses: ['owner@acme.example'],
      subject: 'Action needed',
      snippet: 'Please review',
      labelIds: ['INBOX'],
      hasAttachments: false,
      attachmentMetadata: [],
    };
  }

  async function seedGmailExcerpt(eventId: string): Promise<string> {
    await upsertCommunicationEvent(db.prisma, {
      organizationId: org,
      accountId: 'acct_d082_link',
      message: inboxMessage(eventId, `msg_${eventId}`),
    });
    const excerpt = await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: eventId,
      excerptId: `ex_${eventId}`,
      content: 'Temporary excerpt body',
      purgeAt: ingestPurgeAt,
    });
    return excerpt.id;
  }

  function proposal(input: {
    id: string;
    sourceExcerptId?: string | null;
    sourceCommunicationEventId?: string | null;
    createdAt?: string;
  }): TaskSuggestion {
    return {
      id: asTaskSuggestionId(input.id),
      organizationId: asOrganizationId(org),
      status: 'pending',
      summaryPoints: [
        { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Follow up' },
      ],
      voiceOriginated: false,
      sourceCommunicationEventId: input.sourceCommunicationEventId
        ? asCommunicationEventId(input.sourceCommunicationEventId)
        : null,
      sourceExcerptId: input.sourceExcerptId
        ? asTemporaryCommunicationExcerptId(input.sourceExcerptId)
        : null,
      retention: {},
      version: 1,
      createdAt: input.createdAt ?? now,
      updatedAt: input.createdAt ?? now,
    };
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    await createOrUpdatePendingCommunicationAccount(db.prisma, {
      organizationId: org,
      accountId: 'acct_d082_link',
      emailAddress: 'owner@acme.example',
      externalAccountId: 'google-d082-link',
    });
    await persistConnectedCommunicationAccount(db.prisma, {
      organizationId: org,
      accountId: 'acct_d082_link',
      emailAddress: 'owner@acme.example',
      externalAccountId: 'google-d082-link',
      connectedAt: now,
      historyId: 'hist_1',
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('reaches one excerpt from either linkage', async () => {
    const excerptId = await seedGmailExcerpt('evt_either');
    const ceiling = computeWorkflowSafetyCeilingPurgeAt(now);

    await createTaskSuggestion(
      db.prisma,
      org,
      proposal({ id: 'sug_either_review', sourceExcerptId: excerptId }),
    );
    expect(
      await applyD082ExcerptRetention(db.prisma, org, {
        target: { kind: 'excerpt', excerptId },
      }),
    ).toBe(true);
    expect(
      (await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_either'))?.purgeAt,
    ).toBe(ceiling);

    // Same row, addressed the way A6 addresses it.
    expect(
      await applyD082ExcerptRetention(db.prisma, org, {
        target: { kind: 'communication_event', communicationEventId: 'evt_either' },
      }),
    ).toBe(true);
    expect(
      (await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_either'))?.purgeAt,
    ).toBe(ceiling);
  });

  it('resolves an A6 suggestion and a Review sibling on the same Gmail excerpt together', async () => {
    const excerptId = await seedGmailExcerpt('evt_mixed');
    const a6AssociatedAt = '2026-08-03T12:00:00.000Z';
    const reviewAssociatedAt = '2026-08-20T12:00:00.000Z';

    await createTaskSuggestion(
      db.prisma,
      org,
      proposal({
        id: 'sug_mixed_a6',
        sourceCommunicationEventId: 'evt_mixed',
        createdAt: a6AssociatedAt,
      }),
    );
    await createTaskSuggestion(
      db.prisma,
      org,
      proposal({
        id: 'sug_mixed_review',
        sourceExcerptId: excerptId,
        createdAt: reviewAssociatedAt,
      }),
    );

    // Addressed through A6's linkage, yet the later Review sibling's entitlement wins: one excerpt,
    // one aggregate deadline, whichever column named it.
    expect(
      await applyD082ExcerptRetention(db.prisma, org, {
        target: { kind: 'communication_event', communicationEventId: 'evt_mixed' },
        transitionEntitlements: [
          {
            suggestionId: 'sug_mixed_a6',
            purgeAt: computeWorkflowSafetyCeilingPurgeAt(a6AssociatedAt),
          },
        ],
      }),
    ).toBe(true);
    expect(
      (await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_mixed'))?.purgeAt,
    ).toBe(computeWorkflowSafetyCeilingPurgeAt(reviewAssociatedAt));
  });

  it('writes nothing when no proposal claims the excerpt', async () => {
    await seedGmailExcerpt('evt_unclaimed');
    expect(
      await applyD082ExcerptRetention(db.prisma, org, {
        target: { kind: 'communication_event', communicationEventId: 'evt_unclaimed' },
      }),
    ).toBe(false);
    expect(
      (await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_unclaimed'))?.purgeAt,
    ).toBe(ingestPurgeAt);
  });

  it('writes nothing for a missing or already-purged excerpt', async () => {
    expect(
      await applyD082ExcerptRetention(db.prisma, org, {
        target: { kind: 'excerpt', excerptId: 'ex_absent' },
      }),
    ).toBe(false);

    const excerptId = await seedGmailExcerpt('evt_purged_seam');
    await createTaskSuggestion(
      db.prisma,
      org,
      proposal({ id: 'sug_purged_seam', sourceExcerptId: excerptId }),
    );
    await purgeTemporaryCommunicationExcerpt(db.prisma, org, 'evt_purged_seam', now);

    expect(
      await applyD082ExcerptRetention(db.prisma, org, {
        target: { kind: 'excerpt', excerptId },
        transitionEntitlements: [
          { suggestionId: 'sug_purged_seam', purgeAt: '2027-01-01T00:00:00.000Z' },
        ],
      }),
    ).toBe(false);

    const after = await getTemporaryCommunicationExcerptByEventId(
      db.prisma,
      org,
      'evt_purged_seam',
    );
    expect(after?.purgedAt).toBe(now);
    expect(after?.purgeAt).toBe(ingestPurgeAt);
    expect(after?.content).toBe('');
  });

  it('ignores another organization’s excerpt', async () => {
    const excerptId = await seedGmailExcerpt('evt_other_org');
    await createTaskSuggestion(
      db.prisma,
      org,
      proposal({ id: 'sug_other_org', sourceExcerptId: excerptId }),
    );
    expect(
      await applyD082ExcerptRetention(db.prisma, 'org_someone_else', {
        target: { kind: 'excerpt', excerptId },
      }),
    ).toBe(false);
    expect(
      (await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_other_org'))?.purgeAt,
    ).toBe(ingestPurgeAt);
  });

  it('keeps A6 approve, dismiss, and Task-terminal values identical through the shared resolver', async () => {
    const dismissedAt = '2026-08-05T09:00:00.000Z';
    const approvedAt = '2026-08-06T09:00:00.000Z';
    const taskTerminalAt = '2026-08-11T09:00:00.000Z';

    await seedGmailExcerpt('evt_a6_dismiss');
    const dismissTarget = await createTaskSuggestion(
      db.prisma,
      org,
      proposal({ id: 'sug_a6_dismiss', sourceCommunicationEventId: 'evt_a6_dismiss' }),
    );
    const dismissed = await persistDismissTaskSuggestion({
      db: db.prisma,
      organizationId: org,
      expectedSuggestionVersion: dismissTarget.version,
      suggestion: { ...dismissTarget, status: 'dismissed', version: 2, updatedAt: dismissedAt },
      excerptPurgeAt: computeExcerptPurgeAt(dismissedAt),
      audit: {
        id: 'audit_a6_dismiss',
        organizationId: org,
        actorKind: 'owner',
        ownerId: owner.ownerId,
        action: 'suggestion.dismiss',
        outcome: 'succeeded',
        recordedAt: dismissedAt,
      },
    });
    expect(dismissed.excerptUpdated).toBe(true);
    expect(dismissed.suggestion.sourceCommunicationEventId).toBe('evt_a6_dismiss');
    expect(dismissed.suggestion.sourceExcerptId).toBeNull();
    expect(
      (await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_a6_dismiss'))?.purgeAt,
    ).toBe(computeExcerptPurgeAt(dismissedAt));

    await seedGmailExcerpt('evt_a6_approve');
    const approveTarget = await createTaskSuggestion(
      db.prisma,
      org,
      proposal({ id: 'sug_a6_approve', sourceCommunicationEventId: 'evt_a6_approve' }),
    );
    const task = createStandaloneTask({
      actor: owner,
      now: approvedAt,
      id: asTaskId('task_a6_approve'),
      organizationId: asOrganizationId(org),
      summaryPoints: approveTarget.summaryPoints,
      dueAt: null,
    });
    const approved = await persistApproveTaskSuggestion({
      db: db.prisma,
      organizationId: org,
      expectedSuggestionVersion: approveTarget.version,
      suggestion: {
        ...approveTarget,
        status: 'approved',
        approvedTaskId: asTaskId('task_a6_approve'),
        version: 2,
        updatedAt: approvedAt,
      },
      task,
      responsibilitySelection: {
        id: 'tsrs_a6_approve',
        partyKind: 'owner',
        recipientId: null,
        selectedByOwnerId: owner.ownerId,
        selectedAt: approvedAt,
      },
      excerptPurgeAt: computeWorkflowSafetyCeilingPurgeAt(approvedAt),
      audit: {
        id: 'audit_a6_approve',
        organizationId: org,
        actorKind: 'owner',
        ownerId: owner.ownerId,
        action: 'suggestion.approve',
        outcome: 'succeeded',
        recordedAt: approvedAt,
      },
    });
    expect(approved.excerptUpdated).toBe(true);
    expect(
      (await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_a6_approve'))?.purgeAt,
    ).toBe(computeWorkflowSafetyCeilingPurgeAt(approvedAt));

    const terminal = await persistOwnerTaskMutation({
      db: db.prisma,
      organizationId: org,
      expectedVersion: approved.task.version,
      task: {
        ...approved.task,
        status: 'completed',
        outcome: { type: 'completed', recordedAt: taskTerminalAt, summaryPoints: [] },
        version: approved.task.version + 1,
        updatedAt: taskTerminalAt,
      },
      audit: {
        id: 'audit_a6_complete',
        organizationId: org,
        actorKind: 'owner',
        ownerId: owner.ownerId,
        action: 'task.complete',
        outcome: 'succeeded',
        recordedAt: taskTerminalAt,
      },
    });
    expect(terminal.excerptUpdated).toBe(true);
    expect(
      (await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_a6_approve'))?.purgeAt,
    ).toBe(computeExcerptPurgeAt(taskTerminalAt));
  });

  it('applies the same law to a Google Messages Review excerpt', async () => {
    await upsertGoogleMessagesReviewEvent(db.prisma, {
      organizationId: org,
      eventId: 'cmsg_seam',
      sourceOccurrenceId: '0|com.google.android.apps.messaging|seam',
      dedupeKey: 's'.repeat(64),
      observedAt: now,
    });
    const excerpt = await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: 'cmsg_seam',
      excerptId: 'exm_seam',
      content: 'Selected message text',
      // Review + 7 days, the Messages initial deadline.
      purgeAt: ingestPurgeAt,
    });

    await createTaskSuggestion(
      db.prisma,
      org,
      proposal({ id: 'sug_msg_seam_a', sourceExcerptId: excerpt.id }),
    );
    await createTaskSuggestion(
      db.prisma,
      org,
      proposal({ id: 'sug_msg_seam_b', sourceExcerptId: excerpt.id }),
    );

    expect(
      await applyD082ExcerptRetention(db.prisma, org, {
        target: { kind: 'excerpt', excerptId: excerpt.id },
      }),
    ).toBe(true);
    const after = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'cmsg_seam');
    expect(after?.purgeAt).toBe(computeWorkflowSafetyCeilingPurgeAt(now));
    // Both siblings genuinely link to the one excerpt; neither claims the A6 processing column.
    const siblings = await db.prisma.taskSuggestion.findMany({
      where: { sourceExcerptId: excerpt.id },
      select: { id: true, sourceCommunicationEventId: true },
      orderBy: { id: 'asc' },
    });
    expect(siblings.map((row) => row.id)).toEqual(['sug_msg_seam_a', 'sug_msg_seam_b']);
    for (const row of siblings) {
      expect(row.sourceCommunicationEventId).toBeNull();
    }
  });
});
