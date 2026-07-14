import { jsonErrorResponse } from '@/lib/auth/http';
import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';

type ErrorResponse = components['schemas']['ErrorResponse'];
type SubmitWorkRequestRequest = components['schemas']['SubmitWorkRequestRequest'];

function fail(message: string): { ok: false; response: NextResponse<ErrorResponse> } {
  return {
    ok: false,
    response: jsonErrorResponse('VALIDATION_ERROR', message, 400),
  };
}

/** Validates SubmitWorkRequestRequest message (confirmation checked separately). */
export function parseWorkRequestBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: Pick<SubmitWorkRequestRequest, 'message'> }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  if (typeof body.message !== 'string' || body.message.trim().length < 1) {
    return fail('message is required.');
  }
  if (body.message.length > 2000) {
    return fail('message exceeds 2000 characters.');
  }
  return { ok: true, value: { message: body.message } };
}
