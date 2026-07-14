/**
 * Recipient capability application-service errors.
 * Codes align with the public Recipient error-mapping policy for a future HTTP layer.
 * No HTTP status codes or Response objects here.
 *
 * Internal CapabilityTokenError codes (CAPABILITY_EXPIRED, CAPABILITY_REVOKED, …)
 * are mapped into these public-aligned codes by the Recipient service layer.
 */
export type RecipientCapabilityServiceErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INVALID_STATE_TRANSITION'
  | 'PRECONDITION_REQUIRED'
  | 'PRECONDITION_FAILED'
  | 'DOMAIN_CONFLICT'
  | 'PERSISTENCE_CONFLICT';

export class RecipientCapabilityServiceError extends Error {
  readonly code: RecipientCapabilityServiceErrorCode;
  readonly details?: ReadonlyArray<{ field: string; message: string }>;

  constructor(
    code: RecipientCapabilityServiceErrorCode,
    message: string,
    details?: ReadonlyArray<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = 'RecipientCapabilityServiceError';
    this.code = code;
    this.details = details ? Object.freeze([...details]) : undefined;
  }
}

export function recipientCapabilityServiceError(
  code: RecipientCapabilityServiceErrorCode,
  message: string,
  details?: ReadonlyArray<{ field: string; message: string }>,
): RecipientCapabilityServiceError {
  return new RecipientCapabilityServiceError(code, message, details);
}
