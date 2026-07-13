import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';
import { AuthConfigError } from '@/lib/auth/errors';
import { jsonErrorResponse, unauthorizedResponse } from '@/lib/auth/http';
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

/** Map Owner task application / auth failures to the contracted HTTP error envelope. */
export function mapOwnerTaskRouteError(error: unknown): NextResponse<ErrorResponse> {
  if (error instanceof TaskServiceError) {
    return jsonErrorResponseWithDetails(
      contractCodeForTaskCode(error.code),
      error.message,
      httpStatusForTaskCode(error.code),
      error.details,
    );
  }
  if (error instanceof AuthConfigError) {
    return jsonErrorResponse('INTERNAL_ERROR', 'Authentication is not configured.', 500);
  }
  return jsonErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
}

export { unauthorizedResponse };
