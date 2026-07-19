import 'server-only';
import type { HandoffDeliveryPath } from '@aicaa/domain';
import { GmailSendRawError, sendRawMessage, type GmailSendRawResponse } from '../gmail-api-client';
import { buildMimeMessage, toBase64Url, type MimeBuildOptions } from './mime';
import type { OutboundMessage } from './outbound-types';
import {
  classifyGmailSendHttpStatus,
  classifyMimeError,
  isMimeConstructionError,
  transportFailure,
  type TransportFailure,
} from './errors';

/**
 * A7.4 Gmail transport boundary.
 *
 * Accepts an already-authorized, already-composed outbound message and a caller-supplied access
 * token, builds the MIME + base64url `raw`, calls users.messages.send, and returns a normalized
 * provider acceptance or a privacy-safe transport failure.
 *
 * Hard boundaries (A7.4 contract):
 * - NEVER decides eligibility, creates a HandoffAttempt, activates a capability, or writes DB state.
 * - NEVER returns or logs OAuth tokens, message bodies, subjects, recipient content, capability
 *   links, or attachment data.
 * - Does NOT set threadId / In-Reply-To / References — both paths create a NEW outbound thread
 *   unless a caller explicitly opts into threading via `threadId` (deferred to orchestration).
 */

export interface GmailSendAcceptance {
  /** Gmail provider message id (users.messages.send `id`). */
  providerMessageId: string;
  /** Gmail thread id, only when actually returned by Google. */
  providerThreadId?: string;
  /** Accepted timestamp, normalized to ISO 8601 at the application boundary. */
  acceptedAt: string;
  deliveryPath: HandoffDeliveryPath;
}

export type GmailSendResult =
  { ok: true; acceptance: GmailSendAcceptance } | { ok: false; failure: TransportFailure };

/** Low-level sender seam so tests can mock Gmail without real network access. */
export type GmailRawSender = (input: {
  accessToken: string;
  raw: string;
  threadId?: string;
}) => Promise<GmailSendRawResponse>;

export interface GmailTransportDeps {
  sendRaw?: GmailRawSender;
  /** Deterministic clock for acceptedAt normalization. */
  now?: () => Date;
  /** Passed through to MIME construction (boundary/date/message-id seams). */
  mimeOptions?: MimeBuildOptions;
}

export interface GmailSendCommand {
  /** Already-authorized Gmail access token. Never logged. */
  accessToken: string;
  /** Fully-composed outbound message (assignment_email or gmail_forward). */
  message: OutboundMessage;
  /**
   * Optional deliberate threading. Omitted by A7.4 builders so a new outbound thread is created.
   */
  threadId?: string;
  /** Optional correlation id for privacy-safe logs. */
  requestId?: string;
}

export interface GmailTransport {
  send(command: GmailSendCommand): Promise<GmailSendResult>;
}

/** Create a Gmail transport. Inject `sendRaw` in tests; defaults to the real Gmail REST sender. */
export function createGmailTransport(deps: GmailTransportDeps = {}): GmailTransport {
  const sendRaw = deps.sendRaw ?? sendRawMessage;
  const now = deps.now ?? (() => new Date());

  return {
    async send(command: GmailSendCommand): Promise<GmailSendResult> {
      const deliveryPath = command.message.deliveryPath;

      // 1) Build the RFC 5322 message. MIME/validation failures are typed + non-retryable.
      let rawBase64Url: string;
      try {
        const raw = buildMimeMessage(command.message, deps.mimeOptions);
        rawBase64Url = toBase64Url(raw);
      } catch (error) {
        if (isMimeConstructionError(error)) {
          return { ok: false, failure: classifyMimeError(error) };
        }
        return { ok: false, failure: transportFailure('GMAIL_CONFIGURATION_ERROR') };
      }

      // 2) Submit to Gmail. Classify by HTTP status; fetch/parse issues are typed separately.
      let response: GmailSendRawResponse;
      try {
        response = await sendRaw({
          accessToken: command.accessToken,
          raw: rawBase64Url,
          threadId: command.threadId,
        });
      } catch (error) {
        if (error instanceof GmailSendRawError) {
          if (error.kind === 'timeout' || error.kind === 'parse') {
            // Cannot prove the message was not accepted — surface an ambiguous outcome.
            return { ok: false, failure: transportFailure('GMAIL_AMBIGUOUS_SEND', error.kind) };
          }
          return { ok: false, failure: transportFailure('GMAIL_NETWORK_ERROR', error.kind) };
        }
        return { ok: false, failure: transportFailure('GMAIL_NETWORK_ERROR') };
      }

      if (response.status < 200 || response.status >= 300) {
        return { ok: false, failure: classifyGmailSendHttpStatus(response.status) };
      }

      if (!response.id) {
        return { ok: false, failure: transportFailure('GMAIL_AMBIGUOUS_SEND', 'missing_id') };
      }

      return {
        ok: true,
        acceptance: {
          providerMessageId: response.id,
          providerThreadId: response.threadId,
          acceptedAt: now().toISOString(),
          deliveryPath,
        },
      };
    },
  };
}
