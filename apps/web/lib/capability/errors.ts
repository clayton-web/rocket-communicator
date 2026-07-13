export type CapabilityTokenErrorCode =
  | 'INVALID_CAPABILITY'
  | 'CAPABILITY_EXPIRED'
  | 'CAPABILITY_REVOKED'
  | 'INSUFFICIENT_SCOPE'
  | 'WRONG_RESOURCE'
  | 'TERMINAL_TASK'
  | 'MISSING_CONFIGURATION'
  | 'INVALID_TTL_CONFIGURATION'
  | 'ISSUANCE_CONFLICT'
  | 'ISSUANCE_PRECONDITION';

/**
 * Stable internal capability-token errors. External HTTP mappers should avoid
 * revealing token presence distinctions beyond the approved API codes.
 */
export class CapabilityTokenError extends Error {
  readonly code: CapabilityTokenErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: CapabilityTokenErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'CapabilityTokenError';
    this.code = code;
    this.details = details ? Object.freeze({ ...details }) : undefined;
  }
}

export function capabilityTokenError(
  code: CapabilityTokenErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): CapabilityTokenError {
  return new CapabilityTokenError(code, message, details);
}
