import 'server-only';
import { AiProviderError } from '@aicaa/ai';
import { interpretationServiceError } from './errors';

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
  /**
   * When the source was captured, in the caller's own words about the capture — not when the server
   * happened to process it.
   *
   * Required, because it is fingerprinted request semantics. A retry of one capture must describe
   * the same capture, and the service has no way to recover a value it invented for an occurrence
   * that never committed. See the module comment on `capturedAt` stability below.
   */
  capturedAt: string;
  /** Owner/org IANA timezone when known. Mechanical context only. */
  timezone?: string | null;
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
  if (!ISO_INSTANT_WITH_ZONE.test(value)) {
    validationError(
      'capturedAt',
      'capturedAt must be an ISO-8601 timestamp with an explicit UTC offset.',
    );
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    validationError('capturedAt', 'capturedAt must be a valid timestamp.');
  }
  return new Date(parsed).toISOString();
}

/**
 * Validate one interpretation request at the application-service boundary (D169 S3.1).
 *
 * Runs before the idempotency read, before the provider call, and before any transaction, so an
 * unusable request costs no interpretation and leaves no state.
 */
export function validateInterpretationRequest(
  request: InterpretationRequest,
): ValidatedInterpretationRequest {
  return {
    ...request,
    organizationId: requireBoundedIdentifier(
      request.organizationId,
      'organizationId',
      MAX_ORGANIZATION_ID,
    ),
    requestId: requireBoundedIdentifier(request.requestId, 'requestId', MAX_REQUEST_ID),
    idempotencyKey: requireIdempotencyKey(request.idempotencyKey),
    capturedAt: requireCapturedAt(request.capturedAt),
    timezone: request.timezone ?? null,
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
