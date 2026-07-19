import 'server-only';
import { evaluateIncompleteForwardPreflight } from '@aicaa/domain';
import type { GmailMessage, GmailMessagePart } from '../gmail-api-client';
import type {
  OutboundAddress,
  OutboundAttachment,
  OutboundMessage,
} from '../transport/outbound-types';
import { transportFailure, type TransportFailure } from '../transport/errors';
import {
  GMAIL_FORWARD_MAX_ATTACHMENTS,
  GMAIL_FORWARD_MAX_ATTACHMENT_TOTAL_BYTES,
  GMAIL_FORWARD_MAX_SINGLE_ATTACHMENT_BYTES,
} from '../transport/limits';
import { escapeHtml, escapeHtmlAttribute, normalizeForwardSubject } from './text-utils';

/**
 * A7.4 gmail_forward builder.
 *
 * Reconstructs a conventional forwarded email from the EXACT Gmail source message referenced by a
 * CommunicationEvent (never "latest in thread", never the whole thread). It reads the source
 * message and its approved attachments through the authorized Gmail read helpers, enforces
 * count/size ceilings, and applies the D088 incomplete-forward policy: if the original content or
 * any required attachment cannot be obtained, construction fails BEFORE any Gmail send — it never
 * degrades to a partial forward or silently switches to assignment_email.
 *
 * Threading: the forward creates a NEW outbound thread. No threadId / In-Reply-To / References are
 * emitted, so the message never replies into the original sender's thread.
 */

export interface GmailForwardSource {
  /** Exact Gmail provider message id from the CommunicationEvent. */
  providerMessageId: string;
  /** Owner organization the source is expected to belong to (orchestration-supplied guard). */
  organizationId: string;
  /** Communication account the source is expected to belong to (orchestration-supplied guard). */
  accountId: string;
  /**
   * Attachment ids approved for inclusion. When provided, exactly these must be present; a missing
   * one blocks the send (incomplete forward). When omitted, all attachments on the source message
   * are treated as required.
   */
  approvedAttachmentIds?: string[];
}

export interface GmailForwardInput {
  from: OutboundAddress;
  to: OutboundAddress;
  /** Short Owner-authored assignment introduction rendered above the forwarded content. */
  ownerIntro: string;
  /** Already-issued capability URL. Included once per alternative in the intro. */
  capabilityUrl: string;
  /**
   * Persisted Task summary points (A7 binding requirement). Rendered as safe data (escaped) above
   * the forwarded original — NEVER regenerated, reinterpreted, or produced by a fresh LLM call. They
   * supplement the forwarded original and never replace or truncate it. Order is preserved.
   */
  summaryLines?: string[];
  source: GmailForwardSource;
}

export interface GmailForwardDeps {
  accessToken: string;
  getMessage(input: { accessToken: string; messageId: string }): Promise<GmailMessage>;
  getAttachment(input: {
    accessToken: string;
    messageId: string;
    attachmentId: string;
  }): Promise<{ data: string; size: number }>;
}

export type GmailForwardBuildResult =
  { ok: true; message: OutboundMessage } | { ok: false; failure: TransportFailure };

interface ExtractedAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  contentId?: string;
  inline: boolean;
}

interface ExtractedSource {
  plainText?: string;
  html?: string;
  attachments: ExtractedAttachment[];
  headers: { from?: string; to?: string; date?: string; subject?: string };
}

function headerValue(part: GmailMessagePart | undefined, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const header of part?.headers ?? []) {
    if ((header.name ?? '').toLowerCase() === target) {
      return header.value ?? undefined;
    }
  }
  return undefined;
}

function decodeGmailBase64(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

function collectSource(message: GmailMessage): ExtractedSource {
  const result: ExtractedSource = {
    attachments: [],
    headers: {
      from: headerValue(message.payload, 'From'),
      to: headerValue(message.payload, 'To'),
      date: headerValue(message.payload, 'Date'),
      subject: headerValue(message.payload, 'Subject'),
    },
  };

  const walk = (part: GmailMessagePart | undefined): void => {
    if (!part) {
      return;
    }
    const mimeType = (part.mimeType ?? '').toLowerCase();
    const filename = part.filename ?? '';
    const attachmentId = part.body?.attachmentId;
    const contentId = headerValue(part, 'Content-ID')?.replace(/^<|>$/g, '');
    const disposition = (headerValue(part, 'Content-Disposition') ?? '').toLowerCase();

    if (attachmentId && (filename || contentId)) {
      const inline = disposition.startsWith('inline') || Boolean(contentId);
      result.attachments.push({
        attachmentId,
        filename: filename || (contentId ? `${contentId}` : 'attachment'),
        mimeType: mimeType || 'application/octet-stream',
        contentId,
        inline,
      });
    } else if (mimeType === 'text/plain' && part.body?.data && !filename) {
      if (result.plainText === undefined) {
        result.plainText = decodeGmailBase64(part.body.data);
      }
    } else if (mimeType === 'text/html' && part.body?.data && !filename) {
      if (result.html === undefined) {
        result.html = decodeGmailBase64(part.body.data);
      }
    }

    for (const child of part.parts ?? []) {
      walk(child);
    }
  };

  walk(message.payload);
  return result;
}

/** Extract all `cid:` references from HTML (for inline-image support validation). */
function extractCidReferences(html: string): Set<string> {
  const refs = new Set<string>();
  const regex = /cid:([^"'\s>)]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    refs.add(match[1]);
  }
  return refs;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function buildForwardedHeaderTextBlock(headers: ExtractedSource['headers']): string {
  const lines = ['---------- Forwarded message ----------'];
  if (headers.from) lines.push(`From: ${headers.from}`);
  if (headers.date) lines.push(`Date: ${headers.date}`);
  if (headers.subject) lines.push(`Subject: ${headers.subject}`);
  if (headers.to) lines.push(`To: ${headers.to}`);
  return lines.join('\n');
}

function buildForwardedHeaderHtmlBlock(headers: ExtractedSource['headers']): string {
  const lines = ['<p>---------- Forwarded message ----------<br />'];
  if (headers.from) lines.push(`From: ${escapeHtml(headers.from)}<br />`);
  if (headers.date) lines.push(`Date: ${escapeHtml(headers.date)}<br />`);
  if (headers.subject) lines.push(`Subject: ${escapeHtml(headers.subject)}<br />`);
  if (headers.to) lines.push(`To: ${escapeHtml(headers.to)}<br />`);
  lines.push('</p>');
  return lines.join('\n');
}

/** Normalize summary points to non-empty, single-line, trimmed data (defence against injection). */
function normalizeSummaryLines(summaryLines: string[] | undefined): string[] {
  if (!summaryLines) {
    return [];
  }
  return summaryLines
    .map((line) => line.replace(/[\r\n]+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

function buildSummaryTextBlock(summaryLines: string[]): string[] {
  if (summaryLines.length === 0) {
    return [];
  }
  return ['', 'Assignment summary:', ...summaryLines.map((line) => `- ${line}`)];
}

function buildSummaryHtmlBlock(summaryLines: string[]): string {
  if (summaryLines.length === 0) {
    return '';
  }
  const items = summaryLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  return `<p>Assignment summary:</p>\n<ul>${items}</ul>`;
}

/** Assemble the forward, fetching source + attachments. Fails before send when incomplete. */
export async function buildGmailForward(
  input: GmailForwardInput,
  deps: GmailForwardDeps,
): Promise<GmailForwardBuildResult> {
  const { source } = input;

  if (!source.providerMessageId || !source.organizationId || !source.accountId) {
    return {
      ok: false,
      failure: transportFailure('GMAIL_SOURCE_MESSAGE_UNAVAILABLE', 'missing_source'),
    };
  }

  // 1) Read the EXACT source message. A read failure means the source is unavailable.
  let message: GmailMessage;
  try {
    message = await deps.getMessage({
      accessToken: deps.accessToken,
      messageId: source.providerMessageId,
    });
  } catch {
    return {
      ok: false,
      failure: transportFailure('GMAIL_SOURCE_MESSAGE_UNAVAILABLE', 'read_failed'),
    };
  }

  const extracted = collectSource(message);
  const originalMessageAvailable =
    extracted.plainText !== undefined || extracted.html !== undefined;

  // 2) Decide which attachments are required.
  const requiredIds = source.approvedAttachmentIds
    ? new Set(source.approvedAttachmentIds)
    : new Set(extracted.attachments.map((a) => a.attachmentId));
  const requiredAttachments = extracted.attachments.filter((a) => requiredIds.has(a.attachmentId));

  // If specific attachments were approved but are not present on the message, the forward is
  // incomplete — a required attachment cannot be assembled.
  const presentIds = new Set(extracted.attachments.map((a) => a.attachmentId));
  const missingApproved = source.approvedAttachmentIds?.some((id) => !presentIds.has(id)) ?? false;

  // 3) Inline-image shape validation: every cid referenced by HTML must map to a fetchable inline
  // part; otherwise reject as unsupported rather than send broken HTML.
  if (extracted.html) {
    const cidRefs = extractCidReferences(extracted.html);
    for (const cid of cidRefs) {
      const match = extracted.attachments.find((a) => a.contentId === cid && a.inline);
      if (!match) {
        return {
          ok: false,
          failure: transportFailure('GMAIL_UNSUPPORTED_SOURCE_SHAPE', 'inline_cid'),
        };
      }
      // Ensure inline images we must render are also in the required set.
      requiredIds.add(match.attachmentId);
      if (!requiredAttachments.some((a) => a.attachmentId === match.attachmentId)) {
        requiredAttachments.push(match);
      }
    }
  }

  // 4) Enforce ceilings on count before fetching bytes.
  if (requiredAttachments.length > GMAIL_FORWARD_MAX_ATTACHMENTS) {
    return { ok: false, failure: transportFailure('GMAIL_MESSAGE_TOO_LARGE', 'attachment_count') };
  }

  // 5) Fetch all required attachment bytes. Any failure → incomplete forward.
  const fetched: OutboundAttachment[] = [];
  const inlineImages: OutboundAttachment[] = [];
  let allRequiredAttachmentsAvailable = !missingApproved;
  let totalBytes = 0;

  if (allRequiredAttachmentsAvailable) {
    for (const att of requiredAttachments) {
      let bytes: Uint8Array;
      try {
        const result = await deps.getAttachment({
          accessToken: deps.accessToken,
          messageId: source.providerMessageId,
          attachmentId: att.attachmentId,
        });
        bytes = Buffer.from(result.data, 'base64url');
      } catch {
        allRequiredAttachmentsAvailable = false;
        break;
      }
      if (bytes.length > GMAIL_FORWARD_MAX_SINGLE_ATTACHMENT_BYTES) {
        return {
          ok: false,
          failure: transportFailure('GMAIL_MESSAGE_TOO_LARGE', 'attachment_single'),
        };
      }
      totalBytes += bytes.length;
      if (totalBytes > GMAIL_FORWARD_MAX_ATTACHMENT_TOTAL_BYTES) {
        return {
          ok: false,
          failure: transportFailure('GMAIL_MESSAGE_TOO_LARGE', 'attachment_total'),
        };
      }
      const outbound: OutboundAttachment = {
        filename: att.filename,
        mimeType: att.mimeType,
        content: bytes,
        disposition: att.inline ? 'inline' : 'attachment',
        contentId: att.inline ? att.contentId : undefined,
      };
      if (att.inline && att.contentId) {
        inlineImages.push(outbound);
      } else {
        fetched.push(outbound);
      }
    }
  }

  // 6) D088 incomplete-forward policy gate (domain-owned decision).
  const preflight = evaluateIncompleteForwardPreflight('gmail_forward', {
    originalMessageAvailable,
    allRequiredAttachmentsAvailable,
  });
  if (!preflight.ok || !preflight.value.maySend) {
    const reason = !originalMessageAvailable ? 'source' : 'attachment';
    return {
      ok: false,
      failure:
        reason === 'source'
          ? transportFailure('GMAIL_SOURCE_MESSAGE_UNAVAILABLE', 'incomplete')
          : transportFailure('GMAIL_ATTACHMENT_UNAVAILABLE', 'incomplete'),
    };
  }

  // 7) Compose bodies. Plain text is always produced (derived from HTML when needed).
  const subject = normalizeForwardSubject(extracted.headers.subject);
  const intro = input.ownerIntro.trim();

  const summaryLines = normalizeSummaryLines(input.summaryLines);

  const originalText =
    extracted.plainText ?? (extracted.html ? stripHtmlToText(extracted.html) : '');
  const textBody = [
    intro,
    '',
    'Open your assignment:',
    input.capabilityUrl,
    ...buildSummaryTextBlock(summaryLines),
    '',
    buildForwardedHeaderTextBlock(extracted.headers),
    '',
    originalText,
  ].join('\n');

  let htmlBody: string | undefined;
  if (extracted.html) {
    const summaryHtml = buildSummaryHtmlBlock(summaryLines);
    htmlBody = [
      '<!DOCTYPE html><html><body>',
      `<p>${escapeHtml(intro)}</p>`,
      `<p><a href="${escapeHtmlAttribute(input.capabilityUrl)}">Open your assignment</a></p>`,
      ...(summaryHtml ? [summaryHtml] : []),
      buildForwardedHeaderHtmlBlock(extracted.headers),
      '<div>',
      extracted.html,
      '</div>',
      '</body></html>',
    ].join('\n');
  }

  const message_: OutboundMessage = {
    from: input.from,
    to: input.to,
    subject,
    textBody,
    htmlBody,
    attachments: fetched.length > 0 ? fetched : undefined,
    inlineImages: inlineImages.length > 0 ? inlineImages : undefined,
    deliveryPath: 'gmail_forward',
  };

  return { ok: true, message: message_ };
}
