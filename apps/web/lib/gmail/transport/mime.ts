import 'server-only';
import { randomBytes } from 'node:crypto';
import type { OutboundAddress, OutboundAttachment, OutboundMessage } from './outbound-types';
import { GMAIL_OUTBOUND_MAX_MESSAGE_BYTES } from './limits';

/**
 * A7.4 RFC 5322 / MIME construction for Gmail users.messages.send.
 *
 * Emits a standards-compliant message with CRLF line endings, UTF-8-safe headers (RFC 2047
 * encoded-words), quoted-printable text bodies, base64 attachments, unique multipart boundaries,
 * and base64url encoding of the whole message for the Gmail `raw` field.
 *
 * Security posture:
 * - Header injection is impossible: raw values containing CR/LF/other control chars are rejected
 *   before any header is emitted, and non-ASCII header text is RFC 2047-encoded (no raw newlines
 *   ever reach the wire).
 * - Recipient/sender addresses are strictly validated.
 * - Callers cannot supply arbitrary headers — the header set is fixed by this module.
 * - No token/body/subject is logged here; this module returns a string and throws typed errors.
 */

const CRLF = '\r\n';
const MAX_QP_LINE = 76;
const MAX_BASE64_LINE = 76;

export type MimeErrorCode =
  | 'INVALID_RECIPIENT'
  | 'INVALID_SENDER'
  | 'INVALID_HEADER'
  | 'INVALID_ATTACHMENT'
  | 'MESSAGE_TOO_LARGE'
  | 'EMPTY_BODY';

export class MimeConstructionError extends Error {
  readonly code: MimeErrorCode;
  constructor(code: MimeErrorCode, message: string) {
    // Message is a safe, generic description — never includes the offending value.
    super(message);
    this.code = code;
    this.name = 'MimeConstructionError';
  }
}

const MAX_EMAIL_LENGTH = 254;

/** Any CR, LF, NUL, or other C0 control char (except we handle folding ourselves) is unsafe. */
function containsControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    // Reject C0 controls (0x00–0x1F) and DEL (0x7F). Tab/space are handled by encoders, not here.
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function isAscii(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 0x7f) {
      return false;
    }
  }
  return true;
}

/**
 * Strict addr-spec validation for headers. Stricter than the domain recipient shape check because
 * it also forbids control chars and enforces single-address form (no comma/semicolon list).
 */
export function assertValidAddressSpec(email: string, kind: 'recipient' | 'sender'): string {
  const normalized = email.trim();
  const code: MimeErrorCode = kind === 'recipient' ? 'INVALID_RECIPIENT' : 'INVALID_SENDER';
  if (normalized.length === 0 || normalized.length > MAX_EMAIL_LENGTH) {
    throw new MimeConstructionError(code, `Invalid ${kind} email length.`);
  }
  if (containsControlChars(normalized)) {
    throw new MimeConstructionError(code, `Invalid ${kind} email: control characters.`);
  }
  if (/[,;]/.test(normalized) || /\s/.test(normalized)) {
    throw new MimeConstructionError(code, `Invalid ${kind} email: multiple or malformed address.`);
  }
  if (!isAscii(normalized)) {
    // Internationalized addresses (SMTPUTF8) are out of scope for A7.4 outbound send.
    throw new MimeConstructionError(code, `Invalid ${kind} email: non-ASCII address.`);
  }
  const at = normalized.lastIndexOf('@');
  if (at < 1 || at === normalized.length - 1) {
    throw new MimeConstructionError(code, `Invalid ${kind} email: missing local/domain part.`);
  }
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
    throw new MimeConstructionError(code, `Invalid ${kind} email: malformed domain.`);
  }
  if (/[<>()[\]\\,;:"]/.test(local) || /[<>()[\]\\,;:"]/.test(domain)) {
    throw new MimeConstructionError(code, `Invalid ${kind} email: illegal characters.`);
  }
  return normalized;
}

/** Base64url without padding for the Gmail `raw` field (RFC 4648 §5). */
export function toBase64Url(input: Uint8Array | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 2047 "B" encoded-word for a header text value (UTF-8), chunked to stay within limits. */
function encodeHeaderWord(value: string): string {
  // Encoded-word max total length is 75 chars; reserve for the =?UTF-8?B?...?= wrapper (12 chars).
  const prefix = '=?UTF-8?B?';
  const suffix = '?=';
  const maxEncodedChars = 75 - prefix.length - suffix.length;
  // base64 expands 3 bytes -> 4 chars; choose a byte budget that keeps each word within limit.
  const maxBytesPerWord = Math.floor(maxEncodedChars / 4) * 3;

  const bytes = Buffer.from(value, 'utf8');
  const words: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    // Do not split a multi-byte UTF-8 sequence across encoded words.
    let end = Math.min(offset + maxBytesPerWord, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    const chunk = bytes.subarray(offset, end);
    words.push(`${prefix}${chunk.toString('base64')}${suffix}`);
    offset = end;
  }
  // Encoded words are joined with CRLF + space folding.
  return words.join(`${CRLF} `);
}

/**
 * Encode an unstructured header text value (e.g. Subject). Non-ASCII → RFC 2047; long ASCII is
 * folded at whitespace to respect the 78-char soft line limit. Rejects control chars.
 */
export function encodeUnstructuredHeader(name: string, value: string): string {
  if (containsControlChars(value)) {
    throw new MimeConstructionError(
      'INVALID_HEADER',
      `Header ${name} contains control characters.`,
    );
  }
  if (!isAscii(value)) {
    return `${name}: ${encodeHeaderWord(value)}`;
  }
  return foldHeaderLine(`${name}: ${value}`);
}

/** Fold a long ASCII header line at whitespace boundaries (RFC 5322 §2.2.3). */
function foldHeaderLine(line: string): string {
  const softLimit = 78;
  if (line.length <= softLimit) {
    return line;
  }
  const words = line.split(' ');
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    if (current === '') {
      current = word;
    } else if (`${current} ${word}`.length > softLimit) {
      out.push(current);
      current = `\t${word}`;
    } else {
      current = `${current} ${word}`;
    }
  }
  if (current) {
    out.push(current);
  }
  return out.join(CRLF);
}

/** Format an address header value: `Display Name <email>` with safe name encoding. */
export function formatAddressHeader(
  name: string,
  address: OutboundAddress,
  kind: 'recipient' | 'sender',
): string {
  const email = assertValidAddressSpec(address.email, kind);
  const display = address.name?.trim();
  if (!display) {
    return foldHeaderLine(`${name}: ${email}`);
  }
  if (containsControlChars(display)) {
    throw new MimeConstructionError('INVALID_HEADER', `${name} display name is invalid.`);
  }
  if (!isAscii(display)) {
    return foldHeaderLine(`${name}: ${encodeHeaderWord(display)} <${email}>`);
  }
  // Quote ASCII display names containing specials (RFC 5322 quoted-string).
  if (/[()<>@,;:\\".[\]]/.test(display)) {
    const quoted = `"${display.replace(/([\\"])/g, '\\$1')}"`;
    return foldHeaderLine(`${name}: ${quoted} <${email}>`);
  }
  return foldHeaderLine(`${name}: ${display} <${email}>`);
}

/** Quoted-printable encode a UTF-8 text body with CRLF hard breaks + soft line wrapping. */
export function encodeQuotedPrintable(text: string): string {
  // Normalize line endings to LF first; emit CRLF hard breaks.
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const outputLines: string[] = [];

  for (const line of lines) {
    const bytes = Buffer.from(line, 'utf8');
    let encoded = '';
    for (let i = 0; i < bytes.length; i += 1) {
      const byte = bytes[i];
      const isLastOnLine = i === bytes.length - 1;
      const isSpaceOrTab = byte === 0x20 || byte === 0x09;
      if (isSpaceOrTab && isLastOnLine) {
        // Trailing whitespace must be encoded.
        encoded += `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      } else if (byte === 0x3d) {
        encoded += '=3D';
      } else if ((byte >= 0x20 && byte <= 0x7e) || isSpaceOrTab) {
        encoded += String.fromCharCode(byte);
      } else {
        encoded += `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
    outputLines.push(wrapQuotedPrintableLine(encoded));
  }
  return outputLines.join(CRLF);
}

/** Insert soft line breaks (`=\r\n`) so no QP line exceeds 76 chars, never splitting an `=XX`. */
function wrapQuotedPrintableLine(line: string): string {
  if (line.length <= MAX_QP_LINE) {
    return line;
  }
  const segments: string[] = [];
  let remaining = line;
  while (remaining.length > MAX_QP_LINE) {
    let breakAt = MAX_QP_LINE - 1; // reserve room for the trailing '='
    // Do not break in the middle of an `=XX` escape sequence.
    if (remaining[breakAt - 1] === '=') {
      breakAt -= 1;
    } else if (remaining[breakAt - 2] === '=') {
      breakAt -= 2;
    }
    segments.push(`${remaining.slice(0, breakAt)}=`);
    remaining = remaining.slice(breakAt);
  }
  segments.push(remaining);
  return segments.join(CRLF);
}

/** Standard base64 wrapped at 76 columns with CRLF (RFC 2045 §6.8) for attachment bodies. */
function encodeBase64Wrapped(content: Uint8Array): string {
  const base64 = Buffer.from(content).toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += MAX_BASE64_LINE) {
    lines.push(base64.slice(i, i + MAX_BASE64_LINE));
  }
  return lines.join(CRLF);
}

/** Sanitize an attachment filename: strip path separators + control chars; enforce a max length. */
export function sanitizeAttachmentFilename(filename: string): string {
  const base = filename.replace(/[\\/]/g, '_');
  let cleaned = '';
  for (let i = 0; i < base.length; i += 1) {
    const code = base.charCodeAt(i);
    cleaned += code <= 0x1f || code === 0x7f ? '_' : base[i];
  }
  cleaned = cleaned.trim();
  if (!cleaned) {
    cleaned = 'attachment';
  }
  return cleaned.length > 255 ? cleaned.slice(0, 255) : cleaned;
}

/** RFC 2231 parameter encoding for non-ASCII filenames; plain quoted value otherwise. */
function formatFilenameParameter(paramName: string, filename: string): string {
  if (isAscii(filename) && !/["\\]/.test(filename)) {
    return `${paramName}="${filename}"`;
  }
  const encoded = Array.from(Buffer.from(filename, 'utf8'))
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /[A-Za-z0-9.\-_]/.test(char)
        ? char
        : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
  return `${paramName}*=UTF-8''${encoded}`;
}

const SAFE_MIME_TYPE = /^[\w.+-]+\/[\w.+-]+$/;

function normalizeMimeType(mimeType: string | undefined): string {
  const trimmed = (mimeType ?? '').trim().toLowerCase();
  if (!trimmed || !SAFE_MIME_TYPE.test(trimmed)) {
    return 'application/octet-stream';
  }
  return trimmed;
}

export interface MimeBuildOptions {
  /** Deterministic test seam for boundary generation. */
  boundaryFactory?: () => string;
  /** Deterministic test seam for Date header. */
  now?: Date;
  /** Deterministic test seam for Message-ID. Must be a bare ASCII token without CR/LF. */
  messageIdFactory?: () => string;
  /** Domain used for the Message-ID right-hand side; derived from sender when omitted. */
  messageIdDomain?: string;
}

function defaultBoundary(): string {
  return `=_aicaa_${randomBytes(18).toString('hex')}`;
}

interface LeafPart {
  kind: 'leaf';
  headers: string[];
  body: string;
}
interface MultiPart {
  kind: 'multipart';
  subtype: 'alternative' | 'mixed' | 'related';
  headers: string[];
  boundary: string;
  parts: MimeNode[];
}
type MimeNode = LeafPart | MultiPart;

function textPart(mimeSubtype: 'plain' | 'html', body: string): LeafPart {
  return {
    kind: 'leaf',
    headers: [
      `Content-Type: text/${mimeSubtype}; charset=UTF-8`,
      'Content-Transfer-Encoding: quoted-printable',
    ],
    body: encodeQuotedPrintable(body),
  };
}

function attachmentPart(att: OutboundAttachment): LeafPart {
  const filename = sanitizeAttachmentFilename(att.filename);
  const mimeType = normalizeMimeType(att.mimeType);
  const headers = [
    `Content-Type: ${mimeType}; ${formatFilenameParameter('name', filename)}`,
    'Content-Transfer-Encoding: base64',
  ];
  if (att.disposition === 'inline') {
    if (!att.contentId) {
      throw new MimeConstructionError('INVALID_ATTACHMENT', 'Inline part is missing Content-ID.');
    }
    if (containsControlChars(att.contentId) || /[<>]/.test(att.contentId)) {
      throw new MimeConstructionError('INVALID_ATTACHMENT', 'Inline Content-ID is invalid.');
    }
    headers.push(`Content-ID: <${att.contentId}>`);
    headers.push(`Content-Disposition: inline; ${formatFilenameParameter('filename', filename)}`);
  } else {
    headers.push(
      `Content-Disposition: attachment; ${formatFilenameParameter('filename', filename)}`,
    );
  }
  return { kind: 'leaf', headers, body: encodeBase64Wrapped(att.content) };
}

function serializeNode(node: MimeNode): string {
  if (node.kind === 'leaf') {
    return `${node.headers.join(CRLF)}${CRLF}${CRLF}${node.body}`;
  }
  const parts = node.parts
    .map((child) => `--${node.boundary}${CRLF}${serializeNode(child)}`)
    .join(CRLF);
  const headers = [
    ...node.headers,
    `Content-Type: multipart/${node.subtype}; boundary="${node.boundary}"`,
  ];
  return `${headers.join(CRLF)}${CRLF}${CRLF}${parts}${CRLF}--${node.boundary}--`;
}

/**
 * Build the body tree (everything below the top-level message headers) from the outbound model.
 *
 * Structure rules:
 *   text only                         → text/plain
 *   text + html                       → multipart/alternative
 *   html + inline images              → multipart/related( html, inline… ) [inside alternative]
 *   any attachments                   → multipart/mixed( <content>, attachment… )
 */
function buildBodyTree(message: OutboundMessage, newBoundary: () => string): MimeNode {
  const hasHtml = typeof message.htmlBody === 'string' && message.htmlBody.length > 0;
  const inline = message.inlineImages ?? [];
  const attachments = message.attachments ?? [];

  if (!message.textBody && !hasHtml) {
    throw new MimeConstructionError('EMPTY_BODY', 'Outbound message has no body content.');
  }

  let htmlNode: MimeNode | undefined;
  if (hasHtml) {
    const html = textPart('html', message.htmlBody as string);
    if (inline.length > 0) {
      htmlNode = {
        kind: 'multipart',
        subtype: 'related',
        headers: [],
        boundary: newBoundary(),
        parts: [html, ...inline.map(attachmentPart)],
      };
    } else {
      htmlNode = html;
    }
  } else if (inline.length > 0) {
    // Inline images require an HTML body to reference them.
    throw new MimeConstructionError('INVALID_ATTACHMENT', 'Inline images require an HTML body.');
  }

  let contentNode: MimeNode;
  if (hasHtml) {
    contentNode = {
      kind: 'multipart',
      subtype: 'alternative',
      headers: [],
      boundary: newBoundary(),
      parts: [textPart('plain', message.textBody), htmlNode as MimeNode],
    };
  } else {
    contentNode = textPart('plain', message.textBody);
  }

  if (attachments.length === 0) {
    return contentNode;
  }
  return {
    kind: 'multipart',
    subtype: 'mixed',
    headers: [],
    boundary: newBoundary(),
    parts: [contentNode, ...attachments.map(attachmentPart)],
  };
}

/**
 * Build the complete RFC 5322 message string (CRLF-terminated headers + MIME body). Enforces the
 * conservative outbound size ceiling. Returns the raw string; callers base64url-encode it.
 */
export function buildMimeMessage(message: OutboundMessage, options: MimeBuildOptions = {}): string {
  const newBoundary = options.boundaryFactory ?? defaultBoundary;
  const now = options.now ?? new Date();

  const fromHeader = formatAddressHeader('From', message.from, 'sender');
  const toHeader = formatAddressHeader('To', message.to, 'recipient');
  const subjectHeader = encodeUnstructuredHeader('Subject', message.subject);

  const senderDomain =
    options.messageIdDomain ?? message.from.email.slice(message.from.email.lastIndexOf('@') + 1);
  const messageId = options.messageIdFactory
    ? options.messageIdFactory()
    : `${randomBytes(16).toString('hex')}@${senderDomain}`;
  if (containsControlChars(messageId)) {
    throw new MimeConstructionError('INVALID_HEADER', 'Message-ID is invalid.');
  }

  const bodyTree = buildBodyTree(message, newBoundary);

  const topHeaders = [
    'MIME-Version: 1.0',
    `Date: ${formatRfc5322Date(now)}`,
    `Message-ID: <${messageId}>`,
    fromHeader,
    toHeader,
    subjectHeader,
  ];

  const serializedBody = serializeNode(bodyTree);
  const raw = `${topHeaders.join(CRLF)}${CRLF}${serializedBody}${CRLF}`;

  const byteLength = Buffer.byteLength(raw, 'utf8');
  if (byteLength > GMAIL_OUTBOUND_MAX_MESSAGE_BYTES) {
    throw new MimeConstructionError(
      'MESSAGE_TOO_LARGE',
      `Outbound message exceeds the ${GMAIL_OUTBOUND_MAX_MESSAGE_BYTES}-byte ceiling.`,
    );
  }
  return raw;
}

const RFC5322_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RFC5322_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Format a Date as an RFC 5322 date-time in UTC (`+0000`). */
export function formatRfc5322Date(date: Date): string {
  const day = RFC5322_DAYS[date.getUTCDay()];
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const month = RFC5322_MONTHS[date.getUTCMonth()];
  const yyyy = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${day}, ${dd} ${month} ${yyyy} ${hh}:${mm}:${ss} +0000`;
}
