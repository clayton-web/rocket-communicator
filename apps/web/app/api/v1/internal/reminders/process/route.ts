import { NextResponse } from 'next/server';
import { jsonErrorResponse } from '@/lib/auth/http';
import { logDatabaseRuntimeFailure } from '@/lib/db/diagnostics';
import { getDb } from '@/lib/db/server';
import { authorizeCronRequest } from '@/lib/gmail/cron-auth';
import { runInternalReminderProcess } from '@/lib/reminders/process-service';
import {
  createRequestId,
  getRequestId,
  logOperationalFailure,
  runWithRequestContext,
} from '@/lib/observability';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Every response leaves through here (A8.4a audit L2).
 *
 * `no-store` used to be attached to the success branch only, so a 401 and a 500 — the two responses
 * most likely to be produced in bulk by a misconfigured scheduler — were cacheable by anything
 * between here and the caller. Applying it at the single exit is a stronger guarantee than
 * remembering to repeat the header on every branch, because there is no branch left to forget.
 */
function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/**
 * Internal reminder occurrence processing (A8.4a).
 *
 * **Built dark, and never deployed.** No deployment of this milestone has happened, so this route
 * does not exist in any running environment. Even if it did, three independent things would each be
 * enough to stop it doing anything: `ENABLE_REMINDER_DELIVERY` is not set to `"true"` anywhere; no
 * transport is injected, and the processing service fails closed without one; and no real transport
 * has been implemented to inject. With delivery off it scans nothing, claims nothing, writes
 * nothing, and calls no transport — it returns zero aggregates and `deliveryEnabled: false`. No cron
 * job invokes it, and the only transport that exists at all is the A8.4a test fake.
 *
 * Invoked by an External Scheduler with `Authorization: Bearer <CRON_SECRET>`, on the same
 * approximately five-minute wake-up cadence as the other internal jobs. Nothing repeats every five
 * minutes: persisted occurrence instants are the scheduling authority and this endpoint asks which
 * of them have arrived. Missed invocations are recovered by later ones, and overlapping invocations
 * are safe because occurrence identity is unique in the database, not because they do not overlap.
 *
 * Empty body, aggregate counts only. No POST handler sibling reads a Task summary, recipient
 * address, or provider payload, and none may be added to the response.
 *
 * There is no GET handler. The Gmail poll exposes one because some schedulers prefer GET; this
 * endpoint mutates occurrence state and has no reason to be reachable by a browser address bar.
 */
export async function POST(request: Request): Promise<Response> {
  const routeTemplate = '/api/v1/internal/reminders/process';
  const response = await runWithRequestContext(
    {
      requestId: createRequestId(),
      routeTemplate,
      operation: 'internal_reminder_process',
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
        const result = await runInternalReminderProcess({ db, requestId: requestId! });
        return NextResponse.json(result.response);
      } catch (error) {
        logDatabaseRuntimeFailure(error, { routePathname: routeTemplate, requestId });
        logOperationalFailure(error, {
          routePathname: routeTemplate,
          operation: 'internal_reminder_process',
          requestId,
        });
        return jsonErrorResponse('INTERNAL_ERROR', 'Internal server error.', 500);
      }
    },
  );
  return noStore(response);
}
