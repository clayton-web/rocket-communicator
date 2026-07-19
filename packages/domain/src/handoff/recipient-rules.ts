import type { OrganizationId } from '../types/ids.js';
import type { Recipient } from '../entities/recipient.js';
import { validationError } from '../errors/domain-errors.js';
import { categoryForHandoffCode, handoffFail, handoffOk, type HandoffResult } from './failures.js';
import type { HandoffAuditIntent } from './types.js';
import type { UtcInstant } from '../types/timestamps.js';

const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;

/** Normalize Recipient email for comparison (trim + lowercase). */
export function normalizeRecipientEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Minimal email shape check aligned with existing domain validation style
 * (see Gmail mailbox validation). Not a full RFC parser.
 */
export function isValidRecipientEmailShape(email: string): boolean {
  const normalized = normalizeRecipientEmail(email);
  if (normalized.length === 0 || normalized.length > MAX_EMAIL_LENGTH) {
    return false;
  }
  const at = normalized.lastIndexOf('@');
  if (at < 1 || at === normalized.length - 1) {
    return false;
  }
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (local.includes(' ') || domain.includes(' ') || !domain.includes('.')) {
    return false;
  }
  return true;
}

export function assertValidRecipientEmail(email: string): string {
  const normalized = normalizeRecipientEmail(email);
  if (!isValidRecipientEmailShape(normalized)) {
    throw validationError('Recipient email is invalid.', [
      { field: 'email', message: 'Invalid email format' },
    ]);
  }
  return normalized;
}

export function assertValidRecipientDisplayName(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) {
    throw validationError('Recipient display name is required.', [
      { field: 'displayName', message: 'Required' },
    ]);
  }
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    throw validationError('Recipient display name is too long.', [
      { field: 'displayName', message: `Max length ${MAX_DISPLAY_NAME_LENGTH}` },
    ]);
  }
  return trimmed;
}

export interface RecipientOrgBoundInput {
  recipient: Recipient;
  /** Organization that owns the Recipient record (supplied; not looked up). */
  recipientOrganizationId: OrganizationId;
  ownerOrganizationId: OrganizationId;
}

/**
 * Active Recipient required for new handoff; must belong to the Owner organization.
 */
export function evaluateRecipientForHandoff(
  input: RecipientOrgBoundInput,
): HandoffResult<Recipient> {
  if (input.recipientOrganizationId !== input.ownerOrganizationId) {
    return handoffFail(
      'NOT_FOUND',
      categoryForHandoffCode('NOT_FOUND'),
      'Recipient was not found in the Owner organization.',
    );
  }
  if (!input.recipient.active) {
    return handoffFail(
      'RECIPIENT_INACTIVE',
      categoryForHandoffCode('RECIPIENT_INACTIVE'),
      'Inactive Recipients cannot receive a new handoff.',
    );
  }
  try {
    assertValidRecipientEmail(input.recipient.email);
    assertValidRecipientDisplayName(input.recipient.displayName);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Recipient validation failed.';
    return handoffFail('VALIDATION_ERROR', categoryForHandoffCode('VALIDATION_ERROR'), message);
  }
  return handoffOk(input.recipient);
}

/**
 * Deactivation must not alter prior Assignment/audit identity — domain rule only.
 * Returns audit intent; does not mutate historical assignment fields.
 */
export function planRecipientDeactivation(input: {
  recipient: Recipient;
  organizationId: OrganizationId;
  now: UtcInstant;
}): HandoffResult<{ recipient: Recipient; auditIntent: HandoffAuditIntent }> {
  if (!input.recipient.active) {
    return handoffFail(
      'DOMAIN_CONFLICT',
      categoryForHandoffCode('DOMAIN_CONFLICT'),
      'Recipient is already inactive.',
    );
  }
  const deactivated: Recipient = { ...input.recipient, active: false };
  return handoffOk({
    recipient: deactivated,
    auditIntent: {
      type: 'recipient_deactivated',
      organizationId: input.organizationId,
      recipientId: input.recipient.id,
      occurredAt: input.now,
    },
  });
}

/**
 * Recommendation for duplicate email within an Owner organization (D087).
 * Domain does not enforce uniqueness via I/O — callers supply whether a duplicate exists.
 */
export function evaluateDuplicateRecipientEmail(input: {
  normalizedEmail: string;
  duplicateActiveExists: boolean;
}): HandoffResult<void> {
  const normalized = normalizeRecipientEmail(input.normalizedEmail);
  if (!isValidRecipientEmailShape(normalized)) {
    return handoffFail(
      'VALIDATION_ERROR',
      categoryForHandoffCode('VALIDATION_ERROR'),
      'Recipient email is invalid.',
      [{ field: 'email', message: 'Invalid email format' }],
    );
  }
  if (input.duplicateActiveExists) {
    return handoffFail(
      'DOMAIN_CONFLICT',
      categoryForHandoffCode('DOMAIN_CONFLICT'),
      'An active Recipient with this email already exists in the organization.',
      [{ field: 'email', message: 'Duplicate active email' }],
    );
  }
  return handoffOk(undefined);
}
