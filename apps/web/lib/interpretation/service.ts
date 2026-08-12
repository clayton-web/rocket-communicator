import 'server-only';
import { randomBytes } from 'node:crypto';
import {
  createInterpretationProvider,
  type InterpretationProvider,
  type ProposedTask,
} from '@aicaa/ai';
import {
  asOrganizationId,
  asTaskSuggestionId,
  type SourceReference,
  type TaskSuggestion,
} from '@aicaa/domain';
import type { DbClient, InterpretationOccurrence } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { computeInterpretationRequestFingerprint } from './fingerprint';

/**
 * The only interpretation source kind authorized to produce occurrences today (D169). The service
 * itself is source-neutral: a later authorized Gmail or SMS adapter supplies its own kind and
 * captured-at and reuses everything below rather than growing a second interpretation system.
 */
export type AuthorizedInterpretationSourceKind = 'owner_manual_capture';

export interface InterpretationRequest {
  organizationId: string;
  sourceKind: AuthorizedInterpretationSourceKind;
  /** Owner capture text. Interpreted transiently and never persisted (D169). */
  rawInput: string;
  /** Organization-scoped idempotency key supplied by the caller. */
  idempotencyKey: string;
  /** Durable traceability id recorded on the occurrence. */
  requestId: string;
  /** When the source was captured. Defaults to the service clock. */
  capturedAt?: string | null;
  /** Owner/org IANA timezone when known. Mechanical context only. */
  timezone?: string | null;
}

export interface InterpretationServiceDeps {
  /** Injected provider for tests. Production composition is default closed (D169). */
  provider?: InterpretationProvider;
}

export type InterpretationServiceResult = InterpretationOccurrence & {
  /** `replayed` means the occurrence already existed for this key and fingerprint. */
  outcome: 'created' | 'replayed';
};

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

/**
 * Deterministic source reference for a manual capture (D169).
 *
 * The occurrence's organization-scoped idempotency key is the only stable identity a manual capture
 * has, so both the reference id and the dedupe key derive from it: sibling proposals from one
 * capture truthfully share one source. Gmail identity semantics are deliberately absent — no
 * `externalIds`, no provider message id, no contact hint. There is no `excerptRef` because no raw
 * input is stored, and the interpretation run id is not embedded because it is internal provenance
 * that must stay off the public TaskSuggestion contract.
 */
function buildManualCaptureSourceReference(input: {
  idempotencyKey: string;
  capturedAt: string;
}): SourceReference {
  return {
    id: `src_${input.idempotencyKey}`,
    sourceType: 'manual',
    dedupeKey: `owner_manual_capture:${input.idempotencyKey}`,
    capturedAt: input.capturedAt,
  };
}

/**
 * Map one validated `ProposedTask` onto the canonical TaskSuggestion model.
 *
 * `summaryPoints` are the canonical proposal content and carry over unchanged, including any
 * deadline-kind points the interpretation already grounded. The advisory interpretation-layer
 * fields are intentionally not persisted (D169): `peopleHints` must not become a Recipient,
 * assignment, or responsibility, and an unresolved `deadlineExpression` must not be promoted into
 * `proposedDueAt`. Neither has a column, and their omission is a decision rather than an oversight.
 */
function buildProposedSuggestion(input: {
  organizationId: string;
  proposal: ProposedTask;
  sourceReference: SourceReference;
  now: string;
}): TaskSuggestion {
  return {
    id: asTaskSuggestionId(newId('sug')),
    organizationId: asOrganizationId(input.organizationId),
    status: 'pending',
    summaryPoints: input.proposal.summaryPoints,
    sourceReference: input.sourceReference,
    voiceOriginated: false,
    sourceCommunicationEventId: null,
    retention: {},
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Shared backend interpretation: source-neutral request in, canonical proposals persisted (D169).
 *
 * Sequence, and the reason for it:
 *
 * 1. Resolve organization-scoped idempotency **before** interpreting. An exact replay is answered
 *    from committed canonical state, so the provider is not called a second time, and a reused key
 *    with a different fingerprint raises the existing `IDEMPOTENCY_KEY_CONFLICT` before any work.
 * 2. Call the provider with no database transaction open. A failed call leaves nothing behind:
 *    there is no InterpretationRun, no TaskSuggestion, and no attempt row to record it.
 * 3. Persist the occurrence and its 0..N proposals in one transaction. `tasks: []` is truthful
 *    success recorded as `no_proposals`, not a failure and not a manufactured placeholder.
 *
 * Nothing here creates a canonical Task, approves a proposal, chooses responsibility, or writes an
 * assignment; acceptance remains the Owner's, through the existing review path. The service has no
 * HTTP or Android reachability in this slice.
 */
export async function interpretCapture(input: {
  db: DbClient;
  request: InterpretationRequest;
  now?: string;
  deps?: InterpretationServiceDeps;
}): Promise<InterpretationServiceResult> {
  const runtime = await loadDbRuntime();
  const now = input.now ?? new Date().toISOString();
  const capturedAt = input.request.capturedAt ?? now;
  const timezone = input.request.timezone ?? null;

  const idempotency = {
    organizationId: input.request.organizationId,
    idempotencyKey: input.request.idempotencyKey,
    requestFingerprint: computeInterpretationRequestFingerprint({
      organizationId: input.request.organizationId,
      sourceKind: input.request.sourceKind,
      rawInput: input.request.rawInput,
      capturedAt,
      timezone,
    }),
  };

  const resolved = await runtime.resolveInterpretationOccurrence(input.db, idempotency);
  if (resolved.kind === 'replay') {
    return { outcome: 'replayed', ...resolved.occurrence };
  }

  const provider = input.deps?.provider ?? createInterpretationProvider();
  const interpretation = await provider.interpret({
    rawInput: input.request.rawInput,
    capturedAt,
    timezone,
  });

  const sourceReference = buildManualCaptureSourceReference({
    idempotencyKey: input.request.idempotencyKey,
    capturedAt,
  });
  const suggestions = interpretation.tasks.map((proposal) =>
    buildProposedSuggestion({
      organizationId: input.request.organizationId,
      proposal,
      sourceReference,
      now,
    }),
  );

  try {
    const occurrence = await runtime.persistInterpretationOccurrence({
      db: input.db,
      run: {
        id: newId('irun'),
        ...idempotency,
        sourceKind: input.request.sourceKind,
        modelVersion: interpretation.modelVersion,
        policyVersion: interpretation.policyVersion,
        requestId: input.request.requestId,
      },
      suggestions,
    });
    return { outcome: 'created', ...occurrence };
  } catch (error) {
    // A concurrent request with the same key committed first. Our transaction rolled back whole, so
    // nothing of this attempt persisted; the committed occurrence is the answer.
    if (runtime.isPersistenceError(error) && error.code === 'UNIQUE_VIOLATION') {
      const replay = await runtime.resolveInterpretationOccurrence(input.db, idempotency);
      if (replay.kind === 'replay') {
        return { outcome: 'replayed', ...replay.occurrence };
      }
    }
    throw error;
  }
}
