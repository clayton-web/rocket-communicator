import { NextResponse } from 'next/server';
import { jsonErrorResponse } from '@/lib/auth/http';
import { logDatabaseRuntimeFailure } from '@/lib/db/diagnostics';
import { getDb } from '@/lib/db/server';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { authorizeCronRequest } from '@/lib/gmail/cron-auth';
import { createGmailReminderTransportProvider } from '@/lib/gmail/reminder-transport-provider';
import {
  getReminderDeliveryOrganizationId,
  isReminderDeliveryEnabled,
} from '@/lib/reminders/process-config';
import { runInternalReminderProcess } from '@/lib/reminders/process-service';
import type { ReminderTransportProvider } from '@/lib/reminders/transport';
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
 * Compose the production reminder transport, or nothing at all (A8.4b.1).
 *
 * The flag is checked **here**, before any Gmail object is constructed, in addition to being checked
 * inside the processing service. That is not redundancy for its own sake: it means that with
 * `ENABLE_REMINDER_DELIVERY` unset, no Gmail provider is built, no access resolver exists, no refresh
 * token is decrypted, and no token exchange is attempted. "Delivery disabled implies no Gmail contact"
 * becomes a property of the composition rather than a promise made by code further down.
 *
 * A missing `OWNER_ORGANIZATION_ID` also yields nothing, so the invocation fails closed rather than
 * guessing which Owner's Gmail account to send through.
 */
async function composeTransportProvider(
  db: Awaited<ReturnType<typeof getDb>>,
): Promise<ReminderTransportProvider | undefined> {
  if (!isReminderDeliveryEnabled()) {
    return undefined;
  }
  const organizationId = getReminderDeliveryOrganizationId();
  if (!organizationId) {
    return undefined;
  }
  return createGmailReminderTransportProvider({
    db,
    runtime: await loadDbRuntime(),
    organizationId,
  });
}

/**
 * Internal reminder occurrence processing (A8.4a foundation, A8.4b.1 overdue Gmail delivery).
 *
 * **Built, and never deployed.** No deployment of this milestone has happened, so this route does not
 * exist in any running environment. Even if it did, three independent things would each be enough to
 * stop it sending anything: `ENABLE_REMINDER_DELIVERY` is not set to `"true"` in any environment, and
 * with it unset no Gmail transport is even constructed; the processing service fails closed without a
 * transport; and the once-per-invocation Gmail authorization has to succeed before a single occurrence
 * can be claimed. With delivery off it claims nothing, writes nothing, and calls no transport — it
 * returns zero aggregates and `deliveryEnabled: false`. No cron job invokes it.
 *
 * **It does still open a database connection while disabled, and that is worth stating plainly**
 * because the sibling notification worker does not. `getDb()` is awaited below before the flag is
 * consulted, so a disabled invocation constructs a database client and connects; what it does not do
 * is issue a scan, a claim, or a write. Against a Production database without the A8 migrations that
 * connection succeeds and the invocation is still inert, since nothing queries the absent tables.
 * Do not cite this route as an example of "disabled implies no database contact".
 *
 * A8.4b.1 delivers **overdue** reminders only. Advance delivery is A8.4b.3 and has no scan predicate,
 * so no advance occurrence can be claimed here; D129's consecutive-ambiguous stopping rule is
 * A8.4b.2, and this slice records the terminal ambiguous outcomes it will count without enforcing the
 * threshold.
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
        const result = await runInternalReminderProcess({
          db,
          requestId: requestId!,
          transportProvider: await composeTransportProvider(db),
        });
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
