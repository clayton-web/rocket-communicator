import { describe, expect, it, vi } from 'vitest';
import { ROCKET_GENERATED_HEADER_NAME } from '@aicaa/domain';
import { GmailSendRawError } from '@/lib/gmail/gmail-api-client';
import {
  createGmailOwnerNotificationTransport,
  OwnerNotificationTransportTestEnvironmentError,
  OWNER_NOTIFICATION_FAILURE_CODES,
  type GmailOwnerNotificationTransportDeps,
  type OwnerNotificationAuthorization,
  type OwnerNotificationRenderContext,
} from '@/lib/gmail/outbound/owner-notification-transport';
import type { OwnerNotificationTransportRequest } from '@/lib/notifications/transport';

/**
 * A8.5c real Gmail Owner notification transport (D134, D135).
 *
 * Every test here injects `sendRaw`. Nothing in this file may reach Gmail, and the construction
 * guard below is what makes that a property of the code rather than of this file's discipline.
 */

const ORG_A = 'org_a';
const ORG_B = 'org_b';

const MAILBOX_A = { email: 'owner-a@example.com' } as const;
const MAILBOX_B = { email: 'owner-b@example.com' } as const;

const REQUEST: OwnerNotificationTransportRequest = {
  intentId: 'onint_1',
  organizationId: ORG_A,
  eventType: 'task.completed_by_recipient',
  subjectKind: 'task',
  subjectId: 'task_1',
  attemptNumber: 1,
};

const CONTEXT: OwnerNotificationRenderContext = {
  eventType: 'task_completed_by_recipient',
  actorKind: 'capability',
  occurredAt: '2026-08-20T18:04:05.000Z',
  summaryLines: ['Confirm the venue booking'],
  ownerLink: 'https://app.example.com/tasks/task_1',
};

/** Records what was sent without ever performing a request. */
function recordingSender(response: { status: number; id?: string } | Error) {
  const calls: Array<{ accessToken: string; raw: string; threadId?: string }> = [];
  const sendRaw = vi.fn(async (input: { accessToken: string; raw: string; threadId?: string }) => {
    calls.push(input);
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
  return { calls, sendRaw };
}

function transport(
  overrides: Partial<GmailOwnerNotificationTransportDeps> = {},
  authorization: OwnerNotificationAuthorization = {
    state: 'available',
    mailbox: MAILBOX_A,
    accessToken: 'token-a',
  },
) {
  const authorize = vi.fn(async () => authorization);
  const resolveContext = vi.fn(async () => CONTEXT);
  const sender = recordingSender({ status: 200, id: 'gmail-msg-1' });
  const instance = createGmailOwnerNotificationTransport({
    authorize,
    resolveContext,
    sendRaw: sender.sendRaw,
    mimeOptions: {
      now: new Date('2026-08-20T18:05:00.000Z'),
      boundaryFactory: () => 'BOUNDARY',
      messageIdFactory: () => 'fixed@example.com',
    },
    ...overrides,
  });
  return { instance, authorize, resolveContext, sender };
}

function decodeRaw(raw: string): string {
  return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

describe('A8.5c transport: the test-environment construction guard', () => {
  it('refuses to build the real sender under Vitest without an injected fake', () => {
    expect(() =>
      createGmailOwnerNotificationTransport({
        authorize: async () => ({ state: 'not_connected' }),
        resolveContext: async () => null,
      }),
    ).toThrow(OwnerNotificationTransportTestEnvironmentError);
  });

  it('throws at construction, before anything could be authorized or sent', () => {
    const authorize = vi.fn(async () => ({ state: 'not_connected' }) as const);
    expect(() =>
      createGmailOwnerNotificationTransport({ authorize, resolveContext: async () => null }),
    ).toThrow();
    expect(authorize).not.toHaveBeenCalled();
  });
});

describe('A8.5c transport: destination resolution', () => {
  it('sends from and to the connected mailbox of the intent organization', async () => {
    const { instance, authorize, sender } = transport();
    const result = await instance.send(REQUEST);

    expect(result).toEqual({ kind: 'accepted', providerMessageRef: 'gmail-msg-1' });
    expect(authorize).toHaveBeenCalledWith(ORG_A);

    const mime = decodeRaw(sender.calls[0].raw);
    expect(mime).toContain('From: owner-a@example.com');
    expect(mime).toContain('To: owner-a@example.com');
  });

  it('stamps the D136 marker on what actually goes to Gmail', async () => {
    const { instance, sender } = transport();
    await instance.send(REQUEST);
    const mime = decodeRaw(sender.calls[0].raw);
    expect(mime).toContain(`${ROCKET_GENERATED_HEADER_NAME}: owner-event-notification`);
    expect(mime.split(`${ROCKET_GENERATED_HEADER_NAME}:`).length - 1).toBe(1);
  });

  it('resolves the destination fresh for every notification, caching nothing', async () => {
    let current = MAILBOX_A;
    const authorize = vi.fn(async () => ({
      state: 'available' as const,
      mailbox: current,
      accessToken: 'token-a',
    }));
    const { instance, sender } = transport({ authorize });

    await instance.send(REQUEST);
    current = MAILBOX_B;
    await instance.send({ ...REQUEST, intentId: 'onint_2', attemptNumber: 1 });

    expect(authorize).toHaveBeenCalledTimes(2);
    expect(decodeRaw(sender.calls[0].raw)).toContain('To: owner-a@example.com');
    expect(decodeRaw(sender.calls[1].raw)).toContain('To: owner-b@example.com');
  });

  it('passes no threadId, so the notification joins no conversation', async () => {
    const { instance, sender } = transport();
    await instance.send(REQUEST);
    expect(sender.calls[0].threadId).toBeUndefined();
  });
});

describe('A8.5c transport: cross-organization safety', () => {
  it('authorizes the organization on the intent, never a configured one', async () => {
    const { instance, authorize } = transport({ expectedOrganizationId: ORG_A });
    await instance.send(REQUEST);
    expect(authorize).toHaveBeenCalledWith(ORG_A);
  });

  it('refuses an intent from another organization rather than redirecting it', async () => {
    const { instance, authorize, sender } = transport({ expectedOrganizationId: ORG_A });
    const result = await instance.send({ ...REQUEST, organizationId: ORG_B });

    expect(result).toEqual({
      kind: 'permanent',
      failureCode: OWNER_NOTIFICATION_FAILURE_CODES.organizationMismatch,
    });
    // Fails before authorization and before any provider contact: no token for either organization
    // is resolved, so there is nothing a mistake downstream could send with.
    expect(authorize).not.toHaveBeenCalled();
    expect(sender.sendRaw).not.toHaveBeenCalled();
  });

  it('still resolves per intent when no organization is configured to assert against', async () => {
    const { instance, authorize } = transport();
    await instance.send({ ...REQUEST, organizationId: ORG_B });
    expect(authorize).toHaveBeenCalledWith(ORG_B);
  });
});

describe('A8.5c transport: unavailable channel', () => {
  it('reports a disconnected account as permanent, and contacts nothing', async () => {
    const { instance, sender, resolveContext } = transport({}, { state: 'not_connected' });
    const result = await instance.send(REQUEST);

    expect(result).toEqual({
      kind: 'permanent',
      failureCode: OWNER_NOTIFICATION_FAILURE_CODES.notConnected,
    });
    expect(sender.sendRaw).not.toHaveBeenCalled();
    // Not even the render context is loaded: an undeliverable channel is decided before anything
    // about the Task is read.
    expect(resolveContext).not.toHaveBeenCalled();
  });

  it('reports a missing send scope as permanent, and contacts nothing', async () => {
    const { instance, sender } = transport({}, { state: 'send_scope_required' });
    const result = await instance.send(REQUEST);

    expect(result).toEqual({
      kind: 'permanent',
      failureCode: OWNER_NOTIFICATION_FAILURE_CODES.sendScopeRequired,
    });
    expect(sender.sendRaw).not.toHaveBeenCalled();
  });

  /**
   * Permanent rather than retryable is the point. A8.5b would otherwise spend three attempts and
   * three wake-ups against a mailbox nobody has reconnected, and each of the first two would leave
   * the intent looking like ordinary pending work.
   */
  it('does not ask for a retry against a durably unavailable channel', async () => {
    const { instance } = transport({}, { state: 'not_connected' });
    const result = await instance.send(REQUEST);
    expect(result.kind).not.toBe('retryable');
    expect(result.kind).not.toBe('ambiguous');
  });
});

describe('A8.5c transport: missing render context', () => {
  it('fails closed as permanent when the facts to render truthfully are gone', async () => {
    const { instance, sender } = transport({ resolveContext: async () => null });
    const result = await instance.send(REQUEST);

    expect(result).toEqual({
      kind: 'permanent',
      failureCode: OWNER_NOTIFICATION_FAILURE_CODES.contextUnavailable,
    });
    expect(sender.sendRaw).not.toHaveBeenCalled();
  });

  it('fails closed as permanent when content rules refuse the message', async () => {
    const { instance, sender } = transport({
      resolveContext: async () => ({ ...CONTEXT, summaryLines: ['Approve at /c/tok_abc'] }),
    });
    const result = await instance.send(REQUEST);

    expect(result).toEqual({
      kind: 'permanent',
      failureCode: OWNER_NOTIFICATION_FAILURE_CODES.contentRejected,
    });
    expect(sender.sendRaw).not.toHaveBeenCalled();
  });
});

describe('A8.5c transport: provider outcome classification', () => {
  async function classify(response: { status: number; id?: string } | Error) {
    const sender = recordingSender(response);
    const instance = createGmailOwnerNotificationTransport({
      authorize: async () => ({
        state: 'available',
        mailbox: MAILBOX_A,
        accessToken: 'token-a',
      }),
      resolveContext: async () => CONTEXT,
      sendRaw: sender.sendRaw,
    });
    return instance.send(REQUEST);
  }

  it('accepts only a 2xx carrying a provider message reference', async () => {
    await expect(classify({ status: 200, id: 'gmail-msg-9' })).resolves.toEqual({
      kind: 'accepted',
      providerMessageRef: 'gmail-msg-9',
    });
  });

  it('keeps only the short reference, never a response body', async () => {
    const result = await classify({ status: 200, id: 'gmail-msg-9' });
    expect(result).toEqual({ kind: 'accepted', providerMessageRef: 'gmail-msg-9' });
    expect(Object.keys(result)).toEqual(['kind', 'providerMessageRef']);
  });

  it('treats a 2xx without a message reference as ambiguous, never as sent', async () => {
    const result = await classify({ status: 200 });
    expect(result.kind).toBe('ambiguous');
  });

  const HTTP: ReadonlyArray<readonly [number, 'retryable' | 'permanent']> = [
    [429, 'retryable'],
    [500, 'retryable'],
    [503, 'retryable'],
    // Definitively not accepted, and a fresh token next invocation fixes it.
    [401, 'retryable'],
    [403, 'retryable'],
    [400, 'permanent'],
    [413, 'permanent'],
  ];

  for (const [status, kind] of HTTP) {
    it(`maps HTTP ${status} to ${kind}`, async () => {
      const result = await classify({ status });
      expect(result.kind).toBe(kind);
    });
  }

  const THROWN = ['network', 'timeout', 'parse'] as const;
  for (const kind of THROWN) {
    it(`treats a thrown ${kind} error as ambiguous, preserving the A8.5b contract`, async () => {
      const result = await classify(new GmailSendRawError(kind, 'boom'));
      expect(result.kind).toBe('ambiguous');
    });
  }

  it('treats an unrecognized thrown error as ambiguous rather than retryable', async () => {
    const result = await classify(new Error('unexpected'));
    expect(result.kind).toBe('ambiguous');
  });

  it('never leaks a provider or exception string into the failure code', async () => {
    for (const response of [
      { status: 500 },
      { status: 400 },
      new GmailSendRawError('network', 'ECONNRESET talking to gmail.googleapis.com'),
      new Error('token ya29.SECRET expired'),
    ] as const) {
      const result = await classify(response);
      if (result.kind === 'accepted') {
        continue;
      }
      expect(result.failureCode).toMatch(/^[A-Za-z0-9_]+$/);
      expect(result.failureCode).not.toMatch(/gmail\.googleapis|ya29|ECONNRESET/);
    }
  });
});

describe('A8.5c transport: what never reaches persistence or the wire', () => {
  it('returns no destination address in any outcome', async () => {
    for (const authorization of [
      { state: 'available', mailbox: MAILBOX_A, accessToken: 'token-a' },
      { state: 'not_connected' },
      { state: 'send_scope_required' },
    ] as const) {
      const { instance } = transport({}, authorization);
      const result = await instance.send(REQUEST);
      expect(JSON.stringify(result)).not.toContain('owner-a@example.com');
      expect(JSON.stringify(result)).not.toContain('@');
    }
  });

  it('never returns the access token', async () => {
    const { instance } = transport();
    const result = await instance.send(REQUEST);
    expect(JSON.stringify(result)).not.toContain('token-a');
  });
});
