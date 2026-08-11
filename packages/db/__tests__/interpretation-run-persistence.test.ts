/**
 * InterpretationRun persistence foundation (D161).
 *
 * Inert storage only: create completed successful runs and evaluate
 * (organizationId, idempotencyKey, requestFingerprint) with HandoffAttempt semantics.
 * No producer, trigger, raw-input, or TaskSuggestion linkage.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PersistenceError } from '../src/errors/persistence-errors.js';
import {
  createInterpretationRun,
  lookupInterpretationRunIdempotency,
  resolveInterpretationRunIdempotency,
  type CreateInterpretationRunInput,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const orgA = 'org_interp_a';
const orgB = 'org_interp_b';

function runInput(
  overrides: Partial<CreateInterpretationRunInput> = {},
): CreateInterpretationRunInput {
  return {
    id: 'irun_1',
    organizationId: orgA,
    idempotencyKey: 'idem_interp_1',
    requestFingerprint: 'fp_interp_1',
    outcome: 'proposals_created',
    modelVersion: 'fixture-model',
    policyVersion: 'interpretation-policy-v1',
    requestId: 'req_interp_1',
    ...overrides,
  };
}

describe('InterpretationRun persistence foundation', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.prisma.interpretationRun.deleteMany();
    await db.prisma.taskSuggestion.deleteMany();
  });

  it('persists a completed run with proposals_created', async () => {
    const created = await createInterpretationRun(db.prisma, runInput());

    expect(created).toMatchObject({
      id: 'irun_1',
      organizationId: orgA,
      idempotencyKey: 'idem_interp_1',
      requestFingerprint: 'fp_interp_1',
      outcome: 'proposals_created',
      modelVersion: 'fixture-model',
      policyVersion: 'interpretation-policy-v1',
      requestId: 'req_interp_1',
    });
    expect(typeof created.createdAt).toBe('string');
  });

  it('persists a completed run with no_proposals', async () => {
    const created = await createInterpretationRun(
      db.prisma,
      runInput({ id: 'irun_zero', outcome: 'no_proposals' }),
    );

    expect(created.outcome).toBe('no_proposals');
    expect(created.id).toBe('irun_zero');
  });

  it('treats successful no_proposals as a valid occurrence without any TaskSuggestion row', async () => {
    await createInterpretationRun(
      db.prisma,
      runInput({ id: 'irun_no_props', outcome: 'no_proposals' }),
    );

    const suggestions = await db.prisma.taskSuggestion.count({
      where: { organizationId: orgA },
    });
    expect(suggestions).toBe(0);

    const runs = await db.prisma.interpretationRun.findMany({
      where: { organizationId: orgA, outcome: 'no_proposals' },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.idempotencyKey).toBe('idem_interp_1');
  });

  it('resolves same organization + same key + same fingerprint as replay', async () => {
    const first = await createInterpretationRun(db.prisma, runInput());

    const lookup = await lookupInterpretationRunIdempotency(db.prisma, {
      organizationId: orgA,
      idempotencyKey: 'idem_interp_1',
      requestFingerprint: 'fp_interp_1',
    });
    expect(lookup.kind).toBe('replay');
    if (lookup.kind !== 'replay') {
      throw new Error('expected replay');
    }
    expect(lookup.run.id).toBe(first.id);

    const resolved = await resolveInterpretationRunIdempotency(db.prisma, {
      organizationId: orgA,
      idempotencyKey: 'idem_interp_1',
      requestFingerprint: 'fp_interp_1',
    });
    expect(resolved.kind).toBe('replay');
  });

  it('resolves same organization + same key + different fingerprint as IDEMPOTENCY_KEY_CONFLICT', async () => {
    await createInterpretationRun(db.prisma, runInput());

    const lookup = await lookupInterpretationRunIdempotency(db.prisma, {
      organizationId: orgA,
      idempotencyKey: 'idem_interp_1',
      requestFingerprint: 'fp_different',
    });
    expect(lookup.kind).toBe('key_conflict');

    await expect(
      resolveInterpretationRunIdempotency(db.prisma, {
        organizationId: orgA,
        idempotencyKey: 'idem_interp_1',
        requestFingerprint: 'fp_different',
      }),
    ).rejects.toMatchObject({
      name: 'PersistenceError',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    } satisfies Partial<PersistenceError>);
  });

  it('allows different organizations to reuse the same idempotency key', async () => {
    await createInterpretationRun(db.prisma, runInput({ id: 'irun_a' }));
    const other = await createInterpretationRun(
      db.prisma,
      runInput({
        id: 'irun_b',
        organizationId: orgB,
        idempotencyKey: 'idem_interp_1',
        requestFingerprint: 'fp_org_b',
      }),
    );

    expect(other.organizationId).toBe(orgB);
    expect(other.idempotencyKey).toBe('idem_interp_1');

    const lookupA = await lookupInterpretationRunIdempotency(db.prisma, {
      organizationId: orgA,
      idempotencyKey: 'idem_interp_1',
      requestFingerprint: 'fp_interp_1',
    });
    const lookupB = await lookupInterpretationRunIdempotency(db.prisma, {
      organizationId: orgB,
      idempotencyKey: 'idem_interp_1',
      requestFingerprint: 'fp_org_b',
    });
    expect(lookupA.kind).toBe('replay');
    expect(lookupB.kind).toBe('replay');
  });

  it('rejects null idempotency_key at the database', async () => {
    await expect(
      db.pglite.query(
        `INSERT INTO interpretation_runs (
           id, organization_id, idempotency_key, request_fingerprint,
           outcome, model_version, policy_version, request_id
         ) VALUES (
           'irun_null_key', $1, NULL, 'fp_x',
           'no_proposals', 'm', 'p', 'req_x'
         )`,
        [orgA],
      ),
    ).rejects.toThrow();
  });

  it('rejects null request_fingerprint at the database', async () => {
    await expect(
      db.pglite.query(
        `INSERT INTO interpretation_runs (
           id, organization_id, idempotency_key, request_fingerprint,
           outcome, model_version, policy_version, request_id
         ) VALUES (
           'irun_null_fp', $1, 'idem_null_fp', NULL,
           'no_proposals', 'm', 'p', 'req_x'
         )`,
        [orgA],
      ),
    ).rejects.toThrow();
  });

  it('rejects null request_id at the database', async () => {
    await expect(
      db.pglite.query(
        `INSERT INTO interpretation_runs (
           id, organization_id, idempotency_key, request_fingerprint,
           outcome, model_version, policy_version, request_id
         ) VALUES (
           'irun_null_req', $1, 'idem_null_req', 'fp_x',
           'no_proposals', 'm', 'p', NULL
         )`,
        [orgA],
      ),
    ).rejects.toThrow();
  });

  it('persists a valid run that includes requestId', async () => {
    const created = await createInterpretationRun(
      db.prisma,
      runInput({ id: 'irun_with_req', requestId: 'req_durable_trace' }),
    );

    expect(created.requestId).toBe('req_durable_trace');

    const row = await db.prisma.interpretationRun.findUniqueOrThrow({
      where: { id: 'irun_with_req' },
    });
    expect(row.requestId).toBe('req_durable_trace');
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
       WHERE c.relname = 'interpretation_runs'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.relrowsecurity).toBe(true);
    expect(Number(rows.rows[0]?.policies ?? -1)).toBe(0);
  });

  it('reports new_request when no row exists for the key', async () => {
    const lookup = await lookupInterpretationRunIdempotency(db.prisma, {
      organizationId: orgA,
      idempotencyKey: 'idem_missing',
      requestFingerprint: 'fp_x',
    });
    expect(lookup).toEqual({ kind: 'new_request' });
  });
});
