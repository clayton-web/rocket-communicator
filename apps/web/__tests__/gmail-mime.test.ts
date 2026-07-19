// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MimeConstructionError,
  buildMimeMessage,
  encodeQuotedPrintable,
  sanitizeAttachmentFilename,
  toBase64Url,
} from '@/lib/gmail/transport/mime';
import type { OutboundMessage } from '@/lib/gmail/transport/outbound-types';
import { GMAIL_OUTBOUND_MAX_MESSAGE_BYTES } from '@/lib/gmail/transport/limits';

let boundaryCounter = 0;
function deterministicOptions() {
  boundaryCounter = 0;
  return {
    boundaryFactory: () => `BOUNDARY_${boundaryCounter++}`,
    now: new Date('2026-07-18T15:00:00.000Z'),
    messageIdFactory: () => 'msgid@example.com',
  };
}

function baseMessage(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    from: { email: 'owner@example.com', name: 'Owner' },
    to: { email: 'recipient@example.com', name: 'Recipient' },
    subject: 'Hello',
    textBody: 'Plain text body',
    deliveryPath: 'assignment_email',
    ...overrides,
  };
}

describe('A7.4 MIME construction', () => {
  it('emits CRLF line endings everywhere (no bare LF)', () => {
    const raw = buildMimeMessage(baseMessage(), deterministicOptions());
    expect(raw).toContain('\r\n');
    // No LF that is not preceded by CR.
    expect(/(?<!\r)\n/.test(raw)).toBe(false);
  });

  it('base64url encoding is URL-safe and unpadded', () => {
    const encoded = toBase64Url('sube+/=ff??');
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('nests multipart/mixed(alternative + attachment) when html + attachment present', () => {
    const raw = buildMimeMessage(
      baseMessage({
        htmlBody: '<p>Hello</p>',
        attachments: [
          {
            filename: 'report.pdf',
            mimeType: 'application/pdf',
            content: new Uint8Array([1, 2, 3, 4]),
            disposition: 'attachment',
          },
        ],
      }),
      deterministicOptions(),
    );
    expect(raw).toContain('Content-Type: multipart/mixed; boundary="');
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="');
    expect(raw).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(raw).toContain('Content-Type: text/html; charset=UTF-8');
    expect(raw).toContain('Content-Type: application/pdf');
    expect(raw).toContain('Content-Disposition: attachment');
  });

  it('produces multipart/related for html with inline images', () => {
    const raw = buildMimeMessage(
      baseMessage({
        htmlBody: '<p><img src="cid:img1"></p>',
        inlineImages: [
          {
            filename: 'img.png',
            mimeType: 'image/png',
            content: new Uint8Array([9, 9, 9]),
            disposition: 'inline',
            contentId: 'img1',
          },
        ],
      }),
      deterministicOptions(),
    );
    expect(raw).toContain('multipart/related');
    expect(raw).toContain('Content-ID: <img1>');
    expect(raw).toContain('Content-Disposition: inline');
  });

  it('sanitizes dangerous filenames (path separators + control chars)', () => {
    expect(sanitizeAttachmentFilename('../../etc/passwd')).not.toContain('/');
    const raw = buildMimeMessage(
      baseMessage({
        attachments: [
          {
            filename: '../../evil\r\nname.txt',
            mimeType: 'text/plain',
            content: new Uint8Array([1]),
            disposition: 'attachment',
          },
        ],
      }),
      deterministicOptions(),
    );
    expect(/(?<!\r)\n/.test(raw)).toBe(false);
    expect(raw).not.toContain('../../evil');
  });

  it('falls back to application/octet-stream for missing/invalid mime types', () => {
    const raw = buildMimeMessage(
      baseMessage({
        attachments: [
          {
            filename: 'blob',
            mimeType: '',
            content: new Uint8Array([1, 2]),
            disposition: 'attachment',
          },
        ],
      }),
      deterministicOptions(),
    );
    expect(raw).toContain('Content-Type: application/octet-stream');
  });

  it('rejects a message that exceeds the size ceiling', () => {
    const huge = 'a'.repeat(GMAIL_OUTBOUND_MAX_MESSAGE_BYTES + 1024);
    expect(() => buildMimeMessage(baseMessage({ textBody: huge }), deterministicOptions())).toThrow(
      MimeConstructionError,
    );
  });

  it('rejects malformed recipient addresses', () => {
    expect(() =>
      buildMimeMessage(baseMessage({ to: { email: 'not-an-email' } }), deterministicOptions()),
    ).toThrow(MimeConstructionError);
    expect(() =>
      buildMimeMessage(baseMessage({ to: { email: 'a@b.com, c@d.com' } }), deterministicOptions()),
    ).toThrow(MimeConstructionError);
  });

  it('prevents header injection via recipient / subject / display name', () => {
    expect(() =>
      buildMimeMessage(
        baseMessage({ to: { email: 'a@b.com\r\nBcc: evil@x.com' } }),
        deterministicOptions(),
      ),
    ).toThrow(MimeConstructionError);
    expect(() =>
      buildMimeMessage(baseMessage({ subject: 'Hi\r\nBcc: evil@x.com' }), deterministicOptions()),
    ).toThrow(MimeConstructionError);
    expect(() =>
      buildMimeMessage(
        baseMessage({ to: { email: 'a@b.com', name: 'Bad\r\nName' } }),
        deterministicOptions(),
      ),
    ).toThrow(MimeConstructionError);
  });

  it('RFC 2047-encodes unicode subjects and display names', () => {
    const raw = buildMimeMessage(
      baseMessage({
        subject: 'こんにちは café',
        to: { email: 'r@example.com', name: 'Café Niño' },
      }),
      deterministicOptions(),
    );
    expect(raw).toContain('=?UTF-8?B?');
    // The raw unicode must not appear unencoded in headers.
    expect(raw.split('\r\n\r\n')[0]).not.toContain('こんにちは');
  });

  it('quoted-printable keeps ASCII readable and escapes non-ASCII + trailing space', () => {
    expect(encodeQuotedPrintable('hello world')).toBe('hello world');
    expect(encodeQuotedPrintable('café')).toContain('=C3=A9');
    expect(encodeQuotedPrintable('line ')).toBe('line=20');
  });

  it('does not expose any arbitrary-header field (fixed message header set only)', () => {
    // The OutboundMessage type has no header map; only From/To/Subject/Date/Message-ID/MIME are
    // set at the message level. No caller-supplied header can be injected.
    const raw = buildMimeMessage(baseMessage(), deterministicOptions());
    const messageHeaders = raw.split('\r\n\r\n')[0].split('\r\n');
    for (const required of ['MIME-Version:', 'Date:', 'Message-ID:', 'From:', 'To:', 'Subject:']) {
      expect(messageHeaders.some((l) => l.startsWith(required))).toBe(true);
    }
    // No recipient-disclosure or arbitrary headers ever appear.
    const header = raw.split('\r\n\r\n')[0];
    expect(header).not.toMatch(/\r\nBcc:/i);
    expect(header).not.toMatch(/\r\nCc:/i);
    expect(header).not.toMatch(/\r\nX-/i);
  });
});
