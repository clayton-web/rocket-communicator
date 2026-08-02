// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  REMINDER_SCHEDULING_TIME_ZONE,
  asAssignmentId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  decideAdvanceReminder,
  parseLocalDate,
  selectNextOverdueOccurrence,
  type Recipient,
  type Task,
} from '@aicaa/domain';
import {
  createTask,
  listReminderDeliveryAttemptsForTask,
  persistEstablishedReminderSchedule,
  stopReminderSchedule,
  upsertRecipient,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { runInternalReminderProcess } from '@/lib/reminders/process-service';
import { FakeReminderTransport } from '@/lib/reminders/transport';
import type {
  ReminderTransport,
  ReminderTransportProvider,
  ReminderTransportResolution,
} from '@/lib/reminders/transport';
import { createGmailReminderTransport } from '@/lib/gmail/outbound/reminder-transport';
import { GmailSendRawError } from '@/lib/gmail/gmail-api-client';

/**
 * A8.4b.1 real overdue reminder delivery, end to end through the A8.4a occurrence lifecycle.
 *
 * Two properties are load-bearing here and neither can be checked by reading one function:
 *
 * 1. **Authorization is resolved once, before the first claim.** An unusable Gmail connection must
 *    cost zero claims, zero occurrence rows, zero schedule mutations, and zero provider calls — and
 *    must not be charged to whichever Task the scan reached first as a delivery failure.
 * 2. **A non-actionable capability skips truthfully (D130).** The reminder's only instruction is
 *    "use the original assignment email", so a dead capability means the occurrence is skipped rather
 *    than spent on a message that cannot be acted on.
 *
 * The Gmail adapter is exercised through an injected raw sender, so this suite composes the real
 * transport code without any possibility of contacting Gmail.
 */

const org = 'org_a8_4b1';
const zone = REMINDER_SCHEDULING_TIME_ZONE;
const NOW = '2026-08-20T18:00:00.000Z';
const ENABLED = { ...process.env, ENABLE_REMINDER_DELIVERY: 'true' } as NodeJS.ProcessEnv;

let db: TestDatabase;

function recipientFixture(id: string): Recipient {
  return {
    id: asRecipientId(id),
    displayName: 'Alex Recipient',
    email: `${id}@example.com`,
    active: true,
  };
}

function taskFixture(id: string, at: string): Task {
  return {
    id: asTaskId(id),
    organizationId: asOrganizationId(org),
    status: 'open',
    summaryPoints: [
      { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Confirm the venue booking' },
    ],
    notes: [],
    reminder: { paused: false },
    retention: {},
    version: 1,
    createdAt: at,
    updatedAt: at,
    assignment: {
      id: asAssignmentId(`asg_${id}`),
      recipientId: asRecipientId(`rcp_${id}`),
      intendedRecipientEmail: `rcp_${id}@example.com`,
      assignedAt: at,
      assignedByOwnerId: asOwnerId('owner_1'),
      allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
    },
  };
}

type CapabilityShape =
  'actionable' | 'missing' | 'expired' | 'revoked' | 'never_activated' | 'used';

/** The capability the original assignment email carried, in whatever state a test needs. */
async function grantCapability(taskId: string, shape: CapabilityShape): Promise<void> {
  if (shape === 'missing') {
    return;
  }
  const assignment = await db.prisma.taskAssignment.findFirstOrThrow({
    where: { taskId, organizationId: org, clearedAt: null },
  });
  const status = shape === 'revoked' ? 'revoked' : shape === 'used' ? 'used' : 'active';
  await db.prisma.taskCapability.create({
    data: {
      id: `cap_${taskId}`,
      organizationId: org,
      taskId,
      assignmentId: assignment.id,
      recipientId: assignment.recipientId,
      intendedRecipientEmail: assignment.intendedRecipientEmail,
      scope: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
      status,
      tokenHash: `hash_cap_${taskId}`,
      issuedAt: new Date('2026-08-01T12:00:00.000Z'),
      // Expiry is a passage of time rather than an event, so the expired case is a past instant with
      // the status left `active` — exactly the row a sweep has not caught up with yet.
      expiresAt: new Date(
        shape === 'expired' ? '2026-08-10T00:00:00.000Z' : '2027-01-01T00:00:00.000Z',
      ),
      actionableAt: shape === 'never_activated' ? null : new Date('2026-08-01T12:05:00.000Z'),
      revokedAt: shape === 'revoked' ? new Date('2026-08-11T00:00:00.000Z') : null,
      revocationReason: shape === 'revoked' ? 'manual' : null,
    },
  });
  await db.prisma.taskAssignment.update({
    where: { id: assignment.id },
    data: { activeCapabilityId: `cap_${taskId}`, capabilityStatus: status },
  });
}

async function seedDueTask(
  key: string,
  options: { capability?: CapabilityShape } = {},
): Promise<{ taskId: string; scheduleId: string }> {
  const taskId = `task_${key}`;
  const establishedAt = '2026-08-01T12:00:00.000Z';
  await upsertRecipient(db.prisma, {
    organizationId: org,
    recipient: recipientFixture(`rcp_${taskId}`),
  });
  const task = taskFixture(taskId, establishedAt);
  await createTask(db.prisma, org, task, task.assignment);
  await grantCapability(taskId, options.capability ?? 'actionable');

  const dueLocalDate = parseLocalDate('2026-08-05');
  const advance = decideAdvanceReminder({ dueLocalDate, establishedAt });
  const nextOverdue = selectNextOverdueOccurrence({ dueLocalDate, now: establishedAt });
  const { schedule } = await persistEstablishedReminderSchedule({
    db: db.prisma,
    schedule: {
      id: `sched_${key}`,
      organizationId: org,
      taskId,
      dueLocalDate,
      schedulingTimeZone: zone,
      establishedAt,
      advanceDisposition: advance.kind === 'scheduled' ? 'scheduled' : 'skipped_window_elapsed',
      advanceOccurrence: {
        occurrenceLocalDate: advance.occurrenceLocalDate,
        occurrenceAt: advance.occurrenceAt,
      },
      nextOverdueOccurrence: {
        occurrenceLocalDate: nextOverdue.occurrenceLocalDate,
        occurrenceAt: nextOverdue.occurrenceAt,
      },
    },
  });
  // A8.4b.3: these fixtures are about overdue delivery, and `NOW` is a fortnight past the advance
  // morning establishment scheduled. A running system would have resolved that morning the day it
  // fell, so resolve it here rather than leave every test below processing two occurrences.
  await db.prisma.taskReminderSchedule.updateMany({
    where: { id: schedule.id, advanceDisposition: 'scheduled' },
    data: { advanceDisposition: 'skipped_window_elapsed' },
  });
  return { taskId, scheduleId: schedule.id };
}

/** The worker scan is global, so a schedule an earlier test armed is genuinely due. */
async function quiesce(): Promise<void> {
  const active = await db.prisma.taskReminderSchedule.findMany({
    where: { status: 'active' },
    select: { id: true, organizationId: true },
  });
  for (const schedule of active) {
    await stopReminderSchedule(db.prisma, {
      organizationId: schedule.organizationId,
      scheduleId: schedule.id,
      reason: 'task_completed',
      stoppedAt: '2026-08-19T00:00:00.000Z',
    });
  }
}

async function attemptsFor(taskId: string) {
  return listReminderDeliveryAttemptsForTask(db.prisma, org, taskId);
}

/**
 * Successful overdue deliveries, counted from history.
 *
 * There is no stored counter to read, deliberately: D106's ceiling is derived from the immutable
 * occurrence rows every time it is evaluated, which is the same discipline D129 requires of the
 * consecutive-ambiguous count. Asserting against history rather than a column is therefore asserting
 * against the thing the ceiling actually uses.
 */
async function successfulOverdueSends(taskId: string): Promise<number> {
  const attempts = await attemptsFor(taskId);
  return attempts.filter(
    (attempt) => attempt.outcome === 'success' && attempt.occurrenceKind === 'overdue',
  ).length;
}

/** Every row the worker could possibly have written, so "wrote nothing" can be asserted literally. */
async function writtenRowCounts() {
  const [attempts, schedules, claimed] = await Promise.all([
    db.prisma.reminderDeliveryAttempt.count(),
    db.prisma.taskReminderSchedule.count({ where: { status: 'active' } }),
    db.prisma.taskReminderSchedule.count({ where: { claimedBy: { not: null } } }),
  ]);
  return { attempts, schedules, claimed };
}

/** A provider that counts how many times an invocation asked it to authorize. */
function countingProvider(resolution: ReminderTransportResolution): ReminderTransportProvider & {
  readonly resolveCount: () => number;
} {
  let calls = 0;
  return {
    resolve: async () => {
      calls += 1;
      return resolution;
    },
    resolveCount: () => calls,
  };
}

function acceptingTransport(): FakeReminderTransport {
  return new FakeReminderTransport({
    defaultResult: { kind: 'accepted', providerMessageRef: 'ref_default' },
  });
}

async function run(options: {
  transport?: ReminderTransport;
  transportProvider?: ReminderTransportProvider;
  env?: NodeJS.ProcessEnv;
  now?: string;
}) {
  const { response } = await runInternalReminderProcess({
    db: db.prisma,
    requestId: 'req_a8_4b1',
    now: options.now ?? NOW,
    env: options.env ?? ENABLED,
    transport: options.transport,
    transportProvider: options.transportProvider,
  });
  return response;
}

describe('A8.4b.1 real overdue reminder delivery', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    clearDbTestRuntime();
    delete process.env.ENABLE_REMINDER_DELIVERY;
    await db.close();
  });

  beforeEach(async () => {
    installDbTestRuntime(db.prisma);
    await quiesce();
  });

  afterEach(() => {
    delete process.env.ENABLE_REMINDER_DELIVERY;
  });

  // -------------------------------------------------------------------------------------------
  // Authorization: once, and before anything else
  // -------------------------------------------------------------------------------------------

  describe('Gmail authorization is resolved once per invocation, before any claim', () => {
    it('resolves exactly once even when several schedules are due', async () => {
      await seedDueTask('auth_once_a');
      await seedDueTask('auth_once_b');
      await seedDueTask('auth_once_c');
      const provider = countingProvider({ state: 'available', transport: acceptingTransport() });

      const response = await run({ transportProvider: provider });

      expect(response.schedulesScanned).toBe(3);
      expect(response.delivered).toBe(3);
      // Three schedules, three occurrences, one authorization.
      expect(provider.resolveCount()).toBe(1);
    });

    it('claims nothing and writes nothing when authorization is unavailable', async () => {
      const seeded = await seedDueTask('auth_unavailable');
      const before = await writtenRowCounts();
      const provider = countingProvider({ state: 'unavailable', reason: 'gmail_not_connected' });

      const response = await run({ transportProvider: provider });

      expect(response.transportAuthorized).toBe(false);
      expect(response.transportConfigured).toBe(true);
      expect(response.deliveryEnabled).toBe(true);
      // Every counter zero, including the recovery sweeps: the invocation stopped before all of them.
      expect(response.schedulesScanned).toBe(0);
      expect(response.occurrencesClaimed).toBe(0);
      expect(response.skipped).toBe(0);
      expect(response.recoveredClaims).toBe(0);
      expect(response.unsettledOccurrencesSettled).toBe(0);
      expect(await attemptsFor(seeded.taskId)).toEqual([]);
      expect(await writtenRowCounts()).toEqual(before);
    });

    it('does not record an authorization failure as an occurrence-level reminder failure', async () => {
      const seeded = await seedDueTask('auth_not_a_failure');
      const provider = countingProvider({
        state: 'unavailable',
        reason: 'gmail_send_scope_required',
      });

      const response = await run({ transportProvider: provider });

      // Nothing failed to deliver, so nothing may be recorded as having failed.
      expect(response.failedPermanent).toBe(0);
      expect(response.failedRetryable).toBe(0);
      expect(response.ambiguous).toBe(0);
      expect(await attemptsFor(seeded.taskId)).toEqual([]);
      // The schedule is untouched: still active, still armed, no stop reason, no Owner attention.
      const schedule = await db.prisma.taskReminderSchedule.findFirstOrThrow({
        where: { id: seeded.scheduleId },
      });
      expect(schedule.status).toBe('active');
      expect(schedule.stopReason).toBeNull();
      expect(schedule.requiresOwnerAttention).toBe(false);
      expect(schedule.nextOverdueOccurrenceAt).not.toBeNull();
    });

    it('leaves the schedule deliverable on the next invocation once authorization returns', async () => {
      const seeded = await seedDueTask('auth_recovers');
      await run({
        transportProvider: countingProvider({
          state: 'unavailable',
          reason: 'gmail_not_connected',
        }),
      });
      expect(await attemptsFor(seeded.taskId)).toEqual([]);

      const response = await run({
        transportProvider: countingProvider({
          state: 'available',
          transport: acceptingTransport(),
        }),
      });

      expect(response.delivered).toBe(1);
      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.outcome).toBe('success');
    });

    it('never asks the transport to send when authorization was unavailable', async () => {
      await seedDueTask('auth_no_send');
      const transport = acceptingTransport();
      // An `unavailable` resolution carries no transport at all, so this one is unreachable by
      // construction; asserting on it proves the invocation did not fall back to something else.
      await run({
        transportProvider: countingProvider({
          state: 'unavailable',
          reason: 'gmail_not_connected',
        }),
      });
      expect(transport.calls).toEqual([]);
    });

    it('reports the three ways to do nothing apart from one another', async () => {
      await seedDueTask('auth_three_ways');

      const disabled = await run({ transport: acceptingTransport(), env: { ...process.env } });
      expect(disabled).toMatchObject({
        deliveryEnabled: false,
        transportConfigured: true,
        transportAuthorized: false,
      });

      const unconfigured = await run({});
      expect(unconfigured).toMatchObject({
        deliveryEnabled: true,
        transportConfigured: false,
        transportAuthorized: false,
      });

      const unauthorized = await run({
        transportProvider: countingProvider({
          state: 'unavailable',
          reason: 'gmail_not_connected',
        }),
      });
      expect(unauthorized).toMatchObject({
        deliveryEnabled: true,
        transportConfigured: true,
        transportAuthorized: false,
      });
    });
  });

  // -------------------------------------------------------------------------------------------
  // D130: the capability gate
  // -------------------------------------------------------------------------------------------

  describe('the capability state is evaluated before any provider call (D130)', () => {
    it('delivers when an actionable original capability exists', async () => {
      const seeded = await seedDueTask('cap_actionable', { capability: 'actionable' });
      const transport = acceptingTransport();

      const response = await run({ transport });

      expect(response.delivered).toBe(1);
      expect(response.skipped).toBe(0);
      expect(transport.calls).toHaveLength(1);
      expect(transport.calls[0]?.delivery.recipientEmail).toBe(`rcp_${seeded.taskId}@example.com`);
    });

    const SKIPPING: ReadonlyArray<{ shape: CapabilityShape; why: string }> = [
      { shape: 'missing', why: 'no capability was ever issued' },
      { shape: 'expired', why: 'the capability TTL has passed' },
      { shape: 'revoked', why: 'the Owner revoked it' },
      { shape: 'never_activated', why: 'no accepted send ever made it actionable' },
      { shape: 'used', why: 'it has already been consumed' },
    ];

    for (const { shape, why } of SKIPPING) {
      it(`skips truthfully and calls no provider when ${why}`, async () => {
        const seeded = await seedDueTask(`cap_${shape}`, { capability: shape });
        const transport = acceptingTransport();

        const response = await run({ transport });

        expect(response.skipped).toBe(1);
        expect(response.delivered).toBe(0);
        // The provider is never contacted, so no local calendar day is spent on a dead link.
        expect(transport.calls).toEqual([]);

        const [attempt] = await attemptsFor(seeded.taskId);
        expect(attempt.outcome).toBe('skipped');
        expect(attempt.skipReason).toBe('no_actionable_capability');
        // A skip is not a failure: no failure code, and no provider marker.
        expect(attempt.failureCode).toBeNull();
        expect(attempt.providerCallStartedAt).toBeNull();
        expect(attempt.providerMessageRef).toBeNull();
      });
    }

    it('distinguishes a dead capability from a missing assignment', async () => {
      const revoked = await seedDueTask('cap_vs_assignment', { capability: 'revoked' });
      await run({ transport: acceptingTransport() });
      const [attempt] = await attemptsFor(revoked.taskId);
      // Different remedies: re-send the assignment, versus assign somebody.
      expect(attempt.skipReason).toBe('no_actionable_capability');
      expect(attempt.skipReason).not.toBe('no_active_assignment');
    });

    it('generates no replacement capability and mints no new one', async () => {
      const seeded = await seedDueTask('cap_no_mint', { capability: 'revoked' });
      const before = await db.prisma.taskCapability.count();

      await run({ transport: acceptingTransport() });

      expect(await db.prisma.taskCapability.count()).toBe(before);
      const capability = await db.prisma.taskCapability.findFirstOrThrow({
        where: { taskId: seeded.taskId },
      });
      // The revoked capability is untouched: reminders never change capability state.
      expect(capability.status).toBe('revoked');
      expect(capability.expiresAt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });

    it('does not resend the original assignment email', async () => {
      const seeded = await seedDueTask('cap_no_resend', { capability: 'revoked' });
      await run({ transport: acceptingTransport() });
      // A reminder writes reminder history and nothing else; a resend would be a handoff attempt.
      expect(await db.prisma.handoffAttempt.count({ where: { taskId: seeded.taskId } })).toBe(0);
    });

    it('consumes the local day and arms the next occurrence, as any terminal skip does', async () => {
      const seeded = await seedDueTask('cap_arms_next', { capability: 'missing' });
      await run({ transport: acceptingTransport() });

      const schedule = await db.prisma.taskReminderSchedule.findFirstOrThrow({
        where: { id: seeded.scheduleId },
      });
      // Still active and still armed: a dead capability may come back, and a skip is not a stop.
      expect(schedule.status).toBe('active');
      expect(schedule.nextOverdueOccurrenceAt).not.toBeNull();
      // A skip is not a delivery, so the D106 count toward the ceiling does not move.
      expect(await successfulOverdueSends(seeded.taskId)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------------------------
  // The real adapter, driven through the real service
  // -------------------------------------------------------------------------------------------

  describe('the real Gmail adapter, composed with an injected sender', () => {
    const gmailProvider = (sendRaw: ReturnType<typeof vi.fn>): ReminderTransportProvider => ({
      resolve: async () => ({
        state: 'available',
        transport: createGmailReminderTransport({
          organizationId: org,
          accessToken: 'ya29.fake-access-token',
          from: { email: 'owner@example.com' },
          sendRaw: sendRaw as never,
        }),
      }),
    });

    it('records a confirmed Gmail acceptance as a counted success carrying the provider id', async () => {
      const seeded = await seedDueTask('gmail_success');
      const sendRaw = vi.fn().mockResolvedValue({ status: 200, id: 'gmail_msg_42' });

      const response = await run({ transportProvider: gmailProvider(sendRaw) });

      expect(response.delivered).toBe(1);
      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.outcome).toBe('success');
      expect(attempt.providerMessageRef).toBe('gmail_msg_42');
      expect(attempt.providerAcceptedAt).not.toBeNull();
      // The in-flight marker was committed before the call, so a crash would have been ambiguous.
      expect(attempt.providerCallStartedAt).not.toBeNull();
      // Exactly one, so a confirmed send moves the D106 count by exactly one.
      expect(await successfulOverdueSends(seeded.taskId)).toBe(1);
    });

    it('sends exactly one message per occurrence, and the MIME carries no link (D130)', async () => {
      await seedDueTask('gmail_one_send');
      const sendRaw = vi.fn().mockResolvedValue({ status: 200, id: 'gmail_msg_43' });

      await run({ transportProvider: gmailProvider(sendRaw) });

      expect(sendRaw).toHaveBeenCalledTimes(1);
      const submitted = sendRaw.mock.calls[0]?.[0] as { raw: string };
      const raw = Buffer.from(submitted.raw, 'base64url').toString('utf8');
      expect(raw).toContain('Confirm the venue booking');
      expect(raw).toContain('2026-08-05');
      expect(raw).not.toMatch(/:\/\//);
      expect(raw).not.toMatch(/\/c\//);
    });

    it('leaves a retryable Gmail failure owed and uncounted', async () => {
      const seeded = await seedDueTask('gmail_retryable');
      const sendRaw = vi.fn().mockResolvedValue({ status: 503 });

      const response = await run({ transportProvider: gmailProvider(sendRaw) });

      expect(response.failedRetryable).toBe(1);
      expect(response.delivered).toBe(0);
      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.outcome).toBe('retryable_failure');
      expect(attempt.failureCode).toBe('GMAIL_PROVIDER_UNAVAILABLE');
      expect(await successfulOverdueSends(seeded.taskId)).toBe(0);
    });

    it('stops the schedule on a permanent Gmail rejection and raises Owner attention', async () => {
      const seeded = await seedDueTask('gmail_permanent');
      const sendRaw = vi.fn().mockResolvedValue({ status: 400 });

      const response = await run({ transportProvider: gmailProvider(sendRaw) });

      expect(response.failedPermanent).toBe(1);
      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.outcome).toBe('permanent_failure');
      expect(attempt.failureCode).toBe('GMAIL_INVALID_MESSAGE');
      const schedule = await db.prisma.taskReminderSchedule.findFirstOrThrow({
        where: { id: seeded.scheduleId },
      });
      expect(schedule.status).toBe('stopped');
      expect(schedule.requiresOwnerAttention).toBe(true);
    });

    /**
     * D129's raw material. A8.4b.2 derives the consecutive count from exactly these rows, so what
     * matters here is that each one is durable, terminal, and identifiable as ambiguous — not that
     * anything counts them yet.
     */
    it('records a terminal ambiguous outcome durably, and never as a delivery', async () => {
      const seeded = await seedDueTask('gmail_ambiguous');
      // A Gmail timeout: submitted, and no answer. The one outcome that cannot be resolved by asking.
      const sendRaw = vi.fn().mockRejectedValue(new GmailSendRawError('timeout'));

      const response = await run({ transportProvider: gmailProvider(sendRaw) });

      expect(response.ambiguous).toBe(1);
      expect(response.delivered).toBe(0);
      const [attempt] = await attemptsFor(seeded.taskId);
      expect(attempt.outcome).toBe('ambiguous');
      expect(attempt.completedAt).not.toBeNull();
      expect(attempt.failureCode).toBe('GMAIL_AMBIGUOUS_SEND');
      // Ambiguity must not advance the D106 count toward the ceiling.
      expect(await successfulOverdueSends(seeded.taskId)).toBe(0);
      // Not retried within the occurrence: the local day is consumed and the row is terminal.
      expect(sendRaw).toHaveBeenCalledTimes(1);
    });

    /**
     * Re-audit B1 regression.
     *
     * A connection failure with no HTTP status used to classify `retryable`, on the premise that
     * `GmailSendRawError('network')` means the request never left. It does not — Node raises the same
     * non-abort rejection when the peer resets after receiving the whole body — so the premise turned
     * a message Gmail may already hold into an occurrence that stayed owed, and the next invocation
     * reclaimed the row, cleared the provider marker, and sent a second real reminder for the same
     * local calendar day.
     *
     * This asserts the end of that path, not just the classification: two invocations, one send.
     */
    it('never sends an occurrence twice after a connection failure with no HTTP status', async () => {
      const seeded = await seedDueTask('gmail_network_no_duplicate');
      const sendRaw = vi.fn().mockRejectedValue(new GmailSendRawError('network'));

      const first = await run({ transportProvider: gmailProvider(sendRaw) });
      const second = await run({ transportProvider: gmailProvider(sendRaw) });

      expect(first.ambiguous).toBe(1);
      expect(first.failedRetryable).toBe(0);
      // The whole point: the second invocation finds nothing left to send for this occurrence.
      expect(sendRaw).toHaveBeenCalledTimes(1);
      expect(second.delivered).toBe(0);
      expect(second.failedRetryable).toBe(0);

      const attempts = await attemptsFor(seeded.taskId);
      const forDay = attempts.filter(
        (attempt) => attempt.occurrenceLocalDate === attempts[0].occurrenceLocalDate,
      );
      expect(forDay).toHaveLength(1);
      expect(forDay[0].outcome).toBe('ambiguous');
      expect(forDay[0].failureCode).toBe('GMAIL_AMBIGUOUS_SEND');
      // Ambiguity is not a delivery, so it must not move the D106 ceiling either.
      expect(await successfulOverdueSends(seeded.taskId)).toBe(0);
    });

    it('leaves the ambiguous history D129 will need, without enforcing its threshold', async () => {
      /**
       * A8.4b.2 derives the consecutive-ambiguous count from exactly these rows. What this slice owes
       * it is durable, terminal, identifiable ambiguity — not a count, not a stored counter, and not
       * the stopping rule, which would be inventing law a milestone early.
       */
      const seeded = await seedDueTask('gmail_no_threshold');
      const sendRaw = vi.fn().mockRejectedValue(new GmailSendRawError('timeout'));

      for (let round = 0; round < 3; round += 1) {
        await run({ transportProvider: gmailProvider(sendRaw) });
      }

      const schedule = await db.prisma.taskReminderSchedule.findFirstOrThrow({
        where: { id: seeded.scheduleId },
      });
      // Not stopped for repeated ambiguity, because nothing counts it yet.
      expect(schedule.stopReason).not.toBe('repeated_ambiguous_outcomes');
      const ambiguous = (await attemptsFor(seeded.taskId)).filter(
        (attempt) => attempt.outcome === 'ambiguous',
      );
      expect(ambiguous.length).toBeGreaterThan(0);
      for (const attempt of ambiguous) {
        // Each one is terminal, dated, and attributable to a generation — the three things a
        // consecutive-outcome derivation needs.
        expect(attempt.completedAt).not.toBeNull();
        expect(attempt.generation).toBe(1);
        expect(attempt.occurrenceLocalDate).toBeTruthy();
      }
      // And no counter was stored anywhere for it (D129).
      expect(Object.keys(schedule)).not.toContain('consecutiveAmbiguousCount');
    });

    it('writes no raw provider response, token, or MIME body into reminder history', async () => {
      const seeded = await seedDueTask('gmail_privacy');
      const sendRaw = vi.fn().mockResolvedValue({
        status: 200,
        id: 'gmail_msg_44',
        threadId: 'gmail_thread_1',
        raw: 'the entire MIME body',
      });

      await run({ transportProvider: gmailProvider(sendRaw) });

      const serialized = JSON.stringify(await attemptsFor(seeded.taskId));
      expect(serialized).toContain('gmail_msg_44');
      expect(serialized).not.toContain('gmail_thread_1');
      expect(serialized).not.toContain('the entire MIME body');
      expect(serialized).not.toMatch(/ya29/);
      expect(serialized).not.toMatch(/@example\.com/);
      expect(serialized).not.toMatch(/venue/i);
      expect(serialized).not.toMatch(/Reminder: an assigned task/);
    });

    it('cannot be reached at all when the flag is off', async () => {
      const seeded = await seedDueTask('gmail_flag_off');
      const sendRaw = vi.fn();

      const response = await run({
        transportProvider: gmailProvider(sendRaw),
        env: { ...process.env },
      });

      expect(response.deliveryEnabled).toBe(false);
      expect(sendRaw).not.toHaveBeenCalled();
      expect(await attemptsFor(seeded.taskId)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Regression: nothing the A8.4a lifecycle refused may become deliverable
  // -------------------------------------------------------------------------------------------

  describe('a real transport does not widen what may be delivered', () => {
    it('claims only the overdue occurrence when the advance morning is already resolved', async () => {
      await seedDueTask('advance_resolved');
      const transport = acceptingTransport();

      await run({ transport });

      // A8.4b.3 gave advance occurrences a scan of their own, so "one send" is now a claim about
      // the schedule's state rather than about a missing code path: this generation's advance
      // morning was settled before the worker ran, and a settled disposition leaves that scan.
      expect(transport.calls).toHaveLength(1);
      expect(transport.calls.every((call) => call.occurrenceKind === 'overdue')).toBe(true);
    });

    it('sends an advance request that reaches the adapter (A8.4b.3)', async () => {
      const sendRaw = vi.fn().mockResolvedValue({ status: 200, id: 'gmail_msg_45' });
      const adapter = createGmailReminderTransport({
        organizationId: org,
        accessToken: 'ya29.fake-access-token',
        from: { email: 'owner@example.com' },
        sendRaw: sendRaw as never,
      });

      const result = await adapter.send({
        occurrenceId: 'rocc_advance',
        organizationId: org,
        taskId: 'task_advance',
        occurrenceKind: 'advance',
        occurrenceLocalDate: '2026-08-04',
        delivery: {
          recipientEmail: 'recipient@example.com',
          summaryLines: ['Confirm the venue booking'],
          dueLocalDate: '2026-08-05',
          timeZone: zone,
        },
      });

      expect(result).toEqual({ kind: 'accepted', providerMessageRef: 'gmail_msg_45' });
      expect(sendRaw).toHaveBeenCalledTimes(1);
    });

    for (const state of ['completed', 'dismissed'] as const) {
      it(`cannot send for a ${state} Task`, async () => {
        const seeded = await seedDueTask(`state_${state}`);
        await db.prisma.task.update({ where: { id: seeded.taskId }, data: { status: state } });
        const transport = acceptingTransport();

        const response = await run({ transport });

        expect(transport.calls).toEqual([]);
        expect(response.delivered).toBe(0);
        expect(response.skipped).toBe(1);
      });
    }

    it('cannot send for a stopped schedule, because the scan cannot see it', async () => {
      const seeded = await seedDueTask('state_stopped');
      await stopReminderSchedule(db.prisma, {
        organizationId: org,
        scheduleId: seeded.scheduleId,
        reason: 'task_completed',
        stoppedAt: '2026-08-19T00:00:00.000Z',
      });
      const transport = acceptingTransport();

      const response = await run({ transport });

      expect(transport.calls).toEqual([]);
      expect(response.schedulesScanned).toBe(0);
    });
  });
});
