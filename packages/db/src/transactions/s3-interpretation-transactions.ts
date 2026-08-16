import type { TaskSuggestion } from '@aicaa/domain';
import { computeWorkflowSafetyCeilingPurgeAt } from '@aicaa/domain';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import {
  createInterpretationRun,
  resolveInterpretationRunIdempotency,
  type CreateInterpretationRunInput,
} from '../repositories/interpretation-run-repository.js';
import {
  createTaskSuggestion,
  listTaskSuggestionsByInterpretationRunId,
} from '../repositories/suggestion-repository.js';
import type {
  PersistedInterpretationRun,
  TaskSuggestionWithInterpretationRun,
} from '../mappers/domain-mappers.js';
import { organizationMismatch, persistenceValidation } from '../errors/persistence-errors.js';
import { applyD082ExcerptRetention, type TransitionEntitlement } from './d082-excerpt-retention.js';

/**
 * One completed interpretation occurrence together with the proposals it owns (D161).
 *
 * `suggestions` is 0..N: a `no_proposals` occurrence legitimately owns none. The proposals carry
 * `interpretationRunId` because it is internal provenance the application layer may read; it stays
 * off the public TaskSuggestion contract (D169).
 */
export type InterpretationOccurrence = {
  run: PersistedInterpretationRun;
  suggestions: TaskSuggestionWithInterpretationRun[];
};

export type InterpretationOccurrenceResolution =
  { kind: 'new_request' } | { kind: 'replay'; occurrence: InterpretationOccurrence };

/**
 * Organization-scoped idempotency resolution for a shared interpretation request (D161, D169).
 *
 * Read-only, and callable **before** the AI provider is invoked, so an exact replay recovers the
 * committed occurrence from canonical state without a second interpretation. Fingerprint mismatch
 * raises the existing `IDEMPOTENCY_KEY_CONFLICT` through
 * {@link resolveInterpretationRunIdempotency} rather than a second conflict scheme.
 */
export async function resolveInterpretationOccurrence(
  db: DbClient,
  input: {
    organizationId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  },
): Promise<InterpretationOccurrenceResolution> {
  const idempotency = await resolveInterpretationRunIdempotency(db, input);
  if (idempotency.kind === 'new_request') {
    return { kind: 'new_request' };
  }
  const suggestions = await listTaskSuggestionsByInterpretationRunId(
    db,
    input.organizationId,
    idempotency.run.id,
  );
  return { kind: 'replay', occurrence: { run: idempotency.run, suggestions } };
}

export type PersistInterpretationOccurrenceInput = {
  db: DbClient;
  /**
   * Everything about the occurrence except `outcome`, which is derived from the proposal set so a
   * caller cannot record `proposals_created` without proposals or `no_proposals` alongside them.
   */
  run: Omit<CreateInterpretationRunInput, 'outcome'>;
  /** Validated proposals for this occurrence. Empty is truthful success, not a failure. */
  suggestions: TaskSuggestion[];
};

/**
 * The D082 workflow hold this occurrence's proposals establish on the excerpts backing them.
 *
 * Grouped per excerpt because sibling proposals of one Review share one, and each contributes its
 * own `associatedAt + 30 days` entitlement. The association instant is the proposal's own
 * `createdAt`: the write that made this excerpt evidence for a workflow is the write that created
 * the proposal, and there is no separate association timestamp to disagree with it.
 *
 * Proposals with no excerpt linkage — manual capture — appear here not at all, which is why a manual
 * capture creates no entitlement rather than an empty one.
 */
function groupAssociationEntitlements(
  suggestions: readonly TaskSuggestion[],
): Map<string, TransitionEntitlement[]> {
  const grouped = new Map<string, TransitionEntitlement[]>();
  for (const suggestion of suggestions) {
    if (!suggestion.sourceExcerptId) {
      continue;
    }
    const entitlement: TransitionEntitlement = {
      suggestionId: suggestion.id,
      purgeAt: computeWorkflowSafetyCeilingPurgeAt(suggestion.createdAt),
    };
    const existing = grouped.get(suggestion.sourceExcerptId);
    if (existing) {
      existing.push(entitlement);
    } else {
      grouped.set(suggestion.sourceExcerptId, [entitlement]);
    }
  }
  return grouped;
}

/**
 * Refuse a proposal claiming an excerpt this organization does not own.
 *
 * The foreign key proves the excerpt exists; it does not prove whose it is. Server-controlled
 * provenance means a foreign id should be unreachable, and this makes it unrepresentable rather than
 * merely unlikely — a cross-organization linkage would be a durable privacy defect even though the
 * organization-scoped retention resolver would refuse to act on it.
 */
async function assertExcerptsOwnedByOrganization(
  tx: DbTransaction,
  organizationId: string,
  excerptIds: readonly string[],
): Promise<void> {
  if (excerptIds.length === 0) {
    return;
  }
  const owned = await tx.temporaryCommunicationExcerpt.count({
    where: { organizationId, id: { in: [...excerptIds] } },
  });
  if (owned !== excerptIds.length) {
    throw organizationMismatch(
      'Interpretation proposal source excerpt must belong to the occurrence organization.',
    );
  }
}

function assertPersistableProposal(organizationId: string, suggestion: TaskSuggestion): void {
  if (suggestion.organizationId !== organizationId) {
    throw organizationMismatch('Suggestion organizationId must match the occurrence scope.');
  }
  if (suggestion.status !== 'pending') {
    throw persistenceValidation('Interpretation proposals must be created pending.');
  }
  if (suggestion.sourceCommunicationEventId) {
    throw persistenceValidation(
      'Interpretation proposals must not claim A6 Gmail-origin CommunicationEvent linkage.',
    );
  }
  if (suggestion.approvedTaskId || suggestion.mergedIntoTaskId) {
    throw persistenceValidation('Interpretation proposals must not carry acceptance linkage.');
  }
}

/**
 * Persist one completed interpretation occurrence and its 0..N proposals atomically (D161, D169).
 *
 * The AI/provider call belongs **outside** this function: the transaction opens only once a
 * validated result exists, so no database transaction is held across an external AI call. The run
 * and its proposal set commit or roll back together — a partially persisted proposal set can never
 * be observed as a completed occurrence.
 *
 * Creates no canonical Task, no assignment, and no revision evidence. A failed provider call must
 * not reach this function at all: there is no failure outcome to record (D161).
 *
 * ## D082 association hold
 *
 * Proposals backed by a temporary communication excerpt establish their workflow retention
 * entitlement here, in this same transaction, because this is the transaction that makes the
 * association durable. A hold committed separately could be lost while the proposals it protects
 * survived, leaving the excerpt to purge out from under them at its short initial deadline.
 *
 * A zero-proposal occurrence writes no entitlement at all, so its source excerpt keeps the initial
 * deadline it was created with — a truthful success does not extend retention. So does a replay,
 * which reaches this function not at all.
 *
 * Same-key races surface as `UNIQUE_VIOLATION` from `createInterpretationRun` and roll the whole
 * transaction back; callers re-run {@link resolveInterpretationOccurrence} to distinguish replay
 * from conflict, matching the HandoffAttempt pattern.
 */
export async function persistInterpretationOccurrence(
  input: PersistInterpretationOccurrenceInput,
): Promise<InterpretationOccurrence> {
  const { organizationId } = input.run;
  for (const suggestion of input.suggestions) {
    assertPersistableProposal(organizationId, suggestion);
  }

  const outcome = input.suggestions.length > 0 ? 'proposals_created' : 'no_proposals';
  const associationEntitlements = groupAssociationEntitlements(input.suggestions);

  return input.db.$transaction(async (tx) => {
    await assertExcerptsOwnedByOrganization(tx, organizationId, [
      ...associationEntitlements.keys(),
    ]);

    const run = await createInterpretationRun(tx, { ...input.run, outcome });

    for (const suggestion of input.suggestions) {
      await createTaskSuggestion(tx, organizationId, suggestion, undefined, run.id);
    }

    for (const [excerptId, transitionEntitlements] of associationEntitlements) {
      await applyD082ExcerptRetention(tx, organizationId, {
        target: { kind: 'excerpt', excerptId },
        transitionEntitlements,
      });
    }

    const suggestions = await listTaskSuggestionsByInterpretationRunId(tx, organizationId, run.id);
    return { run, suggestions };
  });
}
