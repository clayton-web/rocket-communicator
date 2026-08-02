// @vitest-environment node
/**
 * A8.5a Owner Event Notification capture (D133, D135).
 *
 * What this suite is actually trying to establish, in order of how much it would hurt to get wrong:
 *
 *  1. With the flag off, a Task mutation never touches an A8.5 table. Production runs
 *     `persistCapabilityAction` on every Task mutation and the A8.5 migration is not applied there,
 *     so a stray query is not a missing feature — it is a broken production mutation.
 *  2. A Recipient completion records exactly one intent, and an Owner completion records none.
 *  3. The intent tells the truth about who acted, matching the audit row written beside it.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CAPABILITY_TTL_MS,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  ownerActor,
  type Recipient,
} from '@aicaa/domain';
import * as aicaaDb from '@aicaa/db/runtime';
import { listAuditEventsForTask, upsertRecipient, type DbClient } from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { resetDbRuntimeForTests, setDbRuntimeForTests } from '@/lib/db/runtime-db';
import {
  addCapabilityTaskNote,
  completeCapabilityTask,
  issueCapabilityForTask,
} from '@/lib/capability';
import { completeOwnerTask, createOwnerTask } from '@/lib/tasks';
import {
  ENABLE_OWNER_EVENT_CAPTURE_ENV,
  isOwnerEventCaptureEnabled,
} from '@/lib/notifications/capture-config';
import { seedAssignedTaskViaService } from './helpers/seed-assigned-task';

const org = 'org_a85a_capture';
const now = '2026-08-03T17:00:00.000Z';
const pepper = 'capability-pepper-value-32chars!!';
const appUrl = 'http://localhost:3000';
const owner = ownerActor(asOwnerId('owner_a85a'), asOrganizationId(org));

const summaryPoints = [
  { id: 'p1', kind: 'next_action' as const, label: 'Act', order: 0, value: 'Do the work' },
];

function recipient(): Recipient {
  return {
    id: asRecipientId('rcp_a85a'),
    displayName: 'A8.5a Recipient',
    email: 'a85a-recipient@example.com',
    active: true,
  };
}

/**
 * A client that refuses to let anything reach an A8.5 table, transactions included.
 *
 * Asserting `count() === 0` afterwards would only prove no row was *written*; the production hazard
 * is the statement itself, against a table that does not exist there. The wrapper also re-guards the
 * transaction client, because that is where `persistCapabilityAction` does all its work.
 */
function forbidNotificationTables(client: DbClient): DbClient {
  const forbidden = new Set(['ownerNotificationIntent', 'ownerNotificationAttempt']);

  const guard = (target: unknown): unknown =>
    new Proxy(target as object, {
      get(inner, property) {
        if (typeof property === 'string' && forbidden.has(property)) {
          throw new Error(
            `A8.5 table "${property}" was reached with ENABLE_OWNER_EVENT_CAPTURE disabled.`,
          );
        }
        const value = Reflect.get(inner, property);
        if (property === '$transaction' && typeof value === 'function') {
          return (callback: (tx: unknown) => unknown, ...rest: unknown[]) =>
            (value as (...a: unknown[]) => unknown).call(
              inner,
              (tx: unknown) => callback(guard(tx)),
              ...rest,
            );
        }
        return typeof value === 'function' ? (value as () => unknown).bind(inner) : value;
      },
    });

  return guard(client) as DbClient;
}

describe('A8.5a Owner event capture', () => {
  let db: TestDatabase;
  const originalFlag = process.env[ENABLE_OWNER_EVENT_CAPTURE_ENV];

  beforeAll(async () => {
    db = await createTestDatabase();
    setDbRuntimeForTests(aicaaDb);
  });

  afterAll(async () => {
    await db.close();
    resetDbRuntimeForTests();
  });

  beforeEach(async () => {
    await db.prisma.ownerNotificationAttempt.deleteMany();
    await db.prisma.ownerNotificationIntent.deleteMany();
    await db.prisma.auditEvent.deleteMany();
    await db.prisma.taskCapability.deleteMany();
    await db.prisma.taskNote.deleteMany();
    await db.prisma.taskAssignment.deleteMany();
    await db.prisma.taskSuggestion.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.recipient.deleteMany();
    delete process.env[ENABLE_OWNER_EVENT_CAPTURE_ENV];
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env[ENABLE_OWNER_EVENT_CAPTURE_ENV];
    } else {
      process.env[ENABLE_OWNER_EVENT_CAPTURE_ENV] = originalFlag;
    }
  });

  async function seedAssignedIssued(taskId: string, client: DbClient = db.prisma) {
    await upsertRecipient(db.prisma, { organizationId: org, recipient: recipient() });
    const created = await seedAssignedTaskViaService({
      db: client,
      org,
      owner,
      now,
      summaryPoints,
      taskId,
      assignmentId: `asg_${taskId}`,
      recipientId: 'rcp_a85a',
      recipientEmail: 'a85a-recipient@example.com',
    });
    const issued = await issueCapabilityForTask({
      db: client,
      owner,
      taskId: created.task.id,
      ttlMs: DEFAULT_CAPABILITY_TTL_MS,
      pepper,
      appUrl,
      now,
      expectedVersion: created.task.version,
      capabilityId: `cap_${taskId}` as never,
    });
    return issued;
  }

  describe('the flag is opt-in by exact string', () => {
    it('enables capture only for "true"', () => {
      expect(isOwnerEventCaptureEnabled({ ENABLE_OWNER_EVENT_CAPTURE: 'true' })).toBe(true);
    });

    it.each(['1', 'TRUE', 'True', 'yes', 'on', ' true', 'true ', '"true"', 'false', ''])(
      'leaves capture disabled for %o',
      (value) => {
        expect(isOwnerEventCaptureEnabled({ ENABLE_OWNER_EVENT_CAPTURE: value })).toBe(false);
      },
    );

    it('leaves capture disabled when the variable is absent', () => {
      expect(isOwnerEventCaptureEnabled({})).toBe(false);
    });
  });

  describe('with capture disabled', () => {
    it('completes a Task without reaching either A8.5 table', async () => {
      const guarded = forbidNotificationTables(db.prisma);
      const issued = await seedAssignedIssued('task_a85a_off', guarded);

      const completed = await completeCapabilityTask({
        db: guarded,
        rawToken: issued.rawToken,
        pepper,
        taskId: 'task_a85a_off',
        now,
        expectedVersion: issued.task.version,
        outcomeType: 'completed',
      });

      expect(completed.task.status).toBe('completed');
      expect(await db.prisma.ownerNotificationIntent.count()).toBe(0);
    });
  });

  describe('with capture enabled', () => {
    beforeEach(() => {
      process.env[ENABLE_OWNER_EVENT_CAPTURE_ENV] = 'true';
    });

    it('records exactly one intent for a Recipient completion', async () => {
      const issued = await seedAssignedIssued('task_a85a_on');

      const completed = await completeCapabilityTask({
        db: db.prisma,
        rawToken: issued.rawToken,
        pepper,
        taskId: 'task_a85a_on',
        now,
        expectedVersion: issued.task.version,
        outcomeType: 'completed',
      });

      const intents = await db.prisma.ownerNotificationIntent.findMany();
      expect(intents).toHaveLength(1);
      expect(intents[0]).toMatchObject({
        organizationId: org,
        eventType: 'task_completed_by_recipient',
        subjectKind: 'task',
        subjectId: 'task_a85a_on',
        state: 'pending',
        attemptCount: 0,
        claimSequence: 0,
        claimedBy: null,
        settledAt: null,
        suppressionReason: null,
      });
      // The identity is the post-mutation version, so a retry of this transition collides.
      expect(intents[0]!.occurrenceKey).toBe(String(completed.task.version));
    });

    it('attributes the intent to the capability, not to the Owner who will read it', async () => {
      const issued = await seedAssignedIssued('task_a85a_actor');

      await completeCapabilityTask({
        db: db.prisma,
        rawToken: issued.rawToken,
        pepper,
        taskId: 'task_a85a_actor',
        now,
        expectedVersion: issued.task.version,
        outcomeType: 'completed',
      });

      const intent = await db.prisma.ownerNotificationIntent.findFirstOrThrow();
      const audits = await listAuditEventsForTask(db.prisma, org, 'task_a85a_actor');
      const causing = audits.find((event) => event.id === intent.auditEventId);

      expect(causing?.action).toBe('complete_task');
      expect(intent.actorKind).toBe('capability');
      expect(intent.ownerId).toBeNull();
      expect(intent.capabilityId).toBe('cap_task_a85a_actor');
      expect(intent.capabilityId).toBe(causing?.capabilityId);
      expect(intent.assignmentId).toBe(causing?.assignmentId);
      expect(intent.occurredAt.toISOString()).toBe(causing?.recordedAt);
    });

    it('records no intent for an Owner completion of the same Task', async () => {
      const created = await createOwnerTask({
        db: db.prisma,
        owner,
        now,
        summaryPoints,
        taskId: 'task_a85a_owner',
      });

      await completeOwnerTask({
        db: db.prisma,
        owner,
        now,
        taskId: 'task_a85a_owner',
        expectedVersion: created.task.version,
        outcomeType: 'completed',
      });

      expect(await db.prisma.ownerNotificationIntent.count()).toBe(0);
    });

    it('records no intent for a capability action outside the A8.5a producer', async () => {
      const issued = await seedAssignedIssued('task_a85a_note');

      await addCapabilityTaskNote({
        db: db.prisma,
        rawToken: issued.rawToken,
        pepper,
        taskId: 'task_a85a_note',
        now,
        expectedVersion: issued.task.version,
        body: 'Making progress.',
      });

      expect(await db.prisma.ownerNotificationIntent.count()).toBe(0);
    });

    it('leaves no intent behind when the mutation is rejected', async () => {
      const issued = await seedAssignedIssued('task_a85a_rollback');

      await expect(
        completeCapabilityTask({
          db: db.prisma,
          rawToken: issued.rawToken,
          pepper,
          taskId: 'task_a85a_rollback',
          now,
          // Stale version: the precondition fails before anything is written.
          expectedVersion: issued.task.version + 5,
          outcomeType: 'completed',
        }),
      ).rejects.toThrow();

      expect(await db.prisma.ownerNotificationIntent.count()).toBe(0);
    });
  });
});
