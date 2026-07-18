import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { jsonErrorResponse } from '@/lib/auth/http';
import { logDatabaseRuntimeFailure } from '@/lib/db/diagnostics';
import { getDb } from '@/lib/db/server';
import { authorizeCronRequest } from '@/lib/gmail/cron-auth';
import {
  runInternalSuggestionProcess,
  SuggestionProcessConfigurationError,
} from '@/lib/suggestions/process-service';

export const runtime = 'nodejs';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * Internal Application Suggestion Engine (A6.3 / D084).
 *
 * Invoked by an External Scheduler with Authorization: Bearer <CRON_SECRET>.
 * Empty body. Independent of Gmail History poll (D075, D084).
 * Aggregate counts only — never excerpts, prompts, or model payloads.
 */
export async function POST(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  let requestId: string | undefined;
  try {
    const auth = authorizeCronRequest(request);
    if (!auth.ok) {
      return jsonErrorResponse(
        auth.code === 'configuration_error' ? 'INTERNAL_ERROR' : 'UNAUTHORIZED',
        auth.message,
        auth.status,
      );
    }

    requestId = randomUUID();
    const db = await getDb();
    const result = await runInternalSuggestionProcess({ db, requestId });
    return NextResponse.json(result.response, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SuggestionProcessConfigurationError) {
      return jsonErrorResponse(
        'INTERNAL_ERROR',
        'Suggestion processing is not configured correctly.',
        500,
      );
    }
    logDatabaseRuntimeFailure(error, { routePathname: pathname, requestId });
    return jsonErrorResponse('INTERNAL_ERROR', 'Internal server error.', 500);
  }
}
