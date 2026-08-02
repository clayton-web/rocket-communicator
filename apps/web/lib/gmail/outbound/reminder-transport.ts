import 'server-only';
import type {
  ReminderTransport,
  ReminderTransportRequest,
  ReminderTransportResult,
} from '@/lib/reminders/transport';
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
import { buildReminderEmail, ReminderEmailContentError } from './reminder-email';

/**
 * A8.4b.1 Gmail reminder transport.
 *
 * The narrowest possible adapter between A8.4a's occurrence lifecycle and A7's Gmail primitives. It
 * reuses the MIME builder, the raw sender, the HTTP-status classification, and the access resolver;
 * it reimplements none of them and modifies none of them.
 *
 * ## Why this is not `createGmailTransport`
 *
 * A7's transport takes an `OutboundMessage`, whose `deliveryPath` is a `HandoffDeliveryPath`, and
 * echoes that value back on every acceptance. A reminder is neither an assignment email nor a Gmail
 * forward, so reusing that transport would require either widening A7's delivery-path union — which
 * changes an A7 domain type and its persisted meaning — or passing `'assignment_email'` for a message
 * that is not one, which writes a false value into A7's own acceptance record. Neither is acceptable
 * for a convenience. This adapter composes the same four primitives directly and A7 is untouched.
 *
 * ## Why it lives here rather than in `lib/reminders`
 *
 * `lib/reminders` is guarded: no module in it may import Gmail, googleapis, or any provider, and
 * `a8-4a-worker-safety-guards.test.ts` fails the build if one does. That guard is the reason a
 * reminder cannot accidentally send anything, and A8.4b.1 keeps it intact by putting the provider
 * code on the provider side of the line and having the service depend only on the abstract seam.
 *
 * ## Why authorization resolution is not in this file
 *
 * A7.4 guards this directory in the other direction: `gmail-transport-packaging.test.ts` fails the
 * build if anything under `lib/gmail/transport` or `lib/gmail/outbound` imports the database layer,
 * so that message construction and provider I/O cannot reach persistence and quietly mutate handoff
 * state. Resolving Gmail authorization needs the connected account and its encrypted credential, so
 * it belongs on the other side of that line: `lib/gmail/reminder-transport-provider.ts` composes the
 * A7 access resolver with this factory, exactly as `lib/gmail/service.ts` composes persistence with
 * the A7 transport. This file therefore takes an access token as an argument and never learns where
 * it came from.
 *
 * ## What it never does
 *
 * No threading (`threadId`, `In-Reply-To`, `References`), no CC, no BCC, no OAuth flow, no second
 * token-refresh implementation, no capability minting, no database write, no eligibility decision,
 * and no retry of its own. Every one of those belongs to somebody else, and several are forbidden.
 */

/** Bound to exactly one organization's resolved authorization. */
export interface GmailReminderTransportDeps {
  /** The organization whose Gmail connection produced `accessToken`. */
  readonly organizationId: string;
  /** Already-authorized Gmail access token, resolved once per invocation. Never logged or stored. */
  readonly accessToken: string;
  /** Owner Gmail identity (sender), from the same resolution as `accessToken`. */
  readonly from: OutboundAddress;
  /** Low-level sender seam. Tests inject; production uses the real Gmail REST sender. */
  readonly sendRaw?: GmailRawSender;
  readonly now?: () => Date;
  readonly mimeOptions?: MimeBuildOptions;
}

/**
 * Map an A7 transport failure onto the four outcomes the occurrence lifecycle can act on.
 *
 * The taxonomy already carries the two flags that matter, so this reads them rather than restating a
 * code list that would drift the first time A7 added one.
 *
 * The one deliberate departure is authorization. A7 classifies `GMAIL_AUTHORIZATION_INVALID` as
 * non-retryable, which is right for A7: an Owner is present, watching a handoff they just requested,
 * and the useful answer is "reconnect Gmail" rather than a silent retry. A reminder worker has no
 * Owner present and fourteen schedules in flight, and a token that aged out between this invocation's
 * authorization resolution and this particular send is a transient fact about one HTTP call. Treating
 * it as permanent would stop every schedule the invocation touched, each with `requiresOwnerAttention`,
 * for something the next invocation's fresh resolution fixes by itself. It is also definitively *not
 * sent* — Gmail rejected the request — so retrying is safe, which is the only question `retryable`
 * asks. A genuinely disconnected account never reaches here at all: authorization resolves before any
 * claim, and an unusable connection ends the invocation with zero occurrences.
 */
export function classifyReminderTransportFailure(
  failure: TransportFailure,
): ReminderTransportResult {
  if (failure.ambiguous) {
    return { kind: 'ambiguous', failureCode: failure.code };
  }
  if (failure.retryable || failure.category === 'authorization') {
    return { kind: 'retryable', failureCode: failure.code };
  }
  return { kind: 'permanent', failureCode: failure.code };
}

export class ReminderTransportTestEnvironmentError extends Error {
  constructor() {
    super(
      'The real Gmail reminder sender must not be constructed under an automated test runner. ' +
        'Inject `sendRaw` with a deterministic fake instead.',
    );
    this.name = 'ReminderTransportTestEnvironmentError';
  }
}

/** Automated test runner detection. Vitest sets both of these; the third covers Jest-style runners. */
function isAutomatedTestEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VITEST === 'true' || env.NODE_ENV === 'test' || typeof env.JEST_WORKER_ID === 'string';
}

/**
 * Choose the sender, and refuse the real one under a test runner (A8.4b.1).
 *
 * Every static guard in this repository is a statement about the code as it is written today. This is
 * the one protection that also holds for code nobody has written yet: a future test that constructs
 * this adapter and forgets to inject a fake gets a loud error at construction instead of an HTTP
 * request to Gmail carrying a real token to a real address. Throwing here rather than returning a
 * no-op sender is deliberate — a silent stub would let such a test pass while asserting nothing.
 */
function resolveRawSender(injected: GmailRawSender | undefined): GmailRawSender {
  if (injected) {
    return injected;
  }
  if (isAutomatedTestEnvironment()) {
    throw new ReminderTransportTestEnvironmentError();
  }
  return sendRawMessage;
}

export function createGmailReminderTransport(deps: GmailReminderTransportDeps): ReminderTransport {
  const sendRaw = resolveRawSender(deps.sendRaw);

  return {
    async send(request: ReminderTransportRequest): Promise<ReminderTransportResult> {
      // Authorization is bound to one organization. A request from another one is a programming
      // error, and the only safe response to it is to send nothing: delivering an Owner's reminder
      // through a different Owner's Gmail account would be a cross-tenant send.
      if (request.organizationId !== deps.organizationId) {
        return { kind: 'permanent', failureCode: 'reminder_authorization_organization_mismatch' };
      }

      // No branch on `occurrenceKind` (A8.4b.3). A8.4b.1 refused anything but `overdue` here,
      // because an advance scan that arrived before the advance content rules did would otherwise
      // have started sending silently. D105 then settled what those rules are: the advance reminder
      // differs in *timing* only, and the body states the due date rather than asserting lateness,
      // so it is truthful the morning before and every morning after. The kind reaches the provider
      // only as the occurrence identity the caller already decided, and changes nothing here.
      let rawBase64Url: string;
      try {
        const message = buildReminderEmail({
          from: deps.from,
          to: { email: request.delivery.recipientEmail },
          summaryLines: request.delivery.summaryLines,
          dueLocalDate: request.delivery.dueLocalDate,
          timeZone: request.delivery.timeZone,
        });
        rawBase64Url = toBase64Url(buildMimeMessage(message, deps.mimeOptions));
      } catch (error) {
        if (error instanceof ReminderEmailContentError) {
          // D130 refused the content. Permanent by construction: the same summary renders the same
          // way on every attempt, so retrying would fail identically and burn the retry budget.
          return { kind: 'permanent', failureCode: 'reminder_content_rejected' };
        }
        if (isMimeConstructionError(error)) {
          return classifyReminderTransportFailure(classifyMimeError(error));
        }
        return classifyReminderTransportFailure(transportFailure('GMAIL_CONFIGURATION_ERROR'));
      }

      let response: GmailSendRawResponse;
      try {
        // No `threadId`: a reminder starts no conversation and joins none (D130, A7.4 boundary).
        response = await sendRaw({ accessToken: deps.accessToken, raw: rawBase64Url });
      } catch (error) {
        // A definitive answer from Gmail, or ambiguity. There is no third option (re-audit B1).
        //
        // `sendRawMessage` reports every fetch rejection that is not an abort as
        // `GmailSendRawError('network')`, and its comment used to call that "request not submitted".
        // It is not: Node rejects a `fetch` with the same non-abort `TypeError` when the peer resets
        // the connection *after* receiving the full request body — `UND_ERR_SOCKET`, indistinguishable
        // from `ECONNREFUSED`. So `network` covers both "Gmail never heard us" and "Gmail has the
        // message and we never heard the answer", and nothing at this seam can tell them apart.
        //
        // Classifying that as retryable was a duplicate-send path: the occurrence stays owed, the
        // schedule stays armed at the same instant, the next invocation reclaims the row — clearing
        // the provider marker as a retry takeover must — and sends a second real reminder for the
        // same local calendar day, which is exactly what D106 and the marker exist to prevent.
        //
        // The marker is already committed by the time control reaches here, so this is the same
        // epistemic state a crash at this instant would leave, and recovery finalizes *that*
        // ambiguous. Catching the error must not produce a less safe outcome than crashing. The cost
        // is a provable pre-submission failure spending its occurrence's local day instead of
        // retrying; the alternative cost is a Recipient receiving the same reminder twice, and this
        // codebase resolves that trade in the same direction everywhere else.
        const kind = error instanceof GmailSendRawError ? error.kind : 'unknown';
        return classifyReminderTransportFailure(transportFailure('GMAIL_AMBIGUOUS_SEND', kind));
      }

      if (response.status < 200 || response.status >= 300) {
        return classifyReminderTransportFailure(classifyGmailSendHttpStatus(response.status));
      }

      if (!response.id) {
        // A 2xx with no message id is the worst case: Gmail probably has it and cannot be asked
        // which one. Ambiguous rather than accepted — an acceptance with no provider reference is
        // not an acceptance anybody could later verify.
        return classifyReminderTransportFailure(
          transportFailure('GMAIL_AMBIGUOUS_SEND', 'missing_id'),
        );
      }

      // The Gmail message id, and nothing else. Not the raw response, not `threadId`, not headers,
      // not the MIME body, not the address (D109, D114).
      return { kind: 'accepted', providerMessageRef: response.id };
    },
  };
}
