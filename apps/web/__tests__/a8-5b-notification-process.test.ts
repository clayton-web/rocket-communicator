// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  beginOwnerNotificationAttempt,
  claimOwnerNotificationIntent,
  createOwnerNotificationIntent,
  findOwnerNotificationIntentById,
  listOwnerNotificationAttempts,
  type CreateOwnerNotificationIntentInput,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import {
  ENABLE_OWNER_EVENT_DELIVERY_ENV,
  isOwnerEventDeliveryEnabled,
  MAX_NOTIFICATION_ATTEMPTS,
} from '@/lib/notifications/process-config';
import { runInternalNotificationProcess } from '@/lib/notifications/process-service';
import {
  FakeOwnerNotificationTransport,
  type OwnerNotificationTransport,
} from '@/lib/notifications/transport';
import { POST } from '@/app/api/v1/internal/notifications/process/route';

/**
 * A8.5b Owner notification processing service and its inert internal endpoint (D133, D135).
 *
 * There is no real transport in this slice and delivery is disabled by default, so the properties
 * worth proving are about *ordering, refusal, and truthfulness* rather than about mail: that a
 * disabled invocation touches nothing, that an ambiguous answer is never reported as sent, that a
 * spent budget stops, and that a stale intent is refused without contacting anything.
 */

const SECRET = 'cron-secret-for-notification-process-32b!';
const org = 'org_notif_proc';
const NOW = '2026-08-04T12:00:00.000Z';

/** Delivery is off by default, so every test that wants work done must say so explicitly. */
const ENABLED = {
  ...process.env,
  [ENABLE_OWNER_EVENT_DELIVERY_ENV]: 'true',
} as NodeJS.ProcessEnv;

let db: TestDatabase;

function intentInput(
  overrides: Partial<CreateOwnerNotificationIntentInput> = {},
): CreateOwnerNotificationIntentInput {
  return {
    id: 'onint_1',
    organizationId: org,
    eventType: 'task_completed_by_recipient',
    subjectKind: 'task',
    subjectId: 'task_1',
    occurrenceKey: '4',
    occurredAt: '2026-08-04T11:30:00.000Z',
    actorKind: 'capability',
    ownerId: null,
    capabilityId: 'cap_1',
    systemId: null,
    assignmentId: 'asg_1',
    attributionLabel: 'Alex R.',
    auditEventId: 'audit_trigger_1',
    requestId: 'req_trigger',
    correlationId: 'corr_1',
    ...overrides,
  };
}

async function run(input: {
  transport?: OwnerNotificationTransport;
  env?: NodeJS.ProcessEnv;
  now?: string;
  maxNotifications?: number;
  deadlineMs?: number;
}) {
  const { response } = await runInternalNotificationProcess({
    db: db.prisma,
    requestId: 'req_worker',
    now: input.now ?? NOW,
    env: input.env ?? ENABLED,
    transport: input.transport,
    maxNotifications: input.maxNotifications,
    deadlineMs: input.deadlineMs,
  });
  return response;
}

beforeAll(async () => {
  db = await createTestDatabase();
  installDbTestRuntime(db.prisma);
});

afterAll(async () => {
  clearDbTestRuntime();
  await db.close();
});

beforeEach(async () => {
  await db.prisma.ownerNotificationAttempt.deleteMany();
  await db.prisma.ownerNotificationIntent.deleteMany();
  await db.prisma.auditEvent.deleteMany();
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env[ENABLE_OWNER_EVENT_DELIVERY_ENV];
});

describe('A8.5b delivery gating', () => {
  it('treats only the exact string "true" as enabled', () => {
    expect(
      isOwnerEventDeliveryEnabled({ [ENABLE_OWNER_EVENT_DELIVERY_ENV]: 'true' } as never),
    ).toBe(true);
    for (const near of ['1', 'TRUE', 'True', 'yes', 'on', ' true', 'true ', '', 'false']) {
      expect(
        isOwnerEventDeliveryEnabled({ [ENABLE_OWNER_EVENT_DELIVERY_ENV]: near } as never),
        `"${near}" must not enable delivery`,
      ).toBe(false);
    }
    expect(isOwnerEventDeliveryEnabled({} as never)).toBe(false);
  });

  it('is disabled in the repository default environment', () => {
    expect(isOwnerEventDeliveryEnabled()).toBe(false);
  });

  it('touches no A8.5 table and builds no transport when the flag is unset', async () => {
    await createOwnerNotificationIntent(db.prisma, intentInput());

    // Any statement against either table through this client fails the test outright.
    const forbidden = () => {
      throw new Error('A8.5 table accessed while delivery was disabled');
    };
    const trapped = new Proxy(db.prisma, {
      get(target, property, receiver) {
        if (
          property === 'ownerNotificationIntent' ||
          property === 'ownerNotificationAttempt' ||
          property === '$transaction'
        ) {
          return new Proxy({}, { get: forbidden, apply: forbidden });
        }
        return Reflect.get(target, property, receiver);
      },
    }) as typeof db.prisma;

    const { response } = await runInternalNotificationProcess({
      db: trapped,
      requestId: 'req_worker',
      now: NOW,
      env: { ...process.env, [ENABLE_OWNER_EVENT_DELIVERY_ENV]: undefined } as NodeJS.ProcessEnv,
      transport: new FakeOwnerNotificationTransport(),
    });

    expect(response.deliveryEnabled).toBe(false);
    expect(response.scanned).toBe(0);
    expect(response.claimed).toBe(0);

    const untouched = await findOwnerNotificationIntentById(db.prisma, org, 'onint_1');
    expect(untouched?.state).toBe('pending');
    expect(untouched?.claimSequence).toBe(0);
  });

  it('does no work when enabled but no transport is composed', async () => {
    await createOwnerNotificationIntent(db.prisma, intentInput());

    const response = await run({ transport: undefined });

    expect(response.deliveryEnabled).toBe(true);
    expect(response.transportConfigured).toBe(false);
    expect(response.scanned).toBe(0);
    const untouched = await findOwnerNotificationIntentById(db.prisma, org, 'onint_1');
    expect(untouched?.state).toBe('pending');
  });
});

describe('A8.5b fake transport', () => {
  it('fails closed rather than reporting a delivery it never made', async () => {
    const transport = new FakeOwnerNotificationTransport();

    const result = await transport.send({
      intentId: 'onint_1',
      organizationId: org,
      eventType: 'task_completed_by_recipient',
      subjectKind: 'task',
      subjectId: 'task_1',
      attemptNumber: 1,
    });

    expect(result.kind).toBe('permanent');
  });

  it('resumes failing closed once its script is spent', async () => {
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'accepted', providerMessageRef: 'm1' },
    ]);
    const request = {
      intentId: 'onint_1',
      organizationId: org,
      eventType: 'task_completed_by_recipient',
      subjectKind: 'task',
      subjectId: 'task_1',
      attemptNumber: 1,
    };

    expect((await transport.send(request)).kind).toBe('accepted');
    expect((await transport.send(request)).kind).toBe('permanent');
  });

  it('is given identity and never content', async () => {
    await createOwnerNotificationIntent(db.prisma, intentInput());
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'accepted', providerMessageRef: 'm1' },
    ]);

    await run({ transport });

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toEqual({
      intentId: 'onint_1',
      organizationId: org,
      eventType: 'task_completed_by_recipient',
      subjectKind: 'task',
      subjectId: 'task_1',
      attemptNumber: 1,
    });
    // The attribution label lives on the intent and is not handed to a transport.
    expect(JSON.stringify(transport.calls)).not.toContain('Alex R.');
  });
});

describe('A8.5b state machine', () => {
  it('delivers, terminalizes as sent, and audits the system actor', async () => {
    await createOwnerNotificationIntent(db.prisma, intentInput());
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'accepted', providerMessageRef: 'fake-msg-1' },
    ]);

    const response = await run({ transport });

    expect(response).toMatchObject({ scanned: 1, claimed: 1, sent: 1, ambiguous: 0 });
    const intent = await findOwnerNotificationIntentById(db.prisma, org, 'onint_1');
    expect(intent?.state).toBe('sent');
    expect(intent?.attemptCount).toBe(1);

    const attempts = await listOwnerNotificationAttempts(db.prisma, 'onint_1');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe('sent');
    expect(attempts[0]?.providerMessageRef).toBe('fake-msg-1');
    // The marker was durable before the call, which is what makes a crash recoverable.
    expect(attempts[0]?.providerCallStartedAt).toBe(NOW);

    const [audit] = await db.prisma.auditEvent.findMany();
    expect(audit?.action).toBe('owner_notification.sent');
    expect(audit?.actorKind).toBe('system');
    expect(audit?.systemId).toBe('owner_notification_process');
    expect(audit?.taskId).toBe('task_1');
    expect(audit?.correlationId).toBe('corr_1');
  });

  it('returns a retryable failure to pending without settling it', async () => {
    await createOwnerNotificationIntent(db.prisma, intentInput());
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'retryable', failureCode: 'transient' },
    ]);

    const response = await run({ transport });

    expect(response).toMatchObject({ claimed: 1, failedRetryable: 1, sent: 0, retryExhausted: 0 });
    const intent = await findOwnerNotificationIntentById(db.prisma, org, 'onint_1');
    expect(intent?.state).toBe('pending');
    expect(intent?.attemptCount).toBe(1);
    expect(intent?.settledAt).toBeNull();
    expect(await db.prisma.auditEvent.count()).toBe(0);
  });

  it('retries across invocations and terminalizes on the third failure', async () => {
    await createOwnerNotificationIntent(db.prisma, intentInput());

    for (const attempt of [1, 2]) {
      const response = await run({
        transport: new FakeOwnerNotificationTransport([
          { kind: 'retryable', failureCode: 'transient' },
        ]),
      });
      expect(response.failedRetryable, `invocation ${attempt}`).toBe(1);
      const between = await findOwnerNotificationIntentById(db.prisma, org, 'onint_1');
      expect(between?.state).toBe('pending');
      expect(between?.attemptCount).toBe(attempt);
    }

    const third = await run({
      transport: new FakeOwnerNotificationTransport([
        { kind: 'retryable', failureCode: 'transient' },
      ]),
    });

    expect(third).toMatchObject({ retryExhausted: 1, failedRetryable: 0 });
    const intent = await findOwnerNotificationIntentById(db.prisma, org, 'onint_1');
    expect(intent?.state).toBe('requires_owner_attention');
    expect(intent?.failureCode).toBe('retry_budget_exhausted');
    expect(intent?.attemptCount).toBe(MAX_NOTIFICATION_ATTEMPTS);

    // Exactly three provider calls, and never a fourth.
    expect(await listOwnerNotificationAttempts(db.prisma, 'onint_1')).toHaveLength(3);
    const spent = new FakeOwnerNotificationTransport([
      { kind: 'accepted', providerMessageRef: 'never' },
    ]);
    expect(await run({ transport: spent })).toMatchObject({ scanned: 0, claimed: 0 });
    expect(spent.calls).toHaveLength(0);
  });

  it('attempts a notification at most once per invocation', async () => {
    await createOwnerNotificationIntent(db.prisma, intentInput());
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'retryable', failureCode: 'transient' },
      { kind: 'retryable', failureCode: 'transient' },
    ]);

    await run({ transport });

    // The scan is taken once at the start, so returning a row to `pending` does not burn the whole
    // budget inside one wake-up. The retry waits for the next invocation.
    expect(transport.calls).toHaveLength(1);
  });

  it('terminalizes a permanent failure on the first attempt', async () => {
    await createOwnerNotificationIntent(db.prisma, intentInput());
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'permanent', failureCode: 'rejected' },
    ]);

    const response = await run({ transport });

    expect(response).toMatchObject({ failedPermanent: 1, sent: 0 });
    const intent = await findOwnerNotificationIntentById(db.prisma, org, 'onint_1');
    expect(intent?.state).toBe('failed_permanent');
    expect(intent?.attemptCount).toBe(1);
    const [audit] = await db.prisma.auditEvent.findMany();
    expect(audit?.action).toBe('owner_notification.failed_permanent');
    expect(audit?.outcome).toBe('failed');
  });

  it('terminalizes an ambiguous outcome on the first attempt and never calls sent', async () => {
    await createOwnerNotificationIntent(db.prisma, intentInput());
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'ambiguous', failureCode: 'no_answer' },
    ]);

    const response = await run({ transport });

    expect(response).toMatchObject({ ambiguous: 1, sent: 0, failedRetryable: 0 });
    const intent = await findOwnerNotificationIntentById(db.prisma, org, 'onint_1');
    expect(intent?.state).toBe('ambiguous');
    const attempts = await listOwnerNotificationAttempts(db.prisma, 'onint_1');
    expect(attempts[0]?.outcome).toBe('ambiguous');
    // No acceptance proof exists, because none was received.
    expect(attempts[0]?.providerAcceptedAt).toBeNull();
    expect(attempts[0]?.providerMessageRef).toBeNull();

    // Never retried, even though only one attempt was spent.
    const later = new FakeOwnerNotificationTransport([
      { kind: 'accepted', providerMessageRef: 'never' },
    ]);
    await run({ transport: later });
    expect(later.calls).toHaveLength(0);
  });

  it('treats a transport that throws as ambiguous, because the marker is already durable', async () => {
    await createOwnerNotificationIntent(db.prisma, intentInput());
    const transport = new FakeOwnerNotificationTransport(['throw']);

    const response = await run({ transport });

    expect(response).toMatchObject({ ambiguous: 1, sent: 0, failedRetryable: 0 });
    const intent = await findOwnerNotificationIntentById(db.prisma, org, 'onint_1');
    expect(intent?.state).toBe('ambiguous');
    expect(intent?.failureCode).toBe('transport_error');
    // The exception message is discarded: a closed code, never an arbitrary string.
    expect(intent?.failureCode).not.toContain('scripted');
  });

  it('suppresses an intent past the 24-hour horizon without contacting anything', async () => {
    await createOwnerNotificationIntent(
      db.prisma,
      intentInput({ occurredAt: '2026-08-03T11:00:00.000Z' }),
    );
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'accepted', providerMessageRef: 'never' },
    ]);

    const response = await run({ transport });

    expect(response).toMatchObject({ scanned: 1, staleSuppressed: 1, claimed: 0, sent: 0 });
    expect(transport.calls).toHaveLength(0);
    const intent = await findOwnerNotificationIntentById(db.prisma, org, 'onint_1');
    expect(intent?.state).toBe('suppressed');
    expect(intent?.suppressionReason).toBe('stale');
    expect(intent?.settledAt).toBe(NOW);
    expect(intent?.attemptCount).toBe(0);
    expect(await listOwnerNotificationAttempts(db.prisma, 'onint_1')).toHaveLength(0);

    const [audit] = await db.prisma.auditEvent.findMany();
    expect(audit?.action).toBe('owner_notification.suppressed_stale');
    expect(audit?.outcome).toBe('denied');
  });

  it('delivers an intent that is old but still inside the horizon', async () => {
    await createOwnerNotificationIntent(
      db.prisma,
      intentInput({ occurredAt: '2026-08-03T12:30:00.000Z' }),
    );
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'accepted', providerMessageRef: 'fake-msg-1' },
    ]);

    expect(await run({ transport })).toMatchObject({ sent: 1, staleSuppressed: 0 });
  });

  it('never revisits a terminal intent', async () => {
    await createOwnerNotificationIntent(db.prisma, intentInput());
    await run({
      transport: new FakeOwnerNotificationTransport([
        { kind: 'accepted', providerMessageRef: 'fake-msg-1' },
      ]),
    });

    const second = new FakeOwnerNotificationTransport([
      { kind: 'accepted', providerMessageRef: 'duplicate' },
    ]);
    const response = await run({ transport: second });

    expect(response).toMatchObject({ scanned: 0, claimed: 0, sent: 0 });
    expect(second.calls).toHaveLength(0);
    expect(await listOwnerNotificationAttempts(db.prisma, 'onint_1')).toHaveLength(1);
  });
});

describe('A8.5b expired-claim recovery', () => {
  it('returns a lapsed lease to claimable work when no call had started', async () => {
    const intent = await createOwnerNotificationIntent(db.prisma, intentInput());
    await claimOwnerNotificationIntent(db.prisma, {
      id: intent.id,
      organizationId: org,
      expectedClaimSequence: 0,
      claimedBy: 'dead_worker',
      claimedAt: '2026-08-04T11:40:00.000Z',
      claimExpiresAt: '2026-08-04T11:42:00.000Z',
    });
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'accepted', providerMessageRef: 'fake-msg-1' },
    ]);

    const response = await run({ transport });

    expect(response.recoveredClaims).toBe(1);
    // Recovered before the scan, so the same invocation delivers it.
    expect(response.sent).toBe(1);
    expect(transport.calls).toHaveLength(1);
  });

  it('terminalizes a lapsed lease as ambiguous when a call had started, and never resends', async () => {
    const intent = await createOwnerNotificationIntent(db.prisma, intentInput());
    const claim = await claimOwnerNotificationIntent(db.prisma, {
      id: intent.id,
      organizationId: org,
      expectedClaimSequence: 0,
      claimedBy: 'dead_worker',
      claimedAt: '2026-08-04T11:40:00.000Z',
      claimExpiresAt: '2026-08-04T11:42:00.000Z',
    });
    if (!claim.claimed) {
      throw new Error('seed claim failed');
    }
    await beginOwnerNotificationAttempt(db.prisma, {
      attemptId: 'onatt_orphan',
      intentId: intent.id,
      organizationId: org,
      claimSequence: claim.claimSequence,
      expectedAttemptCount: 0,
      startedAt: '2026-08-04T11:41:00.000Z',
    });
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'accepted', providerMessageRef: 'never' },
    ]);

    const response = await run({ transport });

    expect(response).toMatchObject({ ambiguous: 1, recoveredClaims: 0, sent: 0, claimed: 0 });
    expect(transport.calls).toHaveLength(0);

    const after = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
    expect(after?.state).toBe('ambiguous');
    expect(after?.failureCode).toBe('lease_expired_in_flight');
    // The orphaned attempt is closed out rather than left in flight forever.
    const attempts = await listOwnerNotificationAttempts(db.prisma, intent.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe('ambiguous');
    expect(attempts[0]?.providerAcceptedAt).toBeNull();
  });

  it('leaves a live lease alone', async () => {
    const intent = await createOwnerNotificationIntent(db.prisma, intentInput());
    await claimOwnerNotificationIntent(db.prisma, {
      id: intent.id,
      organizationId: org,
      expectedClaimSequence: 0,
      claimedBy: 'live_worker',
      claimedAt: NOW,
      claimExpiresAt: '2026-08-04T12:05:00.000Z',
    });

    const response = await run({
      transport: new FakeOwnerNotificationTransport([
        { kind: 'accepted', providerMessageRef: 'never' },
      ]),
    });

    expect(response).toMatchObject({ recoveredClaims: 0, ambiguous: 0, scanned: 0 });
    const after = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
    expect(after?.claimedBy).toBe('live_worker');
  });
});

describe('A8.5b batching and deadline', () => {
  it('processes at most the batch bound and reports that more may remain', async () => {
    for (let index = 0; index < 3; index += 1) {
      await createOwnerNotificationIntent(
        db.prisma,
        intentInput({ id: `onint_${index}`, occurrenceKey: String(index) }),
      );
    }
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'accepted', providerMessageRef: 'm1' },
      { kind: 'accepted', providerMessageRef: 'm2' },
    ]);

    const response = await run({ transport, maxNotifications: 2 });

    expect(response).toMatchObject({ scanned: 2, sent: 2, batchFilled: true });
    expect(transport.calls).toHaveLength(2);
  });

  it('reports an unfilled batch as such', async () => {
    await createOwnerNotificationIntent(db.prisma, intentInput());

    const response = await run({
      transport: new FakeOwnerNotificationTransport([
        { kind: 'accepted', providerMessageRef: 'm1' },
      ]),
      maxNotifications: 25,
    });

    expect(response.batchFilled).toBe(false);
  });

  it('stops accepting new work at the deadline and claims nothing', async () => {
    await createOwnerNotificationIntent(db.prisma, intentInput());
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'accepted', providerMessageRef: 'never' },
    ]);

    const response = await run({ transport, deadlineMs: Date.now() - 60_000 });

    expect(response.deadlineStopped).toBe(true);
    expect(response.claimed).toBe(0);
    expect(transport.calls).toHaveLength(0);
    const intent = await findOwnerNotificationIntentById(db.prisma, org, 'onint_1');
    expect(intent?.state).toBe('pending');
  });
});

describe('A8.5b internal endpoint', () => {
  function request(authorization: string | null = `Bearer ${SECRET}`): Request {
    return new Request('https://app.example/api/v1/internal/notifications/process', {
      method: 'POST',
      headers: authorization ? { authorization } : {},
    });
  }

  it('rejects a missing, malformed, or wrong bearer token', async () => {
    process.env.CRON_SECRET = SECRET;

    expect((await POST(request(null))).status).toBe(401);
    expect((await POST(request('Bearer'))).status).toBe(401);
    expect((await POST(request(SECRET))).status).toBe(401);
    expect((await POST(request(`Basic ${SECRET}`))).status).toBe(401);
    expect((await POST(request('Bearer wrong-secret-entirely-different'))).status).toBe(401);
  });

  it('reports a configuration error rather than running without a secret', async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(request())).status).toBe(500);
  });

  it('accepts a valid secret and returns an inert aggregate', async () => {
    process.env.CRON_SECRET = SECRET;
    await createOwnerNotificationIntent(db.prisma, intentInput());

    const response = await POST(request());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    // No transport is composed here in A8.5b, so nothing is delivered even with a valid secret.
    expect(body).toMatchObject({
      deliveryEnabled: false,
      transportConfigured: false,
      scanned: 0,
      claimed: 0,
      sent: 0,
    });

    const untouched = await findOwnerNotificationIntentById(db.prisma, org, 'onint_1');
    expect(untouched?.state).toBe('pending');
  });

  it('returns counts only, with nothing that could identify a notification', async () => {
    process.env.CRON_SECRET = SECRET;
    await createOwnerNotificationIntent(db.prisma, intentInput());

    const body = (await (await POST(request())).json()) as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    for (const leak of ['task_1', 'cap_1', 'asg_1', 'onint_1', 'Alex R.', '@', '/c/', 'corr_1']) {
      expect(serialized, `response must not contain ${leak}`).not.toContain(leak);
    }
    for (const [key, value] of Object.entries(body)) {
      if (key === 'requestId') {
        continue;
      }
      expect(typeof value, `${key} must be a count or a flag`).toMatch(/^(number|boolean)$/);
    }
  });
});
