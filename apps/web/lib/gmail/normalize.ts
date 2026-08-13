import 'server-only';
import {
  MAX_GMAIL_ATTACHMENT_FILENAME_LENGTH,
  MAX_GMAIL_ATTACHMENT_METADATA_ITEMS,
  MAX_GMAIL_EXCERPT_BYTES,
  MAX_GMAIL_TO_ADDRESSES,
  ROCKET_GENERATED_HEADER_NAME,
  truncateGmailSnippet,
  truncateGmailSubject,
  type AttachmentMetadataItem,
} from '@aicaa/domain';
import type { GmailMessage, GmailMessageHeader, GmailMessagePart } from './gmail-api-client';
import { GmailSyncError } from './sync-errors';

/**
 * Normalized Gmail message fields ready for persistence (IDs assigned by the sync engine).
 * Matches ParsedGmailMessageFixture shape minus eventId/excerptId.
 */
export interface NormalizedGmailMessage {
  providerMessageId: string;
  providerThreadId: string;
  internalDate: string;
  receivedAt?: string;
  fromAddress: string;
  toAddresses: string[];
  subject: string | null;
  snippet: string | null;
  labelIds: string[];
  hasAttachments: boolean;
  attachmentMetadata: AttachmentMetadataItem[];
  excerptContent: string | null;
  /**
   * Every `X-Rocket-Generated` value on the **top-level** message headers (D136, A8.5c).
   *
   * Usually empty. Populated for mail Rocket generated itself, which the sync engine then declines
   * to ingest rather than feeding its own Owner notifications back to A6 as Task Suggestions.
   *
   * All of them, not the first: `isRocketGeneratedOwnerNotification` treats a repeated marker as
   * forgery, and it cannot do that if this field has already collapsed the duplicates away.
   */
  rocketGeneratedMarkers: string[];
}

/** Cap a string to at most `maxBytes` UTF-8 bytes without splitting a code point. */
export function truncateUtf8Bytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }
  const encoded = Buffer.from(text, 'utf8');
  if (encoded.byteLength <= maxBytes) {
    return text;
  }
  let end = maxBytes;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return encoded.subarray(0, end).toString('utf8');
}

/** Extract a canonical lowercase email from a From/To header value. */
export function parseEmailAddress(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const angle = trimmed.match(/<([^>]+)>/);
  const candidate = (angle?.[1] ?? trimmed).trim().toLowerCase();
  if (!candidate.includes('@') || candidate.length > 320) {
    return null;
  }
  return candidate;
}

/**
 * Sentinel stored by Gmail ingestion when From cannot be parsed (see {@link normalizeGmailMessage}).
 *
 * This value is a valid-looking `parseEmailAddress` result, so Exclude Sender must refuse it
 * explicitly. One unparseable From must never become an exclusion key shared by every malformed
 * sender (D180).
 */
export const UNPARSEABLE_GMAIL_FROM_SENTINEL = 'unknown@invalid';

/**
 * Canonical Gmail sender exclusion key using existing ingestion normalization only.
 *
 * Returns null for missing/unparseable addresses and for the unparseable-From sentinel.
 */
export function gmailSenderExclusionKey(fromAddress: string | null | undefined): string | null {
  const parsed = parseEmailAddress(fromAddress);
  if (parsed == null || parsed === UNPARSEABLE_GMAIL_FROM_SENTINEL) {
    return null;
  }
  return parsed;
}

export function parseAddressList(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }
  const parts = raw.split(',');
  const addresses: string[] = [];
  for (const part of parts) {
    const email = parseEmailAddress(part);
    if (email && !addresses.includes(email)) {
      addresses.push(email);
    }
    if (addresses.length >= MAX_GMAIL_TO_ADDRESSES) {
      break;
    }
  }
  return addresses;
}

function headerValue(headers: GmailMessageHeader[] | undefined, name: string): string | null {
  if (!headers) {
    return null;
  }
  const target = name.toLowerCase();
  for (const header of headers) {
    if (header.name?.toLowerCase() === target && typeof header.value === 'string') {
      return header.value;
    }
  }
  return null;
}

/**
 * Every value carried under one header name, in order.
 *
 * Separate from {@link headerValue} because the two answer different questions. A `From` has one
 * meaningful value and taking the first is right. A marker that grants an ingestion exclusion needs
 * the count as well as the content, so it collects rather than picks (D136).
 */
function headerValues(headers: GmailMessageHeader[] | undefined, name: string): string[] {
  if (!headers) {
    return [];
  }
  const target = name.toLowerCase();
  const values: string[] = [];
  for (const header of headers) {
    if (header.name?.toLowerCase() === target && typeof header.value === 'string') {
      values.push(header.value);
    }
  }
  return values;
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

/** Minimal HTML → plain text. Never stores HTML. */
export function stripHtmlToPlain(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number.parseInt(code, 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Drop lines that look like quoted reply content (`>` prefixes). */
export function trimQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) {
      continue;
    }
    kept.push(line);
  }
  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function walkParts(
  part: GmailMessagePart | undefined,
  visit: (part: GmailMessagePart) => void,
): void {
  if (!part) {
    return;
  }
  visit(part);
  for (const child of part.parts ?? []) {
    walkParts(child, visit);
  }
}

function collectBodyCandidates(payload: GmailMessagePart | undefined): {
  plain: string | null;
  html: string | null;
} {
  let plain: string | null = null;
  let html: string | null = null;

  walkParts(payload, (part) => {
    const filename = part.filename?.trim();
    if (filename) {
      return;
    }
    const data = part.body?.data;
    if (!data) {
      return;
    }
    const mime = (part.mimeType ?? '').toLowerCase();
    try {
      const decoded = decodeBase64Url(data);
      if (mime === 'text/plain' && plain == null) {
        plain = decoded;
      } else if (mime === 'text/html' && html == null) {
        html = decoded;
      }
    } catch {
      // Ignore undecodable parts; excerpt may be empty.
    }
  });

  return { plain, html };
}

function collectAttachmentMetadata(
  payload: GmailMessagePart | undefined,
): AttachmentMetadataItem[] {
  const items: AttachmentMetadataItem[] = [];
  walkParts(payload, (part) => {
    const filename = part.filename?.trim();
    if (!filename) {
      return;
    }
    if (items.length >= MAX_GMAIL_ATTACHMENT_METADATA_ITEMS) {
      return;
    }
    const safeName =
      filename.length <= MAX_GMAIL_ATTACHMENT_FILENAME_LENGTH
        ? filename
        : filename.slice(0, MAX_GMAIL_ATTACHMENT_FILENAME_LENGTH);
    const item: AttachmentMetadataItem = { filename: safeName };
    if (part.mimeType) {
      item.mimeType = part.mimeType;
    }
    if (typeof part.body?.size === 'number' && Number.isFinite(part.body.size)) {
      item.sizeBytes = part.body.size;
    }
    items.push(item);
  });
  return items;
}

function parseInternalDate(raw: string | undefined): string {
  if (!raw) {
    throw new GmailSyncError('malformed_message', 'Gmail message is missing internalDate.');
  }
  const millis = Number.parseInt(raw, 10);
  if (!Number.isFinite(millis) || millis < 0) {
    throw new GmailSyncError('malformed_message', 'Gmail message internalDate is invalid.');
  }
  return new Date(millis).toISOString();
}

/**
 * Normalize a Gmail API message into capped, minimized fields for CommunicationEvent + excerpt.
 * Prefer text/plain; HTML-only falls back to stripped plain. Cap excerpt at 8192 UTF-8 bytes.
 */
export function normalizeGmailMessage(raw: GmailMessage): NormalizedGmailMessage {
  if (!raw.id) {
    throw new GmailSyncError('malformed_message', 'Gmail message is missing id.');
  }

  const headers = raw.payload?.headers;
  const fromAddress =
    parseEmailAddress(headerValue(headers, 'From')) ?? UNPARSEABLE_GMAIL_FROM_SENTINEL;
  const toAddresses = parseAddressList(headerValue(headers, 'To'));
  const subject = truncateGmailSubject(headerValue(headers, 'Subject'));
  const snippet = truncateGmailSnippet(raw.snippet ?? null);
  const labelIds = Array.isArray(raw.labelIds) ? [...raw.labelIds] : [];
  const attachmentMetadata = collectAttachmentMetadata(raw.payload);
  const { plain, html } = collectBodyCandidates(raw.payload);

  let excerptSource = '';
  if (plain != null && plain.trim()) {
    excerptSource = plain;
  } else if (html != null && html.trim()) {
    excerptSource = stripHtmlToPlain(html);
  }

  const trimmed = trimQuotedReply(excerptSource);
  const excerptContent = trimmed ? truncateUtf8Bytes(trimmed, MAX_GMAIL_EXCERPT_BYTES) : null;

  return {
    providerMessageId: raw.id,
    providerThreadId: raw.threadId ?? raw.id,
    internalDate: parseInternalDate(raw.internalDate),
    fromAddress,
    toAddresses,
    subject,
    snippet,
    labelIds,
    hasAttachments: attachmentMetadata.length > 0,
    attachmentMetadata,
    excerptContent,
    // Top-level headers only, deliberately. A `message/rfc822` attachment carries its own header
    // block, and walking into those would let anyone grant their message the D136 exclusion by
    // attaching a forwarded copy of one of Rocket's. Rocket stamps the marker on the message it
    // sends, so the message's own headers are the only place it can legitimately appear.
    rocketGeneratedMarkers: headerValues(headers, ROCKET_GENERATED_HEADER_NAME),
  };
}
