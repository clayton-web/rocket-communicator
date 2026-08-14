import 'server-only';
import { AiProviderError } from '@aicaa/ai';
import { interpretationServiceError } from './errors';

/**
 * Interpretation source kinds authorized to produce occurrences through this service.
 *
 * `owner_manual_capture` is the S3.1 / S3.2 Owner capture path (D169, D170). `gmail` is the S7
 * Gmail Review-with-Rocket adapter (D179). `google_messages` is the D181 Messages Review adapter.
 * The service stays source-neutral beyond these authorized kinds: an adapter supplies its own
 * kind, captured-at, and provenance rather than growing a second interpretation system.
 */
export type AuthorizedInterpretationSourceKind =
  'owner_manual_capture' | 'gmail' | 'google_messages';

/**
 * Gmail occurrence identity required to build truthful Gmail source provenance (D179).
 *
 * Supplied only by the Gmail Review adapter after it has resolved an A5 event and its temporary
 * excerpt. Current Inbox eligibility is a new-interpretation gate in the adapter, not a
 * prerequisite for reconstructing this provenance. Not accepted from a client as an interpretation
 * source-kind claim.
 */
export interface GmailInterpretationProvenance {
  communicationEventId: string;
  providerMessageId: string;
  providerThreadId: string;
  excerptId: string;
  excerptByteLength: number;
  subject: string | null;
  fromAddress: string;
  dedupeKey: string;
}

/**
 * Google Messages occurrence identity required to build truthful Messages provenance (D181).
 *
 * Supplied only by the Messages Review adapter. Event and excerpt identities may be prepared
 * before D161 classification and bound to durable rows only when this request is a new
 * interpretation. Not accepted from a client as an interpretation source-kind claim. Contains
 * no sender, phone number, or conversation title.
 */
export interface GoogleMessagesInterpretationProvenance {
  communicationEventId: string;
  sourceOccurrenceId: string;
  excerptId: string;
  excerptByteLength: number;
  dedupeKey: string;
}

export interface InterpretationRequest {
  organizationId: string;
  sourceKind: AuthorizedInterpretationSourceKind;
  /** Source text. Interpreted transiently and never persisted as raw input by this service. */
  rawInput: string;
  /** Organization-scoped idempotency key supplied by the caller. */
  idempotencyKey: string;
  /** Durable traceability id recorded on the occurrence. */
  requestId: string;
  /**
   * When the source was captured, in the caller's own words about the capture — not when the server
   * happened to process it.
   *
   * Required, because it is fingerprinted request semantics. A retry of one capture must describe
   * the same capture, and the service has no way to recover a value it invented for an occurrence
   * that never committed. See the module comment on `capturedAt` stability below.
   *
   * For Gmail Review, the adapter supplies the A5 event's receivedAt rather than the server clock.
   */
  capturedAt: string;
  /** Owner/org IANA timezone when known. Mechanical context only. */
  timezone?: string | null;
  /**
   * Required when `sourceKind` is `gmail`; forbidden for manual capture and Google Messages so
   * Gmail provenance cannot leak onto another source.
   */
  gmailProvenance?: GmailInterpretationProvenance;
  /**
   * Required when `sourceKind` is `google_messages`; forbidden for manual capture and Gmail.
   */
  messagesProvenance?: GoogleMessagesInterpretationProvenance;
}

/**
 * An {@link InterpretationRequest} whose caller-supplied fields are known to fit persistence and to
 * fingerprint identically on an exact retry.
 */
export interface ValidatedInterpretationRequest extends InterpretationRequest {
  capturedAt: string;
  timezone: string | null;
}

/**
 * Storage ceilings taken from the `InterpretationRun` columns: `organization_id`, `request_id`,
 * `model_version`, and `policy_version` are `VarChar(64)`; `idempotency_key` is `VarChar(128)`.
 * Checking them here means an oversized caller or provider value fails as a classified error
 * before the transaction opens, instead of as a raw Prisma string-length error thrown from inside
 * it. Values are never truncated — silent truncation would falsify identity or provider provenance.
 */
const MAX_ORGANIZATION_ID = 64;
const MAX_REQUEST_ID = 64;
const IDEMPOTENCY_KEY_MAX = 128;
/** `InterpretationRun.model_version` / `policy_version` persistence ceiling. */
export const MAX_INTERPRETATION_VERSION_LENGTH = 64;

/** Published `SourceReference` / CommunicationEvent identity ceilings. */
const MAX_GMAIL_EVENT_ID = 64;
const MAX_GMAIL_PROVIDER_ID = 256;
const MAX_GMAIL_EXCERPT_ID = 64;
const MAX_GMAIL_DEDUPE_KEY = 128;
const MAX_GMAIL_SUBJECT = 256;
/** CommunicationEvent.fromAddress persistence ceiling; contactHint is truncated at build time. */
const MAX_GMAIL_FROM_ADDRESS = 320;

const AUTHORIZED_SOURCE_KINDS = new Set<AuthorizedInterpretationSourceKind>([
  'owner_manual_capture',
  'gmail',
  'google_messages',
]);

/**
 * Same key shape the contracted `Idempotency-Key` header is parsed against (A7.7 / D094): 8–128
 * characters from the safe URL-token alphabet. It is restated rather than imported because that
 * parser is an HTTP transport concern belonging to the handoff slice, and this is a service-boundary
 * check on a direct caller. The full key value is never logged.
 */
const IDEMPOTENCY_KEY_MIN = 8;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]+$/;

/**
 * ISO-8601 timestamp carrying an explicit UTC designator or numeric offset.
 *
 * A zone-less timestamp is rejected on purpose. `Date.parse('2026-08-11T18:00:00')` resolves against
 * the host's local zone, so the same retry interpreted on two differently configured hosts would
 * canonicalize to two instants, produce two fingerprints, and turn a legitimate replay into a
 * conflict. Requiring the offset makes the value mean one instant everywhere.
 */
const ISO_INSTANT_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})$/;

export type CanonicalInterpretationInstant =
  { ok: true; instant: string } | { ok: false; reason: 'format' | 'invalid' };

/**
 * Shared absolute/zoned instant check used by `capturedAt` and Messages `observedAt`.
 *
 * Rejects zone-less local datetimes and date-only values so the same retry cannot canonicalize
 * to two instants on differently configured hosts. Equivalent zoned encodings of one instant
 * collapse to one UTC ISO-8601 value.
 */
export function canonicalizeInterpretationInstant(value: string): CanonicalInterpretationInstant {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, reason: 'format' };
  }
  if (!ISO_INSTANT_WITH_ZONE.test(value)) {
    return { ok: false, reason: 'format' };
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, instant: new Date(parsed).toISOString() };
}

function validationError(field: string, message: string): never {
  throw interpretationServiceError('VALIDATION_ERROR', message, [{ field, message }]);
}

function requireBoundedIdentifier(value: string, field: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    validationError(field, `${field} is required.`);
  }
  if (value.length > max) {
    validationError(field, `${field} must be at most ${max} characters.`);
  }
  return value;
}

/**
 * Validate the organization-scoped idempotency key without altering it.
 *
 * It is deliberately not trimmed: the key is durable identity, and silently accepting `" k "` as
 * `"k"` would let two textually different retries resolve to one occurrence. The charset already
 * excludes whitespace, so a padded key is simply invalid.
 */
function requireIdempotencyKey(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    validationError('idempotencyKey', 'idempotencyKey is required.');
  }
  if (
    value.length < IDEMPOTENCY_KEY_MIN ||
    value.length > IDEMPOTENCY_KEY_MAX ||
    !IDEMPOTENCY_KEY_PATTERN.test(value)
  ) {
    validationError(
      'idempotencyKey',
      `idempotencyKey must be ${IDEMPOTENCY_KEY_MIN}–${IDEMPOTENCY_KEY_MAX} characters using A–Z, a–z, 0–9, and . _ ~ -`,
    );
  }
  return value;
}

/**
 * Canonicalize `capturedAt` to a single instant encoding.
 *
 * Two encodings of one instant — `2026-08-11T18:00:00Z`, `2026-08-11T18:00:00.000Z`, and
 * `2026-08-11T11:00:00-07:00` — describe the same capture, so they must fingerprint the same.
 * Normalizing before fingerprinting means an exact retry stays an exact retry even when the caller's
 * clock formatting differs, while a genuinely different capture time still conflicts.
 */
function requireCapturedAt(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    validationError('capturedAt', 'capturedAt is required.');
  }
  const canonical = canonicalizeInterpretationInstant(value);
  if (!canonical.ok) {
    validationError(
      'capturedAt',
      canonical.reason === 'invalid'
        ? 'capturedAt must be a valid timestamp.'
        : 'capturedAt must be an ISO-8601 timestamp with an explicit UTC offset.',
    );
  }
  return canonical.instant;
}

/**
 * Validate one interpretation request at the application-service boundary (D169 S3.1).
 *
 * Runs before the idempotency read, before the provider call, and before any transaction, so an
 * unusable request costs no interpretation and leaves no state.
 */
function requireAuthorizedSourceKind(value: string): AuthorizedInterpretationSourceKind {
  if (!AUTHORIZED_SOURCE_KINDS.has(value as AuthorizedInterpretationSourceKind)) {
    validationError('sourceKind', 'sourceKind is not an authorized interpretation source.');
  }
  return value as AuthorizedInterpretationSourceKind;
}

function requireGmailProvenance(
  provenance: GmailInterpretationProvenance | undefined,
): GmailInterpretationProvenance {
  if (provenance == null) {
    validationError('gmailProvenance', 'gmailProvenance is required for a Gmail interpretation.');
  }
  const excerptByteLength = provenance.excerptByteLength;
  if (!Number.isInteger(excerptByteLength) || excerptByteLength < 0) {
    validationError(
      'gmailProvenance.excerptByteLength',
      'gmailProvenance.excerptByteLength must be a non-negative integer.',
    );
  }
  return {
    communicationEventId: requireBoundedIdentifier(
      provenance.communicationEventId,
      'gmailProvenance.communicationEventId',
      MAX_GMAIL_EVENT_ID,
    ),
    providerMessageId: requireBoundedIdentifier(
      provenance.providerMessageId,
      'gmailProvenance.providerMessageId',
      MAX_GMAIL_PROVIDER_ID,
    ),
    providerThreadId: requireBoundedIdentifier(
      provenance.providerThreadId,
      'gmailProvenance.providerThreadId',
      MAX_GMAIL_PROVIDER_ID,
    ),
    excerptId: requireBoundedIdentifier(
      provenance.excerptId,
      'gmailProvenance.excerptId',
      MAX_GMAIL_EXCERPT_ID,
    ),
    excerptByteLength,
    subject:
      provenance.subject == null
        ? null
        : requireBoundedIdentifier(
            provenance.subject,
            'gmailProvenance.subject',
            MAX_GMAIL_SUBJECT,
          ),
    fromAddress: requireBoundedIdentifier(
      provenance.fromAddress,
      'gmailProvenance.fromAddress',
      MAX_GMAIL_FROM_ADDRESS,
    ),
    dedupeKey: requireBoundedIdentifier(
      provenance.dedupeKey,
      'gmailProvenance.dedupeKey',
      MAX_GMAIL_DEDUPE_KEY,
    ),
  };
}

const MAX_MESSAGES_EVENT_ID = 64;
const MAX_MESSAGES_OCCURRENCE_ID = 128;
const MAX_MESSAGES_EXCERPT_ID = 64;
const MAX_MESSAGES_DEDUPE_KEY = 128;

export function requireGoogleMessagesProvenance(
  provenance: GoogleMessagesInterpretationProvenance | undefined,
): GoogleMessagesInterpretationProvenance {
  if (provenance == null) {
    validationError(
      'messagesProvenance',
      'messagesProvenance is required for a Google Messages interpretation.',
    );
  }
  const excerptByteLength = provenance.excerptByteLength;
  if (!Number.isInteger(excerptByteLength) || excerptByteLength < 0) {
    validationError(
      'messagesProvenance.excerptByteLength',
      'messagesProvenance.excerptByteLength must be a non-negative integer.',
    );
  }
  return {
    communicationEventId: requireBoundedIdentifier(
      provenance.communicationEventId,
      'messagesProvenance.communicationEventId',
      MAX_MESSAGES_EVENT_ID,
    ),
    sourceOccurrenceId: requireBoundedIdentifier(
      provenance.sourceOccurrenceId,
      'messagesProvenance.sourceOccurrenceId',
      MAX_MESSAGES_OCCURRENCE_ID,
    ),
    excerptId: requireBoundedIdentifier(
      provenance.excerptId,
      'messagesProvenance.excerptId',
      MAX_MESSAGES_EXCERPT_ID,
    ),
    excerptByteLength,
    dedupeKey: requireBoundedIdentifier(
      provenance.dedupeKey,
      'messagesProvenance.dedupeKey',
      MAX_MESSAGES_DEDUPE_KEY,
    ),
  };
}

/**
 * Validate one interpretation request at the application-service boundary (D169 S3.1, D179 S7).
 *
 * Runs before the idempotency read, before the provider call, and before any transaction, so an
 * unusable request costs no interpretation and leaves no state.
 */
export function validateInterpretationRequest(
  request: InterpretationRequest,
): ValidatedInterpretationRequest {
  const sourceKind = requireAuthorizedSourceKind(request.sourceKind);
  if (sourceKind === 'owner_manual_capture' && request.gmailProvenance != null) {
    validationError(
      'gmailProvenance',
      'gmailProvenance is not valid for a manual capture interpretation.',
    );
  }
  if (sourceKind === 'owner_manual_capture' && request.messagesProvenance != null) {
    validationError(
      'messagesProvenance',
      'messagesProvenance is not valid for a manual capture interpretation.',
    );
  }
  if (sourceKind === 'gmail' && request.messagesProvenance != null) {
    validationError(
      'messagesProvenance',
      'messagesProvenance is not valid for a Gmail interpretation.',
    );
  }
  if (sourceKind === 'google_messages' && request.gmailProvenance != null) {
    validationError(
      'gmailProvenance',
      'gmailProvenance is not valid for a Google Messages interpretation.',
    );
  }
  const gmailProvenance =
    sourceKind === 'gmail' ? requireGmailProvenance(request.gmailProvenance) : undefined;
  const messagesProvenance =
    sourceKind === 'google_messages'
      ? requireGoogleMessagesProvenance(request.messagesProvenance)
      : undefined;

  return {
    ...request,
    organizationId: requireBoundedIdentifier(
      request.organizationId,
      'organizationId',
      MAX_ORGANIZATION_ID,
    ),
    sourceKind,
    requestId: requireBoundedIdentifier(request.requestId, 'requestId', MAX_REQUEST_ID),
    idempotencyKey: requireIdempotencyKey(request.idempotencyKey),
    capturedAt: requireCapturedAt(request.capturedAt),
    timezone: request.timezone ?? null,
    gmailProvenance,
    messagesProvenance,
  };
}

/**
 * Reject provider-returned version metadata that cannot fit `InterpretationRun` persistence (S3.1a).
 *
 * Lives at the shared interpretation application seam — after any provider returns accepted
 * `InterpretationResult` metadata and before the occurrence transaction — so every caller of
 * `interpretCapture` benefits without repeating the check in source adapters. This is a persistence
 * contract guard, not a redesign of interpretation output: oversized strings are refused as invalid
 * provider output (`AiProviderError`), never truncated and never left for Prisma/Postgres to reject.
 */
export function assertInterpretationResultFitsPersistence(result: {
  policyVersion: string;
  modelVersion: string;
}): void {
  if (result.policyVersion.length > MAX_INTERPRETATION_VERSION_LENGTH) {
    throw new AiProviderError(
      'AI_SCHEMA_INVALID',
      'retryable',
      `policyVersion exceeds the ${MAX_INTERPRETATION_VERSION_LENGTH}-character persistence limit.`,
    );
  }
  if (result.modelVersion.length > MAX_INTERPRETATION_VERSION_LENGTH) {
    throw new AiProviderError(
      'AI_SCHEMA_INVALID',
      'retryable',
      `modelVersion exceeds the ${MAX_INTERPRETATION_VERSION_LENGTH}-character persistence limit.`,
    );
  }
}
