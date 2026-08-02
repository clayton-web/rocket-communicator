import 'server-only';
import type {
  OwnerNotificationTransport,
  OwnerNotificationTransportRequest,
  OwnerNotificationTransportResult,
} from '@/lib/notifications/transport';
import { GmailSendRawError, sendRawMessage, type GmailSendRawResponse } from '../gmail-api-client';
import {
  classifyGmailSendHttpStatus,
  classifyMimeError,
  isMimeConstructionError,
  transportFailure,
  type TransportFailure,
} from '../transport/errors';
import { toBase64Url, buildMimeMessage, type MimeBuildOptions } from '../transport/mime';
import type { GmailRawSender } from '../transport/gmail-transport';
import type { OutboundAddress } from '../transport/outbound-types';
import {
  buildOwnerNotificationEmail,
  OwnerNotificationEmailContentError,
  type OwnerNotificationActorKind,
  type OwnerNotificationEventType,
} from './owner-notification-email';

/**
 * A8.5c Gmail transport for Owner Event Notifications (D133–D136).
 *
 * Satisfies the A8.5b seam and changes nothing behind it. The worker still claims, marks the
 * provider call, calls this, and settles under its fencing token; this file is only what happens
 * during the call it already made.
 *
 * ## The destination cannot come from anywhere but the connected account (D134)
 *
 * There is no `to` in this file's inputs, and that is the design rather than an omission. The
 * message is addressed to the same mailbox it is sent from, and that mailbox arrives from
 * {@link OwnerNotificationAuthorizer}, which reads `CommunicationAccount.emailAddress` for the
 * intent's own organization. A Task field, a Recipient row, an event's metadata, or a caller-supplied
 * string has no parameter to travel through, so "the destination is the connected account" is a
 * property of the type signature and not a rule somebody has to keep following.
 *
 * Authorization is resolved **per notification**, against the organization on the intent. The
 * reminder worker resolves once per invocation because every reminder it will send belongs to one
 * configured organization; notification intents carry their own, and reusing one organization's
 * token for another organization's event would be a cross-tenant send. Nothing is cached between
 * items, so a mailbox that was reconnected to a different address a moment ago is mailed at the new
 * one — which is also what makes "resolved fresh at delivery time" testable rather than asserted.
 *
 * ## Why authorization failure is permanent here and retryable in the reminder worker
 *
 * The reminder worker resolves authorization before its first claim, so a disconnected account ends
 * the whole invocation with nothing claimed and no occurrence charged. This worker has already
 * claimed the intent and committed the in-flight marker by the time it gets here, so the same
 * condition has to be answered as an outcome for *this* notification. A durably unavailable channel
 * is not worth three attempts against a mailbox nobody has reconnected: `permanent` terminalizes it
 * once, sets `requiresOwnerAttention`, and stops. A token that merely expired mid-flight is a
 * different fact and is reported as `retryable` — see {@link classifyOwnerNotificationFailure}.
 *
 * ## What it never does
 *
 * No threading, no CC, no BCC, no OAuth flow, no second token-refresh path, no capability minting,
 * no database write, no retry of its own, and no state change. All of those belong to somebody else,
 * and most are forbidden.
 */

/** Failure codes this adapter can persist. Closed set: never a provider body or exception text. */
export const OWNER_NOTIFICATION_FAILURE_CODES = {
  notConnected: 'gmail_not_connected',
  sendScopeRequired: 'gmail_send_scope_required',
  organizationMismatch: 'owner_notification_organization_mismatch',
  contextUnavailable: 'owner_notification_context_unavailable',
  contentRejected: 'owner_notification_content_rejected',
} as const;

/** Everything the renderer needs that only the database can answer, for one intent. */
export interface OwnerNotificationRenderContext {
  readonly eventType: OwnerNotificationEventType;
  /** The historical triggering actor from the intent row, never today's Task state (D133). */
  readonly actorKind: OwnerNotificationActorKind;
  readonly occurredAt: string;
  /** Persisted Task summary points, already URL-redacted. Empty when the subject is not a Task. */
  readonly summaryLines: readonly string[];
  /** Authenticated Owner surface for this event, when one applies. Never a capability URL. */
  readonly ownerLink?: string;
}

/**
 * Load the render context for one intent, or `null` when the facts required to render truthfully
 * are missing. `null` fails the send closed rather than producing a vague email.
 */
export type OwnerNotificationContextResolver = (
  request: OwnerNotificationTransportRequest,
) => Promise<OwnerNotificationRenderContext | null>;

export type OwnerNotificationAuthorization =
  | {
      readonly state: 'available';
      /** The connected mailbox. Sender and destination both — this is a send-to-self message. */
      readonly mailbox: OutboundAddress;
      readonly accessToken: string;
    }
  | { readonly state: 'not_connected' }
  | { readonly state: 'send_scope_required' };

/** Resolve one organization's Gmail authorization and connected mailbox identity. */
export type OwnerNotificationAuthorizer = (
  organizationId: string,
) => Promise<OwnerNotificationAuthorization>;

export interface GmailOwnerNotificationTransportDeps {
  readonly authorize: OwnerNotificationAuthorizer;
  readonly resolveContext: OwnerNotificationContextResolver;
  /**
   * Optional single-Owner assertion. When configured, an intent from any other organization is
   * refused rather than delivered — the failure mode this guards against is routing one
   * organization's event through another's mailbox, which is worse than not sending it.
   */
  readonly expectedOrganizationId?: string;
  /** Low-level sender seam. Tests inject; production uses the real Gmail REST sender. */
  readonly sendRaw?: GmailRawSender;
  readonly mimeOptions?: MimeBuildOptions;
}

/**
 * Map a Gmail failure onto the four outcomes A8.5b can act on (D135).
 *
 * Deliberately not `classifyReminderTransportFailure`. That function encodes reminder policy, and
 * the two engines disagree about what an ambiguous answer means: a reminder counts one as a
 * delivery because D106 caps them and a duplicate reminder is the worse failure, while an Owner
 * notification treats one as terminal and unconfirmed because reporting a delivery that may never
 * have happened is the worse untruth. Reusing the function would put both readings behind one call
 * and let a change to either reach the other.
 *
 * The mapping itself agrees on authorization, for a reason worth stating rather than inheriting: a
 * 401 or 403 from Gmail is proof the message was **not** accepted, and `retryable` asks only whether
 * trying again is safe. A token that aged out between authorization and this HTTP call is fixed by
 * the next invocation resolving a fresh one, and burning the intent's whole budget on it would put
 * `requiresOwnerAttention` on a notification nothing was actually wrong with.
 */
export function classifyOwnerNotificationFailure(
  failure: TransportFailure,
): OwnerNotificationTransportResult {
  if (failure.ambiguous) {
    return { kind: 'ambiguous', failureCode: failure.code };
  }
  if (failure.retryable || failure.category === 'authorization') {
    return { kind: 'retryable', failureCode: failure.code };
  }
  return { kind: 'permanent', failureCode: failure.code };
}

export class OwnerNotificationTransportTestEnvironmentError extends Error {
  constructor() {
    super(
      'The real Gmail Owner notification sender must not be constructed under an automated test runner. ' +
        'Inject `sendRaw` with a deterministic fake instead.',
    );
    this.name = 'OwnerNotificationTransportTestEnvironmentError';
  }
}

/** Automated test runner detection. Vitest sets both of these; the third covers Jest-style runners. */
function isAutomatedTestEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VITEST === 'true' || env.NODE_ENV === 'test' || typeof env.JEST_WORKER_ID === 'string';
}

/**
 * Choose the sender, and refuse the real one under a test runner (A8.4b.1's protection, A8.5c's
 * turn to need it).
 *
 * Every other guard in this repository describes code that exists. This one also covers code nobody
 * has written: a future test that builds this adapter and forgets to inject a fake gets a loud error
 * at construction instead of a real HTTP request carrying a real token to a real mailbox. Throwing
 * rather than substituting a no-op sender is deliberate, since a silent stub would let that test
 * pass while asserting nothing.
 */
function resolveRawSender(injected: GmailRawSender | undefined): GmailRawSender {
  if (injected) {
    return injected;
  }
  if (isAutomatedTestEnvironment()) {
    throw new OwnerNotificationTransportTestEnvironmentError();
  }
  return sendRawMessage;
}

export function createGmailOwnerNotificationTransport(
  deps: GmailOwnerNotificationTransportDeps,
): OwnerNotificationTransport {
  const sendRaw = resolveRawSender(deps.sendRaw);

  return {
    async send(
      request: OwnerNotificationTransportRequest,
    ): Promise<OwnerNotificationTransportResult> {
      if (
        deps.expectedOrganizationId !== undefined &&
        request.organizationId !== deps.expectedOrganizationId
      ) {
        // Fail closed rather than redirect. Delivering this organization's event through the
        // configured organization's mailbox would be a cross-tenant send, and silently doing so is
        // exactly the outcome the single-Owner assertion exists to prevent.
        return {
          kind: 'permanent',
          failureCode: OWNER_NOTIFICATION_FAILURE_CODES.organizationMismatch,
        };
      }

      // The intent's own organization, resolved now. Not a cached mailbox, not a configured
      // address, not anything derived from the Task or its Recipient (D134).
      const authorization = await deps.authorize(request.organizationId);
      if (authorization.state === 'not_connected') {
        return {
          kind: 'permanent',
          failureCode: OWNER_NOTIFICATION_FAILURE_CODES.notConnected,
        };
      }
      if (authorization.state === 'send_scope_required') {
        return {
          kind: 'permanent',
          failureCode: OWNER_NOTIFICATION_FAILURE_CODES.sendScopeRequired,
        };
      }

      const context = await deps.resolveContext(request);
      if (!context) {
        // Nothing truthful left to say about this event. Permanent because the missing facts will
        // still be missing on a retry, and an email that names no Task is worse than none.
        return {
          kind: 'permanent',
          failureCode: OWNER_NOTIFICATION_FAILURE_CODES.contextUnavailable,
        };
      }

      let rawBase64Url: string;
      try {
        const message = buildOwnerNotificationEmail({
          from: authorization.mailbox,
          // Send-to-self: the connected mailbox is both ends of this message (D134, D136).
          to: authorization.mailbox,
          eventType: context.eventType,
          actorKind: context.actorKind,
          occurredAt: context.occurredAt,
          summaryLines: context.summaryLines,
          ownerLink: context.ownerLink,
        });
        rawBase64Url = toBase64Url(buildMimeMessage(message, deps.mimeOptions));
      } catch (error) {
        if (error instanceof OwnerNotificationEmailContentError) {
          // A content rule refused it. Permanent by construction: the same facts render the same way
          // every time, so retrying would fail identically and spend the budget proving it.
          return {
            kind: 'permanent',
            failureCode: OWNER_NOTIFICATION_FAILURE_CODES.contentRejected,
          };
        }
        if (isMimeConstructionError(error)) {
          return classifyOwnerNotificationFailure(classifyMimeError(error));
        }
        return classifyOwnerNotificationFailure(transportFailure('GMAIL_CONFIGURATION_ERROR'));
      }

      let response: GmailSendRawResponse;
      try {
        // No `threadId`. A notification joins no conversation and starts none.
        response = await sendRaw({ accessToken: authorization.accessToken, raw: rawBase64Url });
      } catch (error) {
        // Ambiguous, never retryable, and the reasoning is A8.4b.1's re-audit applied to a stricter
        // policy. `sendRawMessage` reports every non-abort fetch rejection as `network`, and Node
        // raises the same error whether the peer refused the connection or reset it *after* reading
        // the whole request body. So this seam genuinely cannot distinguish "Gmail never heard us"
        // from "Gmail has the message and we never heard the answer".
        //
        // A8.5b already settles a crash at this instant as ambiguous, because the in-flight marker
        // is committed before the call. Catching the error must not produce a *less* safe answer
        // than crashing would have, and D135 makes ambiguity terminal rather than retried.
        const kind = error instanceof GmailSendRawError ? error.kind : 'unknown';
        return classifyOwnerNotificationFailure(transportFailure('GMAIL_AMBIGUOUS_SEND', kind));
      }

      if (response.status < 200 || response.status >= 300) {
        return classifyOwnerNotificationFailure(classifyGmailSendHttpStatus(response.status));
      }

      if (!response.id) {
        // A 2xx carrying no message id is not an acceptance anybody could later verify. Ambiguous
        // rather than sent — D135 forbids reporting an unconfirmable send as delivered.
        return classifyOwnerNotificationFailure(
          transportFailure('GMAIL_AMBIGUOUS_SEND', 'missing_id'),
        );
      }

      // The Gmail message id and nothing else. Not the response body, not `threadId`, not the
      // headers, not the MIME, and not the address (D109, D114).
      return { kind: 'accepted', providerMessageRef: response.id };
    },
  };
}
