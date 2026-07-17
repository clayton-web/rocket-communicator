import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { jsonErrorResponse } from '@/lib/auth/http';
import { logDatabaseRuntimeFailure } from '@/lib/db/diagnostics';
import { getDb } from '@/lib/db/server';
import { authorizeCronRequest } from '@/lib/gmail/cron-auth';
import { runInternalGmailPoll } from '@/lib/gmail/poll-service';
import { mapGmailRequestError } from '@/lib/gmail/route-context';

export const runtime = 'nodejs';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * Internal scheduled Gmail poll (A5.5).
 *
 * Invoked by an External Scheduler (recommended initial adapter: cron-job.org).
 * GET remains available for schedulers that prefer GET (secret-auth internal only).
 * Both GET and POST require Authorization: Bearer <CRON_SECRET>. No Owner session.
 */
async function handlePoll(request: Request): Promise<Response> {
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
    const result = await runInternalGmailPoll({ db, requestId });
    return NextResponse.json(result.response, { headers: NO_STORE });
  } catch (error) {
    logDatabaseRuntimeFailure(error, { routePathname: pathname, requestId });
    return mapGmailRequestError(error);
  }
}

export const GET = handlePoll;
export const POST = handlePoll;
