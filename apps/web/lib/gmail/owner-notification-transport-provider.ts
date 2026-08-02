import 'server-only';
import type { DbClient } from '@aicaa/db';
import { assertValidCapabilityAppUrl } from '@/lib/capability/config';
import type { DbRuntimeModule } from '@/lib/db/runtime-db';
import { createGmailAccessResolver } from '@/lib/handoff/runtime-adapters';
import type { GmailAccessResolver } from '@/lib/handoff/types';
import type {
  OwnerNotificationTransport,
  OwnerNotificationTransportRequest,
} from '@/lib/notifications/transport';
import { redactUrls } from './outbound/reminder-email';
import {
  createGmailOwnerNotificationTransport,
  type OwnerNotificationAuthorization,
  type OwnerNotificationRenderContext,
} from './outbound/owner-notification-transport';
import type {
  OwnerNotificationActorKind,
  OwnerNotificationEventType,
} from './outbound/owner-notification-email';
import type { GmailRawSender } from './transport/gmail-transport';
import type { MimeBuildOptions } from './transport/mime';

/**
 * A8.5c composition point for the Owner notification Gmail transport.
 *
 * Exists because two guards point in opposite directions and both are right. `lib/notifications` may
 * import no provider, so the transport cannot be built there. `lib/gmail/outbound` may import no
 * database layer, so neither authorization nor the Task summary can be resolved there. Composition
 * therefore happens here, next to `reminder-transport-provider.ts`, which joins the same two sides
 * for the same reason.
 */

export interface GmailOwnerNotificationTransportDeps {
  readonly db: DbClient;
  readonly runtime: Pick<
    DbRuntimeModule,
    | 'getCommunicationAccountByOrganization'
    | 'getGmailOAuthCredentialByAccountId'
    | 'findOwnerNotificationIntentById'
    | 'getTaskById'
  >;
  /**
   * The single configured Owner organization, when one is configured. Used only as an assertion:
   * an intent from a different organization is refused, never redirected here.
   */
  readonly expectedOrganizationId?: string;
  /** Canonical application base URL for authenticated Owner links. */
  readonly appUrl: string;
  /** Injectable for tests; production builds the A7 resolver. */
  readonly accessResolver?: GmailAccessResolver;
  readonly sendRaw?: GmailRawSender;
  readonly mimeOptions?: MimeBuildOptions;
}

/**
 * Build the authenticated Owner destination for an event, or `undefined` when none applies.
 *
 * A Task subject gets `/tasks/{id}`; everything else gets no link rather than a guessed one. The
 * base URL goes through the same validator capability URLs use — absolute, https outside local
 * development, no credentials, no query, no fragment — because a misconfigured base is the one way
 * a link in this email could point somewhere it should not.
 *
 * This is not a capability URL and mints nothing. An Owner reaching it without a session lands on
 * sign-in, which is the property that makes a link permissible here at all (D134).
 */
export function buildOwnerNotificationLink(input: {
  readonly appUrl: string;
  readonly subjectKind: string;
  readonly subjectId: string;
}): string | undefined {
  if (input.subjectKind !== 'task') {
    return undefined;
  }
  const base = assertValidCapabilityAppUrl(input.appUrl, {
    requireHttps: (process.env.NODE_ENV ?? '').trim() === 'production',
  });
  // Path-segment encoding, so an identifier carrying anything path-shaped cannot escape `/tasks/`.
  return `${base}/tasks/${encodeURIComponent(input.subjectId)}`;
}

/**
 * Load what the renderer needs for one intent, straight from persisted state.
 *
 * Two reads and no inference. The intent supplies the event type, the historical actor, and the
 * occurrence instant — read from the intent rather than recomputed from the Task, because a Task
 * completed by a Recipient and later reopened by the Owner is still a Recipient completion, and
 * today's row would say otherwise (D133).
 *
 * The Task supplies the summary points, which are how a Task is identified in a product with no
 * title field. They are redacted through the same pass the reminder builder uses: a summary point
 * legitimately derived from a real message can contain a URL, and this email permits exactly one
 * link — its own. Notes, clarification text, and excerpts are never read.
 *
 * Returns `null` when the facts are missing or inconsistent, which the transport turns into a
 * truthful permanent failure rather than a vague email.
 */
export async function resolveOwnerNotificationContext(
  deps: GmailOwnerNotificationTransportDeps,
  request: OwnerNotificationTransportRequest,
): Promise<OwnerNotificationRenderContext | null> {
  // Scoped by organization at the query, so an intent id belonging to another organization reads as
  // absent rather than as somebody else's event. The re-check below is redundant against this
  // repository function today and costs nothing if that ever changes.
  const intent = await deps.runtime.findOwnerNotificationIntentById(
    deps.db,
    request.organizationId,
    request.intentId,
  );
  if (!intent || intent.organizationId !== request.organizationId) {
    return null;
  }

  let summaryLines: string[] = [];
  if (intent.subjectKind === 'task') {
    const task = await deps.runtime.getTaskById(deps.db, intent.organizationId, intent.subjectId);
    if (!task) {
      // The Task is gone — purged under retention, most likely. The event stayed true, which is why
      // the intent holds no foreign key to it (D133), but a notification that can name no task is
      // not worth sending.
      return null;
    }
    summaryLines = (task.summaryPoints ?? [])
      .map((point) =>
        ('value' in point && typeof point.value === 'string' ? point.value : point.label).trim(),
      )
      .map((line) => redactUrls(line))
      .filter((line) => line.length > 0);
  }

  return {
    eventType: intent.eventType as OwnerNotificationEventType,
    actorKind: intent.actorKind as OwnerNotificationActorKind,
    occurredAt: intent.occurredAt,
    summaryLines,
    ownerLink: buildOwnerNotificationLink({
      appUrl: deps.appUrl,
      subjectKind: intent.subjectKind,
      subjectId: intent.subjectId,
    }),
  };
}

/**
 * Compose the real transport.
 *
 * Authorization resolves **per notification**, against the organization named on the intent, and
 * nothing is cached between items. That costs a token exchange per message and buys two properties
 * worth more: one organization's event can never be sent through another's mailbox, and a mailbox
 * reconnected to a different address between two items is mailed at the address it has now.
 */
export function createGmailOwnerNotificationTransportProvider(
  deps: GmailOwnerNotificationTransportDeps,
): OwnerNotificationTransport {
  const accessResolver =
    deps.accessResolver ?? createGmailAccessResolver({ db: deps.db, runtime: deps.runtime });

  return createGmailOwnerNotificationTransport({
    expectedOrganizationId: deps.expectedOrganizationId,
    sendRaw: deps.sendRaw,
    mimeOptions: deps.mimeOptions,
    async authorize(organizationId: string): Promise<OwnerNotificationAuthorization> {
      const access = await accessResolver.resolve(organizationId);
      if (access.state === 'not_connected') {
        return { state: 'not_connected' };
      }
      if (access.state === 'send_scope_required') {
        return { state: 'send_scope_required' };
      }
      // `access.from` is `CommunicationAccount.emailAddress` for this organization, written only by
      // the OAuth connect transaction after Google verified the mailbox (D134). It is the sender and
      // — this being a send-to-self message — the destination.
      return { state: 'available', mailbox: access.from, accessToken: access.accessToken };
    },
    resolveContext: (request) => resolveOwnerNotificationContext(deps, request),
  });
}
