import { NextResponse } from 'next/server';
import { jsonErrorResponse } from '@/lib/auth/http';
import { logDatabaseRuntimeFailure } from '@/lib/db/diagnostics';
import { getDb } from '@/lib/db/server';
import { authorizeCronRequest } from '@/lib/gmail/cron-auth';
import { runInternalNotificationProcess } from '@/lib/notifications/process-service';
import {
  createRequestId,
  getRequestId,
  logOperationalFailure,
  runWithRequestContext,
} from '@/lib/observability';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Every response leaves through here, so no branch can forget the header (A8.4a audit L2). */
function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/**
 * Internal Owner Event Notification processing (A8.5b, D133/D135).
 *
 * A sibling of `/api/v1/internal/reminders/process`, deliberately not an extension of it. The two
 * workers share a shape — cron bearer secret, Node runtime, 60-second cap, soft deadline, bounded
 * batch — and share no policy: one delivers a repeating series to a Recipient under D106 and D129,
 * the other delivers a single event to the Owner under D135. Merging them would put both policies
 * behind one entry point and make a change to either reach the other. Neither calls the other, and
 * a source guard fails the build if that changes.
 *
 * ## Inert in A8.5b
 *
 * This endpoint exists and does nothing, on purpose, in two independent ways.
 *
 * `ENABLE_OWNER_EVENT_DELIVERY` is unset everywhere, so the service returns before it opens a
 * database connection: no scan, no claim, no attempt row, no state change.
 *
 * And no transport is composed here at all. A8.5b's only implementation is the fail-closed fake,
 * which belongs to tests; the production composition is deliberately absent rather than defaulted,
 * so even with the flag set this invocation would deliver nothing. A8.5c adds the real adapter, and
 * until it does there is nothing here that could contact Gmail.
 *
 * No cron invokes this. Creating one is A8.7's decision, not this slice's.
 */
export async function POST(request: Request): Promise<Response> {
  const routeTemplate = '/api/v1/internal/notifications/process';
  const response = await runWithRequestContext(
    {
      requestId: createRequestId(),
      routeTemplate,
      operation: 'internal_notification_process',
      correlationId: null,
    },
    async () => {
      const requestId = getRequestId();
      try {
        const auth = authorizeCronRequest(request);
        if (!auth.ok) {
          return jsonErrorResponse(
            auth.code === 'configuration_error' ? 'INTERNAL_ERROR' : 'UNAUTHORIZED',
            auth.message,
            auth.status,
          );
        }

        const db = await getDb();
        const result = await runInternalNotificationProcess({ db, requestId: requestId! });
        return NextResponse.json(result.response);
      } catch (error) {
        logDatabaseRuntimeFailure(error, { routePathname: routeTemplate, requestId });
        logOperationalFailure(error, {
          routePathname: routeTemplate,
          operation: 'internal_notification_process',
          requestId,
        });
        return jsonErrorResponse('INTERNAL_ERROR', 'Internal server error.', 500);
      }
    },
  );
  return noStore(response);
}
