import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';
import { jsonErrorResponse, unauthorizedResponse } from '@/lib/auth/http';
import { attachOwnerTaskDbDiagnosticHeaders } from '@/lib/db/stage-response-headers';
import type { CapabilityTokenErrorCode } from '@/lib/capability/errors';
import type { RecipientCapabilityServiceErrorCode } from '@/lib/capability/recipient-errors';
import {
  isAuthConfigError,
  isCapabilityTokenError,
  isPersistenceErrorShape,
  isRecipientCapabilityServiceError,
  isTaskServiceError,
  readCapabilityTokenErrorCode,
  readPersistenceErrorCode,
  readRecipientCapabilityServiceErrorCode,
  readRecipientCapabilityServiceErrorDetails,
  readRecipientCapabilityServiceErrorMessage,
  readTaskServiceErrorCode,
  readTaskServiceErrorDetails,
  readTaskServiceErrorMessage,
  safeReadString,
} from '@/lib/errors/safe-error-shapes';
import type { TaskServiceErrorCode } from '@/lib/tasks/errors';

type ErrorResponse = components['schemas']['ErrorResponse'];
type ErrorCode = ErrorResponse['error']['code'];

export function jsonErrorResponseWithDetails(
  code: ErrorCode,
  message: string,
  status: number,
  details?: ReadonlyArray<{ field: string; message: string }>,
): NextResponse<ErrorResponse> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details: details ? [...details] : undefined,
        requestId: randomUUID(),
        correlationId: null,
      },
    },
    { status },
  );
}

function genericInternalErrorResponse(): NextResponse<ErrorResponse> {
  return jsonErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
}

function ownerTaskUnexpectedInternalErrorResponse(): NextResponse<ErrorResponse> {
  return attachOwnerTaskDbDiagnosticHeaders(genericInternalErrorResponse());
}

function httpStatusForTaskCode(code: TaskServiceErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'FORBIDDEN':
      return 403;
    case 'VALIDATION_ERROR':
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
        code === 'VALIDATION_ERROR'
          ? readRecipientCapabilityServiceErrorDetails(error)
          : undefined,
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
