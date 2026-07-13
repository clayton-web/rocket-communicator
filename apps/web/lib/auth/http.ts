import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';

type ErrorResponse = components['schemas']['ErrorResponse'];

export function jsonErrorResponse(
  code: ErrorResponse['error']['code'],
  message: string,
  status: number,
): NextResponse<ErrorResponse> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        requestId: randomUUID(),
        correlationId: null,
      },
    },
    { status },
  );
}

export function unauthorizedResponse(
  message = 'Authentication required.',
): NextResponse<ErrorResponse> {
  return jsonErrorResponse('UNAUTHORIZED', message, 401);
}

export function internalErrorResponse(message: string): NextResponse<ErrorResponse> {
  return jsonErrorResponse('INTERNAL_ERROR', message, 500);
}
