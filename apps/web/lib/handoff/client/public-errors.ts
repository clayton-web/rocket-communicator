/**
 * Browser-safe parser for public handoff/Owner API ErrorResponse shapes.
 * Never trusts free-form messages for retry decisions; never logs bodies.
 */

import type { components } from '@aicaa/contracts/schema';
import type { PendingHandoffOutcomeCategory } from './pending-operation';

type ErrorCode = components['schemas']['ErrorResponse']['error']['code'];

const KNOWN_CODES = new Set<string>([
  'VALIDATION_ERROR',
  'HANDOFF_NOT_ELIGIBLE',
  'RECIPIENT_INACTIVE',
  'HANDOFF_INCOMPLETE_FORWARD_PROHIBITED',
  'GMAIL_SOURCE_UNAVAILABLE',
  'HANDOFF_DELIVERY_FAILED',
  'UNAUTHORIZED',
  'GMAIL_SEND_SCOPE_REQUIRED',
  'NOT_FOUND',
  'DOMAIN_CONFLICT',
  'IDEMPOTENCY_KEY_CONFLICT',
  'HANDOFF_IN_PROGRESS',
  'PRECONDITION_FAILED',
  'PRECONDITION_REQUIRED',
  'GMAIL_NOT_CONNECTED',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
  'FORBIDDEN',
]);

export interface ParsedPublicError {
  status: number;
  code: ErrorCode | 'UNKNOWN';
  /** Safe Owner-facing copy (never raw provider text). */
  message: string;
  outcomeCategory: PendingHandoffOutcomeCategory;
  /** Same-key retry/check is appropriate. */
  allowSameKeyRetry: boolean;
  /** Browser may start a new logical op (new key) only for pre-persistence cases. */
  allowNewOperation: boolean;
  /** Refetch Task after this error. */
  refetchTask: boolean;
  /** Refetch Recipients after this error. */
  refetchRecipients: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeCode(value: unknown): ErrorCode | 'UNKNOWN' {
  if (typeof value === 'string' && KNOWN_CODES.has(value)) {
    return value as ErrorCode;
  }
  return 'UNKNOWN';
}

/** Map status+code to UX category using contracted public codes only (no retryable field on ErrorResponse). */
export function classifyHandoffPublicError(
  status: number,
  code: ErrorCode | 'UNKNOWN',
): ParsedPublicError {
  const base = {
    status,
    code,
    allowSameKeyRetry: false,
    allowNewOperation: false,
    refetchTask: false,
    refetchRecipients: false,
    message: 'Something went wrong. Please try again.',
    outcomeCategory: 'unknown' as PendingHandoffOutcomeCategory,
  };

  switch (code) {
    case 'VALIDATION_ERROR':
      return {
        ...base,
        message: 'The handoff request was invalid. Refresh the Task and try again.',
        outcomeCategory: 'validation',
        allowNewOperation: true,
        refetchTask: true,
      };
    case 'HANDOFF_NOT_ELIGIBLE':
      return {
        ...base,
        message: 'This Task cannot be handed off in its current state.',
        outcomeCategory: 'not_eligible',
        refetchTask: true,
      };
    case 'RECIPIENT_INACTIVE':
      return {
        ...base,
        message: 'That Recipient is no longer active. Choose another Recipient.',
        outcomeCategory: 'inactive_recipient',
        allowNewOperation: true,
        refetchRecipients: true,
      };
    case 'HANDOFF_INCOMPLETE_FORWARD_PROHIBITED':
      return {
        ...base,
        message:
          'The original Gmail message could not be forwarded completely. A new handoff was not started.',
        outcomeCategory: 'preparation_failure',
        allowSameKeyRetry: true,
        refetchTask: true,
      };
    case 'GMAIL_SOURCE_UNAVAILABLE':
      return {
        ...base,
        message: 'The Gmail source for this Task is unavailable. A new handoff was not started.',
        outcomeCategory: 'preparation_failure',
        allowSameKeyRetry: true,
        refetchTask: true,
      };
    case 'HANDOFF_DELIVERY_FAILED':
      if (status === 503) {
        return {
          ...base,
          message: 'Delivery could not be completed because of a temporary Gmail problem.',
          outcomeCategory: 'retryable_failure',
          allowSameKeyRetry: true,
        };
      }
      return {
        ...base,
        message: 'Gmail did not accept the message. Do not start a new handoff for this operation.',
        outcomeCategory: 'permanent_failure',
        allowSameKeyRetry: false,
        refetchTask: true,
      };
    case 'UNAUTHORIZED':
      return {
        ...base,
        message: 'Your session expired. Sign in again to continue.',
        outcomeCategory: 'unauthorized',
      };
    case 'GMAIL_SEND_SCOPE_REQUIRED':
      return {
        ...base,
        message: 'Gmail send permission is missing. Grant send access, then retry this handoff.',
        outcomeCategory: 'reconsent_required',
        allowSameKeyRetry: true,
      };
    case 'NOT_FOUND':
      return {
        ...base,
        message: 'The Task or Recipient was not found.',
        outcomeCategory: 'not_found',
        refetchTask: true,
      };
    case 'DOMAIN_CONFLICT':
      return {
        ...base,
        message: 'The Task state changed. Refreshing the current status.',
        outcomeCategory: 'conflict',
        refetchTask: true,
      };
    case 'IDEMPOTENCY_KEY_CONFLICT':
      return {
        ...base,
        message:
          'The saved browser handoff conflicts with server state. Refreshing the Task status.',
        outcomeCategory: 'conflict',
        refetchTask: true,
      };
    case 'HANDOFF_IN_PROGRESS':
      return {
        ...base,
        message: 'This handoff is still unresolved. We will not start another delivery.',
        outcomeCategory: 'in_progress',
        allowSameKeyRetry: true,
      };
    case 'PRECONDITION_FAILED':
      return {
        ...base,
        message: 'The Task changed since this page was loaded. Refreshing.',
        outcomeCategory: 'stale',
        allowNewOperation: true,
        refetchTask: true,
      };
    case 'PRECONDITION_REQUIRED':
      return {
        ...base,
        message: 'Required request headers were missing. Refresh and try again.',
        outcomeCategory: 'validation',
        allowNewOperation: true,
        refetchTask: true,
      };
    case 'GMAIL_NOT_CONNECTED':
      return {
        ...base,
        message: 'Connect Gmail before handing off this Task.',
        outcomeCategory: 'not_connected',
        allowSameKeyRetry: true,
      };
    case 'DEPENDENCY_UNAVAILABLE':
      return {
        ...base,
        message:
          'Gmail did not provide a confirmed final result. The message may or may not have been sent. Do not start a new handoff.',
        outcomeCategory: 'ambiguous',
        allowSameKeyRetry: true,
      };
    case 'INTERNAL_ERROR':
    case 'FORBIDDEN':
    case 'UNKNOWN':
    default:
      return base;
  }
}

export function parsePublicErrorResponse(status: number, body: unknown): ParsedPublicError {
  if (!isRecord(body) || !isRecord(body.error)) {
    return classifyHandoffPublicError(status, 'UNKNOWN');
  }
  const code = safeCode(body.error.code);
  return classifyHandoffPublicError(status, code);
}
