// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildGmailForward,
  type GmailForwardDeps,
  type GmailForwardInput,
} from '@/lib/gmail/outbound/gmail-forward';
import type { GmailMessage } from '@/lib/gmail/gmail-api-client';
import { buildMimeMessage } from '@/lib/gmail/transport/mime';

function b64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

const SOURCE = {
  providerMessageId: 'msg_exact_123',
  organizationId: 'org_1',
  accountId: 'acct_1',
};

function baseInput(overrides: Partial<GmailForwardInput> = {}): GmailForwardInput {
  return {
    from: { email: 'owner@example.com', name: 'Owner' },
    to: { email: 'recipient@example.com', name: 'Recipient' },
    ownerIntro: 'Please handle this forwarded message.',
    capabilityUrl: 'https://app.example.com/c/FAKE-TOKEN-xyz',
    source: { ...SOURCE },
    ...overrides,
  };
}

function plainTextMessage(): GmailMessage {
  return {
    id: SOURCE.providerMessageId,
    threadId: 'thread_1',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'sender@other.com' },
        { name: 'To', value: 'owner@example.com' },
        { name: 'Date', value: 'Tue, 15 Jul 2026 10:00:00 +0000' },
        { name: 'Subject', value: 'Original subject' },
      ],
      body: { data: b64url('This is the original body.') },
    },
  };
}

function htmlWithAttachment(): GmailMessage {
  return {
    id: SOURCE.providerMessageId,
    threadId: 'thread_1',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'sender@other.com' },
        { name: 'Date', value: 'Tue, 15 Jul 2026 10:00:00 +0000' },
        { name: 'Subject', value: 'Fwd: Fw: Quarterly' },
        { name: 'To', value: 'owner@example.com' },
      ],
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64url('Plain version') } },
            { mimeType: 'text/html', body: { data: b64url('<p>HTML version</p>') } },
          ],
        },
        {
          mimeType: 'application/pdf',
          filename: 'report.pdf',
          body: { attachmentId: 'att_1', size: 4 },
        },
      ],
    },
  };
}

function makeDeps(
  message: GmailMessage,
  overrides: Partial<GmailForwardDeps> = {},
): GmailForwardDeps {
  return {
    accessToken: 'access-token',
    getMessage: vi.fn().mockResolvedValue(message),
    getAttachment: vi.fn().mockResolvedValue({ data: b64url('PDFBYTES'), size: 8 }),
    ...overrides,
  };
}

describe('A7.4 gmail_forward builder', () => {
  it('selects the exact source message (never lists the thread)', async () => {
    const deps = makeDeps(plainTextMessage());
    const result = await buildGmailForward(baseInput(), deps);
    expect(result.ok).toBe(true);
    expect(deps.getMessage).toHaveBeenCalledTimes(1);
    expect(deps.getMessage).toHaveBeenCalledWith({
      accessToken: 'access-token',
      messageId: SOURCE.providerMessageId,
    });
  });

  it('represents original metadata safely in the forwarded block', async () => {
    const result = await buildGmailForward(baseInput(), makeDeps(plainTextMessage()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.textBody).toContain('From: sender@other.com');
      expect(result.message.textBody).toContain('Subject: Original subject');
      expect(result.message.textBody).toContain('Forwarded message');
    }
  });

  it('forwards a plain-text source', async () => {
    const result = await buildGmailForward(baseInput(), makeDeps(plainTextMessage()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.textBody).toContain('This is the original body.');
      expect(result.message.htmlBody).toBeUndefined();
    }
  });

  it('forwards an HTML/multipart source and preserves attachments', async () => {
    const deps = makeDeps(htmlWithAttachment());
    const result = await buildGmailForward(baseInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.htmlBody).toContain('HTML version');
      expect(result.message.attachments?.length).toBe(1);
      expect(result.message.attachments?.[0].filename).toBe('report.pdf');
    }
    expect(deps.getAttachment).toHaveBeenCalledWith({
      accessToken: 'access-token',
      messageId: SOURCE.providerMessageId,
      attachmentId: 'att_1',
    });
  });

  it('normalizes repeated Fwd:/Fw: subject prefixes', async () => {
    const result = await buildGmailForward(baseInput(), makeDeps(htmlWithAttachment()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.subject).toBe('Fwd: Quarterly');
    }
  });

  it('blocks send when an approved attachment is missing from the source', async () => {
    const result = await buildGmailForward(
      baseInput({ source: { ...SOURCE, approvedAttachmentIds: ['att_missing'] } }),
      makeDeps(htmlWithAttachment()),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('GMAIL_ATTACHMENT_UNAVAILABLE');
    }
  });

  it('blocks send when attachment retrieval partially fails', async () => {
    const deps = makeDeps(htmlWithAttachment(), {
      getAttachment: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const result = await buildGmailForward(baseInput(), deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('GMAIL_ATTACHMENT_UNAVAILABLE');
    }
  });

  it('blocks send when the source message cannot be read', async () => {
    const deps = makeDeps(plainTextMessage(), {
      getMessage: vi.fn().mockRejectedValue(new Error('404')),
    });
    const result = await buildGmailForward(baseInput(), deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('GMAIL_SOURCE_MESSAGE_UNAVAILABLE');
    }
  });

  it('rejects an unsupported inline-image shape rather than sending broken HTML', async () => {
    const message: GmailMessage = {
      id: SOURCE.providerMessageId,
      payload: {
        mimeType: 'text/html',
        headers: [
          { name: 'From', value: 'sender@other.com' },
          { name: 'Subject', value: 'Inline' },
        ],
        body: { data: b64url('<p><img src="cid:missing-cid"></p>') },
      },
    };
    const result = await buildGmailForward(baseInput(), makeDeps(message));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('GMAIL_UNSUPPORTED_SOURCE_SHAPE');
    }
  });

  it('supports inline images with matching Content-ID parts', async () => {
    const message: GmailMessage = {
      id: SOURCE.providerMessageId,
      payload: {
        mimeType: 'multipart/related',
        headers: [
          { name: 'From', value: 'sender@other.com' },
          { name: 'Subject', value: 'Inline ok' },
        ],
        parts: [
          { mimeType: 'text/html', body: { data: b64url('<p><img src="cid:img1"></p>') } },
          {
            mimeType: 'image/png',
            filename: 'img.png',
            headers: [{ name: 'Content-ID', value: '<img1>' }],
            body: { attachmentId: 'att_img', size: 3 },
          },
        ],
      },
    };
    const result = await buildGmailForward(baseInput(), makeDeps(message));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.inlineImages?.length).toBe(1);
      expect(result.message.inlineImages?.[0].contentId).toBe('img1');
    }
  });

  it('does not disclose hidden recipients or reuse original thread headers', async () => {
    const result = await buildGmailForward(baseInput(), makeDeps(plainTextMessage()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.textBody).not.toContain('Bcc');
      const raw = buildMimeMessage(result.message);
      expect(raw).not.toContain('In-Reply-To');
      expect(raw).not.toContain('References:');
    }
  });

  it('includes the capability link once in the forward intro', async () => {
    const result = await buildGmailForward(baseInput(), makeDeps(htmlWithAttachment()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const url = 'https://app.example.com/c/FAKE-TOKEN-xyz';
      expect(result.message.textBody.split(url).length - 1).toBe(1);
      expect((result.message.htmlBody as string).split(url).length - 1).toBe(1);
    }
  });
});
