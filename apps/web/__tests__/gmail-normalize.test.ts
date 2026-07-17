// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MAX_GMAIL_ATTACHMENT_FILENAME_LENGTH,
  MAX_GMAIL_ATTACHMENT_METADATA_ITEMS,
  MAX_GMAIL_EXCERPT_BYTES,
  MAX_GMAIL_TO_ADDRESSES,
} from '@aicaa/domain';
import type { GmailMessage } from '@/lib/gmail/gmail-api-client';
import {
  normalizeGmailMessage,
  parseAddressList,
  parseEmailAddress,
  stripHtmlToPlain,
  trimQuotedReply,
  truncateUtf8Bytes,
} from '@/lib/gmail/normalize';

function b64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

function baseMessage(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id: 'msg_1',
    threadId: 'thread_1',
    labelIds: ['INBOX'],
    snippet: 'preview',
    internalDate: '1721145600000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'Sender <sender@example.com>' },
        { name: 'To', value: 'Owner <owner@example.com>' },
        { name: 'Subject', value: 'Hello' },
      ],
      body: { data: b64url('Hello body') },
    },
    ...overrides,
  };
}

describe('A5.4 Gmail normalize', () => {
  describe('truncateUtf8Bytes', () => {
    it('does not split multi-byte UTF-8 characters', () => {
      // "é" is 2 bytes; "世" is 3 bytes
      const text = 'aé世';
      expect(Buffer.from(text, 'utf8').byteLength).toBe(1 + 2 + 3);
      expect(truncateUtf8Bytes(text, 2)).toBe('a');
      expect(truncateUtf8Bytes(text, 3)).toBe('aé');
      expect(truncateUtf8Bytes(text, 4)).toBe('aé');
      expect(truncateUtf8Bytes(text, 5)).toBe('aé');
      expect(truncateUtf8Bytes(text, 6)).toBe('aé世');
    });

    it('returns empty for non-positive maxBytes', () => {
      expect(truncateUtf8Bytes('abc', 0)).toBe('');
      expect(truncateUtf8Bytes('abc', -1)).toBe('');
    });
  });

  describe('parseEmailAddress / parseAddressList', () => {
    it('parses angle-bracket and bare addresses to lowercase', () => {
      expect(parseEmailAddress('Alice <Alice@Example.COM>')).toBe('alice@example.com');
      expect(parseEmailAddress('bob@Example.com')).toBe('bob@example.com');
      expect(parseEmailAddress('  ')).toBeNull();
      expect(parseEmailAddress('not-an-email')).toBeNull();
      expect(parseEmailAddress(null)).toBeNull();
    });

    it('parses To lists with dedupe and recipient cap', () => {
      expect(parseAddressList('a@ex.com, B <b@ex.com>, a@ex.com')).toEqual([
        'a@ex.com',
        'b@ex.com',
      ]);
      const many = Array.from({ length: MAX_GMAIL_TO_ADDRESSES + 5 }, (_, i) => `u${i}@ex.com`);
      expect(parseAddressList(many.join(', '))).toHaveLength(MAX_GMAIL_TO_ADDRESSES);
    });
  });

  describe('HTML / quoted reply / excerpt', () => {
    it('falls back from HTML-only payloads and strips tags', () => {
      expect(stripHtmlToPlain('<p>Hi &amp; <b>there</b></p><script>x()</script>')).toContain(
        'Hi & there',
      );
      expect(stripHtmlToPlain('<p>Hi</p><script>x()</script>')).not.toContain('x()');

      const normalized = normalizeGmailMessage(
        baseMessage({
          payload: {
            mimeType: 'text/html',
            headers: [
              { name: 'From', value: 'sender@example.com' },
              { name: 'To', value: 'owner@example.com' },
            ],
            body: { data: b64url('<div>Hello <b>world</b></div>') },
          },
        }),
      );
      expect(normalized.excerptContent).toBe('Hello world');
      expect(normalized.excerptContent).not.toMatch(/<|>|div|b>/);
    });

    it('trims quoted reply lines', () => {
      expect(trimQuotedReply('Keep me\n> quoted\n  > also quoted\nAlso keep')).toBe(
        'Keep me\nAlso keep',
      );

      const normalized = normalizeGmailMessage(
        baseMessage({
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'sender@example.com' },
              { name: 'To', value: 'owner@example.com' },
            ],
            body: { data: b64url('Top\n> On Mon wrote:\n> old\nBottom') },
          },
        }),
      );
      expect(normalized.excerptContent).toBe('Top\nBottom');
    });

    it('caps excerpt at MAX_GMAIL_EXCERPT_BYTES UTF-8 bytes', () => {
      const huge = 'é'.repeat(MAX_GMAIL_EXCERPT_BYTES); // 2 bytes each → over cap
      const normalized = normalizeGmailMessage(
        baseMessage({
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'sender@example.com' },
              { name: 'To', value: 'owner@example.com' },
            ],
            body: { data: b64url(huge) },
          },
        }),
      );
      expect(normalized.excerptContent).toBeTruthy();
      expect(Buffer.byteLength(normalized.excerptContent!, 'utf8')).toBeLessThanOrEqual(
        MAX_GMAIL_EXCERPT_BYTES,
      );
      expect(Buffer.byteLength(normalized.excerptContent!, 'utf8')).toBe(MAX_GMAIL_EXCERPT_BYTES);
    });
  });

  describe('attachments and subject', () => {
    it('caps attachment metadata and truncates long filenames', () => {
      const parts = Array.from({ length: MAX_GMAIL_ATTACHMENT_METADATA_ITEMS + 3 }, (_, i) => ({
        filename:
          i === 0 ? `${'x'.repeat(MAX_GMAIL_ATTACHMENT_FILENAME_LENGTH + 40)}.pdf` : `f${i}.bin`,
        mimeType: 'application/octet-stream',
        body: { size: 10 + i, attachmentId: `att_${i}`, data: 'SHOULD_NOT_APPEAR' },
      }));

      const normalized = normalizeGmailMessage(
        baseMessage({
          payload: {
            mimeType: 'multipart/mixed',
            headers: [
              { name: 'From', value: 'sender@example.com' },
              { name: 'To', value: 'owner@example.com' },
              { name: 'Subject', value: 'Files' },
            ],
            parts: [
              {
                mimeType: 'text/plain',
                body: { data: b64url('body') },
              },
              ...parts,
            ],
          },
        }),
      );

      expect(normalized.hasAttachments).toBe(true);
      expect(normalized.attachmentMetadata).toHaveLength(MAX_GMAIL_ATTACHMENT_METADATA_ITEMS);
      expect(normalized.attachmentMetadata[0]?.filename).toHaveLength(
        MAX_GMAIL_ATTACHMENT_FILENAME_LENGTH,
      );
      expect(JSON.stringify(normalized.attachmentMetadata)).not.toContain('SHOULD_NOT_APPEAR');
      expect(JSON.stringify(normalized.attachmentMetadata)).not.toContain('attachmentId');
      expect(JSON.stringify(normalized.attachmentMetadata)).not.toMatch(/"data"/);
      expect(normalized.attachmentMetadata.every((item) => !('data' in item))).toBe(true);
      expect(normalized.attachmentMetadata.every((item) => !('attachmentId' in item))).toBe(true);
    });

    it('allows missing subject as null', () => {
      const normalized = normalizeGmailMessage(
        baseMessage({
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'sender@example.com' },
              { name: 'To', value: 'owner@example.com' },
            ],
            body: { data: b64url('no subject') },
          },
        }),
      );
      expect(normalized.subject).toBeNull();
    });
  });
});
