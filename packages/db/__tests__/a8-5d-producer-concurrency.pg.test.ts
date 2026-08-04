/**
 * A8.5d producers under contention, on real PostgreSQL 17.
 *
 * `a8-5d-notification-producers.test.ts` and its reminder sibling establish what each producer does.
 * They run on PGlite, which means one connection, which means two workers are never actually
 * simultaneous and always agree. Everything below needs genuine simultaneity, because the failure
 * mode A8.5d introduces is specifically a duplicate:
 *
 *  - Two clarification requests at different Task versions are two events, not one.
 *  - A retried transition is one event, not two.
 *  - Two workers racing one capability expiry produce one transition, one audit row, one intent.
 *  - A Recipient presenting a lapsed token while a sweep observes it produces the same.
 *  - A refused identity rolls back the mutation that tried to write it, leaving nothing behind.
 *
 * ## Running it
 *
 * Skipped unless `AICAA_PG_CONCURRENCY_URL` names a **loopback** PostgreSQL 17. Not part of
 * `pnpm verify`, which must stay Docker-free. A skipped run is not evidence.
 *
 *   pnpm db:docker:up
 *   AICAA_LOCAL_DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     node packages/db/scripts/run-local-prisma.mjs migrate deploy
 *   AICAA_PG_CONCURRENCY_URL=postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public \
 *     pnpm --filter @aicaa/db exec vitest run a8-5d-producer-concurrency.pg
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  HANDOFF_ACKNOWLEDGEMENT_V1,
  REMINDER_SCHEDULING_TIME_ZONE,
  asAssignmentId,
  asCapabilityId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  computeHandoffRequestFingerprint,
  decideAdvanceReminder,
  identityHandoffFingerprintHasher,
  parseLocalDate,
  selectNextOverdueOccurrence,
  type Recipient,
  type Task,
  type TaskAssignment,
  type TaskCapability,
} from '@aicaa/domain';
import {
  beginInitialHandoff,
  claimReminderOccurrence,
  createOrUpdatePendingCommunicationAccount,
  createPrismaClient,
  createRecipient,
  createTask,
  getCapabilityById,
  markHandoffDeliveryFailed,
  markProviderCallStarted,
  observeCapabilityExpiry,
  persistEstablishedReminderSchedule,
  persistCapabilityAction,
  persistConnectedCommunicationAccount,
  persistGmailChannelUnavailableTransaction,
  persistReturnToOwner,
  revokeCapabilityRecord,
  settleReminderOccurrenceSchedule,
  upsertRecipient,
  type CreateAuditEventInput,
  type DbClient,
} from '../src/index.js';
// Phase A is deliberately off the barrel (A8.4a audit H1). Reached directly so settlement itself can
// be the thing two connections race.
import { terminalizeReminderOccurrence } from '../src/transactions/a8-4a-occurrence-transactions.js';

const RAW_URL = process.env.AICAA_PG_CONCURRENCY_URL;

/** Refuse anything but loopback. `packages/db/.env` holds a production URL. */
function assertLoopback(raw: string): string {
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())) {
    throw new Error(`AICAA_PG_CONCURRENCY_URL must be loopback, got ${url.hostname}.`);
  }
  return raw;
}

const describeMaybe = RAW_URL ? describe : describe.skip;

const runId = randomBytes(4).toString('hex');
const org = `org_a85d_pg_${runId}`;
const ownerId = `owner_a85d_pg_${runId}`;
const now = '2026-08-05T12:00:00.000Z';
const expiresAt = '2026-08-12T12:00:00.000Z';
const afterExpiry = '2026-08-12T12:00:01.000Z';

/** Rounds per race. One pass of a race that fails one time in ten looks like a fix. */
const ROUNDS = 20;

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${runId}_${seq}`;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

function recipientFixture(id: string, email: string): Recipient {
  return { id: asRecipientId(id), displayName: 'Alex Recipient', email, active: true };
}

function taskFixture(taskId: string): Task {
  return {
    id: asTaskId(taskId),
    organizationId: asOrganizationId(org),
    status: 'open',
    summaryPoints: [
      { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Confirm the booking' },
    ],
    notes: [],
    reminder: { paused: false },
    retention: {},
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function capabilityAudit(overrides: Partial<CreateAuditEventInput> = {}): CreateAuditEventInput {
  return {
    id: nextId('audit'),
    organizationId: org,
    actorKind: 'capability',
    capabilityId: 'cap_actor',
    assignmentId: 'asg_actor',
    action: 'task.clarification_requested',
    outcome: 'succeeded',
    recordedAt: now,
    ...overrides,
  };
}

function systemAudit(action: string, overrides: Partial<CreateAuditEventInput> = {}) {
  return {
    id: nextId('audit'),
    organizationId: org,
    actorKind: 'system',
    systemId: 'capability_expiry',
    action,
    outcome: 'succeeded',
    recordedAt: afterExpiry,
    ...overrides,
  } satisfies CreateAuditEventInput;
}

describeMaybe('A8.5d producers under contention on PostgreSQL 17', () => {
  /** Independent connections. Two workers are two processes; two clients is the closest analogue. */
  let a: DbClient;
  let b: DbClient;

  beforeAll(async () => {
    const url = assertLoopback(RAW_URL!);
    a = createPrismaClient(url);
    b = createPrismaClient(url);
    await Promise.all([a.$connect(), b.$connect()]);
  });

  afterAll(async () => {
    // Scoped to this run's organization, so a long-lived local database keeps no debris and a
    // parallel run of another suite is untouched.
    try {
      await a.ownerNotificationAttempt.deleteMany({ where: { organizationId: org } });
      await a.ownerNotificationIntent.deleteMany({ where: { organizationId: org } });
      await a.auditEvent.deleteMany({ where: { organizationId: org } });
    } finally {
      await Promise.all([a.$disconnect(), b.$disconnect()]);
    }
  });

  it('runs against PostgreSQL 17', async () => {
    const [{ version }] = await a.$queryRawUnsafe<{ version: string }[]>('SELECT version()');
    expect(version).toMatch(/PostgreSQL 17\./);
  });

  /** A Task with an active assignment, capability, and pending handoff attempt. */
  async function seedHandoff() {
    const taskId = nextId('task');
    const recipientId = nextId('rcp');
    const email = `${recipientId}@example.com`;
    const assignmentId = nextId('asg');
    const capabilityId = nextId('cap');
    const attemptId = nextId('att');

    await createRecipient(a, {
      organizationId: org,
      recipient: recipientFixture(recipientId, email),
    });
    const task = taskFixture(taskId);
    await createTask(a, org, task);

    const assignment: TaskAssignment = {
      id: asAssignmentId(assignmentId),
      recipientId: asRecipientId(recipientId),
      intendedRecipientEmail: email,
      assignedAt: now,
      assignedByOwnerId: asOwnerId(ownerId),
      allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
      capabilityStatus: 'active',
    };
    const capability: TaskCapability = {
      id: asCapabilityId(capabilityId),
      taskId: asTaskId(taskId),
      assignmentId: asAssignmentId(assignmentId),
      recipientId: asRecipientId(recipientId),
      intendedRecipientEmail: email,
      scope: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
      status: 'active',
      issuedAt: now,
      expiresAt,
      revokedAt: null,
    };

    const result = await beginInitialHandoff({
      db: a,
      organizationId: org,
      ownerId,
      expectedTaskVersion: task.version,
      task,
      assignment,
      capability,
      tokenHash: randomBytes(32).toString('hex'),
      attemptId,
      acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
      deliveryPath: 'assignment_email',
      idempotencyKey: nextId('idem'),
      requestFingerprint: computeHandoffRequestFingerprint(
        {
          organizationId: org,
          taskId: asTaskId(taskId),
          recipientId: asRecipientId(recipientId),
          acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
        },
        identityHandoffFingerprintHasher,
      ),
    });

    return { taskId, assignmentId, capabilityId, attemptId, task: result.task };
  }

  async function intentCount(subjectKind: string, subjectId: string): Promise<number> {
    return a.ownerNotificationIntent.count({
      where: { organizationId: org, subjectKind: subjectKind as never, subjectId },
    });
  }

  // -----------------------------------------------------------------------------------------
  // Task lifecycle: legitimate repeats admitted, retries refused
  // -----------------------------------------------------------------------------------------

  describe('clarification requests', () => {
    it('admits two concurrent requests that land on different Task versions', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const seeded = await seedHandoff();
        const base = seeded.task.version;

        // Sequential versions, concurrent commits: both are genuine events and both must survive.
        const [first, second] = await Promise.all([
          settle(
            persistCapabilityAction({
              db: a,
              organizationId: org,
              expectedVersion: base,
              task: { ...seeded.task, version: base + 1 },
              audit: capabilityAudit({ capabilityId: seeded.capabilityId }),
              ownerNotification: {
                id: nextId('onint'),
                eventType: 'task_clarification_requested',
              },
            }),
          ),
          settle(
            persistCapabilityAction({
              db: b,
              organizationId: org,
              expectedVersion: base,
              task: { ...seeded.task, version: base + 1 },
              audit: capabilityAudit({ capabilityId: seeded.capabilityId }),
              ownerNotification: {
                id: nextId('onint'),
                eventType: 'task_clarification_requested',
              },
            }),
          ),
        ]);

        // Both raced the same expected version, so optimistic concurrency admits exactly one.
        const winners = [first, second].filter((result) => result.ok);
        expect(winners, `round ${round}`).toHaveLength(1);
        expect(await intentCount('task', seeded.taskId), `round ${round}`).toBe(1);

        // The loser retries against the version the winner wrote, and that is a second real event.
        await persistCapabilityAction({
          db: b,
          organizationId: org,
          expectedVersion: base + 1,
          task: { ...seeded.task, version: base + 2 },
          audit: capabilityAudit({ capabilityId: seeded.capabilityId }),
          ownerNotification: { id: nextId('onint'), eventType: 'task_clarification_requested' },
        });
        expect(await intentCount('task', seeded.taskId), `round ${round}`).toBe(2);
      }
    });

    it('refuses a replayed transition without leaving the mutation behind', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const seeded = await seedHandoff();
        const target = { ...seeded.task, version: seeded.task.version + 1 };

        await persistCapabilityAction({
          db: a,
          organizationId: org,
          expectedVersion: seeded.task.version,
          task: target,
          audit: capabilityAudit({ capabilityId: seeded.capabilityId }),
          ownerNotification: { id: nextId('onint'), eventType: 'task_clarification_requested' },
        });

        const replayAudit = capabilityAudit({ capabilityId: seeded.capabilityId });
        const replay = await settle(
          persistCapabilityAction({
            db: b,
            organizationId: org,
            expectedVersion: target.version,
            task: { ...target },
            audit: replayAudit,
            ownerNotification: { id: nextId('onint'), eventType: 'task_clarification_requested' },
          }),
        );

        expect(replay.ok, `round ${round}`).toBe(false);
        expect(await intentCount('task', seeded.taskId), `round ${round}`).toBe(1);
        // The unique violation aborted the whole unit of work, audit row included.
        expect(await a.auditEvent.count({ where: { id: replayAudit.id } }), `round ${round}`).toBe(
          0,
        );
      }
    });
  });

  describe('return to owner', () => {
    it('gives two concurrent returns exactly one intent', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const seeded = await seedHandoff();
        const returned = {
          ...seeded.task,
          version: seeded.task.version + 1,
          assignment: undefined,
        } as Task;

        const input = (db: DbClient) => ({
          db,
          organizationId: org,
          expectedVersion: seeded.task.version,
          task: returned,
          capabilityId: seeded.capabilityId,
          revokedAt: now,
          audit: capabilityAudit({
            action: 'task.returned_to_owner',
            capabilityId: seeded.capabilityId,
          }),
          ownerNotification: { id: nextId('onint') },
        });

        const results = await Promise.all([
          settle(persistReturnToOwner(input(a))),
          settle(persistReturnToOwner(input(b))),
        ]);

        expect(
          results.filter((result) => result.ok),
          `round ${round}`,
        ).toHaveLength(1);
        expect(await intentCount('task', seeded.taskId), `round ${round}`).toBe(1);
      }
    });
  });

  // -----------------------------------------------------------------------------------------
  // Terminal handoff failure
  // -----------------------------------------------------------------------------------------

  describe('terminal handoff failure', () => {
    it('gives two concurrent handlers exactly one intent', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const seeded = await seedHandoff();

        const input = (db: DbClient) => ({
          db,
          organizationId: org,
          attemptId: seeded.attemptId,
          failureCode: 'provider_rejected',
          failureCategory: 'provider' as const,
          failureFingerprint: `fp_${seeded.attemptId}`,
          retryable: false,
          expectedSendGeneration: 1,
          ownerNotification: { id: nextId('onint'), systemId: 'handoff_delivery' },
        });

        await Promise.all([
          settle(markHandoffDeliveryFailed(input(a))),
          settle(markHandoffDeliveryFailed(input(b))),
        ]);

        expect(await intentCount('handoff_attempt', seeded.attemptId), `round ${round}`).toBe(1);
      }
    });
  });

  // -----------------------------------------------------------------------------------------
  // Gmail channel transitions
  // -----------------------------------------------------------------------------------------

  describe('gmail channel', () => {
    async function seedConnectedAccount() {
      const accountId = nextId('cacc');
      // One Gmail account per organization, so each case gets an organization of its own.
      const gmailOrg = `${org}_${accountId}`;
      const account = {
        organizationId: gmailOrg,
        accountId,
        emailAddress: `${accountId}@example.com`,
        externalAccountId: `ext_${accountId}`,
      };
      await createOrUpdatePendingCommunicationAccount(a, account);
      await persistConnectedCommunicationAccount(a, { ...account, connectedAt: now });
      return { accountId, gmailOrg };
    }

    it('gives two workers observing one outage exactly one intent', async () => {
      for (let round = 0; round < 5; round += 1) {
        const { accountId, gmailOrg } = await seedConnectedAccount();

        const input = (db: DbClient) => ({
          db,
          organizationId: gmailOrg,
          accountId,
          transition: 'needs_reauth' as const,
          errorCode: 'invalid_grant',
          at: now,
          audit: systemAudit('gmail.connection.needs_reauth', {
            organizationId: gmailOrg,
            systemId: 'gmail_channel',
            outcome: 'failed',
          }),
          ownerNotification: { id: nextId('onint'), systemId: 'gmail_channel' },
        });

        const results = await Promise.all([
          settle(persistGmailChannelUnavailableTransaction(input(a))),
          settle(persistGmailChannelUnavailableTransaction(input(b))),
        ]);

        // The compare-and-set on `connected` decides it; the loser writes nothing rather than
        // failing, because a re-observation is not an error.
        const transitioned = results.filter(
          (result) => result.ok && result.value.transitioned === true,
        );
        expect(transitioned, `round ${round}`).toHaveLength(1);

        const count = await a.ownerNotificationIntent.count({
          where: { organizationId: gmailOrg, subjectId: accountId },
        });
        expect(count, `round ${round}`).toBe(1);

        await a.ownerNotificationIntent.deleteMany({ where: { organizationId: gmailOrg } });
        await a.auditEvent.deleteMany({ where: { organizationId: gmailOrg } });
      }
    });
  });

  // -----------------------------------------------------------------------------------------
  // Reminder settlement
  // -----------------------------------------------------------------------------------------

  describe('reminder settlement', () => {
    /** An active schedule with one armed overdue occurrence and an assignment. */
    async function seedSchedule() {
      const key = nextId('rem');
      const taskId = `task_${key}`;
      const establishedAt = '2026-08-01T12:00:00.000Z';

      await upsertRecipient(a, {
        organizationId: org,
        recipient: recipientFixture(`rcp_${taskId}`, `rcp_${taskId}@example.com`),
      });
      const task: Task = {
        ...taskFixture(taskId),
        createdAt: establishedAt,
        updatedAt: establishedAt,
        assignment: {
          id: asAssignmentId(`asg_${key}`),
          recipientId: asRecipientId(`rcp_${taskId}`),
          intendedRecipientEmail: `rcp_${taskId}@example.com`,
          assignedAt: establishedAt,
          assignedByOwnerId: asOwnerId(ownerId),
          allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
        },
      };
      await createTask(a, org, task, task.assignment);

      const dueLocalDate = parseLocalDate('2026-08-10');
      const advance = decideAdvanceReminder({ dueLocalDate, establishedAt });
      const overdue = selectNextOverdueOccurrence({ dueLocalDate, now: establishedAt });

      const { schedule } = await persistEstablishedReminderSchedule({
        db: a,
        schedule: {
          id: `sched_${key}`,
          organizationId: org,
          taskId,
          dueLocalDate,
          schedulingTimeZone: REMINDER_SCHEDULING_TIME_ZONE,
          establishedAt,
          advanceDisposition: advance.kind === 'scheduled' ? 'scheduled' : 'skipped_window_elapsed',
          advanceOccurrence: {
            occurrenceLocalDate: advance.occurrenceLocalDate,
            occurrenceAt: advance.occurrenceAt,
          },
          nextOverdueOccurrence: {
            occurrenceLocalDate: overdue.occurrenceLocalDate,
            occurrenceAt: overdue.occurrenceAt,
          },
        },
      });

      return { key, taskId, schedule, overdue };
    }

    /** Terminalize an overdue occurrence without settling it, leaving settlement to the race. */
    async function terminalUnsettled(
      seeded: Awaited<ReturnType<typeof seedSchedule>>,
      outcome: 'permanent_failure' | 'skipped',
      skipReason?: 'no_active_assignment',
    ) {
      const attemptId = `att_${seeded.key}`;
      const claim = await claimReminderOccurrence(a, {
        id: attemptId,
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: seeded.schedule.generation,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seeded.overdue.occurrenceLocalDate,
        occurrenceAt: seeded.overdue.occurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: seeded.overdue.occurrenceAt,
        claimExpiresAt: '2099-01-01T00:00:00.000Z',
        now: seeded.overdue.occurrenceAt,
        maxAttempts: 3,
      });
      if (!claim.claimed) throw new Error('could not claim the occurrence');

      if (outcome === 'permanent_failure') {
        await markProviderCallStarted(a, {
          organizationId: org,
          attemptId,
          claimSequence: claim.claimSequence,
          startedAt: seeded.overdue.occurrenceAt,
        });
      }

      await terminalizeReminderOccurrence({
        db: a,
        organizationId: org,
        attemptId,
        scheduleId: seeded.schedule.id,
        expectedGeneration: seeded.schedule.generation,
        claimSequence: claim.claimSequence,
        outcome,
        completedAt: seeded.overdue.occurrenceAt,
        failureCode: outcome === 'permanent_failure' ? 'recipient_rejected' : null,
        skipReason: skipReason ?? null,
        nextOverdueOccurrence: null,
      });

      return attemptId;
    }

    it('gives two workers settling one stop exactly one intent', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const seeded = await seedSchedule();
        const attemptId = await terminalUnsettled(seeded, 'permanent_failure');

        const input = (db: DbClient) => ({
          db,
          organizationId: org,
          attemptId,
          settledAt: seeded.overdue.occurrenceAt,
          nextOverdueOccurrence: null,
          ownerNotification: { id: nextId('onint'), systemId: 'reminder_engine' },
        });

        await Promise.all([
          settle(settleReminderOccurrenceSchedule(input(a))),
          settle(settleReminderOccurrenceSchedule(input(b))),
        ]);

        const intents = await a.ownerNotificationIntent.findMany({
          where: { organizationId: org, subjectId: seeded.schedule.id },
        });
        expect(intents, `round ${round}`).toHaveLength(1);
        expect(intents[0].eventType).toBe('reminder_schedule_stopped_permanent_failure');
        expect(intents[0].occurrenceKey).toBe(String(seeded.schedule.generation));

        // And the reminder decision underneath is still the one A8.4b makes.
        const schedule = await a.taskReminderSchedule.findUniqueOrThrow({
          where: { id: seeded.schedule.id },
        });
        expect(schedule.status, `round ${round}`).toBe('stopped');
        expect(schedule.stopReason).toBe('permanent_delivery_failure');
      }
    });

    it('gives two workers settling one unassigned skip exactly one intent', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const seeded = await seedSchedule();
        await a.taskAssignment.updateMany({
          where: { organizationId: org, taskId: seeded.taskId, clearedAt: null },
          data: { clearedAt: new Date(seeded.overdue.occurrenceAt) },
        });
        const attemptId = await terminalUnsettled(seeded, 'skipped', 'no_active_assignment');

        const input = (db: DbClient) => ({
          db,
          organizationId: org,
          attemptId,
          settledAt: seeded.overdue.occurrenceAt,
          nextOverdueOccurrence: null,
          ownerNotification: { id: nextId('onint'), systemId: 'reminder_engine' },
        });

        await Promise.all([
          settle(settleReminderOccurrenceSchedule(input(a))),
          settle(settleReminderOccurrenceSchedule(input(b))),
        ]);

        const intents = await a.ownerNotificationIntent.findMany({
          where: { organizationId: org, subjectId: seeded.schedule.id },
        });
        expect(intents, `round ${round}`).toHaveLength(1);
        expect(intents[0].eventType).toBe('reminder_no_active_assignment');
        // Once per generation, which is what the identity enforces.
        expect(intents[0].occurrenceKey).toBe(String(seeded.schedule.generation));
      }
    });
  });

  // -----------------------------------------------------------------------------------------
  // Capability expiry
  // -----------------------------------------------------------------------------------------

  describe('capability expiry', () => {
    it('gives two racing sweep workers one transition, one audit, and one intent', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const seeded = await seedHandoff();

        const input = (db: DbClient) => ({
          db,
          organizationId: org,
          capabilityId: seeded.capabilityId,
          at: afterExpiry,
          audit: systemAudit('capability.expired', { capabilityId: seeded.capabilityId }),
          ownerNotification: { id: nextId('onint') },
        });

        const first = input(a);
        const second = input(b);
        const results = await Promise.all([
          settle(observeCapabilityExpiry(first)),
          settle(observeCapabilityExpiry(second)),
        ]);

        const winners = results.filter((result) => result.ok && result.value.expired === true);
        expect(winners, `round ${round}`).toHaveLength(1);

        expect(await intentCount('task_capability', seeded.capabilityId), `round ${round}`).toBe(1);
        const audits = await a.auditEvent.count({
          where: { id: { in: [first.audit.id, second.audit.id] } },
        });
        expect(audits, `round ${round}`).toBe(1);

        const capability = await getCapabilityById(a, org, seeded.capabilityId);
        expect(capability.status, `round ${round}`).toBe('expired');
      }
    });

    it('gives a sweep racing lazy validation the same single set of facts', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const seeded = await seedHandoff();

        // Both call paths converge on the same transaction, which is the whole point of extracting
        // it: a Recipient's click and a worker's scan are two observers of one fact.
        const sweep = {
          db: a,
          organizationId: org,
          capabilityId: seeded.capabilityId,
          at: afterExpiry,
          audit: systemAudit('capability.expired', { capabilityId: seeded.capabilityId }),
          ownerNotification: { id: nextId('onint') },
        };
        const validator = {
          db: b,
          organizationId: org,
          capabilityId: seeded.capabilityId,
          // A Recipient presenting the token a moment later. A different instant, the same fact.
          at: '2026-08-12T12:00:05.000Z',
          audit: systemAudit('capability.expired', { capabilityId: seeded.capabilityId }),
          ownerNotification: { id: nextId('onint') },
        };

        const results = await Promise.all([
          settle(observeCapabilityExpiry(sweep)),
          settle(observeCapabilityExpiry(validator)),
        ]);

        expect(
          results.filter((result) => result.ok && result.value.expired === true),
          `round ${round}`,
        ).toHaveLength(1);
        expect(await intentCount('task_capability', seeded.capabilityId), `round ${round}`).toBe(1);
        expect(
          await a.auditEvent.count({
            where: { id: { in: [sweep.audit.id, validator.audit.id] } },
          }),
          `round ${round}`,
        ).toBe(1);
      }
    });

    it('does not expire a revoked capability, however many observers look at it', async () => {
      const seeded = await seedHandoff();
      await revokeCapabilityRecord(a, org, seeded.capabilityId, now, 'assignment_ended');

      const results = await Promise.all([
        settle(
          observeCapabilityExpiry({
            db: a,
            organizationId: org,
            capabilityId: seeded.capabilityId,
            at: afterExpiry,
            audit: systemAudit('capability.expired'),
            ownerNotification: { id: nextId('onint') },
          }),
        ),
        settle(
          observeCapabilityExpiry({
            db: b,
            organizationId: org,
            capabilityId: seeded.capabilityId,
            at: afterExpiry,
            audit: systemAudit('capability.expired'),
            ownerNotification: { id: nextId('onint') },
          }),
        ),
      ]);

      expect(results.every((result) => result.ok && result.value.expired === false)).toBe(true);
      expect((await getCapabilityById(a, org, seeded.capabilityId)).status).toBe('revoked');
      expect(await intentCount('task_capability', seeded.capabilityId)).toBe(0);
    });

    it('does not re-emit an expiry that has already been observed', async () => {
      const seeded = await seedHandoff();
      await observeCapabilityExpiry({
        db: a,
        organizationId: org,
        capabilityId: seeded.capabilityId,
        at: afterExpiry,
        audit: systemAudit('capability.expired'),
        ownerNotification: { id: nextId('onint') },
      });

      const laterAudit = systemAudit('capability.expired');
      const again = await observeCapabilityExpiry({
        db: b,
        organizationId: org,
        capabilityId: seeded.capabilityId,
        at: '2026-08-20T00:00:00.000Z',
        audit: laterAudit,
        ownerNotification: { id: nextId('onint') },
      });

      expect(again.expired).toBe(false);
      expect(await intentCount('task_capability', seeded.capabilityId)).toBe(1);
      expect(await a.auditEvent.count({ where: { id: laterAudit.id } })).toBe(0);
    });

    it('expires durably with capture off, touching no A8.5 table', async () => {
      const seeded = await seedHandoff();

      const result = await observeCapabilityExpiry({
        db: a,
        organizationId: org,
        capabilityId: seeded.capabilityId,
        at: afterExpiry,
        audit: systemAudit('capability.expired'),
      });

      // Authorization truth must never depend on whether a notification could be recorded.
      expect(result.expired).toBe(true);
      expect(await intentCount('task_capability', seeded.capabilityId)).toBe(0);
    });
  });
});
