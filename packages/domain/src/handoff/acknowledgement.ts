import { validationError } from '../errors/domain-errors.js';
import { HANDOFF_ACKNOWLEDGEMENT_V1, type HandoffAcknowledgement } from './types.js';
import { categoryForHandoffCode, handoffFail, handoffOk, type HandoffResult } from './failures.js';

/**
 * Validate D037 acknowledgement (A7.1). Rejects missing, unknown, and malformed values.
 * Does not embed UI prose — the version token is the durable audit value.
 */
export function parseHandoffAcknowledgement(value: unknown): HandoffResult<HandoffAcknowledgement> {
  if (value === undefined || value === null || value === '') {
    return handoffFail(
      'VALIDATION_ERROR',
      categoryForHandoffCode('VALIDATION_ERROR'),
      'Handoff acknowledgement is required.',
      [{ field: 'acknowledgement', message: 'Required' }],
    );
  }
  if (typeof value !== 'string') {
    return handoffFail(
      'VALIDATION_ERROR',
      categoryForHandoffCode('VALIDATION_ERROR'),
      'Handoff acknowledgement must be a string version token.',
      [{ field: 'acknowledgement', message: 'Must be a string' }],
    );
  }
  const trimmed = value.trim();
  if (trimmed !== value || trimmed.length === 0) {
    return handoffFail(
      'VALIDATION_ERROR',
      categoryForHandoffCode('VALIDATION_ERROR'),
      'Handoff acknowledgement is malformed.',
      [{ field: 'acknowledgement', message: 'Malformed' }],
    );
  }
  if (trimmed !== HANDOFF_ACKNOWLEDGEMENT_V1) {
    return handoffFail(
      'VALIDATION_ERROR',
      categoryForHandoffCode('VALIDATION_ERROR'),
      'Unsupported handoff acknowledgement version.',
      [{ field: 'acknowledgement', message: `Unsupported version: ${trimmed}` }],
    );
  }
  return handoffOk(HANDOFF_ACKNOWLEDGEMENT_V1);
}

/** Throwing variant for call sites that prefer DomainError. */
export function assertHandoffAcknowledgement(value: unknown): HandoffAcknowledgement {
  const result = parseHandoffAcknowledgement(value);
  if (!result.ok) {
    throw validationError(result.failure.message, result.failure.details);
  }
  return result.value;
}
