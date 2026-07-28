import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';
import { getCorrelationId, getRequestId } from '@/lib/observability/request-context';

type ErrorResponse = components['schemas']['ErrorResponse'];

export interface ErrorEnvelopeIds {
  requestId?: string;
  correlationId?: string | null;
}

/**
 * Public contracted error envelope.
 * Reuses the request-scoped requestId when available (P1.1 / D115);
 * mints a UUID only when no diagnostic context exists.
 */
export function jsonErrorResponse(
  code: ErrorResponse['error']['code'],
  message: string,
  status: number,
  ids?: ErrorEnvelopeIds,
): NextResponse<ErrorResponse> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        requestId: resolveRequestId(ids),
        correlationId: resolveCorrelationId(ids),
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

function resolveRequestId(ids?: ErrorEnvelopeIds): string {
  if (ids?.requestId) {
    return ids.requestId;
  }
  return getRequestId() ?? randomUUID();
}

function resolveCorrelationId(ids?: ErrorEnvelopeIds): string | null {
  if (ids && 'correlationId' in ids) {
    return ids.correlationId ?? null;
  }
  const fromContext = getCorrelationId();
  return fromContext === undefined ? null : fromContext;
}
