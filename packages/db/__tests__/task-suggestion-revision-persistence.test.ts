/**
 * TaskSuggestion revision-evidence persistence foundation (D155).
 *
 * Inert create/read storage only. No producer, A6 wiring, Owner-edit capture, or
 * accepted-revision persistence. Unique (suggestionId, revisionNumber) is numbering
 * protection — not immutability protection.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PersistenceError } from '../src/errors/persistence-errors.js';
import {
  createTaskSuggestionRevision,
  getLatestTaskSuggestionRevision,
  listTaskSuggestionRevisions,
  type CreateTaskSuggestionRevisionInput,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const orgA = 'org_rev_a';
const orgB = 'org_rev_b';

const summaryPointsA = [
  { id: 'p1', kind: 'next_action', label: 'First', order: 0, value: 'do-first' },
  { id: 'p2', kind: 'context', label: 'Second', order: 1, value: 'do-second' },
];

async function seedSuggestion(
  db: TestDatabase,
  id: string,
  organizationId: string = orgA,
): Promise<void> {
  await db.prisma.taskSuggestion.create({
    data: {
      id,
      organizationId,
      status: 'pending',
      summaryPoints: summaryPointsA,
      voiceOriginated: false,
      retention: {},
      version: 1,
    },
  });
}

function revisionInput(
  overrides: Partial<CreateTaskSuggestionRevisionInput> = {},
): CreateTaskSuggestionRevisionInput {
  return {
    id: 'tsr_1',
    organizationId: orgA,
    suggestionId: 'sug_rev_1',
    revisionNumber: 0,
    authorKind: 'ai',
    summaryPoints: summaryPointsA,
    ...overrides,
  };
}

describe('TaskSuggestion revision persistence foundation', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.prisma.taskSuggestionRevision.deleteMany();
    await db.prisma.taskSuggestion.deleteMany();
  });

  it('round-trips authorKind = ai including revision 0', async () => {
    await seedSuggestion(db, 'sug_rev_1');
    const created = await createTaskSuggestionRevision(db.prisma, revisionInput());

    expect(created).toMatchObject({
      id: 'tsr_1',
      organizationId: orgA,
      suggestionId: 'sug_rev_1',
      revisionNumber: 0,
      authorKind: 'ai',
      proposedDueAt: null,
      proposedPriority: null,
      proposedRecipientId: null,
    });
    expect(created.summaryPoints).toEqual(summaryPointsA);
    expect(typeof created.createdAt).toBe('string');
  });

  it('round-trips authorKind = owner as a legitimate revision 0', async () => {
    await seedSuggestion(db, 'sug_rev_1');
    const created = await createTaskSuggestionRevision(
      db.prisma,
      revisionInput({ id: 'tsr_owner_0', authorKind: 'owner' }),
    );

    expect(created.authorKind).toBe('owner');
    expect(created.revisionNumber).toBe(0);
  });

  it('lists multiple revisions in revision-number order', async () => {
    await seedSuggestion(db, 'sug_rev_1');
    await createTaskSuggestionRevision(
      db.prisma,
      revisionInput({ id: 'tsr_0', revisionNumber: 0, authorKind: 'ai' }),
    );
    await createTaskSuggestionRevision(
      db.prisma,
      revisionInput({
        id: 'tsr_2',
        revisionNumber: 2,
        authorKind: 'owner',
        summaryPoints: [{ id: 'p1', kind: 'next_action', label: 'Later', order: 0, value: 'x' }],
      }),
    );
    await createTaskSuggestionRevision(
      db.prisma,
      revisionInput({
        id: 'tsr_1b',
        revisionNumber: 1,
        authorKind: 'owner',
        summaryPoints: [{ id: 'p1', kind: 'next_action', label: 'Mid', order: 0, value: 'y' }],
      }),
    );

    const listed = await listTaskSuggestionRevisions(db.prisma, orgA, 'sug_rev_1');
    expect(listed.map((r) => r.revisionNumber)).toEqual([0, 1, 2]);
    expect(listed.map((r) => r.id)).toEqual(['tsr_0', 'tsr_1b', 'tsr_2']);

    const latest = await getLatestTaskSuggestionRevision(db.prisma, orgA, 'sug_rev_1');
    expect(latest?.id).toBe('tsr_2');
    expect(latest?.revisionNumber).toBe(2);
  });

  it('allows two different suggestions to each have revision 0', async () => {
    await seedSuggestion(db, 'sug_rev_1');
    await seedSuggestion(db, 'sug_rev_2');
    await createTaskSuggestionRevision(
      db.prisma,
      revisionInput({ id: 'tsr_a', suggestionId: 'sug_rev_1' }),
    );
    await createTaskSuggestionRevision(
      db.prisma,
      revisionInput({ id: 'tsr_b', suggestionId: 'sug_rev_2', authorKind: 'owner' }),
    );

    const a = await listTaskSuggestionRevisions(db.prisma, orgA, 'sug_rev_1');
    const b = await listTaskSuggestionRevisions(db.prisma, orgA, 'sug_rev_2');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.revisionNumber).toBe(0);
    expect(b[0]?.revisionNumber).toBe(0);
  });

  it('rejects duplicate (suggestionId, revisionNumber)', async () => {
    await seedSuggestion(db, 'sug_rev_1');
    await createTaskSuggestionRevision(db.prisma, revisionInput());

    await expect(
      createTaskSuggestionRevision(db.prisma, revisionInput({ id: 'tsr_dup', revisionNumber: 0 })),
    ).rejects.toMatchObject({
      name: 'PersistenceError',
      code: 'UNIQUE_VIOLATION',
    } satisfies Partial<PersistenceError>);
  });

  it('rejects negative revision numbers at the database', async () => {
    await seedSuggestion(db, 'sug_rev_1');
    await expect(
      db.pglite.query(
        `INSERT INTO task_suggestion_revisions (
           id, organization_id, suggestion_id, revision_number, author_kind, summary_points
         ) VALUES (
           'tsr_neg', $1, 'sug_rev_1', -1, 'ai', $2::jsonb
         )`,
        [orgA, JSON.stringify(summaryPointsA)],
      ),
    ).rejects.toThrow();
  });

  it('round-trips optional due/priority/recipient fields', async () => {
    await seedSuggestion(db, 'sug_rev_1');
    const created = await createTaskSuggestionRevision(
      db.prisma,
      revisionInput({
        id: 'tsr_opts',
        proposedDueAt: '2026-08-09T18:30:00.000Z',
        proposedPriority: 'urgent',
        proposedRecipientId: 'recip_optional',
      }),
    );

    expect(created.proposedDueAt).toBe('2026-08-09T18:30:00.000Z');
    expect(created.proposedPriority).toBe('urgent');
    expect(created.proposedRecipientId).toBe('recip_optional');
  });

  it('preserves summaryPoints ordering', async () => {
    await seedSuggestion(db, 'sug_rev_1');
    const ordered = [
      { id: 'z', kind: 'context', label: 'Z', order: 0, value: 'z-first' },
      { id: 'a', kind: 'next_action', label: 'A', order: 1, value: 'a-second' },
      { id: 'm', kind: 'context', label: 'M', order: 2, value: 'm-third' },
    ];
    const created = await createTaskSuggestionRevision(
      db.prisma,
      revisionInput({ id: 'tsr_order', summaryPoints: ordered }),
    );

    expect(created.summaryPoints).toEqual(ordered);
    const raw = await db.prisma.taskSuggestionRevision.findUniqueOrThrow({
      where: { id: 'tsr_order' },
    });
    expect(raw.summaryPoints).toEqual(ordered);
  });

  it('scopes list/latest reads to organization + suggestion', async () => {
    await seedSuggestion(db, 'sug_rev_1', orgA);
    await seedSuggestion(db, 'sug_rev_1b', orgB);
    await createTaskSuggestionRevision(db.prisma, revisionInput({ id: 'tsr_org_a' }));
    await createTaskSuggestionRevision(
      db.prisma,
      revisionInput({
        id: 'tsr_org_b',
        organizationId: orgB,
        suggestionId: 'sug_rev_1b',
      }),
    );

    expect(await listTaskSuggestionRevisions(db.prisma, orgA, 'sug_rev_1')).toHaveLength(1);
    expect(await listTaskSuggestionRevisions(db.prisma, orgB, 'sug_rev_1')).toHaveLength(0);
    expect(await getLatestTaskSuggestionRevision(db.prisma, orgA, 'sug_missing')).toBeNull();
  });

  it('treats empty revision history as no recorded evidence, not absence of a proposal', async () => {
    await seedSuggestion(db, 'sug_rev_1');
    const listed = await listTaskSuggestionRevisions(db.prisma, orgA, 'sug_rev_1');
    const latest = await getLatestTaskSuggestionRevision(db.prisma, orgA, 'sug_rev_1');
    expect(listed).toEqual([]);
    expect(latest).toBeNull();

    const suggestion = await db.prisma.taskSuggestion.findUniqueOrThrow({
      where: { id: 'sug_rev_1' },
    });
    expect(suggestion.status).toBe('pending');
  });

  it('enables deny-by-default RLS with no policies', async () => {
    const rows = await db.pglite.query<{
      relname: string;
      relrowsecurity: boolean;
      policies: bigint;
    }>(
      `SELECT c.relname, c.relrowsecurity,
              (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies
       FROM pg_class c
       WHERE c.relname = 'task_suggestion_revisions'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.relrowsecurity).toBe(true);
    expect(Number(rows.rows[0]?.policies ?? -1)).toBe(0);
  });
});
