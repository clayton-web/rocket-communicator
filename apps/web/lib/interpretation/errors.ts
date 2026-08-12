export type InterpretationServiceErrorCode =
  /** Caller-supplied request fields are unusable before any interpretation or persistence happens. */
  | 'VALIDATION_ERROR'
  /** The organization-scoped key was already used for a different request (D161 semantics). */
  | 'IDEMPOTENCY_KEY_CONFLICT'
  /** Persistence refused the write for a reason that is not this occurrence's idempotency. */
  | 'PERSISTENCE_CONFLICT';

/**
 * Shared-interpretation application failure (D169 S3.1).
 *
 * This follows the existing service-error convention (`RecipientManagementError`,
 * `TaskServiceError`, `CapabilityTokenError`) rather than introducing a second error framework: one
 * classified failure type per application service, carrying a code the service itself owns. It
 * exists so a caller of the interpretation seam is never handed a raw Prisma or persistence error
 * whose shape belongs to `packages/db`.
 *
 * These codes are not public API codes. Nothing maps them to HTTP status, because no route reaches
 * this service in this slice.
 */
export class InterpretationServiceError extends Error {
  readonly code: InterpretationServiceErrorCode;
  readonly details?: ReadonlyArray<{ field: string; message: string }>;

  constructor(
    code: InterpretationServiceErrorCode,
    message: string,
    details?: ReadonlyArray<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = 'InterpretationServiceError';
    this.code = code;
    this.details = details ? Object.freeze([...details]) : undefined;
  }
}

export function interpretationServiceError(
  code: InterpretationServiceErrorCode,
  message: string,
  details?: ReadonlyArray<{ field: string; message: string }>,
): InterpretationServiceError {
  return new InterpretationServiceError(code, message, details);
}
