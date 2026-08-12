import type { TaskSuggestion } from '@aicaa/domain';
import type { DbClient } from '../client/create-prisma-client.js';
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

  return input.db.$transaction(async (tx) => {
    const run = await createInterpretationRun(tx, { ...input.run, outcome });

    for (const suggestion of input.suggestions) {
      await createTaskSuggestion(tx, organizationId, suggestion, undefined, run.id);
    }

    const suggestions = await listTaskSuggestionsByInterpretationRunId(tx, organizationId, run.id);
    return { run, suggestions };
  });
}
