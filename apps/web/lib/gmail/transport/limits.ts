import 'server-only';

/**
 * A7.4 Gmail outbound size + count ceilings.
 *
 * Sources (verified against official Google documentation):
 * - users.messages.send accepts an RFC 5322 message in the `raw` field, base64url-encoded.
 *   https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send
 *   https://developers.google.com/workspace/gmail/api/guides/sending
 * - The Gmail API discovery document defines `messages.send` media `maxSize` = 36,700,160 bytes
 *   (35 MiB) — this is the hard provider ceiling for the whole message.
 *   https://github.com/googleapis/google-api-python-client/blob/main/googleapiclient/discovery_cache/documents/gmail.v1.json
 * - The simple JSON (`{ raw }`) request path is only reliable for small messages (~5 MB); larger
 *   messages require the media-upload endpoint (/upload/gmail/v1/...). A7.4 uses the simple JSON
 *   path only; the media-upload path for very large forwards is deferred to later orchestration.
 * - Gmail's practical *sending* limit for users is 25 MB of attachments; deliverability past that
 *   depends on the recipient gateway. We therefore pick a conservative application ceiling well
 *   below the 35 MiB hard cap.
 */

/** Hard provider ceiling for a single sent message (35 MiB), documented above. Never exceed. */
export const GMAIL_SEND_HARD_MAX_MESSAGE_BYTES = 36_700_160;

/**
 * Conservative application ceiling on the assembled RFC 5322 message (pre-base64url). Chosen at
 * 25 MiB to stay under the hard cap and align with Gmail's user-facing sending limit. Messages
 * larger than this are rejected as GMAIL_MESSAGE_TOO_LARGE before any Gmail call.
 */
export const GMAIL_OUTBOUND_MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

/**
 * Reliability threshold for the simple JSON send path. Above this the media-upload endpoint is
 * required (not implemented in A7.4). Surfaced in docs; enforced as a soft warning boundary.
 */
export const GMAIL_SEND_SIMPLE_JSON_SAFE_BYTES = 5 * 1024 * 1024;

/** Max number of forwarded attachments (mirrors A5 MAX_GMAIL_ATTACHMENT_METADATA_ITEMS = 20). */
export const GMAIL_FORWARD_MAX_ATTACHMENTS = 20;

/** Max combined raw bytes of all forwarded attachments (pre-encode). */
export const GMAIL_FORWARD_MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;

/** Max raw bytes of any single forwarded attachment (pre-encode). */
export const GMAIL_FORWARD_MAX_SINGLE_ATTACHMENT_BYTES = 20 * 1024 * 1024;
