import 'server-only';
import type { HandoffDeliveryPath } from '@aicaa/domain';

/**
 * A7.4 normalized outbound-message model.
 *
 * This is the transport-neutral shape produced by the assignment-email / gmail-forward builders
 * and consumed by MIME construction + the Gmail transport. It carries only what is needed to emit
 * one RFC 5322 message. It never carries OAuth tokens, internal database IDs, capability tokens
 * outside the intended body, or raw model output.
 */

export interface OutboundAddress {
  /** RFC 5321 addr-spec. Validated + injection-checked at MIME build time. */
  email: string;
  /** Optional display name; RFC 2047 encoded when non-ASCII, quoted when it has specials. */
  name?: string;
}

export type OutboundAttachmentDisposition = 'attachment' | 'inline';

export interface OutboundAttachment {
  filename: string;
  /** MIME type; falls back to application/octet-stream when absent/unsafe. */
  mimeType: string;
  /** In-memory bytes. Released by the caller after MIME construction; never persisted or logged. */
  content: Uint8Array;
  disposition: OutboundAttachmentDisposition;
  /**
   * Content-ID for inline images referenced by HTML via cid:. Required when disposition = inline.
   * The angle-bracket wrapping is added at build time.
   */
  contentId?: string;
}

/**
 * Everything MIME construction actually reads to emit one RFC 5322 message.
 *
 * Split out from {@link OutboundMessage} in A8.4b.1. `deliveryPath` is A7 handoff metadata that
 * `buildMimeMessage` has never looked at — it exists so the Gmail transport can echo it back on an
 * acceptance — and requiring it forced any non-handoff sender to either widen the A7 delivery-path
 * union or claim to be an assignment email. A reminder is neither, and lying about which it was in
 * order to reuse the MIME builder would put a false value into A7's own acceptance record.
 *
 * Narrowing the MIME parameter to this type removes a requirement rather than adding a value, so
 * every existing A7 call site passes an `OutboundMessage` and compiles unchanged.
 */
export interface OutboundMimeMessage {
  from: OutboundAddress;
  to: OutboundAddress;
  subject: string;
  /** Plain-text alternative. Always present and fully usable on its own. */
  textBody: string;
  /** Optional HTML alternative. */
  htmlBody?: string;
  /** File attachments (Content-Disposition: attachment). */
  attachments?: OutboundAttachment[];
  /** Inline images (Content-Disposition: inline) referenced by cid: in htmlBody. */
  inlineImages?: OutboundAttachment[];
}

export interface OutboundMessage extends OutboundMimeMessage {
  /** Server-selected delivery path — for logs/metadata only; never emitted as a header. */
  deliveryPath: HandoffDeliveryPath;
}
