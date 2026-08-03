// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOwnerNotificationIntent, type CreateOwnerNotificationIntentInput } from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import {
  MAX_CAPABILITY_EXPIRIES_PER_SWEEP,
  runCapabilityExpirySweep,
} from '@/lib/capability/expiry';
import { ENABLE_OWNER_EVENT_CAPTURE_ENV } from '@/lib/notifications/capture-config';
import { ENABLE_OWNER_EVENT_DELIVERY_ENV } from '@/lib/notifications/process-config';
import { FakeOwnerNotificationTransport } from '@/lib/notifications/transport';
import { runOwnerNotificationWorker } from '@/lib/notifications/worker';
import { POST } from '@/app/api/v1/internal/notifications/process/route';

/**
 * A8.5e: two phases, two flags, one invocation (D133, D135).
 *
 * The properties worth proving here are all *refusals*. A8.5b established what delivery does and
 * A8.5d established what each producer writes; what A8.5e adds is a second phase sharing an
 * endpoint with the first, and the ways that can go wrong are:
 *
 *  - capture quietly enabling delivery, or delivery quietly enabling capture
 *  - a capture-only invocation resolving a Gmail credential it has no business touching
 *  - an invocation with both flags off opening a database connection anyway
 *  - one phase's failure rolling back or hiding the other's work
 *
 * `openDb` and `composeTransport` are passed as spies rather than values, so "never opened the
 * database" and "never composed a transport" are observations rather than inferences.
 */

const SECRET = 'cron-secret-for-notification-worker-32b!';
const org = 'org_a85e';
const NOW = '2026-08-06T12:00:00.000Z';

/**
 * Long enough ago to be expired against the real clock as well as against {@link NOW}.
 *
 * The endpoint tests go through `POST`, which supplies its own instant, so a fixture dated relative
 * to `NOW` would be in the future for them and expire for nobody.
 */
const EXPIRED_AT = '2020-01-01T00:00:00.000Z';

let db: TestDatabase;

function env(capture: boolean | string, delivery: boolean | string): NodeJS.ProcessEnv {
  const value = (flag: boolean | string) =>
    flag === true ? 'true' : flag === false ? undefined : flag;
  return {
    ...(value(capture) === undefined ? {} : { [ENABLE_OWNER_EVENT_CAPTURE_ENV]: value(capture) }),
    ...(value(delivery) === undefined
      ? {}
      : { [ENABLE_OWNER_EVENT_DELIVERY_ENV]: value(delivery) }),
  } as NodeJS.ProcessEnv;
}

const NO_EXPIRIES = {
  scanned: 0,
  observed: 0,
  lostRaces: 0,
  batchFilled: false,
  deadlineStopped: false,
};

/** Spies for both lazy dependencies, so what the worker *did* is directly observable. */
function deps(overrides: Partial<Parameters<typeof runOwnerNotificationWorker>[0]> = {}) {
  const openDb = vi.fn(async () => db.prisma);
  const composeTransport = vi.fn(async () => undefined);
  const sweep = vi.fn(async () => NO_EXPIRIES);
  return {
    openDb,
    composeTransport,
    sweep,
    input: {
      openDb,
      composeTransport,
      sweep,
      requestId: 'req_a85e',
      now: NOW,
      ...overrides,
    } as Parameters<typeof runOwnerNotificationWorker>[0],
  };
}

function intentInput(
  overrides: Partial<CreateOwnerNotificationIntentInput> = {},
): CreateOwnerNotificationIntentInput {
  return {
    id: 'onint_a85e',
    organizationId: org,
    eventType: 'task_completed_by_recipient',
    subjectKind: 'task',
    subjectId: 'task_a85e',
    occurrenceKey: '2',
    occurredAt: '2026-08-06T11:30:00.000Z',
    actorKind: 'capability',
    ownerId: null,
    capabilityId: 'cap_a85e',
    systemId: null,
    assignmentId: 'asg_a85e',
    attributionLabel: 'Alex R.',
    auditEventId: null,
    requestId: null,
    correlationId: null,
    ...overrides,
  };
}

/** A capability whose expiry has already passed, with the rows it cannot exist without. */
async function seedExpiredCapability(suffix: string, expiresAt = EXPIRED_AT): Promise<string> {
  const recipientId = `rcp_${suffix}`;
  const taskId = `task_${suffix}`;
  const assignmentId = `asg_${suffix}`;
  const capabilityId = `cap_${suffix}`;
  const email = `${recipientId}@example.com`;

  await db.prisma.recipient.create({
    data: {
      id: recipientId,
      organizationId: org,
      displayName: 'Alex R.',
      email,
      emailNormalized: email,
      active: true,
    },
  });
  await db.prisma.task.create({
    data: {
      id: taskId,
      organizationId: org,
      status: 'open',
      summaryPoints: [],
      reminder: {},
      retention: {},
      version: 1,
    },
  });
  await db.prisma.taskAssignment.create({
    data: {
      id: assignmentId,
      organizationId: org,
      taskId,
      recipientId,
      intendedRecipientEmail: email,
      assignedAt: new Date(EXPIRED_AT),
      assignedByOwnerId: 'owner_a85e',
      allowedCapabilityActions: [],
      capabilityStatus: 'active',
      deliveryStatus: 'pending',
    },
  });
  await db.prisma.taskCapability.create({
    data: {
      id: capabilityId,
      organizationId: org,
      taskId,
      assignmentId,
      intendedRecipientEmail: email,
      scope: [],
      status: 'active',
      tokenHash: `hash_${suffix}`,
      issuedAt: new Date(EXPIRED_AT),
      expiresAt: new Date(expiresAt),
    },
  });
  return capabilityId;
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
  await db.prisma.taskCapability.deleteMany();
  await db.prisma.taskAssignment.deleteMany();
  await db.prisma.task.deleteMany();
  await db.prisma.recipient.deleteMany();
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env[ENABLE_OWNER_EVENT_CAPTURE_ENV];
  delete process.env[ENABLE_OWNER_EVENT_DELIVERY_ENV];
});

// ---------------------------------------------------------------------------------------------
// The four-state matrix
// ---------------------------------------------------------------------------------------------

describe('A8.5e flag matrix: capture off, delivery off', () => {
  it('opens no database, composes no transport, and sweeps nothing', async () => {
    const d = deps();
    const { response } = await runOwnerNotificationWorker({ ...d.input, env: env(false, false) });

    // The whole invariant, stated three ways because each is a different way to break it.
    expect(d.openDb).not.toHaveBeenCalled();
    expect(d.composeTransport).not.toHaveBeenCalled();
    expect(d.sweep).not.toHaveBeenCalled();

    expect(response).toMatchObject({
      captureEnabled: false,
      deliveryEnabled: false,
      transportConfigured: false,
      expiryScanned: 0,
      expiryObserved: 0,
      scanned: 0,
      claimed: 0,
      sent: 0,
      deadlineStopped: false,
    });
  });

  it('is what the repository default environment produces', async () => {
    const d = deps();
    await runOwnerNotificationWorker({ ...d.input, env: process.env });
    expect(d.openDb).not.toHaveBeenCalled();
  });
});

describe('A8.5e flag matrix: capture on, delivery off', () => {
  it('sweeps expiry and never reaches for a transport', async () => {
    const d = deps();
    d.sweep.mockResolvedValue({ ...NO_EXPIRIES, scanned: 3, observed: 2, lostRaces: 1 });

    const { response } = await runOwnerNotificationWorker({ ...d.input, env: env(true, false) });

    expect(d.openDb).toHaveBeenCalledTimes(1);
    expect(d.sweep).toHaveBeenCalledTimes(1);
    // The point of the whole slice: capture is not a reason to touch a Gmail credential.
    expect(d.composeTransport).not.toHaveBeenCalled();

    expect(response).toMatchObject({
      captureEnabled: true,
      deliveryEnabled: false,
      transportConfigured: false,
      expiryScanned: 3,
      expiryObserved: 2,
      expiryLostRaces: 1,
      scanned: 0,
      claimed: 0,
    });
  });

  it('claims no pending notification, however many are owed', async () => {
    await createOwnerNotificationIntent(db.prisma, intentInput());
    const d = deps();

    await runOwnerNotificationWorker({ ...d.input, env: env(true, false) });

    const intent = await db.prisma.ownerNotificationIntent.findUniqueOrThrow({
      where: { id: 'onint_a85e' },
    });
    expect(intent.state).toBe('pending');
    expect(intent.claimSequence).toBe(0);
    expect(await db.prisma.ownerNotificationAttempt.count()).toBe(0);
  });

  it('observes a real expiry: one transition, one audit event, one intent', async () => {
    const capabilityId = await seedExpiredCapability('real');

    const { response } = await runOwnerNotificationWorker({
      openDb: async () => db.prisma,
      composeTransport: async () => undefined,
      requestId: 'req_a85e',
      now: NOW,
      env: env(true, false),
    });

    expect(response.expiryScanned).toBe(1);
    expect(response.expiryObserved).toBe(1);
    expect(response.expiryLostRaces).toBe(0);

    const capability = await db.prisma.taskCapability.findUniqueOrThrow({
      where: { id: capabilityId },
    });
    expect(capability.status).toBe('expired');

    const audits = await db.prisma.auditEvent.findMany({ where: { organizationId: org } });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorKind).toBe('system');
    expect(audits[0].action).toBe('capability_expired');

    const intents = await db.prisma.ownerNotificationIntent.findMany({
      where: { organizationId: org },
    });
    expect(intents).toHaveLength(1);
    expect(intents[0].eventType).toBe('capability_expired');
    expect(intents[0].subjectKind).toBe('task_capability');
    expect(intents[0].subjectId).toBe(capabilityId);
  });

  it('is idempotent: a second invocation observes nothing and writes nothing', async () => {
    await seedExpiredCapability('twice');
    const run = () =>
      runOwnerNotificationWorker({
        openDb: async () => db.prisma,
        composeTransport: async () => undefined,
        requestId: 'req_a85e',
        now: NOW,
        env: env(true, false),
      });

    const first = await run();
    const second = await run();

    expect(first.response.expiryObserved).toBe(1);
    // Not a lost race — the second scan does not return an already-expired capability at all.
    expect(second.response.expiryScanned).toBe(0);
    expect(second.response.expiryObserved).toBe(0);
    expect(await db.prisma.auditEvent.count()).toBe(1);
    expect(await db.prisma.ownerNotificationIntent.count()).toBe(1);
  });

  it('leaves a capability whose time has not come alone', async () => {
    await seedExpiredCapability('future', '2026-09-01T00:00:00.000Z');

    const { response } = await runOwnerNotificationWorker({
      openDb: async () => db.prisma,
      composeTransport: async () => undefined,
      requestId: 'req_a85e',
      now: NOW,
      env: env(true, false),
    });

    expect(response.expiryScanned).toBe(0);
    expect(await db.prisma.auditEvent.count()).toBe(0);
  });
});

describe('A8.5e flag matrix: capture off, delivery on', () => {
  it('composes a transport and performs no expiry observation', async () => {
    const capabilityId = await seedExpiredCapability('nocapture');
    const d = deps();

    const { response } = await runOwnerNotificationWorker({ ...d.input, env: env(false, true) });

    expect(d.openDb).toHaveBeenCalledTimes(1);
    expect(d.composeTransport).toHaveBeenCalledTimes(1);
    expect(d.sweep).not.toHaveBeenCalled();

    expect(response).toMatchObject({
      captureEnabled: false,
      deliveryEnabled: true,
      expiryScanned: 0,
      expiryObserved: 0,
      expiryBatchFilled: false,
    });

    // The capability stays exactly as it was: delivery does not observe expiry as a side effect.
    const capability = await db.prisma.taskCapability.findUniqueOrThrow({
      where: { id: capabilityId },
    });
    expect(capability.status).toBe('active');
    expect(await db.prisma.auditEvent.count()).toBe(0);
  });

  it('delivers an already-persisted intent without creating a new one', async () => {
    await createOwnerNotificationIntent(db.prisma, intentInput());
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'accepted', providerMessageRef: 'm1' },
    ]);

    const { response } = await runOwnerNotificationWorker({
      openDb: async () => db.prisma,
      composeTransport: async () => transport,
      requestId: 'req_a85e',
      now: NOW,
      env: env(false, true),
    });

    expect(response.sent).toBe(1);
    expect(response.expiryObserved).toBe(0);
    expect(await db.prisma.ownerNotificationIntent.count()).toBe(1);
  });
});

describe('A8.5e flag matrix: capture on, delivery on', () => {
  it('runs capture before delivery, in that order', async () => {
    const order: string[] = [];
    const openDb = vi.fn(async () => {
      order.push('openDb');
      return db.prisma;
    });
    const sweep = vi.fn(async () => {
      order.push('sweep');
      return NO_EXPIRIES;
    });
    const composeTransport = vi.fn(async () => {
      order.push('composeTransport');
      return undefined;
    });

    await runOwnerNotificationWorker({
      openDb,
      composeTransport,
      sweep,
      requestId: 'req_a85e',
      now: NOW,
      env: env(true, true),
    });

    expect(order).toEqual(['openDb', 'sweep', 'composeTransport']);
  });

  it('observes a recent expiry and delivers its intent in the same invocation', async () => {
    // An hour before the observation instant, so the intent is inside the 24-hour horizon.
    await seedExpiredCapability('endtoend', '2026-08-06T11:00:00.000Z');
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'accepted', providerMessageRef: 'm1' },
    ]);

    const { response } = await runOwnerNotificationWorker({
      openDb: async () => db.prisma,
      composeTransport: async () => transport,
      requestId: 'req_a85e',
      now: NOW,
      env: env(true, true),
    });

    expect(response.expiryObserved).toBe(1);
    // The intent the capture phase just wrote is claimable by the delivery phase behind it, and
    // the fencing is untouched by having been created moments earlier.
    expect(response.sent).toBe(1);
    const intents = await db.prisma.ownerNotificationIntent.findMany();
    expect(intents).toHaveLength(1);
    expect(intents[0].state).toBe('sent');
  });

  /**
   * The horizon and the sweep meeting for the first time, and the answer being the safe one.
   *
   * A capability that lapsed years ago is observed *now* — the transition is genuinely new — but the
   * event it describes is old, because the intent is dated when the link expired rather than when a
   * worker got round to noticing. D135 refuses to mail the Owner about it, which is what stops
   * enabling capture on a mature database from mailing a history of every dead link.
   */
  it('suppresses an intent for an expiry older than the delivery horizon', async () => {
    await seedExpiredCapability('ancient');
    const transport = new FakeOwnerNotificationTransport([
      { kind: 'accepted', providerMessageRef: 'm1' },
    ]);

    const { response } = await runOwnerNotificationWorker({
      openDb: async () => db.prisma,
      composeTransport: async () => transport,
      requestId: 'req_a85e',
      now: NOW,
      env: env(true, true),
    });

    expect(response).toMatchObject({ expiryObserved: 1, staleSuppressed: 1, sent: 0 });
    // Nothing was contacted: the horizon is applied before anything is claimed.
    expect(transport.calls).toHaveLength(0);
    const intents = await db.prisma.ownerNotificationIntent.findMany();
    expect(intents[0].state).toBe('suppressed');
  });
});

// ---------------------------------------------------------------------------------------------
// Near misses, independently, on each flag
// ---------------------------------------------------------------------------------------------

describe('A8.5e near-miss flag values', () => {
  const NEAR_MISSES = ['1', 'TRUE', 'True', 'yes', 'on', ' true', 'true ', '', 'false'];

  it.each(NEAR_MISSES)('leaves capture disabled for "%s"', async (near) => {
    const d = deps();
    const { response } = await runOwnerNotificationWorker({ ...d.input, env: env(near, false) });
    expect(response.captureEnabled).toBe(false);
    expect(d.sweep).not.toHaveBeenCalled();
    expect(d.openDb).not.toHaveBeenCalled();
  });

  it.each(NEAR_MISSES)('leaves delivery disabled for "%s"', async (near) => {
    const d = deps();
    const { response } = await runOwnerNotificationWorker({ ...d.input, env: env(false, near) });
    expect(response.deliveryEnabled).toBe(false);
    expect(d.composeTransport).not.toHaveBeenCalled();
    expect(d.openDb).not.toHaveBeenCalled();
  });

  it('does not let a near-miss on one flag disable a genuine "true" on the other', async () => {
    const d = deps();
    const { response } = await runOwnerNotificationWorker({ ...d.input, env: env(true, 'TRUE') });
    expect(response).toMatchObject({ captureEnabled: true, deliveryEnabled: false });
    expect(d.sweep).toHaveBeenCalledTimes(1);
    expect(d.composeTransport).not.toHaveBeenCalled();
  });

  it('ignores the reminder flag entirely', async () => {
    const d = deps();
    const { response } = await runOwnerNotificationWorker({
      ...d.input,
      env: { ENABLE_REMINDER_DELIVERY: 'true' } as NodeJS.ProcessEnv,
    });
    expect(response).toMatchObject({ captureEnabled: false, deliveryEnabled: false });
    expect(d.openDb).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// Phase isolation
// ---------------------------------------------------------------------------------------------

describe('A8.5e phase failure isolation', () => {
  it('does not begin delivery when the capture phase runs out of budget', async () => {
    const d = deps();
    d.sweep.mockResolvedValue({
      scanned: 5,
      observed: 5,
      lostRaces: 0,
      batchFilled: true,
      deadlineStopped: true,
    });

    const { response } = await runOwnerNotificationWorker({ ...d.input, env: env(true, true) });

    expect(d.composeTransport).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      expiryObserved: 5,
      expiryDeadlineStopped: true,
      // Invocation-level, so a stop anywhere in the invocation shows here.
      deadlineStopped: true,
      transportConfigured: false,
      sent: 0,
    });
  });

  it('keeps captured expiry when the transport cannot be composed', async () => {
    await seedExpiredCapability('badconfig');

    const { response } = await runOwnerNotificationWorker({
      openDb: async () => db.prisma,
      // Exactly what an absent or invalid application base URL produces.
      composeTransport: async () => undefined,
      requestId: 'req_a85e',
      now: NOW,
      env: env(true, true),
    });

    expect(response).toMatchObject({
      expiryObserved: 1,
      deliveryEnabled: true,
      transportConfigured: false,
      sent: 0,
    });
    // Committed, because the phases share no transaction. A delivery that cannot start is not a
    // reason to un-expire a capability.
    expect(await db.prisma.ownerNotificationIntent.count()).toBe(1);
    expect(await db.prisma.auditEvent.count()).toBe(1);
  });

  it('surfaces a systemic capture failure and starts no delivery work', async () => {
    const d = deps();
    d.sweep.mockRejectedValue(new Error('scan failed'));

    await expect(runOwnerNotificationWorker({ ...d.input, env: env(true, true) })).rejects.toThrow(
      'scan failed',
    );
    expect(d.composeTransport).not.toHaveBeenCalled();
  });

  it('reports a full capture batch without counting what it did not look at', async () => {
    const d = deps();
    d.sweep.mockResolvedValue({
      scanned: MAX_CAPABILITY_EXPIRIES_PER_SWEEP,
      observed: MAX_CAPABILITY_EXPIRIES_PER_SWEEP,
      lostRaces: 0,
      batchFilled: true,
      deadlineStopped: false,
    });

    const { response } = await runOwnerNotificationWorker({ ...d.input, env: env(true, false) });
    expect(response.expiryBatchFilled).toBe(true);
    expect(response.expiryScanned).toBe(MAX_CAPABILITY_EXPIRIES_PER_SWEEP);
  });
});

// ---------------------------------------------------------------------------------------------
// The sweep's own bounds
// ---------------------------------------------------------------------------------------------

describe('A8.5e capability expiry sweep bounds', () => {
  it('takes the oldest expiries first and stops at the limit', async () => {
    for (const [index, expiresAt] of [
      '2026-08-03T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
      '2026-08-02T00:00:00.000Z',
    ].entries()) {
      await seedExpiredCapability(`ordered_${index}`, expiresAt);
    }

    const result = await runCapabilityExpirySweep({ db: db.prisma, now: NOW, limit: 2 });

    expect(result).toMatchObject({ scanned: 2, observed: 2, batchFilled: true });
    const expired = await db.prisma.taskCapability.findMany({
      where: { status: 'expired' },
      select: { id: true },
    });
    // The two oldest, deterministically, rather than whichever two the storage engine offered.
    expect(expired.map((row) => row.id).sort()).toEqual(['cap_ordered_1', 'cap_ordered_2']);
  });

  it('starts no new transition once the stop instant has passed', async () => {
    await seedExpiredCapability('deadline_a', '2026-08-01T00:00:00.000Z');
    await seedExpiredCapability('deadline_b', '2026-08-02T00:00:00.000Z');

    const result = await runCapabilityExpirySweep({
      db: db.prisma,
      now: NOW,
      stopAtMs: Date.now() - 1,
    });

    expect(result).toMatchObject({ scanned: 0, observed: 0, deadlineStopped: true });
    expect(await db.prisma.auditEvent.count()).toBe(0);
  });

  it('refuses an unbounded scan at the persistence boundary', async () => {
    await expect(
      runCapabilityExpirySweep({ db: db.prisma, now: NOW, limit: 5_000 }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// The endpoint
// ---------------------------------------------------------------------------------------------

describe('A8.5e internal endpoint', () => {
  function request(authorization: string | null = `Bearer ${SECRET}`): Request {
    return new Request('https://app.example/api/v1/internal/notifications/process', {
      method: 'POST',
      headers: authorization ? { authorization } : {},
    });
  }

  it('authenticates before it reads a flag or touches anything', async () => {
    process.env.CRON_SECRET = SECRET;
    process.env[ENABLE_OWNER_EVENT_CAPTURE_ENV] = 'true';
    await seedExpiredCapability('unauth');

    expect((await POST(request(null))).status).toBe(401);
    expect((await POST(request('Bearer wrong-secret-entirely-different'))).status).toBe(401);

    // An unauthenticated caller must not be able to make the system do work.
    const capability = await db.prisma.taskCapability.findUniqueOrThrow({
      where: { id: 'cap_unauth' },
    });
    expect(capability.status).toBe('active');
  });

  it('returns the inert both-disabled aggregate with the default environment', async () => {
    process.env.CRON_SECRET = SECRET;
    await seedExpiredCapability('inert');

    const response = await POST(request());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({
      captureEnabled: false,
      deliveryEnabled: false,
      transportConfigured: false,
      expiryScanned: 0,
      expiryObserved: 0,
      expiryLostRaces: 0,
      expiryBatchFilled: false,
      expiryDeadlineStopped: false,
    });

    const capability = await db.prisma.taskCapability.findUniqueOrThrow({
      where: { id: 'cap_inert' },
    });
    expect(capability.status).toBe('active');
  });

  it('observes expiry through the endpoint when only capture is enabled', async () => {
    process.env.CRON_SECRET = SECRET;
    process.env[ENABLE_OWNER_EVENT_CAPTURE_ENV] = 'true';
    await seedExpiredCapability('endpoint');

    const body = (await (await POST(request())).json()) as Record<string, unknown>;

    expect(body).toMatchObject({
      captureEnabled: true,
      deliveryEnabled: false,
      transportConfigured: false,
      expiryScanned: 1,
      expiryObserved: 1,
    });
    const capability = await db.prisma.taskCapability.findUniqueOrThrow({
      where: { id: 'cap_endpoint' },
    });
    expect(capability.status).toBe('expired');
  });

  it('returns counts and flags only, in every flag state', async () => {
    process.env.CRON_SECRET = SECRET;
    await seedExpiredCapability('leak');
    await createOwnerNotificationIntent(db.prisma, intentInput());

    for (const capture of [undefined, 'true']) {
      if (capture) {
        process.env[ENABLE_OWNER_EVENT_CAPTURE_ENV] = capture;
      } else {
        delete process.env[ENABLE_OWNER_EVENT_CAPTURE_ENV];
      }
      const body = (await (await POST(request())).json()) as Record<string, unknown>;
      const serialized = JSON.stringify(body);

      for (const leak of [
        'task_a85e',
        'cap_a85e',
        'cap_leak',
        'onint_a85e',
        'Alex R.',
        '@',
        '/c/',
      ]) {
        expect(serialized, `response must not contain ${leak}`).not.toContain(leak);
      }
      for (const [key, value] of Object.entries(body)) {
        if (key === 'requestId') {
          continue;
        }
        expect(typeof value, `${key} must be a count or a flag`).toMatch(/^(number|boolean)$/);
      }
    }
  });
});
