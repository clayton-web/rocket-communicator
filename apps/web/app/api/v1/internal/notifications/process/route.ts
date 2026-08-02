import { NextResponse } from 'next/server';
import { jsonErrorResponse } from '@/lib/auth/http';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { logDatabaseRuntimeFailure } from '@/lib/db/diagnostics';
import { getDb } from '@/lib/db/server';
import { authorizeCronRequest } from '@/lib/gmail/cron-auth';
import { createGmailOwnerNotificationTransportProvider } from '@/lib/gmail/owner-notification-transport-provider';
import {
  getOwnerNotificationExpectedOrganizationId,
  isOwnerEventDeliveryEnabled,
} from '@/lib/notifications/process-config';
import { runInternalNotificationProcess } from '@/lib/notifications/process-service';
import type { OwnerNotificationTransport } from '@/lib/notifications/transport';
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
 * ## Inert after A8.5c
 *
 * A8.5c gave this endpoint a real Gmail adapter, and the endpoint still sends nothing.
 *
 * `ENABLE_OWNER_EVENT_DELIVERY` is unset in every environment, and it is read in
 * {@link composeTransport} before anything else happens. With it unset, no transport is constructed,
 * no access token is resolved, no refresh token is decrypted, and the service returns before opening
 * a database connection — no scan, no claim, no attempt row, no state change. That an adapter now
 * exists changes what would happen if the flag were set; it does not authorize setting it.
 *
 * No cron invokes this. Creating one is A8.7's decision, not this slice's.
 */

/**
 * Build the Gmail transport, or nothing (D135).
 *
 * The flag is checked first and alone, so the disabled path costs one string comparison and touches
 * no configuration, no credential, and no database. Everything after it can fail, and every failure
 * means *no transport* rather than an error response: a base URL that will not validate is a reason
 * to deliver nothing, not a reason to return 500 to a scheduler that would simply call again.
 *
 * The organization is deliberately absent from this composition. The transport resolves the
 * connected mailbox for whichever organization each intent names;
 * {@link getOwnerNotificationExpectedOrganizationId} contributes an assertion against that, not a
 * destination (D134).
 */
async function composeTransport(
  db: Awaited<ReturnType<typeof getDb>>,
): Promise<OwnerNotificationTransport | undefined> {
  if (!isOwnerEventDeliveryEnabled()) {
    return undefined;
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return undefined;
  }
  try {
    return createGmailOwnerNotificationTransportProvider({
      db,
      runtime: await loadDbRuntime(),
      expectedOrganizationId: getOwnerNotificationExpectedOrganizationId(),
      appUrl,
    });
  } catch {
    // Includes the test-runner construction guard, which throws rather than returning a stub. A
    // failure to construct is a failure to deliver, and never an exception the caller sees.
    return undefined;
  }
}
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
        const result = await runInternalNotificationProcess({
          db,
          requestId: requestId!,
          transport: await composeTransport(db),
        });
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
