import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';
import { PersistenceError } from '@aicaa/db';
import { AuthConfigError } from '@/lib/auth/errors';
import { jsonErrorResponse, unauthorizedResponse } from '@/lib/auth/http';
import { CapabilityTokenError, type CapabilityTokenErrorCode } from '@/lib/capability/errors';
import {
  RecipientCapabilityServiceError,
  type RecipientCapabilityServiceErrorCode,
} from '@/lib/capability/recipient-errors';
import { TaskServiceError, type TaskServiceErrorCode } from '@/lib/tasks/errors';

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

function sanitizeCapabilityMessage(error: CapabilityTokenError): string {
  switch (error.code) {
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
      return error.message;
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

/** Map Recipient capability application failures to the public HTTP error envelope. */
export function mapRecipientCapabilityRouteError(error: unknown): NextResponse<ErrorResponse> {
  if (error instanceof RecipientCapabilityServiceError) {
    return jsonErrorResponseWithDetails(
      contractCodeForRecipientCode(error.code),
      sanitizeRecipientMessage(error.code, error.message),
      httpStatusForRecipientCode(error.code),
      error.code === 'VALIDATION_ERROR' ? error.details : undefined,
    );
  }
  if (error instanceof CapabilityTokenError) {
    // Config/load failures only — runtime authz errors are already mapped by services.
    if (error.code === 'MISSING_CONFIGURATION' || error.code === 'INVALID_TTL_CONFIGURATION') {
      return jsonErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
    }
    return jsonErrorResponse('UNAUTHORIZED', 'Capability token is invalid.', 401);
  }
  if (error instanceof PersistenceError) {
    return jsonErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
  }
  return jsonErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
}

/** Map Owner task / capability application failures to the contracted HTTP error envelope. */
export function mapOwnerTaskRouteError(error: unknown): NextResponse<ErrorResponse> {
  if (error instanceof TaskServiceError) {
    return jsonErrorResponseWithDetails(
      contractCodeForTaskCode(error.code),
      error.message,
      httpStatusForTaskCode(error.code),
      error.details,
    );
  }
  if (error instanceof CapabilityTokenError) {
    return jsonErrorResponseWithDetails(
      contractCodeForCapabilityCode(error.code),
      sanitizeCapabilityMessage(error),
      httpStatusForCapabilityCode(error.code),
    );
  }
  if (error instanceof PersistenceError) {
    if (error.code === 'NOT_FOUND' || error.code === 'ORGANIZATION_MISMATCH') {
      return jsonErrorResponse('NOT_FOUND', 'Task not found.', 404);
    }
    if (error.code === 'OPTIMISTIC_CONCURRENCY') {
      return jsonErrorResponse(
        'PRECONDITION_FAILED',
        'The resource has changed since the provided ETag.',
        412,
      );
    }
    return jsonErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
  }
  if (error instanceof AuthConfigError) {
    return jsonErrorResponse('INTERNAL_ERROR', 'Authentication is not configured.', 500);
  }
  return jsonErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
}

export { unauthorizedResponse };
