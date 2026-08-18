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
  asTemporaryCommunicationExcerptId,
  type SourceReference,
  type TaskSuggestion,
} from '@aicaa/domain';
import type {
  DbClient,
  InterpretationOccurrence,
  InterpretationOccurrenceResolution,
  TaskSuggestionWithInterpretationRun,
} from '@aicaa/db';
import { loadDbRuntime, type DbRuntimeModule } from '@/lib/db/runtime-db';
import {
  computeInterpretationRequestFingerprint,
  computeManualCaptureSourceDedupeDigest,
} from './fingerprint';
import { interpretationServiceError } from './errors';
import {
  assertInterpretationResultFitsPersistence,
  requireGoogleMessagesProvenance,
  validateInterpretationRequest,
  type AuthorizedInterpretationSourceKind,
  type GmailInterpretationProvenance,
  type GoogleMessagesInterpretationProvenance,
  type InterpretationRequest,
  type ValidatedInterpretationRequest,
} from './validate';

export type {
  AuthorizedInterpretationSourceKind,
  GmailInterpretationProvenance,
  GoogleMessagesInterpretationProvenance,
  InterpretationRequest,
};

export interface InterpretationServiceDeps {
  /** Injected provider for tests. Production composition is default closed (D169). */
  provider?: InterpretationProvider;
}

/**
 * Optional result from {@link BeforeNewInterpretation}.
 *
 * Messages Review uses this to bind the source event/excerpt identities that were actually
 * persisted after D161 classified the request as new. Replay and conflict never run the gate,
 * so they never persist selected text. Gmail's eligibility gate returns void.
 */
export type BeforeNewInterpretationResult = {
  messagesProvenance?: GoogleMessagesInterpretationProvenance;
};

/**
 * Caller-owned gate that runs only when this request would start a new interpretation.
 *
 * Replay and idempotency-conflict classification already happened against durable
 * `(organizationId, idempotencyKey)` + fingerprint state. The Gmail adapter uses this to require
 * current Inbox eligibility only for a new interpretation, not for an exact D161 replay. The
 * Messages adapter uses it to persist the CommunicationEvent and TemporaryCommunicationExcerpt
 * only after that same classification.
 */
export type BeforeNewInterpretation = () =>
  void | BeforeNewInterpretationResult | Promise<void | BeforeNewInterpretationResult>;

/**
 * What the committed occurrence itself says, for a caller that needs more than the proposals.
 *
 * This is deliberately not the persisted run. `id`, `idempotencyKey`, and `requestFingerprint` are
 * persistence identity and idempotency bookkeeping: a later adapter answers with proposals, and
 * nothing above this seam has a use for the occurrence's row identity that would justify handing it
 * out. `outcome` is included because it is the occurrence's own recorded truth rather than a
 * recount of the array, and `interpretedAt` because a replay is answered from an occurrence that
 * committed at some earlier time than the request being served.
 */
export interface InterpretationOccurrenceSummary {
  sourceKind: 'owner_manual_capture' | 'gmail' | 'google_messages';
  outcome: 'proposals_created' | 'no_proposals';
  interpretedAt: string;
}

export interface InterpretationServiceResult {
  /** `replayed` means the occurrence already existed for this key and fingerprint. */
  outcome: 'created' | 'replayed';
  /** Canonical domain proposals. Persistence-only provenance does not travel with them. */
  suggestions: TaskSuggestion[];
  occurrence: InterpretationOccurrenceSummary;
}

type OccurrenceIdempotency = {
  organizationId: string;
  idempotencyKey: string;
  requestFingerprint: string;
};

function randomToken(): string {
  return randomBytes(12).toString('base64url');
}

/**
 * Deterministic source reference for a manual capture (D169).
 *
 * The two identities are different questions and are built from different things.
 *
 * `id` answers *which capture produced this proposal*. It is derived from the occurrence's own
 * generated token, so every sibling proposal of one capture truthfully shares one source and no two
 * captures ever share one. It is short and bounded, which matters because `SourceReference.id` is a
 * published `maxLength: 64` contract field.
 *
 * `dedupeKey` answers *which captures are the same capture*. That is the caller's idempotency
 * assertion, so it is derived from the request identity — but as a one-way digest, never as the
 * caller's transport key copied into durable state.
 *
 * Gmail identity semantics are deliberately absent: no `externalIds`, no provider message id, no
 * contact hint. There is no `excerptRef` because no raw input is stored, and the interpretation run
 * id is not embedded because it is internal persistence provenance.
 */
function buildManualCaptureSourceReference(input: {
  occurrenceToken: string;
  organizationId: string;
  sourceKind: AuthorizedInterpretationSourceKind;
  idempotencyKey: string;
  capturedAt: string;
}): SourceReference {
  const dedupeDigest = computeManualCaptureSourceDedupeDigest({
    organizationId: input.organizationId,
    sourceKind: input.sourceKind,
    idempotencyKey: input.idempotencyKey,
  });
  return {
    id: `src_${input.occurrenceToken}`,
    sourceType: 'manual',
    dedupeKey: `${input.sourceKind}:${dedupeDigest}`,
    capturedAt: input.capturedAt,
  };
}

/** Published `SourceReference.contactHint` ceiling (`source-reference.yaml`). */
const MAX_CONTACT_HINT = 128;

/**
 * Truthful Gmail source provenance for an Owner Review-with-Rocket occurrence (D179).
 *
 * Built only from A5 identity the Gmail adapter already resolved. `sourceType` is `gmail`; this
 * helper never claims `manual`. `id` is the CommunicationEvent id so sibling proposals of one
 * Review share the Gmail occurrence, and a later Review of the same message remains a separate
 * InterpretationRun (D161) with the same source identity.
 *
 * The exact-message `externalIds` entry uses canonical A7 `idType: 'message_id'`. The stored `id`
 * is still `CommunicationEvent.providerMessageId` (Gmail `users.messages.get` id). `thread` remains
 * conversation identity only and is never interchangeable with the message id. Already-persisted
 * Review Tasks that used the earlier `idType: 'message'` synonym stay resolvable by the trusted
 * forward-source helper; this constructor does not rewrite them.
 *
 * `sourceCommunicationEventId` stays unset: that column is A6 Gmail-origin suggestion linkage and
 * is not the S7 provenance path.
 */
function buildGmailSourceReference(input: {
  provenance: GmailInterpretationProvenance;
  capturedAt: string;
}): SourceReference {
  const contactHint =
    input.provenance.fromAddress.length <= MAX_CONTACT_HINT
      ? input.provenance.fromAddress
      : input.provenance.fromAddress.slice(0, MAX_CONTACT_HINT);

  const externalIds = [
    {
      provider: 'gmail',
      idType: 'message_id',
      id: input.provenance.providerMessageId,
    },
    {
      provider: 'gmail',
      idType: 'thread',
      id: input.provenance.providerThreadId,
    },
  ];

  return {
    id: input.provenance.communicationEventId,
    sourceType: 'gmail',
    dedupeKey: input.provenance.dedupeKey,
    capturedAt: input.capturedAt,
    externalIds,
    title: input.provenance.subject ?? undefined,
    contactHint,
    excerptRef: {
      excerptId: input.provenance.excerptId,
      byteLength: input.provenance.excerptByteLength,
      contentClassification: 'temporary_communication',
    },
  };
}

/**
 * Truthful Google Messages source provenance for an Owner Review-with-Rocket occurrence (D181).
 *
 * `sourceType` is `google_messages`. No sender, phone number, or conversation title is copied
 * onto the source reference. `sourceCommunicationEventId` stays unset: that column is A6
 * Gmail-origin suggestion linkage and is not the Messages Review path.
 */
function buildGoogleMessagesSourceReference(input: {
  provenance: GoogleMessagesInterpretationProvenance;
  capturedAt: string;
}): SourceReference {
  return {
    id: input.provenance.communicationEventId,
    sourceType: 'google_messages',
    dedupeKey: input.provenance.dedupeKey,
    capturedAt: input.capturedAt,
    externalIds: [
      {
        provider: 'google_messages',
        idType: 'occurrence',
        id: input.provenance.sourceOccurrenceId,
      },
    ],
    excerptRef: {
      excerptId: input.provenance.excerptId,
      byteLength: input.provenance.excerptByteLength,
      contentClassification: 'temporary_communication',
    },
  };
}

function buildSourceReference(input: {
  occurrenceToken: string;
  request: ValidatedInterpretationRequest;
}): SourceReference {
  if (input.request.sourceKind === 'gmail') {
    return buildGmailSourceReference({
      provenance: input.request.gmailProvenance!,
      capturedAt: input.request.capturedAt,
    });
  }
  if (input.request.sourceKind === 'google_messages') {
    return buildGoogleMessagesSourceReference({
      provenance: input.request.messagesProvenance!,
      capturedAt: input.request.capturedAt,
    });
  }
  return buildManualCaptureSourceReference({
    occurrenceToken: input.occurrenceToken,
    organizationId: input.request.organizationId,
    sourceKind: input.request.sourceKind,
    idempotencyKey: input.request.idempotencyKey,
    capturedAt: input.request.capturedAt,
  });
}

/**
 * Map one validated `ProposedTask` onto the canonical TaskSuggestion model.
 *
 * `summaryPoints` are the canonical proposal content and carry over unchanged, including any
 * deadline-kind points the interpretation already grounded. The advisory interpretation-layer
 * fields are intentionally not persisted (D169): `peopleHints` must not become a Recipient,
 * assignment, or responsibility, and an unresolved `deadlineExpression` must not be promoted into
 * `proposedDueAt`. Neither has a column, and their omission is a decision rather than an oversight.
 *
 * ## Two linkages that must not be confused (D082)
 *
 * `sourceExcerptId` comes from the source reference this service just built from server-resolved
 * provenance, never from anything a client sent. It is the proposal's D082 retention entitlement on
 * the temporary excerpt that is its evidence, and it is present for Gmail Review and Google Messages
 * Review and absent for manual capture, which stores no excerpt at all.
 *
 * `sourceCommunicationEventId` stays null for every source. It is A6 claimed-event processing
 * linkage, it is unique per event, and an interpretation proposal claiming it would both break A6's
 * cardinality and misreport which engine produced the proposal. Persistence refuses it independently.
 */
function buildProposedSuggestion(input: {
  organizationId: string;
  proposal: ProposedTask;
  sourceReference: SourceReference;
  now: string;
}): TaskSuggestion {
  const excerptId = input.sourceReference.excerptRef?.excerptId;
  return {
    id: asTaskSuggestionId(`sug_${randomToken()}`),
    organizationId: asOrganizationId(input.organizationId),
    status: 'pending',
    summaryPoints: input.proposal.summaryPoints,
    sourceReference: input.sourceReference,
    voiceOriginated: false,
    sourceCommunicationEventId: null,
    sourceExcerptId: excerptId ? asTemporaryCommunicationExcerptId(excerptId) : null,
    retention: {},
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Narrow a persisted proposal back to the canonical domain entity.
 *
 * Persistence returns `TaskSuggestion & { interpretationRunId }` because the persistence layer may
 * read its own provenance. Above this seam the occurrence link is not part of a proposal: it is not
 * on the domain entity and not on the public TaskSuggestion contract, and an adapter that never
 * receives it cannot spread it into a response. The occurrence is reported once, separately.
 */
function toDomainSuggestion(persisted: TaskSuggestionWithInterpretationRun): TaskSuggestion {
  const { interpretationRunId: _omit, ...suggestion } = persisted;
  void _omit;
  return suggestion;
}

function toServiceResult(
  outcome: 'created' | 'replayed',
  occurrence: InterpretationOccurrence,
): InterpretationServiceResult {
  return {
    outcome,
    suggestions: occurrence.suggestions.map(toDomainSuggestion),
    occurrence: {
      sourceKind: occurrence.run.sourceKind,
      outcome: occurrence.run.outcome,
      interpretedAt: occurrence.run.createdAt,
    },
  };
}

function isUniqueViolation(runtime: DbRuntimeModule, error: unknown): boolean {
  return runtime.isPersistenceError(error) && error.code === 'UNIQUE_VIOLATION';
}

/**
 * Read committed state for this organization and key, reporting a reused key through the service's
 * own error type rather than passing a `packages/db` error out of the seam.
 */
async function resolveCommittedOccurrence(
  runtime: DbRuntimeModule,
  db: DbClient,
  idempotency: OccurrenceIdempotency,
): Promise<InterpretationOccurrenceResolution> {
  try {
    return await runtime.resolveInterpretationOccurrence(db, idempotency);
  } catch (error) {
    if (runtime.isPersistenceError(error) && error.code === 'IDEMPOTENCY_KEY_CONFLICT') {
      throw interpretationServiceError(
        'IDEMPOTENCY_KEY_CONFLICT',
        'Idempotency key was already used for a different interpretation request.',
      );
    }
    throw error;
  }
}

/**
 * Shared backend interpretation: source-neutral request in, canonical proposals persisted (D169).
 *
 * Sequence, and the reason for it:
 *
 * 1. Validate the caller's fields. An unusable organization, key, request id, or capture time costs
 *    no interpretation and never reaches Prisma as a raw string-length or parse failure.
 * 2. Resolve organization-scoped idempotency **before** interpreting. An exact replay is answered
 *    from committed canonical state, so the provider is not called a second time, and a reused key
 *    with a different fingerprint conflicts before any work.
 * 3. If this would be a new interpretation, run the optional caller gate. Gmail uses this to require
 *    current Inbox eligibility only for a new run — an exact replay does not need the source to
 *    still be Inbox-eligible. Messages Review uses it to persist the source event/excerpt only
 *    after D161 has already classified the request as new.
 * 4. Call the provider with no database transaction open. A failed call leaves nothing behind:
 *    there is no InterpretationRun, no TaskSuggestion, and no attempt row to record it.
 * 5. Refuse provider-returned `policyVersion` / `modelVersion` that cannot fit the occurrence
 *    columns. Oversized provenance is invalid interpreted output, not a raw database length error,
 *    and it is never truncated.
 * 6. Persist the occurrence and its 0..N proposals in one transaction. `tasks: []` is truthful
 *    success recorded as `no_proposals`, not a failure and not a manufactured placeholder.
 *
 * Everything the fingerprint covers is supplied by the caller, including `capturedAt`. The service
 * clock never enters request semantics, because a value invented per attempt cannot be recovered on
 * the retry of an attempt that never committed — it would make an exact retry look like a different
 * request and fail as a conflict.
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
  beforeNewInterpretation?: BeforeNewInterpretation;
}): Promise<InterpretationServiceResult> {
  let request: ValidatedInterpretationRequest = validateInterpretationRequest(input.request);
  const runtime = await loadDbRuntime();
  const now = input.now ?? new Date().toISOString();

  const idempotency: OccurrenceIdempotency = {
    organizationId: request.organizationId,
    idempotencyKey: request.idempotencyKey,
    requestFingerprint: computeInterpretationRequestFingerprint({
      organizationId: request.organizationId,
      sourceKind: request.sourceKind,
      rawInput: request.rawInput,
      capturedAt: request.capturedAt,
      timezone: request.timezone,
      gmailOccurrenceId:
        request.sourceKind === 'gmail' ? request.gmailProvenance?.communicationEventId : undefined,
      messagesOccurrenceId:
        request.sourceKind === 'google_messages'
          ? request.messagesProvenance?.sourceOccurrenceId
          : undefined,
    }),
  };

  const resolved = await resolveCommittedOccurrence(runtime, input.db, idempotency);
  if (resolved.kind === 'replay') {
    return toServiceResult('replayed', resolved.occurrence);
  }

  if (input.beforeNewInterpretation) {
    const gateResult = await input.beforeNewInterpretation();
    if (request.sourceKind === 'google_messages' && gateResult?.messagesProvenance) {
      request = {
        ...request,
        messagesProvenance: requireGoogleMessagesProvenance(gateResult.messagesProvenance),
      };
    }
  }

  const provider = input.deps?.provider ?? createInterpretationProvider();
  const interpretation = await provider.interpret({
    rawInput: request.rawInput,
    capturedAt: request.capturedAt,
    timezone: request.timezone,
  });
  assertInterpretationResultFitsPersistence(interpretation);

  // One generated token, two namespaced identities: the occurrence row and the source reference its
  // sibling proposals share.
  const occurrenceToken = randomToken();
  const sourceReference = buildSourceReference({
    occurrenceToken,
    request,
  });
  const suggestions = interpretation.tasks.map((proposal) =>
    buildProposedSuggestion({
      organizationId: request.organizationId,
      proposal,
      sourceReference,
      now,
    }),
  );

  try {
    const occurrence = await runtime.persistInterpretationOccurrence({
      db: input.db,
      run: {
        id: `irun_${occurrenceToken}`,
        ...idempotency,
        sourceKind: request.sourceKind,
        modelVersion: interpretation.modelVersion,
        policyVersion: interpretation.policyVersion,
        requestId: request.requestId,
      },
      suggestions,
    });
    return toServiceResult('created', occurrence);
  } catch (error) {
    if (!isUniqueViolation(runtime, error)) {
      throw error;
    }
    // Our transaction rolled back whole, so nothing of this attempt persisted. Re-reading committed
    // state also classifies which constraint actually refused the write: a concurrent writer that
    // won this key is now visible as a replay, or as a conflict if it used the key for a different
    // request.
    const raced = await resolveCommittedOccurrence(runtime, input.db, idempotency);
    if (raced.kind === 'replay') {
      return toServiceResult('replayed', raced.occurrence);
    }
    // No occurrence exists for this organization and key, so the constraint that failed was not the
    // occurrence idempotency index — an unrelated uniqueness failure, such as a proposal id
    // collision. Calling it replay or conflict would misreport canonical state, and re-throwing the
    // persistence error would leak the database seam.
    throw interpretationServiceError(
      'PERSISTENCE_CONFLICT',
      'Interpretation persistence failed on an unrelated uniqueness constraint.',
    );
  }
}
