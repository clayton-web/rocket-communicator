/**
 * A8.5d producers: the nine remaining ratified events, at their transactions (D133–D136).
 *
 * A8.5a proved that an intent can be stored and that its identity refuses a duplicate. It said
 * nothing about whether the right transaction writes the right intent, which is the whole question
 * here, and the question every one of these events gets wrong in a different way if nobody checks:
 *
 *  - Does the intent commit with the transition, or survive its rollback?
 *  - Is the actor the one who caused the event, or the one who happens to be reading it?
 *  - Does a retry of the same transition collide, while a genuine later event does not?
 *  - With capture off, does the transaction behave exactly as A8.4b and A7 already made it behave?
 *
 * PGlite answers all four on one connection. What it cannot answer is what two connections do to
 * each other, so every race lives in `a8-5d-notification-producers.pg.test.ts` instead.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  HANDOFF_ACKNOWLEDGEMENT_V1,
  asAssignmentId,
  asCapabilityId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  computeHandoffRequestFingerprint,
  identityHandoffFingerprintHasher,
  type Recipient,
  type Task,
  type TaskAssignment,
  type TaskCapability,
} from '@aicaa/domain';
import {
  beginInitialHandoff,
  createOrUpdatePendingCommunicationAccount,
  createRecipient,
  createTask,
  getCapabilityById,
  listOwnerNotificationIntentsForSubject,
  markHandoffDeliveryFailed,
  observeCapabilityExpiry,
  persistCapabilityAction,
  persistConnectedCommunicationAccount,
  persistGmailChannelUnavailableTransaction,
  persistReturnToOwner,
  revokeCapabilityRecord,
  type CreateAuditEventInput,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const org = 'org_a85d';
const ownerId = 'owner_a85d';
const now = '2026-08-05T12:00:00.000Z';
const expiresAt = '2026-08-12T12:00:00.000Z';
/** After `expiresAt`, so a sweep at this instant finds the capability genuinely lapsed. */
const afterExpiry = '2026-08-12T12:00:01.000Z';

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_a85d_${seq}`;
}

function tokenHash(): string {
  seq += 1;
  return seq.toString(16).padStart(64, '0');
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

describe('A8.5d owner notification producers', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.prisma.ownerNotificationAttempt.deleteMany();
    await db.prisma.ownerNotificationIntent.deleteMany();
  });

  /** A Task with an active assignment, capability, and pending handoff attempt. */
  async function seedHandoff() {
    const taskId = nextId('task');
    const recipientId = nextId('rcp');
    const email = `${recipientId}@example.com`;
    const assignmentId = nextId('asg');
    const capabilityId = nextId('cap');
    const attemptId = nextId('att');

    await createRecipient(db.prisma, {
      organizationId: org,
      recipient: recipientFixture(recipientId, email),
    });
    const task = taskFixture(taskId);
    await createTask(db.prisma, org, task);

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
      db: db.prisma,
      organizationId: org,
      ownerId,
      expectedTaskVersion: task.version,
      task,
      assignment,
      capability,
      tokenHash: tokenHash(),
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

  async function intentsFor(subjectKind: string, subjectId: string, organizationId: string = org) {
    return listOwnerNotificationIntentsForSubject(
      db.prisma,
      organizationId,
      subjectKind as never,
      subjectId,
    );
  }

  // -----------------------------------------------------------------------------------------
  // task.clarification_requested
  // -----------------------------------------------------------------------------------------

  describe('task.clarification_requested', () => {
    it('commits the intent with the mutation, attributed to the capability that asked', async () => {
      const seeded = await seedHandoff();
      const intentId = nextId('onint');
      const audit = capabilityAudit({ capabilityId: seeded.capabilityId });

      const result = await persistCapabilityAction({
        db: db.prisma,
        organizationId: org,
        expectedVersion: seeded.task.version,
        task: { ...seeded.task, version: seeded.task.version + 1, updatedAt: now },
        audit,
        ownerNotification: { id: intentId, eventType: 'task_clarification_requested' },
      });

      const [intent] = await intentsFor('task', seeded.taskId);
      expect(intent).toMatchObject({
        id: intentId,
        eventType: 'task_clarification_requested',
        subjectKind: 'task',
        subjectId: seeded.taskId,
        // The post-mutation version, so this transition's identity is this transition's.
        occurrenceKey: String(result.task.version),
        state: 'pending',
        // Not the Owner, who is merely the audience.
        actorKind: 'capability',
        capabilityId: seeded.capabilityId,
        auditEventId: audit.id,
      });
      expect(intent.occurredAt).toBe(audit.recordedAt);
    });

    it('admits a second, genuinely later clarification at the next version', async () => {
      const seeded = await seedHandoff();
      let version = seeded.task.version;

      for (const id of [nextId('onint'), nextId('onint')]) {
        version += 1;
        await persistCapabilityAction({
          db: db.prisma,
          organizationId: org,
          expectedVersion: version - 1,
          task: { ...seeded.task, version, updatedAt: now },
          audit: capabilityAudit({ capabilityId: seeded.capabilityId }),
          ownerNotification: { id, eventType: 'task_clarification_requested' },
        });
      }

      const intents = await intentsFor('task', seeded.taskId);
      expect(intents).toHaveLength(2);
      expect(intents.map((row) => row.occurrenceKey).sort()).toEqual([
        String(seeded.task.version + 1),
        String(seeded.task.version + 2),
      ]);
    });

    it('refuses a replay of the same transition, and rolls the mutation back with it', async () => {
      const seeded = await seedHandoff();
      const target = { ...seeded.task, version: seeded.task.version + 1, updatedAt: now };

      await persistCapabilityAction({
        db: db.prisma,
        organizationId: org,
        expectedVersion: seeded.task.version,
        task: target,
        audit: capabilityAudit({ capabilityId: seeded.capabilityId }),
        ownerNotification: { id: nextId('onint'), eventType: 'task_clarification_requested' },
      });

      const replayAudit = capabilityAudit({ capabilityId: seeded.capabilityId });
      await expect(
        persistCapabilityAction({
          db: db.prisma,
          organizationId: org,
          // The optimistic-concurrency guard would reject this first in practice. Forcing past it
          // proves the identity is a second, independent line of defence rather than decoration.
          expectedVersion: target.version,
          task: { ...target, version: target.version },
          audit: replayAudit,
          ownerNotification: { id: nextId('onint'), eventType: 'task_clarification_requested' },
        }),
      ).rejects.toThrow();

      expect(await intentsFor('task', seeded.taskId)).toHaveLength(1);
      // The whole unit of work rolled back, so the refused notification took its audit row with it.
      const audits = await db.prisma.auditEvent.findMany({ where: { id: replayAudit.id } });
      expect(audits).toHaveLength(0);
    });

    it('writes nothing to either A8.5 table when capture is off', async () => {
      const seeded = await seedHandoff();

      const result = await persistCapabilityAction({
        db: db.prisma,
        organizationId: org,
        expectedVersion: seeded.task.version,
        task: { ...seeded.task, version: seeded.task.version + 1, updatedAt: now },
        audit: capabilityAudit({ capabilityId: seeded.capabilityId }),
      });

      expect(result.task.version).toBe(seeded.task.version + 1);
      expect(await intentsFor('task', seeded.taskId)).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------------------------
  // task.returned_to_owner
  // -----------------------------------------------------------------------------------------

  describe('task.returned_to_owner', () => {
    it('commits the intent with the return, keeping the capability actor that caused it', async () => {
      const seeded = await seedHandoff();
      const intentId = nextId('onint');
      const audit = capabilityAudit({
        action: 'task.returned_to_owner',
        capabilityId: seeded.capabilityId,
        assignmentId: seeded.assignmentId,
      });

      const returned = { ...seeded.task, version: seeded.task.version + 1, assignment: undefined };
      await persistReturnToOwner({
        db: db.prisma,
        organizationId: org,
        expectedVersion: seeded.task.version,
        task: returned as Task,
        capabilityId: seeded.capabilityId,
        revokedAt: now,
        audit,
        ownerNotification: { id: intentId },
      });

      const [intent] = await intentsFor('task', seeded.taskId);
      expect(intent).toMatchObject({
        id: intentId,
        eventType: 'task_returned_to_owner',
        occurrenceKey: String(seeded.task.version + 1),
        // Read from the audit input, not from the assignment this transaction just cleared.
        actorKind: 'capability',
        capabilityId: seeded.capabilityId,
        assignmentId: seeded.assignmentId,
        auditEventId: audit.id,
      });
    });

    it('writes no intent when capture is off', async () => {
      const seeded = await seedHandoff();
      const returned = { ...seeded.task, version: seeded.task.version + 1, assignment: undefined };

      await persistReturnToOwner({
        db: db.prisma,
        organizationId: org,
        expectedVersion: seeded.task.version,
        task: returned as Task,
        capabilityId: seeded.capabilityId,
        revokedAt: now,
        audit: capabilityAudit({ action: 'task.returned_to_owner' }),
      });

      expect(await intentsFor('task', seeded.taskId)).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------------------------
  // handoff.delivery_failed
  // -----------------------------------------------------------------------------------------

  describe('handoff.delivery_failed', () => {
    async function fail(
      attemptId: string,
      retryable: boolean,
      intentId: string | null,
      sendGeneration = 1,
    ) {
      return markHandoffDeliveryFailed({
        db: db.prisma,
        organizationId: org,
        attemptId,
        failureCode: 'provider_rejected',
        failureCategory: 'provider',
        failureFingerprint: `fp_${attemptId}_${sendGeneration}`,
        retryable,
        expectedSendGeneration: sendGeneration,
        ownerNotification:
          intentId === null ? undefined : { id: intentId, systemId: 'handoff_delivery' },
      });
    }

    it('notifies on a terminal failure, attributed to the system that observed it', async () => {
      const seeded = await seedHandoff();
      const intentId = nextId('onint');

      await fail(seeded.attemptId, false, intentId);

      const [intent] = await intentsFor('handoff_attempt', seeded.attemptId);
      expect(intent).toMatchObject({
        id: intentId,
        eventType: 'handoff_delivery_failed',
        subjectKind: 'handoff_attempt',
        subjectId: seeded.attemptId,
        // The attempt id is already unique and already terminal, so it is the occurrence.
        occurrenceKey: seeded.attemptId,
        // A provider refusing a message is not something the Owner did, even though the A7 audit for
        // the handoff request itself is Owner-attributed.
        actorKind: 'system',
        systemId: 'handoff_delivery',
        ownerId: null,
        capabilityId: null,
      });
    });

    it('stays silent on a retryable failure Rocket still intends to retry', async () => {
      const seeded = await seedHandoff();

      await fail(seeded.attemptId, true, nextId('onint'));

      expect(await intentsFor('handoff_attempt', seeded.attemptId)).toHaveLength(0);
    });

    it('creates no second intent when the same terminal failure is replayed', async () => {
      const seeded = await seedHandoff();

      await fail(seeded.attemptId, false, nextId('onint'));
      // Idempotent replay: the attempt is already `failed`, so the transaction returns it unchanged.
      await fail(seeded.attemptId, false, nextId('onint'));

      expect(await intentsFor('handoff_attempt', seeded.attemptId)).toHaveLength(1);
    });

    it('persists no recipient address, provider body, or MIME anywhere on the intent', async () => {
      const seeded = await seedHandoff();
      await fail(seeded.attemptId, false, nextId('onint'));

      const [intent] = await intentsFor('handoff_attempt', seeded.attemptId);
      const serialized = JSON.stringify(intent);
      expect(serialized).not.toContain('@example.com');
      expect(serialized).not.toContain('provider_rejected');
    });

    it('writes no intent when capture is off', async () => {
      const seeded = await seedHandoff();
      await fail(seeded.attemptId, false, null);
      expect(await intentsFor('handoff_attempt', seeded.attemptId)).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------------------------
  // gmail.disconnected
  // -----------------------------------------------------------------------------------------

  describe('gmail.disconnected', () => {
    /**
     * A connected mailbox in an organization of its own. `organizationId_provider` is unique, so one
     * organization can hold exactly one Gmail account and these tests would otherwise collide.
     */
    async function seedConnectedAccount() {
      const accountId = nextId('cacc');
      const gmailOrg = `${org}_${accountId}`;
      const account = {
        organizationId: gmailOrg,
        accountId,
        emailAddress: `${accountId}@example.com`,
        externalAccountId: `ext_${accountId}`,
      };
      await createOrUpdatePendingCommunicationAccount(db.prisma, account);
      await persistConnectedCommunicationAccount(db.prisma, { ...account, connectedAt: now });
      return { accountId, gmailOrg };
    }

    it('commits status, audit, and intent together for a reauthorization transition', async () => {
      const { accountId, gmailOrg } = await seedConnectedAccount();
      const intentId = nextId('onint');
      const audit = systemAudit('gmail.connection.needs_reauth', {
        organizationId: gmailOrg,
        systemId: 'gmail_channel',
        outcome: 'failed',
      });

      const result = await persistGmailChannelUnavailableTransaction({
        db: db.prisma,
        organizationId: gmailOrg,
        accountId,
        transition: 'needs_reauth',
        errorCode: 'invalid_grant',
        at: now,
        audit,
        ownerNotification: { id: intentId, systemId: 'gmail_channel' },
      });

      expect(result.transitioned).toBe(true);
      expect(result.account.status).toBe('needs_reauth');

      const [intent] = await intentsFor('communication_account', accountId, gmailOrg);
      expect(intent).toMatchObject({
        id: intentId,
        eventType: 'gmail_disconnected',
        subjectKind: 'communication_account',
        subjectId: accountId,
        // Which state it entered and when. A reconnect followed by a second lapse is a second
        // event; the same lapse observed twice cannot get here, because the compare-and-set on
        // `connected` refuses the second observer before any of this runs.
        occurrenceKey: `needs_reauth:${now}`,
        actorKind: 'system',
        systemId: 'gmail_channel',
        auditEventId: audit.id,
      });
    });

    it('writes nothing at all when the account has already left connected', async () => {
      const { accountId, gmailOrg } = await seedConnectedAccount();
      await persistGmailChannelUnavailableTransaction({
        db: db.prisma,
        organizationId: gmailOrg,
        accountId,
        transition: 'needs_reauth',
        errorCode: 'invalid_grant',
        at: now,
        audit: systemAudit('gmail.connection.needs_reauth', {
          organizationId: gmailOrg,
          outcome: 'failed',
        }),
        ownerNotification: { id: nextId('onint'), systemId: 'gmail_channel' },
      });

      // A second poll observing the same unusable channel. Nothing changed, so nothing is recorded:
      // the Owner is told a channel broke, not that it is still broken.
      const secondAudit = systemAudit('gmail.connection.needs_reauth', {
        organizationId: gmailOrg,
        outcome: 'failed',
      });
      const again = await persistGmailChannelUnavailableTransaction({
        db: db.prisma,
        organizationId: gmailOrg,
        accountId,
        transition: 'needs_reauth',
        errorCode: 'invalid_grant',
        at: now,
        audit: secondAudit,
        ownerNotification: { id: nextId('onint'), systemId: 'gmail_channel' },
      });

      expect(again.transitioned).toBe(false);
      expect(await intentsFor('communication_account', accountId, gmailOrg)).toHaveLength(1);
      expect(await db.prisma.auditEvent.findMany({ where: { id: secondAudit.id } })).toHaveLength(
        0,
      );
    });

    it('distinguishes a resync transition from a reauthorization one', async () => {
      const { accountId, gmailOrg } = await seedConnectedAccount();

      const result = await persistGmailChannelUnavailableTransaction({
        db: db.prisma,
        organizationId: gmailOrg,
        accountId,
        transition: 'resync_required',
        errorCode: 'history_expired',
        at: now,
        audit: systemAudit('gmail.sync.resync_required', {
          organizationId: gmailOrg,
          outcome: 'failed',
        }),
        ownerNotification: { id: nextId('onint'), systemId: 'gmail_channel' },
      });

      expect(result.account.status).toBe('resync_required');
      expect(result.account.historyState).toBe('resync_required');
      const [intent] = await intentsFor('communication_account', accountId, gmailOrg);
      expect(intent.occurrenceKey).toBe(`resync_required:${now}`);
    });

    it('writes no intent when capture is off', async () => {
      const { accountId, gmailOrg } = await seedConnectedAccount();
      await persistGmailChannelUnavailableTransaction({
        db: db.prisma,
        organizationId: gmailOrg,
        accountId,
        transition: 'needs_reauth',
        errorCode: 'invalid_grant',
        at: now,
        audit: systemAudit('gmail.connection.needs_reauth', {
          organizationId: gmailOrg,
          outcome: 'failed',
        }),
      });
      expect(await intentsFor('communication_account', accountId, gmailOrg)).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------------------------
  // capability.expired
  // -----------------------------------------------------------------------------------------

  describe('capability.expired', () => {
    it('commits the transition, its audit, and the intent in one transaction', async () => {
      const seeded = await seedHandoff();
      const intentId = nextId('onint');
      const audit = systemAudit('capability.expired', { capabilityId: seeded.capabilityId });

      const result = await observeCapabilityExpiry({
        db: db.prisma,
        organizationId: org,
        capabilityId: seeded.capabilityId,
        at: afterExpiry,
        audit,
        ownerNotification: { id: intentId },
      });

      expect(result.expired).toBe(true);
      expect(result.capability.status).toBe('expired');

      const [intent] = await intentsFor('task_capability', seeded.capabilityId);
      expect(intent).toMatchObject({
        id: intentId,
        eventType: 'capability_expired',
        subjectKind: 'task_capability',
        subjectId: seeded.capabilityId,
        // Fixed: a capability expires once and can never return to active.
        occurrenceKey: 'expired',
        actorKind: 'system',
        systemId: 'capability_expiry',
        auditEventId: audit.id,
      });
      // When the link lapsed, not when the sweep noticed it.
      expect(intent.occurredAt).toBe(expiresAt);
    });

    it('does nothing at all on a second observation', async () => {
      const seeded = await seedHandoff();
      await observeCapabilityExpiry({
        db: db.prisma,
        organizationId: org,
        capabilityId: seeded.capabilityId,
        at: afterExpiry,
        audit: systemAudit('capability.expired'),
        ownerNotification: { id: nextId('onint') },
      });

      const secondAudit = systemAudit('capability.expired');
      const again = await observeCapabilityExpiry({
        db: db.prisma,
        organizationId: org,
        capabilityId: seeded.capabilityId,
        at: afterExpiry,
        audit: secondAudit,
        ownerNotification: { id: nextId('onint') },
      });

      expect(again.expired).toBe(false);
      expect(await intentsFor('task_capability', seeded.capabilityId)).toHaveLength(1);
      // A duplicate audit row would be its own falsehood, so the loser writes none.
      expect(await db.prisma.auditEvent.findMany({ where: { id: secondAudit.id } })).toHaveLength(
        0,
      );
    });

    it('leaves a revoked capability revoked and notifies nothing', async () => {
      const seeded = await seedHandoff();
      await revokeCapabilityRecord(db.prisma, org, seeded.capabilityId, now, 'assignment_ended');

      const result = await observeCapabilityExpiry({
        db: db.prisma,
        organizationId: org,
        capabilityId: seeded.capabilityId,
        at: afterExpiry,
        audit: systemAudit('capability.expired'),
        ownerNotification: { id: nextId('onint') },
      });

      expect(result.expired).toBe(false);
      const capability = await getCapabilityById(db.prisma, org, seeded.capabilityId);
      expect(capability.status).toBe('revoked');
      expect(await intentsFor('task_capability', seeded.capabilityId)).toHaveLength(0);
    });

    it('does not expire a capability whose expiry instant has not arrived', async () => {
      const seeded = await seedHandoff();

      const result = await observeCapabilityExpiry({
        db: db.prisma,
        organizationId: org,
        capabilityId: seeded.capabilityId,
        at: now,
        audit: systemAudit('capability.expired'),
        ownerNotification: { id: nextId('onint') },
      });

      expect(result.expired).toBe(false);
      expect(result.capability.status).toBe('active');
      expect(await intentsFor('task_capability', seeded.capabilityId)).toHaveLength(0);
    });

    it('still expires durably when capture is off', async () => {
      const seeded = await seedHandoff();

      const result = await observeCapabilityExpiry({
        db: db.prisma,
        organizationId: org,
        capabilityId: seeded.capabilityId,
        at: afterExpiry,
        audit: systemAudit('capability.expired'),
      });

      // Authorization truth must never depend on whether a notification could be recorded.
      expect(result.expired).toBe(true);
      expect(await intentsFor('task_capability', seeded.capabilityId)).toHaveLength(0);
    });
  });
});
