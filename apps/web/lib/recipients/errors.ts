export type RecipientManagementErrorCode =
  'NOT_FOUND' | 'VALIDATION_ERROR' | 'DOMAIN_CONFLICT' | 'FORBIDDEN';

/**
 * Owner Recipient-management application failure (A7.6). Distinct from the capability-link
 * RecipientCapabilityServiceError, which governs recipient token access, not Owner CRUD.
 */
export class RecipientManagementError extends Error {
  readonly code: RecipientManagementErrorCode;
  readonly details?: ReadonlyArray<{ field: string; message: string }>;

  constructor(
    code: RecipientManagementErrorCode,
    message: string,
    details?: ReadonlyArray<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = 'RecipientManagementError';
    this.code = code;
    this.details = details ? Object.freeze([...details]) : undefined;
  }
}

export function recipientManagementError(
  code: RecipientManagementErrorCode,
  message: string,
  details?: ReadonlyArray<{ field: string; message: string }>,
): RecipientManagementError {
  return new RecipientManagementError(code, message, details);
}
