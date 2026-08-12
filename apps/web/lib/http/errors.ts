import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';
import { jsonErrorResponse, unauthorizedResponse, type ErrorEnvelopeIds } from '@/lib/auth/http';
import type { CapabilityTokenErrorCode } from '@/lib/capability/errors';
import type { RecipientCapabilityServiceErrorCode } from '@/lib/capability/recipient-errors';
import {
  isAiProviderErrorShape,
  isAuthConfigError,
  isCapabilityTokenError,
  isInterpretationServiceError,
  isPersistenceErrorShape,
  isRecipientCapabilityServiceError,
  isRecipientManagementError,
  isTaskServiceError,
  readAiProviderErrorKind,
  readCapabilityTokenErrorCode,
  readInterpretationServiceErrorCode,
  readInterpretationServiceErrorDetails,
  readPersistenceErrorCode,
  readRecipientCapabilityServiceErrorCode,
  readRecipientCapabilityServiceErrorDetails,
  readRecipientCapabilityServiceErrorMessage,
  readRecipientManagementErrorCode,
  readRecipientManagementErrorDetails,
  readRecipientManagementErrorMessage,
  readTaskServiceErrorCode,
  readTaskServiceErrorDetails,
  readTaskServiceErrorMessage,
  safeReadString,
} from '@/lib/errors/safe-error-shapes';
import { getCorrelationId, getRequestId } from '@/lib/observability/request-context';
import type { InterpretationServiceErrorCode } from '@/lib/interpretation/errors';
import type { RecipientManagementErrorCode } from '@/lib/recipients/errors';
import type { TaskServiceErrorCode } from '@/lib/tasks/errors';

type ErrorResponse = components['schemas']['ErrorResponse'];
type ErrorCode = ErrorResponse['error']['code'];

export function jsonErrorResponseWithDetails(
  code: ErrorCode,
  message: string,
  status: number,
  details?: ReadonlyArray<{ field: string; message: string }>,
  ids?: ErrorEnvelopeIds,
): NextResponse<ErrorResponse> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details: details ? [...details] : undefined,
        requestId: ids?.requestId ?? getRequestId() ?? randomUUID(),
        correlationId:
          ids && 'correlationId' in ids
            ? (ids.correlationId ?? null)
            : (getCorrelationId() ?? null),
      },
    },
    { status },
  );
}

function genericInternalErrorResponse(): NextResponse<ErrorResponse> {
  return jsonErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
}

function ownerTaskUnexpectedInternalErrorResponse(): NextResponse<ErrorResponse> {
  return genericInternalErrorResponse();
}

function httpStatusForTaskCode(code: TaskServiceErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'FORBIDDEN':
      return 403;
    case 'VALIDATION_ERROR':
    case 'RECIPIENT_HANDOFF_NOT_AVAILABLE':
      return 400;
    case 'INVALID_STATE_TRANSITION':
    case 'DOMAIN_CONFLICT':
    case 'ASSIGNMENT_PRECONDITION':
    case 'PERSISTENCE_CONFLICT':
      return 409;
    case 'PRECONDITION_REQUIRED':
      return 428;
    case 'PRECONDITION_FAILED':
      return 412;
    default:
      return 500;
  }
}

function contractCodeForTaskCode(code: TaskServiceErrorCode): ErrorCode {
  switch (code) {
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'FORBIDDEN':
      return 'FORBIDDEN';
    case 'VALIDATION_ERROR':
      return 'VALIDATION_ERROR';
    case 'RECIPIENT_HANDOFF_NOT_AVAILABLE':
      return 'RECIPIENT_HANDOFF_NOT_AVAILABLE';
    case 'INVALID_STATE_TRANSITION':
      return 'INVALID_STATE_TRANSITION';
    case 'DOMAIN_CONFLICT':
    case 'ASSIGNMENT_PRECONDITION':
    case 'PERSISTENCE_CONFLICT':
      return 'DOMAIN_CONFLICT';
    case 'PRECONDITION_REQUIRED':
      return 'PRECONDITION_REQUIRED';
    case 'PRECONDITION_FAILED':
      return 'PRECONDITION_FAILED';
    default:
      return 'INTERNAL_ERROR';
  }
}

function httpStatusForCapabilityCode(code: CapabilityTokenErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'PRECONDITION_FAILED':
      return 412;
    case 'ISSUANCE_CONFLICT':
    case 'ISSUANCE_PRECONDITION':
      return 409;
    case 'MISSING_CONFIGURATION':
    case 'INVALID_TTL_CONFIGURATION':
      return 500;
    default:
      return 500;
  }
}

function contractCodeForCapabilityCode(code: CapabilityTokenErrorCode): ErrorCode {
  switch (code) {
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'PRECONDITION_FAILED':
      return 'PRECONDITION_FAILED';
    case 'ISSUANCE_CONFLICT':
    case 'ISSUANCE_PRECONDITION':
      return 'DOMAIN_CONFLICT';
    case 'MISSING_CONFIGURATION':
    case 'INVALID_TTL_CONFIGURATION':
      return 'INTERNAL_ERROR';
    default:
      return 'INTERNAL_ERROR';
  }
}

function sanitizeCapabilityMessage(code: CapabilityTokenErrorCode, message?: string): string {
  switch (code) {
    case 'MISSING_CONFIGURATION':
    case 'INVALID_TTL_CONFIGURATION':
      return 'Capability issuance is not configured.';
    case 'PRECONDITION_FAILED':
      return 'The resource has changed since the provided ETag.';
    case 'NOT_FOUND':
      return 'Task not found.';
    case 'ISSUANCE_CONFLICT':
      return 'An active capability link already exists for this assignment.';
    case 'ISSUANCE_PRECONDITION':
      return message ?? 'An unexpected error occurred.';
    default:
      return 'An unexpected error occurred.';
  }
}

function httpStatusForRecipientCode(code: RecipientCapabilityServiceErrorCode): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION_ERROR':
      return 400;
    case 'INVALID_STATE_TRANSITION':
    case 'DOMAIN_CONFLICT':
    case 'PERSISTENCE_CONFLICT':
      return 409;
    case 'PRECONDITION_REQUIRED':
      return 428;
    case 'PRECONDITION_FAILED':
      return 412;
    default:
      return 500;
  }
}

/**
 * Public Recipient capability ErrorCodes (docs/API_CONTRACT.md).
 * Internal CAPABILITY_EXPIRED / CAPABILITY_REVOKED never leave the service layer.
 * Domain/task-state conflicts collapse to DOMAIN_CONFLICT.
 */
function contractCodeForRecipientCode(code: RecipientCapabilityServiceErrorCode): ErrorCode {
  switch (code) {
    case 'UNAUTHORIZED':
      return 'UNAUTHORIZED';
    case 'FORBIDDEN':
      return 'FORBIDDEN';
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'VALIDATION_ERROR':
      return 'VALIDATION_ERROR';
    case 'INVALID_STATE_TRANSITION':
    case 'DOMAIN_CONFLICT':
    case 'PERSISTENCE_CONFLICT':
      return 'DOMAIN_CONFLICT';
    case 'PRECONDITION_REQUIRED':
      return 'PRECONDITION_REQUIRED';
    case 'PRECONDITION_FAILED':
      return 'PRECONDITION_FAILED';
    default:
      return 'INTERNAL_ERROR';
  }
}

function sanitizeRecipientMessage(
  code: RecipientCapabilityServiceErrorCode,
  message: string,
): string {
  switch (code) {
    case 'UNAUTHORIZED':
      return 'Capability token is invalid.';
    case 'FORBIDDEN':
      return 'Capability token does not authorize this action.';
    case 'NOT_FOUND':
      return 'Resource not found.';
    case 'PRECONDITION_REQUIRED':
      return 'If-Match header is required for this mutation.';
    case 'PRECONDITION_FAILED':
      return 'The resource has changed since the provided ETag.';
    case 'VALIDATION_ERROR':
      return message;
    case 'INVALID_STATE_TRANSITION':
    case 'DOMAIN_CONFLICT':
    case 'PERSISTENCE_CONFLICT':
      return 'The request conflicts with the current task state.';
    default:
      return 'An unexpected error occurred.';
  }
}

function mapPersistenceErrorToHttpResponse(): NextResponse<ErrorResponse> {
  return genericInternalErrorResponse();
}

function mapOwnerPersistenceErrorToHttpResponse(
  code: NonNullable<ReturnType<typeof readPersistenceErrorCode>>,
): NextResponse<ErrorResponse> {
  if (code === 'NOT_FOUND' || code === 'ORGANIZATION_MISMATCH') {
    return jsonErrorResponse('NOT_FOUND', 'Task not found.', 404);
  }
  if (code === 'OPTIMISTIC_CONCURRENCY') {
    return jsonErrorResponse(
      'PRECONDITION_FAILED',
      'The resource has changed since the provided ETag.',
      412,
    );
  }
  if (code === 'RECIPIENT_HANDOFF_NOT_AVAILABLE') {
    return jsonErrorResponse(
      'RECIPIENT_HANDOFF_NOT_AVAILABLE',
      'Recipient handoff is not available when approving a suggestion.',
      400,
    );
  }
  return ownerTaskUnexpectedInternalErrorResponse();
}

/** Map Recipient capability application failures to the public HTTP error envelope. */
export function mapRecipientCapabilityRouteError(error: unknown): NextResponse<ErrorResponse> {
  try {
    if (isRecipientCapabilityServiceError(error)) {
      const code = readRecipientCapabilityServiceErrorCode(error);
      if (!code) {
        return genericInternalErrorResponse();
      }
      return jsonErrorResponseWithDetails(
        contractCodeForRecipientCode(code),
        sanitizeRecipientMessage(code, readRecipientCapabilityServiceErrorMessage(error)),
        httpStatusForRecipientCode(code),
        code === 'VALIDATION_ERROR' ? readRecipientCapabilityServiceErrorDetails(error) : undefined,
      );
    }
    if (isCapabilityTokenError(error)) {
      const code = readCapabilityTokenErrorCode(error);
      if (!code) {
        return genericInternalErrorResponse();
      }
      if (code === 'MISSING_CONFIGURATION' || code === 'INVALID_TTL_CONFIGURATION') {
        return genericInternalErrorResponse();
      }
      return jsonErrorResponse('UNAUTHORIZED', 'Capability token is invalid.', 401);
    }
    if (isPersistenceErrorShape(error)) {
      return mapPersistenceErrorToHttpResponse();
    }
    return genericInternalErrorResponse();
  } catch {
    return genericInternalErrorResponse();
  }
}

function httpStatusForRecipientManagementCode(code: RecipientManagementErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'FORBIDDEN':
      return 403;
    case 'VALIDATION_ERROR':
      return 400;
    case 'DOMAIN_CONFLICT':
      return 409;
    default:
      return 500;
  }
}

function contractCodeForRecipientManagementCode(code: RecipientManagementErrorCode): ErrorCode {
  switch (code) {
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'FORBIDDEN':
      return 'FORBIDDEN';
    case 'VALIDATION_ERROR':
      return 'VALIDATION_ERROR';
    case 'DOMAIN_CONFLICT':
      return 'DOMAIN_CONFLICT';
    default:
      return 'INTERNAL_ERROR';
  }
}

/** Map Owner Recipient-management application failures to the contracted HTTP error envelope. */
export function mapOwnerRecipientRouteError(error: unknown): NextResponse<ErrorResponse> {
  try {
    if (isRecipientManagementError(error)) {
      const code = readRecipientManagementErrorCode(error);
      if (!code) {
        return genericInternalErrorResponse();
      }
      return jsonErrorResponseWithDetails(
        contractCodeForRecipientManagementCode(code),
        readRecipientManagementErrorMessage(error),
        httpStatusForRecipientManagementCode(code),
        code === 'VALIDATION_ERROR' ? readRecipientManagementErrorDetails(error) : undefined,
      );
    }
    const persistenceCode = readPersistenceErrorCode(error);
    if (persistenceCode) {
      if (persistenceCode === 'NOT_FOUND' || persistenceCode === 'ORGANIZATION_MISMATCH') {
        return jsonErrorResponse('NOT_FOUND', 'Recipient not found.', 404);
      }
      if (persistenceCode === 'UNIQUE_VIOLATION') {
        return jsonErrorResponse(
          'DOMAIN_CONFLICT',
          'An active Recipient with this email already exists.',
          409,
        );
      }
      return genericInternalErrorResponse();
    }
    if (isAuthConfigError(error)) {
      return jsonErrorResponse('INTERNAL_ERROR', 'Authentication is not configured.', 500);
    }
    return genericInternalErrorResponse();
  } catch {
    return genericInternalErrorResponse();
  }
}

function httpStatusForInterpretationCode(code: InterpretationServiceErrorCode): number {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 400;
    case 'IDEMPOTENCY_KEY_CONFLICT':
    case 'PERSISTENCE_CONFLICT':
      return 409;
    default:
      return 500;
  }
}

/**
 * Public ErrorCodes for interpretation failures (S3.2 / D170).
 *
 * `PERSISTENCE_CONFLICT` collapses to DOMAIN_CONFLICT the same way the Owner task and Recipient
 * capability mappers already collapse it: which constraint the database refused on is internal, and
 * the caller's usable truth is only that the write conflicted and replaced nothing.
 */
function contractCodeForInterpretationCode(code: InterpretationServiceErrorCode): ErrorCode {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 'VALIDATION_ERROR';
    case 'IDEMPOTENCY_KEY_CONFLICT':
      return 'IDEMPOTENCY_KEY_CONFLICT';
    case 'PERSISTENCE_CONFLICT':
      return 'DOMAIN_CONFLICT';
    default:
      return 'INTERNAL_ERROR';
  }
}

/**
 * Fixed public messages for interpretation failures.
 *
 * Service validation messages are value-free templates naming a field and its rule, so they are
 * returned as-is for the same reason Recipient management messages are. Everything else answers
 * with a constant: a conflict must not describe the committed request it collided with.
 */
function sanitizeInterpretationMessage(
  code: InterpretationServiceErrorCode,
  message: string,
): string {
  switch (code) {
    case 'VALIDATION_ERROR':
      return message;
    case 'IDEMPOTENCY_KEY_CONFLICT':
      return 'Idempotency-Key was already used for a different request.';
    case 'PERSISTENCE_CONFLICT':
      return 'The request conflicts with already-recorded state.';
    default:
      return 'An unexpected error occurred.';
  }
}

/**
 * Map Owner manual-capture interpretation failures to the contracted HTTP error envelope (D170).
 *
 * Provider failures are classified by `AiProviderError.kind` alone. `configuration` and `retryable`
 * are both answered 503 DEPENDENCY_UNAVAILABLE because they are the same fact to a caller: nothing
 * was interpreted, nothing persisted, and the identical request may be retried under the same
 * Idempotency-Key. Distinguishing a disabled provider from an upstream timeout would tell an
 * unauthenticated-adjacent client about our deployment configuration and buy it nothing.
 *
 * No provider message, error code, diagnostic fingerprint, environment variable name, request
 * fingerprint, idempotency key, or raw input crosses this boundary — only the classified kind does.
 */
export function mapOwnerInterpretationRouteError(error: unknown): NextResponse<ErrorResponse> {
  try {
    if (isInterpretationServiceError(error)) {
      const code = readInterpretationServiceErrorCode(error);
      if (!code) {
        return genericInternalErrorResponse();
      }
      return jsonErrorResponseWithDetails(
        contractCodeForInterpretationCode(code),
        sanitizeInterpretationMessage(code, safeReadString(error, 'message') ?? ''),
        httpStatusForInterpretationCode(code),
        code === 'VALIDATION_ERROR' ? readInterpretationServiceErrorDetails(error) : undefined,
      );
    }
    if (isAiProviderErrorShape(error)) {
      if (readAiProviderErrorKind(error) === 'permanent') {
        return genericInternalErrorResponse();
      }
      return jsonErrorResponse(
        'DEPENDENCY_UNAVAILABLE',
        'Interpretation is temporarily unavailable. Retry with the same Idempotency-Key.',
        503,
      );
    }
    if (isPersistenceErrorShape(error)) {
      return genericInternalErrorResponse();
    }
    if (isAuthConfigError(error)) {
      return jsonErrorResponse('INTERNAL_ERROR', 'Authentication is not configured.', 500);
    }
    return genericInternalErrorResponse();
  } catch {
    return genericInternalErrorResponse();
  }
}

/** Map Owner task / capability application failures to the contracted HTTP error envelope. */
export function mapOwnerTaskRouteError(error: unknown): NextResponse<ErrorResponse> {
  try {
    if (isTaskServiceError(error)) {
      const code = readTaskServiceErrorCode(error);
      if (!code) {
        return ownerTaskUnexpectedInternalErrorResponse();
      }
      return jsonErrorResponseWithDetails(
        contractCodeForTaskCode(code),
        readTaskServiceErrorMessage(error),
        httpStatusForTaskCode(code),
        readTaskServiceErrorDetails(error),
      );
    }
    if (isCapabilityTokenError(error)) {
      const code = readCapabilityTokenErrorCode(error);
      if (!code) {
        return ownerTaskUnexpectedInternalErrorResponse();
      }
      return jsonErrorResponseWithDetails(
        contractCodeForCapabilityCode(code),
        sanitizeCapabilityMessage(code, safeReadString(error, 'message')),
        httpStatusForCapabilityCode(code),
      );
    }
    const persistenceCode = readPersistenceErrorCode(error);
    if (persistenceCode) {
      return mapOwnerPersistenceErrorToHttpResponse(persistenceCode);
    }
    if (isAuthConfigError(error)) {
      return jsonErrorResponse('INTERNAL_ERROR', 'Authentication is not configured.', 500);
    }
    return ownerTaskUnexpectedInternalErrorResponse();
  } catch {
    return ownerTaskUnexpectedInternalErrorResponse();
  }
}

export { unauthorizedResponse };
