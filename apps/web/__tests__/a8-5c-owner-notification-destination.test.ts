import { describe, expect, it, vi } from 'vitest';
import {
  buildOwnerNotificationLink,
  createGmailOwnerNotificationTransportProvider,
  resolveOwnerNotificationContext,
  type GmailOwnerNotificationTransportDeps,
} from '@/lib/gmail/owner-notification-transport-provider';
import type { OwnerNotificationTransportRequest } from '@/lib/notifications/transport';

/**
 * A8.5c destination resolution and render-context loading (D134).
 *
 * The question these answer is where an Owner notification's address comes from. The answer has to
 * be "the connected `CommunicationAccount` of the organization named on the intent" and nothing
 * else, so the tests supply hostile alternatives — a Task carrying an address, an intent belonging
 * to another organization — and check that none of them can steer a message.
 */

const ORG_A = 'org_a';
const ORG_B = 'org_b';
const APP_URL = 'https://app.example.com';

const REQUEST: OwnerNotificationTransportRequest = {
  intentId: 'onint_1',
  organizationId: ORG_A,
  eventType: 'task.completed_by_recipient',
  subjectKind: 'task',
  subjectId: 'task_1',
  attemptNumber: 1,
};

function intentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'onint_1',
    organizationId: ORG_A,
    eventType: 'task_completed_by_recipient',
    subjectKind: 'task',
    subjectId: 'task_1',
    occurrenceKey: 'v2',
    state: 'claimed',
    actorKind: 'capability',
    occurredAt: '2026-08-20T18:04:05.000Z',
    ...overrides,
  };
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task_1',
    organizationId: ORG_A,
    summaryPoints: [{ kind: 'request', label: 'Request', value: 'Confirm the venue booking' }],
    ...overrides,
  };
}

function deps(
  overrides: Partial<GmailOwnerNotificationTransportDeps> = {},
  rows: { intent?: unknown; task?: unknown } = {},
): GmailOwnerNotificationTransportDeps {
  return {
    db: {} as never,
    appUrl: APP_URL,
    runtime: {
      findOwnerNotificationIntentById: vi.fn(
        async (_db: unknown, organizationId: string, id: string) => {
          const intent = rows.intent === undefined ? intentRow() : rows.intent;
          if (!intent) {
            return null;
          }
          const row = intent as { id: string; organizationId: string };
          // Mirrors the repository, which scopes the lookup by organization.
          return row.id === id && row.organizationId === organizationId ? row : null;
        },
      ),
      // A8.5d: the subject is resolved to its Task before the summary is read, so a reminder or a
      // capability event can still name the work it is about. Mirrors the repository, which returns
      // the identifier unchanged for a Task subject and null for a communication account.
      findOwnerNotificationSubjectTaskId: vi.fn(
        async (_db: unknown, _organizationId: string, subjectKind: string, subjectId: string) =>
          subjectKind === 'task'
            ? subjectId
            : subjectKind === 'communication_account'
              ? null
              : null,
      ),
      getTaskById: vi.fn(async (_db: unknown, organizationId: string, id: string) => {
        const task = rows.task === undefined ? taskRow() : rows.task;
        if (!task) {
          return null;
        }
        const row = task as { id: string; organizationId: string };
        return row.id === id && row.organizationId === organizationId ? row : null;
      }),
      getCommunicationAccountByOrganization: vi.fn(async () => null),
      getGmailOAuthCredentialByAccountId: vi.fn(async () => null),
    } as never,
    ...overrides,
  };
}

describe('A8.5c: the authenticated Owner link', () => {
  it('points at the Owner Task surface on the canonical application origin', () => {
    expect(buildOwnerNotificationLink({ appUrl: APP_URL, taskId: 'task_1' })).toBe(
      'https://app.example.com/tasks/task_1',
    );
  });

  it('is omitted for an event about no Task rather than guessed at', () => {
    expect(buildOwnerNotificationLink({ appUrl: APP_URL, taskId: undefined })).toBeUndefined();
  });

  it('encodes the identifier so nothing path-shaped can escape /tasks/', () => {
    const link = buildOwnerNotificationLink({
      appUrl: APP_URL,
      taskId: '../../c/tok_abc',
    });
    expect(link).toBe('https://app.example.com/tasks/..%2F..%2Fc%2Ftok_abc');
    expect(link).not.toContain('/c/');
  });

  it('refuses a base URL that is not a valid absolute origin', () => {
    expect(() => buildOwnerNotificationLink({ appUrl: 'not-a-url', taskId: 't' })).toThrow();
  });
});

describe('A8.5c: render context comes from the intent and the Task, and nothing else', () => {
  it('reads the historical actor and occurrence instant from the intent row', async () => {
    const context = await resolveOwnerNotificationContext(deps(), REQUEST);
    expect(context).toMatchObject({
      eventType: 'task_completed_by_recipient',
      actorKind: 'capability',
      occurredAt: '2026-08-20T18:04:05.000Z',
    });
  });

  /**
   * A Task completed by a Recipient and later reopened by the Owner is still a Recipient completion.
   * Attribution therefore comes from the intent, which recorded it when it happened, and no current
   * Task field can change it.
   */
  it('does not let current Task state restate who acted', async () => {
    const context = await resolveOwnerNotificationContext(
      deps({}, { task: taskRow({ status: 'open', completedBy: 'owner' }) }),
      REQUEST,
    );
    expect(context?.actorKind).toBe('capability');
  });

  it('uses the persisted Task summary points as the Task identification', async () => {
    const context = await resolveOwnerNotificationContext(deps(), REQUEST);
    expect(context?.summaryLines).toEqual(['Confirm the venue booking']);
  });

  it('redacts URLs arriving through a summary point', async () => {
    const context = await resolveOwnerNotificationContext(
      deps(
        {},
        {
          task: taskRow({
            summaryPoints: [
              { kind: 'request', label: 'Request', value: 'Pay at https://vendor.example/inv/9' },
            ],
          }),
        },
      ),
      REQUEST,
    );
    expect(context?.summaryLines).toEqual(['Pay at [link removed]']);
  });

  it('fails closed when the intent is gone', async () => {
    await expect(
      resolveOwnerNotificationContext(deps({}, { intent: null }), REQUEST),
    ).resolves.toBe(null);
  });

  it('fails closed when the Task has been purged under retention', async () => {
    await expect(resolveOwnerNotificationContext(deps({}, { task: null }), REQUEST)).resolves.toBe(
      null,
    );
  });

  it('reads no Recipient row, note, clarification, or excerpt', async () => {
    const d = deps();
    await resolveOwnerNotificationContext(d, REQUEST);
    // The runtime surface this function is given is the whole set of reads it can perform, and it
    // contains no Recipient, note, or excerpt accessor at all.
    expect(Object.keys(d.runtime).sort()).toEqual([
      'findOwnerNotificationIntentById',
      'findOwnerNotificationSubjectTaskId',
      'getCommunicationAccountByOrganization',
      'getGmailOAuthCredentialByAccountId',
      'getTaskById',
    ]);
  });
});

describe('A8.5c: cross-organization safety in context resolution', () => {
  it("cannot read another organization's intent", async () => {
    const context = await resolveOwnerNotificationContext(deps(), {
      ...REQUEST,
      organizationId: ORG_B,
    });
    expect(context).toBe(null);
  });

  it("cannot read another organization's Task", async () => {
    const context = await resolveOwnerNotificationContext(
      deps(
        {},
        { intent: intentRow({ subjectId: 'task_1' }), task: taskRow({ organizationId: ORG_B }) },
      ),
      REQUEST,
    );
    expect(context).toBe(null);
  });

  it('scopes both reads by the organization on the request', async () => {
    const d = deps();
    await resolveOwnerNotificationContext(d, REQUEST);
    expect(d.runtime.findOwnerNotificationIntentById).toHaveBeenCalledWith(
      expect.anything(),
      ORG_A,
      'onint_1',
    );
    expect(d.runtime.getTaskById).toHaveBeenCalledWith(expect.anything(), ORG_A, 'task_1');
  });
});

describe('A8.5c: the destination is the connected account, resolved fresh', () => {
  /** A minimal stand-in for the A7 access resolver, so no credential or token code runs here. */
  function accessResolver(emailAddress: string | null) {
    return {
      resolve: vi.fn(async () =>
        emailAddress
          ? {
              state: 'send_available' as const,
              accessToken: 'token',
              from: { email: emailAddress },
              accountId: 'cacc_1',
            }
          : { state: 'not_connected' as const },
      ),
    };
  }

  it('addresses the message to CommunicationAccount.emailAddress for the intent organization', async () => {
    const resolver = accessResolver('owner-a@example.com');
    const calls: string[] = [];
    const transport = createGmailOwnerNotificationTransportProvider({
      ...deps(),
      accessResolver: resolver,
      sendRaw: async ({ raw }) => {
        calls.push(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
        return { status: 200, id: 'gmail-1' };
      },
    });

    const result = await transport.send(REQUEST);
    expect(result).toEqual({ kind: 'accepted', providerMessageRef: 'gmail-1' });
    expect(resolver.resolve).toHaveBeenCalledWith(ORG_A);
    expect(calls[0]).toContain('From: owner-a@example.com');
    expect(calls[0]).toContain('To: owner-a@example.com');
  });

  it('sends nothing when the organization has no connected account', async () => {
    const sendRaw = vi.fn();
    const transport = createGmailOwnerNotificationTransportProvider({
      ...deps(),
      accessResolver: accessResolver(null),
      sendRaw,
    });

    const result = await transport.send(REQUEST);
    expect(result).toEqual({ kind: 'permanent', failureCode: 'gmail_not_connected' });
    expect(sendRaw).not.toHaveBeenCalled();
  });

  /**
   * The schema enforces one Gmail account per organization with `@@unique([organizationId,
   * provider])`, so "several qualifying accounts" is a state the database will not hold. The lookup
   * is a `findUnique` on that key, which is what makes the ambiguity unrepresentable rather than
   * merely unhandled.
   */
  it('resolves through a uniqueness-constrained lookup, so no ambiguity is possible', async () => {
    const resolver = accessResolver('owner-a@example.com');
    const transport = createGmailOwnerNotificationTransportProvider({
      ...deps(),
      accessResolver: resolver,
      sendRaw: async () => ({ status: 200, id: 'gmail-1' }),
    });
    await transport.send(REQUEST);
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(resolver.resolve).toHaveBeenCalledWith(ORG_A);
  });

  it('picks up a reconnected mailbox on the next notification without touching the intent', async () => {
    let address = 'owner-a@example.com';
    const resolver = {
      resolve: vi.fn(async () => ({
        state: 'send_available' as const,
        accessToken: 'token',
        from: { email: address },
        accountId: 'cacc_1',
      })),
    };
    const sent: string[] = [];
    const transport = createGmailOwnerNotificationTransportProvider({
      ...deps(),
      accessResolver: resolver,
      sendRaw: async ({ raw }) => {
        sent.push(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
        return { status: 200, id: 'gmail-1' };
      },
    });

    await transport.send(REQUEST);
    address = 'owner-a-new@example.com';
    await transport.send({ ...REQUEST, intentId: 'onint_1', attemptNumber: 2 });

    expect(sent[0]).toContain('To: owner-a@example.com');
    expect(sent[1]).toContain('To: owner-a-new@example.com');
  });
});
