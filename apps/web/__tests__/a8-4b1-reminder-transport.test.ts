import { describe, expect, it, vi } from 'vitest';
import { GmailSendRawError } from '@/lib/gmail/gmail-api-client';
import {
  ReminderTransportTestEnvironmentError,
  classifyReminderTransportFailure,
  createGmailReminderTransport,
} from '@/lib/gmail/outbound/reminder-transport';
import { createGmailReminderTransportProvider } from '@/lib/gmail/reminder-transport-provider';
import { transportFailure } from '@/lib/gmail/transport/errors';
import type { GmailAccessResolver } from '@/lib/handoff/types';
import type { DbClient } from '@aicaa/db';
import type { ReminderTransportRequest } from '@/lib/reminders/transport';

/**
 * A8.4b.1 Gmail reminder transport adapter.
 *
 * Everything here runs against an injected sender. The adapter refuses to build a real one under a
 * test runner at all, which is asserted below rather than assumed — it is the one protection in this
 * slice that also covers tests nobody has written yet.
 */

const ORG = 'org_rem_tx';

function request(overrides: Partial<ReminderTransportRequest> = {}): ReminderTransportRequest {
  return {
    occurrenceId: 'rocc_1',
    organizationId: ORG,
    taskId: 'task_1',
    occurrenceKind: 'overdue',
    occurrenceLocalDate: '2026-08-06',
    delivery: {
      recipientEmail: 'recipient@example.com',
      summaryLines: ['Confirm the venue booking'],
      dueLocalDate: '2026-08-05',
      timeZone: 'America/Los_Angeles',
    },
    ...overrides,
  };
}

function transportWith(sendRaw: ReturnType<typeof vi.fn>) {
  return createGmailReminderTransport({
    organizationId: ORG,
    accessToken: 'ya29.fake-access-token',
    from: { email: 'owner@example.com' },
    sendRaw: sendRaw as never,
    mimeOptions: {
      now: new Date('2026-08-20T18:00:00.000Z'),
      boundaryFactory: () => 'BOUNDARY',
      messageIdFactory: () => 'fixed@example.com',
    },
  });
}

const accepting = () => vi.fn().mockResolvedValue({ status: 200, id: 'gmail_msg_1' });

describe('A8.4b.1: no automated test can reach real Gmail', () => {
  it('refuses to construct the real sender under a test runner', () => {
    expect(process.env.VITEST === 'true' || process.env.NODE_ENV === 'test').toBe(true);
    expect(() =>
      createGmailReminderTransport({
        organizationId: ORG,
        accessToken: 'ya29.fake-access-token',
        from: { email: 'owner@example.com' },
      }),
    ).toThrow(ReminderTransportTestEnvironmentError);
  });

  it('refuses at construction, before any request is composed or sent', () => {
    // Throwing lazily inside `send` would let a test build the adapter, assert on nothing, and pass.
    let constructed = false;
    try {
      createGmailReminderTransport({
        organizationId: ORG,
        accessToken: 'ya29.fake-access-token',
        from: { email: 'owner@example.com' },
      });
      constructed = true;
    } catch {
      /* expected */
    }
    expect(constructed).toBe(false);
  });

  it('sends through the injected fake and nowhere else', async () => {
    const sendRaw = accepting();
    await transportWith(sendRaw).send(request());
    expect(sendRaw).toHaveBeenCalledTimes(1);
  });
});

describe('A8.4b.1: provider outcome classification', () => {
  it('maps a confirmed send to accepted, carrying only the provider message id', async () => {
    const result = await transportWith(accepting()).send(request());
    expect(result).toEqual({ kind: 'accepted', providerMessageRef: 'gmail_msg_1' });
  });

  /**
   * Status-by-status, because collapsing these is how a system starts stopping schedules for rate
   * limits or retrying messages Gmail has already rejected as invalid.
   */
  const HTTP_CASES: ReadonlyArray<{ status: number; kind: string; why: string }> = [
    { status: 429, kind: 'retryable', why: 'rate limiting passes' },
    { status: 500, kind: 'retryable', why: 'Gmail being unavailable passes' },
    { status: 503, kind: 'retryable', why: 'Gmail being unavailable passes' },
    { status: 401, kind: 'retryable', why: 'a token that aged out mid-run is refreshed next run' },
    { status: 403, kind: 'retryable', why: 'an authorization refusal is not a Task-level failure' },
    { status: 400, kind: 'permanent', why: 'an invalid message fails the same way every time' },
    { status: 413, kind: 'permanent', why: 'an oversized message will not shrink' },
  ];

  for (const { status, kind, why } of HTTP_CASES) {
    it(`maps HTTP ${status} to ${kind} because ${why}`, async () => {
      const result = await transportWith(vi.fn().mockResolvedValue({ status })).send(request());
      expect(result.kind).toBe(kind);
      expect(result).toHaveProperty('failureCode');
    });
  }

  it('maps a timeout to ambiguous, never to accepted and never to retryable', async () => {
    const sendRaw = vi.fn().mockRejectedValue(new GmailSendRawError('timeout'));
    const result = await transportWith(sendRaw).send(request());
    expect(result.kind).toBe('ambiguous');
  });

  it('maps an unparseable response to ambiguous', async () => {
    const sendRaw = vi.fn().mockRejectedValue(new GmailSendRawError('parse'));
    expect((await transportWith(sendRaw).send(request())).kind).toBe('ambiguous');
  });

  /**
   * Re-audit B1. This case used to assert `retryable` on the premise that a `network` failure means
   * the request was never submitted. It does not: `sendRawMessage` raises this kind for every
   * non-abort `fetch` rejection, and Node raises the same rejection when the peer resets the
   * connection after receiving the entire request body. Retrying a message Gmail may already hold
   * sends a second real reminder for the same local calendar day.
   */
  it('maps a network failure to ambiguous, because it cannot prove Gmail did not accept it', async () => {
    const sendRaw = vi.fn().mockRejectedValue(new GmailSendRawError('network'));
    expect((await transportWith(sendRaw).send(request())).kind).toBe('ambiguous');
  });

  it('maps an unexpected sender throw to ambiguous rather than assuming nothing was sent', async () => {
    const sendRaw = vi.fn().mockRejectedValue(new Error('socket hang up'));
    expect((await transportWith(sendRaw).send(request())).kind).toBe('ambiguous');
  });

  it('leaves no send failure without an HTTP status classified as retryable', async () => {
    // The invariant behind the two cases above, stated once: only Gmail answering with a status may
    // produce a retry, because only that answer proves the message was rejected rather than kept.
    for (const kind of ['network', 'timeout', 'parse'] as const) {
      const sendRaw = vi.fn().mockRejectedValue(new GmailSendRawError(kind));
      expect((await transportWith(sendRaw).send(request())).kind).toBe('ambiguous');
    }
    // The taxonomy still calls a network failure retryable, and A8.4b.1 does not change A7. The
    // difference is who retries: an A7 send is retried by an Owner who asked for it and can see the
    // result, while a reminder would be retried automatically by an unattended worker on the next
    // wake-up. So the reminder send path above must not route to this code.
    expect(classifyReminderTransportFailure(transportFailure('GMAIL_NETWORK_ERROR')).kind).toBe(
      'retryable',
    );
  });

  it('treats a 2xx with no message id as ambiguous rather than as a send', async () => {
    const sendRaw = vi.fn().mockResolvedValue({ status: 200 });
    const result = await transportWith(sendRaw).send(request());
    // An acceptance nobody could later verify is not an acceptance.
    expect(result.kind).toBe('ambiguous');
    expect(result).not.toHaveProperty('providerMessageRef');
  });

  it('never reports an ambiguous provider outcome as a confirmed send', () => {
    const ambiguous = classifyReminderTransportFailure(transportFailure('GMAIL_AMBIGUOUS_SEND'));
    expect(ambiguous.kind).toBe('ambiguous');
    expect(ambiguous.kind).not.toBe('accepted');
  });

  it('reads the A7 taxonomy flags rather than restating a code list', () => {
    // Every code the taxonomy marks ambiguous classifies ambiguous, whatever else it says.
    expect(classifyReminderTransportFailure(transportFailure('GMAIL_RATE_LIMITED')).kind).toBe(
      'retryable',
    );
    expect(
      classifyReminderTransportFailure(transportFailure('GMAIL_PROVIDER_UNAVAILABLE')).kind,
    ).toBe('retryable');
    expect(classifyReminderTransportFailure(transportFailure('GMAIL_INVALID_RECIPIENT')).kind).toBe(
      'permanent',
    );
    expect(
      classifyReminderTransportFailure(transportFailure('GMAIL_CONFIGURATION_ERROR')).kind,
    ).toBe('permanent');
  });

  it('carries a stable failure code and never a provider body, status text, or token', async () => {
    const sendRaw = vi
      .fn()
      .mockResolvedValue({ status: 500, error: { message: 'boom at Google' } });
    const result = await transportWith(sendRaw).send(request());
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('GMAIL_PROVIDER_UNAVAILABLE');
    expect(serialized).not.toMatch(/boom at Google/);
    expect(serialized).not.toMatch(/ya29/);
    expect(serialized).not.toMatch(/recipient@example\.com/);
    expect(serialized).not.toMatch(/venue/i);
  });
});

describe('A8.4b.1: what the adapter refuses to send', () => {
  it('refuses an advance occurrence, because advance delivery is A8.4b.3', async () => {
    const sendRaw = accepting();
    const result = await transportWith(sendRaw).send(request({ occurrenceKind: 'advance' }));
    expect(result).toEqual({ kind: 'permanent', failureCode: 'reminder_kind_not_implemented' });
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('refuses a request from an organization its authorization does not cover', async () => {
    const sendRaw = accepting();
    const result = await transportWith(sendRaw).send(
      request({ organizationId: 'org_someone_else' }),
    );
    expect(result).toEqual({
      kind: 'permanent',
      failureCode: 'reminder_authorization_organization_mismatch',
    });
    // A cross-tenant send is the one failure that must never reach the provider.
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('refuses content D130 rejects, without contacting the provider', async () => {
    const sendRaw = accepting();
    const result = await transportWith(sendRaw).send(
      request({
        delivery: { ...request().delivery, summaryLines: ['9x://evil.example'] },
      }),
    );
    expect(result).toEqual({ kind: 'permanent', failureCode: 'reminder_content_rejected' });
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('maps an unusable recipient address to a non-retryable outcome without sending', async () => {
    const sendRaw = accepting();
    const result = await transportWith(sendRaw).send(
      request({ delivery: { ...request().delivery, recipientEmail: 'not-an-address' } }),
    );
    expect(result.kind).toBe('permanent');
    expect(sendRaw).not.toHaveBeenCalled();
  });
});

describe('A8.4b.1: what reaches Gmail', () => {
  it('submits a base64url raw message with the resolved token and no thread', async () => {
    const sendRaw = accepting();
    await transportWith(sendRaw).send(request());

    const [call] = sendRaw.mock.calls as unknown as [
      [{ accessToken: string; raw: string; threadId?: string }],
    ];
    const [submitted] = call;
    expect(submitted.accessToken).toBe('ya29.fake-access-token');
    expect(submitted.threadId).toBeUndefined();
    expect(submitted.raw).toMatch(/^[A-Za-z0-9_-]+$/);

    const raw = Buffer.from(submitted.raw, 'base64url').toString('utf8');
    expect(raw).toContain('To: recipient@example.com');
    expect(raw).toContain('Reminder: an assigned task is still open');
    expect(raw).toContain('2026-08-05');
    expect(raw).toContain('America/Los_Angeles');
    // D130, asserted against the wire form rather than against the builder's return value.
    expect(raw).not.toMatch(/:\/\//);
    expect(raw).not.toMatch(/\/c\//);
    expect(raw).not.toMatch(/^(In-Reply-To|References|Cc|Bcc):/im);
  });
});

describe('A8.4b.1: once-per-invocation authorization', () => {
  const resolverReturning = (
    resolution: Parameters<GmailAccessResolver['resolve']>[0] extends never
      ? never
      : Awaited<ReturnType<GmailAccessResolver['resolve']>>,
  ) => ({
    resolve: vi.fn().mockResolvedValue(resolution),
  });

  const providerWith = (resolver: { resolve: ReturnType<typeof vi.fn> }) =>
    createGmailReminderTransportProvider({
      db: {} as DbClient,
      runtime: {} as never,
      organizationId: ORG,
      accessResolver: resolver as unknown as GmailAccessResolver,
      sendRaw: accepting() as never,
    });

  it('reports gmail_not_connected without building a transport', async () => {
    const resolver = resolverReturning({ state: 'not_connected' });
    const resolution = await providerWith(resolver).resolve();
    expect(resolution).toEqual({ state: 'unavailable', reason: 'gmail_not_connected' });
    expect(resolver.resolve).toHaveBeenCalledWith(ORG);
  });

  it('reports gmail_send_scope_required apart from a missing connection', async () => {
    const resolution = await providerWith(
      resolverReturning({ state: 'send_scope_required' }),
    ).resolve();
    // Both mean "claim nothing", and their remedies differ, so they stay distinguishable.
    expect(resolution).toEqual({ state: 'unavailable', reason: 'gmail_send_scope_required' });
  });

  it('returns a transport bound to the resolved account when send is available', async () => {
    const resolution = await providerWith(
      resolverReturning({
        state: 'send_available',
        accessToken: 'ya29.fake-access-token',
        from: { email: 'owner@example.com' },
        accountId: 'acct_1',
      }),
    ).resolve();

    expect(resolution.state).toBe('available');
    if (resolution.state !== 'available') {
      throw new Error('unreachable');
    }
    expect((await resolution.transport.send(request())).kind).toBe('accepted');
  });

  it('exposes no token or account detail in the unavailable reason', async () => {
    for (const state of ['not_connected', 'send_scope_required'] as const) {
      const resolution = await providerWith(resolverReturning({ state })).resolve();
      const serialized = JSON.stringify(resolution);
      expect(serialized).not.toMatch(/ya29|refresh|acct_/);
    }
  });
});
