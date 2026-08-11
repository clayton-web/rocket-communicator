import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import {
  mapInterpretationRun,
  type PersistedInterpretationRun,
} from '../mappers/domain-mappers.js';
import { idempotencyKeyConflict, uniqueViolation } from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

export type InterpretationRunOutcomeValue = 'proposals_created' | 'no_proposals';

/** Which kind of source an occurrence interpreted (D161 provenance, not authorization). */
export type InterpretationSourceKindValue = 'owner_manual_capture' | 'gmail';

export type CreateInterpretationRunInput = {
  id: string;
  organizationId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  sourceKind: InterpretationSourceKindValue;
  outcome: InterpretationRunOutcomeValue;
  modelVersion: string;
  policyVersion: string;
  requestId: string;
};

/**
 * Persist one completed successful InterpretationRun (D161).
 *
 * Callers must only invoke this for completed successful outcomes. A failed provider call must not
 * create a row. Duplicate `(organizationId, idempotencyKey)` surfaces as `UNIQUE_VIOLATION`; callers
 * re-`lookupInterpretationRunIdempotency` / `resolveInterpretationRunIdempotency` to distinguish
 * replay from fingerprint conflict (HandoffAttempt pattern).
 */
export async function createInterpretationRun(
  db: Client,
  input: CreateInterpretationRunInput,
): Promise<PersistedInterpretationRun> {
  try {
    const row = await db.interpretationRun.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        sourceKind: input.sourceKind,
        outcome: input.outcome,
        modelVersion: input.modelVersion,
        policyVersion: input.policyVersion,
        requestId: input.requestId,
      },
    });
    return mapInterpretationRun(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw uniqueViolation('Idempotency key already exists for this organization.');
    }
    throw error;
  }
}

export async function findInterpretationRunByIdempotencyKey(
  db: Client,
  organizationId: string,
  idempotencyKey: string,
): Promise<PersistedInterpretationRun | null> {
  const row = await db.interpretationRun.findUnique({
    where: {
      organizationId_idempotencyKey: { organizationId, idempotencyKey },
    },
  });
  return row ? mapInterpretationRun(row) : null;
}

export type InterpretationRunIdempotencyLookup =
  | { kind: 'new_request' }
  | { kind: 'replay'; run: PersistedInterpretationRun }
  | { kind: 'key_conflict'; run: PersistedInterpretationRun };

/**
 * HandoffAttempt-style idempotency evaluation for a completed InterpretationRun (D161).
 *
 * - no row → `new_request`
 * - same fingerprint → `replay` (return existing completed occurrence)
 * - different fingerprint → `key_conflict`
 */
export async function lookupInterpretationRunIdempotency(
  db: Client,
  input: {
    organizationId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  },
): Promise<InterpretationRunIdempotencyLookup> {
  const existing = await findInterpretationRunByIdempotencyKey(
    db,
    input.organizationId,
    input.idempotencyKey,
  );
  if (!existing) {
    return { kind: 'new_request' };
  }
  if (existing.requestFingerprint !== input.requestFingerprint) {
    return { kind: 'key_conflict', run: existing };
  }
  return { kind: 'replay', run: existing };
}

/**
 * Like `lookupInterpretationRunIdempotency`, but fingerprint mismatch throws
 * `IDEMPOTENCY_KEY_CONFLICT` rather than returning `key_conflict`.
 */
export async function resolveInterpretationRunIdempotency(
  db: Client,
  input: {
    organizationId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  },
): Promise<{ kind: 'new_request' } | { kind: 'replay'; run: PersistedInterpretationRun }> {
  const lookup = await lookupInterpretationRunIdempotency(db, input);
  if (lookup.kind === 'key_conflict') {
    throw idempotencyKeyConflict('Idempotency key reused with a different request fingerprint.');
  }
  return lookup;
}
