/**
 * S3.1 atomic interpretation persistence (D161, D169).
 *
 * Proves that one interpretation occurrence and its 0..N canonical proposals commit or roll back
 * together, that organization-scoped idempotency resolves replay and conflict through the existing
 * taxonomy, and that no canonical Task is created by interpretation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asOrganizationId, asTaskSuggestionId, type TaskSuggestion } from '@aicaa/domain';
import {
  findInterpretationRunByIdempotencyKey,
  persistInterpretationOccurrence,
  resolveInterpretationOccurrence,
  type PersistInterpretationOccurrenceInput,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const org = 'org_s3_interp';
const otherOrg = 'org_s3_interp_other';
const now = '2026-08-11T12:00:00.000Z';

function runInput(
  overrides: Partial<PersistInterpretationOccurrenceInput['run']> = {},
): PersistInterpretationOccurrenceInput['run'] {
  return {
    id: 'irun_s3_1',
    organizationId: org,
    idempotencyKey: 'idem_s3_1',
    requestFingerprint: 'fp_s3_1',
    sourceKind: 'owner_manual_capture',
    modelVersion: 'fixture-model',
    policyVersion: 'interpretation-v1',
    requestId: 'req_s3_1',
    ...overrides,
  };
}

function proposal(id: string, overrides: Partial<TaskSuggestion> = {}): TaskSuggestion {
  return {
    id: asTaskSuggestionId(id),
    organizationId: asOrganizationId(org),
    status: 'pending',
    summaryPoints: [
      { id: 'sp1', kind: 'request', label: 'Request', order: 0, value: 'Send the quote' },
    ],
    sourceReference: {
      id: 'src_idem_s3_1',
      sourceType: 'manual',
      dedupeKey: 'owner_manual_capture:idem_s3_1',
      capturedAt: now,
    },
    voiceOriginated: false,
    sourceCommunicationEventId: null,
    retention: {},
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('S3.1 interpretation occurrence persistence (PGlite)', () => {
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
    await db.prisma.task.deleteMany();
  });

  it('records a zero-proposal interpretation as truthful success', async () => {
    const occurrence = await persistInterpretationOccurrence({
      db: db.prisma,
      run: runInput(),
      suggestions: [],
    });

    expect(occurrence.run.outcome).toBe('no_proposals');
    expect(occurrence.suggestions).toEqual([]);
    expect(await db.prisma.interpretationRun.count()).toBe(1);
    expect(await db.prisma.taskSuggestion.count()).toBe(0);
  });

  it('persists one occurrence and its N pending proposals with the internal run linkage', async () => {
    const occurrence = await persistInterpretationOccurrence({
      db: db.prisma,
      run: runInput(),
      suggestions: [proposal('sug_s3_a'), proposal('sug_s3_b'), proposal('sug_s3_c')],
    });

    expect(occurrence.run.outcome).toBe('proposals_created');
    expect(occurrence.run.sourceKind).toBe('owner_manual_capture');
    expect(occurrence.suggestions).toHaveLength(3);
    for (const suggestion of occurrence.suggestions) {
      expect(suggestion.organizationId).toBe(org);
      expect(suggestion.status).toBe('pending');
      expect(suggestion.interpretationRunId).toBe(occurrence.run.id);
      expect(suggestion.sourceCommunicationEventId).toBeNull();
      expect(suggestion.approvedTaskId).toBeNull();
    }

    expect(await db.prisma.interpretationRun.count()).toBe(1);
    expect(await db.prisma.taskSuggestion.count()).toBe(3);
    // Interpretation proposes; it never creates canonical Task truth.
    expect(await db.prisma.task.count()).toBe(0);
    expect(await db.prisma.taskAssignment.count()).toBe(0);
  });

  it('rolls the occurrence back when a proposal cannot be persisted', async () => {
    // Repository-native failure: the second insert violates the TaskSuggestion primary key inside
    // the same transaction that already inserted the run.
    await expect(
      persistInterpretationOccurrence({
        db: db.prisma,
        run: runInput(),
        suggestions: [proposal('sug_s3_dup'), proposal('sug_s3_ok'), proposal('sug_s3_dup')],
      }),
    ).rejects.toBeDefined();

    expect(await db.prisma.interpretationRun.count()).toBe(0);
    expect(await db.prisma.taskSuggestion.count()).toBe(0);
    expect(await findInterpretationRunByIdempotencyKey(db.prisma, org, 'idem_s3_1')).toBeNull();
  });

  it('derives the outcome from the proposal set rather than trusting a caller', async () => {
    const empty = await persistInterpretationOccurrence({
      db: db.prisma,
      run: runInput({ id: 'irun_empty', idempotencyKey: 'idem_empty' }),
      suggestions: [],
    });
    const populated = await persistInterpretationOccurrence({
      db: db.prisma,
      run: runInput({ id: 'irun_full', idempotencyKey: 'idem_full' }),
      suggestions: [proposal('sug_outcome')],
    });

    expect(empty.run.outcome).toBe('no_proposals');
    expect(populated.run.outcome).toBe('proposals_created');
  });

  it('refuses proposals that do not belong to the occurrence scope or lifecycle', async () => {
    await expect(
      persistInterpretationOccurrence({
        db: db.prisma,
        run: runInput(),
        suggestions: [proposal('sug_x', { organizationId: asOrganizationId(otherOrg) })],
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_MISMATCH' });

    await expect(
      persistInterpretationOccurrence({
        db: db.prisma,
        run: runInput(),
        suggestions: [proposal('sug_y', { status: 'approved' })],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    expect(await db.prisma.interpretationRun.count()).toBe(0);
    expect(await db.prisma.taskSuggestion.count()).toBe(0);
  });

  it('resolves an exact replay from committed state without creating anything', async () => {
    const created = await persistInterpretationOccurrence({
      db: db.prisma,
      run: runInput(),
      suggestions: [proposal('sug_replay_1'), proposal('sug_replay_2')],
    });

    const resolution = await resolveInterpretationOccurrence(db.prisma, {
      organizationId: org,
      idempotencyKey: 'idem_s3_1',
      requestFingerprint: 'fp_s3_1',
    });

    expect(resolution.kind).toBe('replay');
    if (resolution.kind !== 'replay') {
      throw new Error('expected replay');
    }
    expect(resolution.occurrence.run.id).toBe(created.run.id);
    expect(resolution.occurrence.suggestions.map((item) => item.id)).toEqual([
      'sug_replay_1',
      'sug_replay_2',
    ]);
    expect(await db.prisma.interpretationRun.count()).toBe(1);
    expect(await db.prisma.taskSuggestion.count()).toBe(2);
  });

  it('raises the existing idempotency conflict for a reused key with a different fingerprint', async () => {
    await persistInterpretationOccurrence({
      db: db.prisma,
      run: runInput(),
      suggestions: [proposal('sug_conflict')],
    });

    await expect(
      resolveInterpretationOccurrence(db.prisma, {
        organizationId: org,
        idempotencyKey: 'idem_s3_1',
        requestFingerprint: 'fp_different',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });

    expect(await db.prisma.interpretationRun.count()).toBe(1);
    expect(await db.prisma.taskSuggestion.count()).toBe(1);
  });

  it('reports a same-key race as a unique violation and commits nothing twice', async () => {
    await persistInterpretationOccurrence({
      db: db.prisma,
      run: runInput(),
      suggestions: [proposal('sug_race_first')],
    });

    await expect(
      persistInterpretationOccurrence({
        db: db.prisma,
        run: runInput({ id: 'irun_race_second' }),
        suggestions: [proposal('sug_race_second')],
      }),
    ).rejects.toMatchObject({ code: 'UNIQUE_VIOLATION' });

    expect(await db.prisma.interpretationRun.count()).toBe(1);
    expect(await db.prisma.taskSuggestion.count()).toBe(1);
    expect(
      await db.prisma.taskSuggestion.findUnique({ where: { id: 'sug_race_second' } }),
    ).toBeNull();
  });

  it('keeps idempotency keys, occurrences, and proposals organization-scoped', async () => {
    const mine = await persistInterpretationOccurrence({
      db: db.prisma,
      run: runInput(),
      suggestions: [proposal('sug_org_a')],
    });
    const theirs = await persistInterpretationOccurrence({
      db: db.prisma,
      // Same idempotency key and fingerprint, different organization.
      run: runInput({ id: 'irun_other', organizationId: otherOrg }),
      suggestions: [proposal('sug_org_b', { organizationId: asOrganizationId(otherOrg) })],
    });

    expect(theirs.run.id).not.toBe(mine.run.id);

    // The other organization's key resolves only its own occurrence, never this one.
    const theirResolution = await resolveInterpretationOccurrence(db.prisma, {
      organizationId: otherOrg,
      idempotencyKey: 'idem_s3_1',
      requestFingerprint: 'fp_s3_1',
    });
    expect(theirResolution.kind).toBe('replay');
    if (theirResolution.kind !== 'replay') {
      throw new Error('expected replay');
    }
    expect(theirResolution.occurrence.run.id).toBe('irun_other');
    expect(theirResolution.occurrence.suggestions.map((item) => item.id)).toEqual(['sug_org_b']);

    // A third organization sharing the key sees no occurrence at all.
    const stranger = await resolveInterpretationOccurrence(db.prisma, {
      organizationId: 'org_s3_stranger',
      idempotencyKey: 'idem_s3_1',
      requestFingerprint: 'fp_s3_1',
    });
    expect(stranger.kind).toBe('new_request');
  });
});
