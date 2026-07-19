// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createGmailTransport } from '@/lib/gmail/transport/gmail-transport';
import { GmailSendRawError } from '@/lib/gmail/gmail-api-client';
import type { OutboundMessage } from '@/lib/gmail/transport/outbound-types';

const SECRET_TOKEN = 'SECRET-ACCESS-TOKEN';
const SECRET_BODY = 'SECRET-BODY-MARKER';

function message(): OutboundMessage {
  return {
    from: { email: 'owner@example.com', name: 'Owner' },
    to: { email: 'recipient@example.com' },
    subject: 'Assignment',
    textBody: SECRET_BODY,
    deliveryPath: 'assignment_email',
  };
}

function command() {
  return { accessToken: SECRET_TOKEN, message: message(), requestId: 'req_1' };
}

const fixedNow = () => new Date('2026-07-18T15:30:00.000Z');

describe('A7.4 Gmail transport send', () => {
  it('normalizes a provider acceptance (message id + accepted timestamp + path)', async () => {
    const sendRaw = vi.fn().mockResolvedValue({ status: 200, id: 'gmail_msg_1', threadId: 't_1' });
    const transport = createGmailTransport({ sendRaw, now: fixedNow });
    const result = await transport.send(command());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.acceptance.providerMessageId).toBe('gmail_msg_1');
      expect(result.acceptance.providerThreadId).toBe('t_1');
      expect(result.acceptance.acceptedAt).toBe('2026-07-18T15:30:00.000Z');
      expect(result.acceptance.deliveryPath).toBe('assignment_email');
    }
    // Transport never sets a threadId (new outbound thread).
    expect(sendRaw).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: SECRET_TOKEN, threadId: undefined }),
    );
  });

  it('maps a known provider rejection (400) to a non-retryable invalid-message failure', async () => {
    const transport = createGmailTransport({ sendRaw: vi.fn().mockResolvedValue({ status: 400 }) });
    const result = await transport.send(command());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('GMAIL_INVALID_MESSAGE');
      expect(result.failure.retryable).toBe(false);
    }
  });

  it('maps rate limiting (429) to a retryable failure', async () => {
    const transport = createGmailTransport({ sendRaw: vi.fn().mockResolvedValue({ status: 429 }) });
    const result = await transport.send(command());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('GMAIL_RATE_LIMITED');
      expect(result.failure.retryable).toBe(true);
    }
  });

  it('maps authorization failure (401) and send-time 403 to authorization-invalid', async () => {
    const t401 = createGmailTransport({ sendRaw: vi.fn().mockResolvedValue({ status: 401 }) });
    const r401 = await t401.send(command());
    expect(r401.ok).toBe(false);
    if (!r401.ok) expect(r401.failure.code).toBe('GMAIL_AUTHORIZATION_INVALID');

    const t403 = createGmailTransport({ sendRaw: vi.fn().mockResolvedValue({ status: 403 }) });
    const r403 = await t403.send(command());
    if (!r403.ok) expect(r403.failure.code).toBe('GMAIL_AUTHORIZATION_INVALID');
  });

  it('maps message-too-large (413) to a validation failure', async () => {
    const transport = createGmailTransport({ sendRaw: vi.fn().mockResolvedValue({ status: 413 }) });
    const result = await transport.send(command());
    if (!result.ok) expect(result.failure.code).toBe('GMAIL_MESSAGE_TOO_LARGE');
  });

  it('maps 5xx to a retryable provider-unavailable failure', async () => {
    const transport = createGmailTransport({ sendRaw: vi.fn().mockResolvedValue({ status: 503 }) });
    const result = await transport.send(command());
    if (!result.ok) {
      expect(result.failure.code).toBe('GMAIL_PROVIDER_UNAVAILABLE');
      expect(result.failure.retryable).toBe(true);
    }
  });

  it('classifies timeout after submission as an ambiguous outcome', async () => {
    const transport = createGmailTransport({
      sendRaw: vi.fn().mockRejectedValue(new GmailSendRawError('timeout')),
    });
    const result = await transport.send(command());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('GMAIL_AMBIGUOUS_SEND');
      expect(result.failure.ambiguous).toBe(true);
    }
  });

  it('classifies a pre-submission network error separately from ambiguous', async () => {
    const transport = createGmailTransport({
      sendRaw: vi.fn().mockRejectedValue(new GmailSendRawError('network')),
    });
    const result = await transport.send(command());
    if (!result.ok) {
      expect(result.failure.code).toBe('GMAIL_NETWORK_ERROR');
      expect(result.failure.ambiguous).toBe(false);
    }
  });

  it('treats a 2xx with no message id as ambiguous', async () => {
    const transport = createGmailTransport({ sendRaw: vi.fn().mockResolvedValue({ status: 200 }) });
    const result = await transport.send(command());
    if (!result.ok) expect(result.failure.code).toBe('GMAIL_AMBIGUOUS_SEND');
  });

  it('never leaks the access token, message body, or a raw provider error', async () => {
    const transport = createGmailTransport({ sendRaw: vi.fn().mockResolvedValue({ status: 400 }) });
    const result = await transport.send(command());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SECRET_TOKEN);
    expect(serialized).not.toContain(SECRET_BODY);
    if (!result.ok) {
      expect(result.failure.fingerprint).toMatch(/^[0-9a-f]{16}$/);
      expect(result.failure.message).toBe('The message was rejected as invalid.');
    }
  });

  it('maps a MIME/validation failure without contacting the provider', async () => {
    const sendRaw = vi.fn();
    const transport = createGmailTransport({ sendRaw });
    const bad = command();
    bad.message = { ...message(), to: { email: 'not-an-email' } };
    const result = await transport.send(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('GMAIL_INVALID_RECIPIENT');
    expect(sendRaw).not.toHaveBeenCalled();
  });
});
