import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  type Task,
  type TaskAssignment,
  type TaskCapability,
  type Recipient,
} from '@aicaa/domain';
import {
  PersistenceError,
  assertCreateTaskRejectsAssignment,
  beginExplicitReforward,
  beginInitialHandoff,
  beginReassignment,
  createActiveAssignment,
  createCapability,
  createRecipient,
  createTask,
  deactivateRecipient,
  findActiveCapabilitiesForAssignment,
  getCapabilityById,
  getRecipientById,
  getTaskById,
  isPersistedCapabilityActionable,
  listStalePendingHandoffAttempts,
  listTaskAssignments,
  markCapabilityExpiredRecord,
  markHandoffDeliveryFailed,
  markHandoffSendAccepted,
  prepareFailedHandoffRetry,
  resolveHandoffIdempotency,
  revokeCapabilityRecord,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const orgId = 'org_a7';
const ownerId = 'owner_a7';
const now = '2026-07-18T12:00:00.000Z';
const expiresAt = '2026-07-25T12:00:00.000Z';

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}`;
}

let tokenSeq = 0;
function uniqueTokenHash(): string {
  tokenSeq += 1;
  return tokenSeq.toString(16).padStart(64, '0');
}

function requestFingerprint(taskId: string, recipientId: string): string {
  return computeHandoffRequestFingerprint(
    {
      organizationId: orgId,
      taskId: asTaskId(taskId),
      recipientId: asRecipientId(recipientId),
      acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
    },
    identityHandoffFingerprintHasher,
  );
}

function recipient(id: string, email: string): Recipient {
  return {
    id: asRecipientId(id),
    displayName: 'Alex Recipient',
    email,
    active: true,
    relationshipLabel: 'assistant',
  };
}

function unassignedTask(taskId: string): Task {
  return {
    id: asTaskId(taskId),
    organizationId: asOrganizationId(orgId),
    status: 'open',
    summaryPoints: [
      { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Do the thing' },
    ],
    notes: [],
    reminder: { paused: false },
    retention: {},
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function handoffAssignment(
  assignmentId: string,
  taskId: string,
  recipientId: string,
  email: string,
): TaskAssignment {
  return {
    id: asAssignmentId(assignmentId),
    recipientId: asRecipientId(recipientId),
    intendedRecipientEmail: email,
    assignedAt: now,
    assignedByOwnerId: asOwnerId(ownerId),
    allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
    capabilityStatus: 'active',
  };
}

function handoffCapability(
  capabilityId: string,
  taskId: string,
  assignmentId: string,
  recipientId: string,
  email: string,
): TaskCapability {
  return {
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
}

async function seedUnassignedTask(db: TestDatabase['prisma']) {
  const taskId = nextId('task');
  const recipientId = nextId('rcp');
  const email = `${recipientId}@example.com`;
  await createRecipient(db, { organizationId: orgId, recipient: recipient(recipientId, email) });
  const task = unassignedTask(taskId);
  await createTask(db, orgId, task);
  return { taskId, recipientId, email, task };
}

type InitialHandoffOpts = {
  assignmentId?: string;
  capabilityId?: string;
  attemptId?: string;
  idempotencyKey?: string;
  requestFingerprint?: string;
  tokenHash?: string;
};

async function beginInitialHandoffForFixture(
  db: TestDatabase['prisma'],
  fixture: Awaited<ReturnType<typeof seedUnassignedTask>>,
  opts: InitialHandoffOpts = {},
) {
  const assignmentId = opts.assignmentId ?? nextId('asg');
  const capabilityId = opts.capabilityId ?? nextId('cap');
  const attemptId = opts.attemptId ?? nextId('att');
  const idempotencyKey = opts.idempotencyKey ?? nextId('idem');
  const fp = opts.requestFingerprint ?? requestFingerprint(fixture.taskId, fixture.recipientId);

  const result = await beginInitialHandoff({
    db,
    organizationId: orgId,
    ownerId,
    expectedTaskVersion: fixture.task.version,
    task: fixture.task,
    assignment: handoffAssignment(assignmentId, fixture.taskId, fixture.recipientId, fixture.email),
    capability: handoffCapability(
      capabilityId,
      fixture.taskId,
      assignmentId,
      fixture.recipientId,
      fixture.email,
    ),
    tokenHash: opts.tokenHash ?? uniqueTokenHash(),
    attemptId,
    acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
    deliveryPath: 'assignment_email',
    idempotencyKey,
    requestFingerprint: fp,
  });

  return {
    ...result,
    assignmentId,
    capabilityId,
    attemptId,
    idempotencyKey,
    requestFingerprint: fp,
  };
}

async function completeSuccessfulSend(
  db: TestDatabase['prisma'],
  attemptId: string,
  providerMessageId = `msg_${attemptId}`,
  sendGeneration = 1,
) {
  return markHandoffSendAccepted({
    db,
    organizationId: orgId,
    attemptId,
    providerMessageId,
    providerAcceptedAt: now,
    expectedSendGeneration: sendGeneration,
  });
}

describe('A7.3 handoff persistence (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  describe('beginInitialHandoff', () => {
    it('1. creates a pending attempt', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const result = await beginInitialHandoffForFixture(db.prisma, fixture);

      expect(result.kind).toBe('created');
      expect(result.attempt.status).toBe('pending');
      expect(result.attempt.intent).toBe('initial');
      expect(result.attempt.taskId).toBe(fixture.taskId);
    });

    it('2. keeps pending assignment and capability non-actionable', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const result = await beginInitialHandoffForFixture(db.prisma, fixture);
      const loadedTask = await getTaskById(db.prisma, orgId, fixture.taskId);

      expect(loadedTask.assignment?.deliveryStatus).toBe('pending');
      expect(isPersistedCapabilityActionable(result.capability, now)).toBe(false);
      expect(result.capability.actionableAt).toBeNull();
    });

    it('24. rejects inactive Recipient selection', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      await deactivateRecipient(db.prisma, orgId, fixture.recipientId);

      await expect(beginInitialHandoffForFixture(db.prisma, fixture)).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    });
  });

  describe('markHandoffSendAccepted', () => {
    it('3. transitions attempt to sent', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      const accepted = await completeSuccessfulSend(db.prisma, initial.attemptId, 'provider_msg_3');

      expect(accepted.attempt.status).toBe('sent');
      expect(accepted.attempt.providerMessageId).toBe('provider_msg_3');
    });

    it('4. activates assignment and capability after accepted send', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      const accepted = await completeSuccessfulSend(db.prisma, initial.attemptId, 'provider_msg_4');
      const task = await getTaskById(db.prisma, orgId, fixture.taskId);

      expect(task.assignment?.deliveryStatus).toBe('sent');
      expect(accepted.capability.actionableAt).toBe(now);
      expect(isPersistedCapabilityActionable(accepted.capability, now)).toBe(true);
    });

    it('5. persists provider message id once', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      const messageId = 'provider_msg_5_unique';
      const accepted = await completeSuccessfulSend(db.prisma, initial.attemptId, messageId);
      const reloaded = await (
        await import('../src/repositories/handoff-attempt-repository.js')
      ).getHandoffAttemptById(db.prisma, orgId, initial.attemptId);

      expect(accepted.attempt.providerMessageId).toBe(messageId);
      expect(reloaded.providerMessageId).toBe(messageId);
    });

    it('6. treats duplicate sent transition as idempotent', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      const messageId = 'provider_msg_6';
      const first = await completeSuccessfulSend(db.prisma, initial.attemptId, messageId);
      const second = await completeSuccessfulSend(db.prisma, initial.attemptId, messageId);

      expect(second.attempt.id).toBe(first.attempt.id);
      expect(second.attempt.providerMessageId).toBe(messageId);
    });

    it('7. rejects conflicting provider message id', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      await completeSuccessfulSend(db.prisma, initial.attemptId, 'provider_msg_7a');

      await expect(
        completeSuccessfulSend(db.prisma, initial.attemptId, 'provider_msg_7b'),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });
  });

  describe('failed delivery and retry', () => {
    it('8. failed transition preserves non-actionable capability', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      const failed = await markHandoffDeliveryFailed({
        db: db.prisma,
        organizationId: orgId,
        attemptId: initial.attemptId,
        failureCode: 'GMAIL_SEND_REJECTED',
        failureCategory: 'provider',
        failureFingerprint: 'fp_failure_8',
        retryable: true,
        expectedSendGeneration: 1,
      });
      const capability = await getCapabilityById(db.prisma, orgId, initial.capabilityId);
      const task = await getTaskById(db.prisma, orgId, fixture.taskId);

      expect(failed.attempt.status).toBe('failed');
      expect(task.assignment?.deliveryStatus).toBe('failed');
      expect(capability.actionableAt).toBeNull();
      expect(isPersistedCapabilityActionable(capability, now)).toBe(false);
    });

    it('9. failed retry reuses attempt and capability', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      await markHandoffDeliveryFailed({
        db: db.prisma,
        organizationId: orgId,
        attemptId: initial.attemptId,
        failureCode: 'GMAIL_TIMEOUT',
        failureCategory: 'retryable_dependency',
        failureFingerprint: initial.requestFingerprint,
        retryable: true,
        expectedSendGeneration: 1,
      });

      const retry = await prepareFailedHandoffRetry({
        db: db.prisma,
        organizationId: orgId,
        attemptId: initial.attemptId,
        requestFingerprint: initial.requestFingerprint,
        newTokenHash: uniqueTokenHash(),
      });
      const task = await getTaskById(db.prisma, orgId, fixture.taskId);

      expect(retry.won).toBe(true);
      expect(retry.attempt.id).toBe(initial.attemptId);
      expect(retry.attempt.status).toBe('pending');
      expect(retry.attempt.intent).toBe('retry_failed');
      expect(retry.capability.id).toBe(initial.capabilityId);
      expect(task.assignment?.deliveryStatus).toBe('pending');
    });

    it('10. rejects retry with changed fingerprint', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      await markHandoffDeliveryFailed({
        db: db.prisma,
        organizationId: orgId,
        attemptId: initial.attemptId,
        failureCode: 'GMAIL_TIMEOUT',
        failureCategory: 'retryable_dependency',
        failureFingerprint: initial.requestFingerprint,
        retryable: true,
        expectedSendGeneration: 1,
      });

      await expect(
        prepareFailedHandoffRetry({
          db: db.prisma,
          organizationId: orgId,
          attemptId: initial.attemptId,
          requestFingerprint: 'changed_fingerprint',
          newTokenHash: uniqueTokenHash(),
        }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
    });

    it('27. persists privacy-safe failure metadata without raw provider content', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      const failed = await markHandoffDeliveryFailed({
        db: db.prisma,
        organizationId: orgId,
        attemptId: initial.attemptId,
        failureCode: 'GMAIL_QUOTA_EXCEEDED',
        failureCategory: 'provider',
        failureFingerprint: 'fp_privacy_27',
        retryable: false,
        expectedSendGeneration: 1,
      });

      expect(failed.attempt.failureCode).toBe('GMAIL_QUOTA_EXCEEDED');
      expect(failed.attempt.failureFingerprint).toBe('fp_privacy_27');
      expect(failed.attempt).not.toHaveProperty('rawProviderBody');
      expect(failed.attempt).not.toHaveProperty('mimeContent');
      expect(failed.attempt.providerMessageId).toBeNull();
    });
  });

  describe('idempotency', () => {
    it('11. replays same idempotency key and fingerprint', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const idempotencyKey = nextId('idem_replay');
      const fp = requestFingerprint(fixture.taskId, fixture.recipientId);
      const first = await beginInitialHandoffForFixture(db.prisma, fixture, {
        idempotencyKey,
        requestFingerprint: fp,
      });
      const replay = await beginInitialHandoffForFixture(db.prisma, fixture, {
        idempotencyKey,
        requestFingerprint: fp,
        assignmentId: nextId('asg_unused'),
        capabilityId: nextId('cap_unused'),
        attemptId: nextId('att_unused'),
      });

      expect(first.kind).toBe('created');
      expect(replay.kind).toBe('replay_pending');
      expect(replay.attempt.id).toBe(first.attempt.id);
    });

    it('12. conflicts when idempotency key is reused with different fingerprint', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const idempotencyKey = nextId('idem_conflict');
      const fp = requestFingerprint(fixture.taskId, fixture.recipientId);
      await beginInitialHandoffForFixture(db.prisma, fixture, {
        idempotencyKey,
        requestFingerprint: fp,
      });

      await expect(
        beginInitialHandoffForFixture(db.prisma, fixture, {
          idempotencyKey,
          requestFingerprint: 'different_fingerprint',
        }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });

      const lookup = await resolveHandoffIdempotency({
        db: db.prisma,
        organizationId: orgId,
        idempotencyKey,
        requestFingerprint: 'different_fingerprint',
      });
      expect(lookup.kind).toBe('key_conflict');
    });
  });

  describe('concurrency', () => {
    it('13. creates exactly one attempt for concurrent same-key requests', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const assignmentId = nextId('asg_conc13');
      const capabilityId = nextId('cap_conc13');
      const attemptId = nextId('att_conc13');
      const idempotencyKey = nextId('idem_conc13');
      const fp = requestFingerprint(fixture.taskId, fixture.recipientId);

      const input = {
        db: db.prisma,
        organizationId: orgId,
        ownerId,
        expectedTaskVersion: fixture.task.version,
        task: fixture.task,
        assignment: handoffAssignment(
          assignmentId,
          fixture.taskId,
          fixture.recipientId,
          fixture.email,
        ),
        capability: handoffCapability(
          capabilityId,
          fixture.taskId,
          assignmentId,
          fixture.recipientId,
          fixture.email,
        ),
        tokenHash: uniqueTokenHash(),
        attemptId,
        acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
        deliveryPath: 'assignment_email' as const,
        idempotencyKey,
        requestFingerprint: fp,
      };

      const results = await Promise.allSettled([
        beginInitialHandoff(input),
        beginInitialHandoff(input),
      ]);

      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof beginInitialHandoff>>> =>
          r.status === 'fulfilled',
      );
      const created = fulfilled.filter((r) => r.value.kind === 'created');
      const replay = fulfilled.filter((r) => r.value.kind === 'replay_pending');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(created.length + replay.length + rejected.length).toBe(2);
      expect(created.length).toBe(1);
      expect(created.length + replay.length).toBeGreaterThanOrEqual(1);
    });

    it('14. allows only one winner for concurrent different-key initial handoffs', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const fp = requestFingerprint(fixture.taskId, fixture.recipientId);

      const makeInput = (suffix: string) => {
        const assignmentId = nextId(`asg_conc14_${suffix}`);
        return {
          db: db.prisma,
          organizationId: orgId,
          ownerId,
          expectedTaskVersion: fixture.task.version,
          task: fixture.task,
          assignment: handoffAssignment(
            assignmentId,
            fixture.taskId,
            fixture.recipientId,
            fixture.email,
          ),
          capability: handoffCapability(
            nextId(`cap_conc14_${suffix}`),
            fixture.taskId,
            assignmentId,
            fixture.recipientId,
            fixture.email,
          ),
          tokenHash: uniqueTokenHash(),
          attemptId: nextId(`att_conc14_${suffix}`),
          acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
          deliveryPath: 'assignment_email' as const,
          idempotencyKey: nextId(`idem_conc14_${suffix}`),
          requestFingerprint: fp,
        };
      };

      const [a, b] = await Promise.allSettled([
        beginInitialHandoff(makeInput('a')),
        beginInitialHandoff(makeInput('b')),
      ]);

      const winners = [a, b].filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof beginInitialHandoff>>> =>
          r.status === 'fulfilled' && r.value.kind === 'created',
      );
      const losers = [a, b].filter((r) => r.status === 'rejected');

      expect(winners.length).toBe(1);
      expect(losers.length).toBe(1);
      const error = (losers[0] as PromiseRejectedResult).reason as PersistenceError;
      expect(['UNIQUE_VIOLATION', 'HANDOFF_IN_PROGRESS', 'DOMAIN_CONFLICT']).toContain(error.code);
    });

    it('15. enforces one active capability per assignment under concurrency', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const assignmentId = nextId('asg_conc15');
      await createActiveAssignment(
        db.prisma,
        orgId,
        fixture.taskId,
        handoffAssignment(assignmentId, fixture.taskId, fixture.recipientId, fixture.email),
      );

      const capA = nextId('cap_conc15_a');
      const capB = nextId('cap_conc15_b');
      const results = await Promise.allSettled([
        createCapability(
          db.prisma,
          orgId,
          handoffCapability(capA, fixture.taskId, assignmentId, fixture.recipientId, fixture.email),
          uniqueTokenHash(),
          { actionableAt: null },
        ),
        createCapability(
          db.prisma,
          orgId,
          handoffCapability(capB, fixture.taskId, assignmentId, fixture.recipientId, fixture.email),
          uniqueTokenHash(),
          { actionableAt: null },
        ),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: 'UNIQUE_VIOLATION',
      });

      const active = await findActiveCapabilitiesForAssignment(db.prisma, orgId, assignmentId);
      expect(active).toHaveLength(1);
    });
  });

  describe('explicit re-forward', () => {
    it('16. supersedes prior capability with revocationReason superseded', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      await completeSuccessfulSend(db.prisma, initial.attemptId, 'provider_msg_16');
      const task = await getTaskById(db.prisma, orgId, fixture.taskId);

      const newCapId = nextId('cap_reforward');
      await beginExplicitReforward({
        db: db.prisma,
        organizationId: orgId,
        priorAttemptId: initial.attemptId,
        expectedTaskVersion: task.version,
        task,
        capability: handoffCapability(
          newCapId,
          fixture.taskId,
          initial.assignmentId,
          fixture.recipientId,
          fixture.email,
        ),
        tokenHash: uniqueTokenHash(),
        attemptId: nextId('att_reforward'),
        acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
        deliveryPath: 'assignment_email',
        idempotencyKey: nextId('idem_reforward'),
        requestFingerprint: requestFingerprint(fixture.taskId, fixture.recipientId),
        now,
      });

      const priorCap = await getCapabilityById(db.prisma, orgId, initial.capabilityId);
      expect(priorCap.status).toBe('revoked');
      expect(priorCap.revocationReason).toBe('superseded');
    });

    it('17. creates a new attempt and capability for explicit re-forward', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      await completeSuccessfulSend(db.prisma, initial.attemptId, 'provider_msg_17');
      const task = await getTaskById(db.prisma, orgId, fixture.taskId);

      const newCapId = nextId('cap_reforward17');
      const newAttemptId = nextId('att_reforward17');
      const reforward = await beginExplicitReforward({
        db: db.prisma,
        organizationId: orgId,
        priorAttemptId: initial.attemptId,
        expectedTaskVersion: task.version,
        task,
        capability: handoffCapability(
          newCapId,
          fixture.taskId,
          initial.assignmentId,
          fixture.recipientId,
          fixture.email,
        ),
        tokenHash: uniqueTokenHash(),
        attemptId: newAttemptId,
        acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
        deliveryPath: 'assignment_email',
        idempotencyKey: nextId('idem_reforward17'),
        requestFingerprint: requestFingerprint(fixture.taskId, fixture.recipientId),
        now,
      });

      expect(reforward.kind).toBe('created');
      expect(reforward.attempt.id).toBe(newAttemptId);
      expect(reforward.attempt.intent).toBe('explicit_reforward');
      expect(reforward.capability.id).toBe(newCapId);
      expect(reforward.attempt.priorAttemptId).toBe(initial.attemptId);
    });
  });

  describe('reassignment', () => {
    it('18. supersedes prior capability on reassignment', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      await completeSuccessfulSend(db.prisma, initial.attemptId, 'provider_msg_18');
      const task = await getTaskById(db.prisma, orgId, fixture.taskId);

      const newRecipientId = nextId('rcp_reassign18');
      const newEmail = `${newRecipientId}@example.com`;
      await createRecipient(db.prisma, {
        organizationId: orgId,
        recipient: recipient(newRecipientId, newEmail),
      });
      const newAssignmentId = nextId('asg_reassign18');
      const newCapId = nextId('cap_reassign18');

      await beginReassignment({
        db: db.prisma,
        organizationId: orgId,
        priorAttemptId: initial.attemptId,
        expectedTaskVersion: task.version,
        task,
        newAssignment: handoffAssignment(newAssignmentId, fixture.taskId, newRecipientId, newEmail),
        capability: handoffCapability(
          newCapId,
          fixture.taskId,
          newAssignmentId,
          newRecipientId,
          newEmail,
        ),
        tokenHash: uniqueTokenHash(),
        attemptId: nextId('att_reassign18'),
        acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
        deliveryPath: 'assignment_email',
        idempotencyKey: nextId('idem_reassign18'),
        requestFingerprint: requestFingerprint(fixture.taskId, newRecipientId),
        now,
      });

      const priorCap = await getCapabilityById(db.prisma, orgId, initial.capabilityId);
      expect(priorCap.status).toBe('revoked');
      expect(priorCap.revocationReason).toBe('superseded');
    });

    it('19. preserves historical assignment rows after reassignment', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      await completeSuccessfulSend(db.prisma, initial.attemptId, 'provider_msg_19');
      const task = await getTaskById(db.prisma, orgId, fixture.taskId);

      const newRecipientId = nextId('rcp_reassign19');
      const newEmail = `${newRecipientId}@example.com`;
      await createRecipient(db.prisma, {
        organizationId: orgId,
        recipient: recipient(newRecipientId, newEmail),
      });
      const newAssignmentId = nextId('asg_reassign19');

      await beginReassignment({
        db: db.prisma,
        organizationId: orgId,
        priorAttemptId: initial.attemptId,
        expectedTaskVersion: task.version,
        task,
        newAssignment: handoffAssignment(newAssignmentId, fixture.taskId, newRecipientId, newEmail),
        capability: handoffCapability(
          nextId('cap_reassign19'),
          fixture.taskId,
          newAssignmentId,
          newRecipientId,
          newEmail,
        ),
        tokenHash: uniqueTokenHash(),
        attemptId: nextId('att_reassign19'),
        acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
        deliveryPath: 'assignment_email',
        idempotencyKey: nextId('idem_reassign19'),
        requestFingerprint: requestFingerprint(fixture.taskId, newRecipientId),
        now,
      });

      const history = await listTaskAssignments(db.prisma, orgId, fixture.taskId);
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history.some((row) => row.id === initial.assignmentId && row.clearedAt != null)).toBe(
        true,
      );
      expect(history.some((row) => row.id === newAssignmentId && row.clearedAt == null)).toBe(true);
    });
  });

  describe('capability revocation and expiration', () => {
    async function standaloneCapability() {
      const fixture = await seedUnassignedTask(db.prisma);
      const assignmentId = nextId('asg_rev');
      const capId = nextId('cap_rev');
      await beginInitialHandoffForFixture(db.prisma, fixture, {
        assignmentId,
        capabilityId: capId,
      });
      return { capId };
    }

    it('20. persists manual revocation reason', async () => {
      const { capId } = await standaloneCapability();
      const revoked = await revokeCapabilityRecord(db.prisma, orgId, capId, now, 'manual');
      expect(revoked.status).toBe('revoked');
      expect(revoked.revocationReason).toBe('manual');
    });

    it('21. persists superseded revocation reason', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      await completeSuccessfulSend(db.prisma, initial.attemptId, 'provider_msg_21');
      const task = await getTaskById(db.prisma, orgId, fixture.taskId);

      await beginExplicitReforward({
        db: db.prisma,
        organizationId: orgId,
        priorAttemptId: initial.attemptId,
        expectedTaskVersion: task.version,
        task,
        capability: handoffCapability(
          nextId('cap_superseded21'),
          fixture.taskId,
          initial.assignmentId,
          fixture.recipientId,
          fixture.email,
        ),
        tokenHash: uniqueTokenHash(),
        attemptId: nextId('att_superseded21'),
        acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
        deliveryPath: 'assignment_email',
        idempotencyKey: nextId('idem_superseded21'),
        requestFingerprint: requestFingerprint(fixture.taskId, fixture.recipientId),
        now,
      });

      const prior = await getCapabilityById(db.prisma, orgId, initial.capabilityId);
      expect(prior.revocationReason).toBe('superseded');
    });

    it('22. persists assignment_ended revocation reason', async () => {
      const { capId } = await standaloneCapability();
      const revoked = await revokeCapabilityRecord(
        db.prisma,
        orgId,
        capId,
        now,
        'assignment_ended',
      );
      expect(revoked.revocationReason).toBe('assignment_ended');
    });

    it('23. marks capability expired with reason expired', async () => {
      const { capId } = await standaloneCapability();
      const expired = await markCapabilityExpiredRecord(db.prisma, orgId, capId);
      expect(expired.status).toBe('expired');
      expect(expired.revocationReason).toBe('expired');
    });
  });

  describe('recipient policy', () => {
    it('25. preserves historical attribution after recipient deactivation', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      await completeSuccessfulSend(db.prisma, initial.attemptId, 'provider_msg_25');

      await deactivateRecipient(db.prisma, orgId, fixture.recipientId);
      const loadedRecipient = await getRecipientById(db.prisma, orgId, fixture.recipientId);
      const task = await getTaskById(db.prisma, orgId, fixture.taskId);

      expect(loadedRecipient.active).toBe(false);
      expect(task.assignment?.recipientId).toBe(fixture.recipientId);
    });

    it('26. enforces duplicate active recipient email policy', async () => {
      const email = `${nextId('dup_email')}@example.com`;
      await createRecipient(db.prisma, {
        organizationId: orgId,
        recipient: recipient(nextId('rcp_dup_a'), email),
      });

      await expect(
        createRecipient(db.prisma, {
          organizationId: orgId,
          recipient: recipient(nextId('rcp_dup_b'), email),
        }),
      ).rejects.toMatchObject({ code: 'UNIQUE_VIOLATION' });
    });
  });

  describe('stale pending discovery', () => {
    it('28. lists stale pending attempts for reconciliation', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);

      await db.prisma.handoffAttempt.update({
        where: { id: initial.attemptId },
        data: { updatedAt: new Date('2026-07-17T10:00:00.000Z') },
      });

      const stale = await listStalePendingHandoffAttempts(
        db.prisma,
        orgId,
        '2026-07-18T00:00:00.000Z',
      );
      expect(stale.some((attempt) => attempt.id === initial.attemptId)).toBe(true);
    });
  });

  describe('A4 compatibility', () => {
    it('29. defaults legacy capability issuance to actionable and enforces one-active rule', async () => {
      const fixture = await seedUnassignedTask(db.prisma);
      const assignmentId = nextId('asg_a4');
      const capA = nextId('cap_a4_a');
      const capB = nextId('cap_a4_b');

      await createActiveAssignment(
        db.prisma,
        orgId,
        fixture.taskId,
        handoffAssignment(assignmentId, fixture.taskId, fixture.recipientId, fixture.email),
      );

      const created = await createCapability(
        db.prisma,
        orgId,
        handoffCapability(capA, fixture.taskId, assignmentId, fixture.recipientId, fixture.email),
        uniqueTokenHash(),
      );

      expect(created.actionableAt).toBe(now);
      expect(isPersistedCapabilityActionable(created, now)).toBe(true);

      await expect(
        createCapability(
          db.prisma,
          orgId,
          handoffCapability(capB, fixture.taskId, assignmentId, fixture.recipientId, fixture.email),
          uniqueTokenHash(),
        ),
      ).rejects.toMatchObject({ code: 'UNIQUE_VIOLATION' });
    });
  });

  describe('create task guard', () => {
    it('30. rejects create-task paths that include assignment', () => {
      expect(() =>
        assertCreateTaskRejectsAssignment(
          handoffAssignment('asg_guard', 'task_guard', 'rcp_guard', 'guard@example.com'),
        ),
      ).toThrow(PersistenceError);

      try {
        assertCreateTaskRejectsAssignment(
          handoffAssignment('asg_guard', 'task_guard', 'rcp_guard', 'guard@example.com'),
        );
      } catch (error) {
        expect(error).toMatchObject({ code: 'RECIPIENT_HANDOFF_NOT_AVAILABLE' });
      }
    });
  });

  describe('A7.5 retry token rotation + send-generation guard', () => {
    async function seedFailed() {
      const fixture = await seedUnassignedTask(db.prisma);
      const initial = await beginInitialHandoffForFixture(db.prisma, fixture);
      await markHandoffDeliveryFailed({
        db: db.prisma,
        organizationId: orgId,
        attemptId: initial.attemptId,
        failureCode: 'GMAIL_TIMEOUT',
        failureCategory: 'retryable_dependency',
        failureFingerprint: initial.requestFingerprint,
        retryable: true,
        expectedSendGeneration: 1,
      });
      return { fixture, initial };
    }

    it('R1. winning retry rotates the token hash in place and advances the send generation', async () => {
      const { initial } = await seedFailed();
      const before = await getCapabilityById(db.prisma, orgId, initial.capabilityId);
      const newHash = uniqueTokenHash();

      const retry = await prepareFailedHandoffRetry({
        db: db.prisma,
        organizationId: orgId,
        attemptId: initial.attemptId,
        requestFingerprint: initial.requestFingerprint,
        newTokenHash: newHash,
      });

      expect(retry.won).toBe(true);
      expect(retry.sendGeneration).toBe(2);
      const after = await getCapabilityById(db.prisma, orgId, initial.capabilityId);
      expect(after.id).toBe(before.id);
      expect(after.tokenHash).toBe(newHash);
      expect(after.tokenHash).not.toBe(before.tokenHash);
      expect(after.status).toBe('active');
      expect(after.actionableAt).toBeNull();
    });

    it('R2. a stale-generation acceptance is rejected and does not activate the rotated capability', async () => {
      const { initial } = await seedFailed();
      await prepareFailedHandoffRetry({
        db: db.prisma,
        organizationId: orgId,
        attemptId: initial.attemptId,
        requestFingerprint: initial.requestFingerprint,
        newTokenHash: uniqueTokenHash(),
      });

      await expect(
        markHandoffSendAccepted({
          db: db.prisma,
          organizationId: orgId,
          attemptId: initial.attemptId,
          providerMessageId: 'gmsg_stale_gen1',
          providerAcceptedAt: now,
          expectedSendGeneration: 1,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });

      const cap = await getCapabilityById(db.prisma, orgId, initial.capabilityId);
      expect(cap.actionableAt).toBeNull();
    });

    it('R3. a stale-generation failure is rejected and leaves the newer generation pending', async () => {
      const { initial } = await seedFailed();
      const retry = await prepareFailedHandoffRetry({
        db: db.prisma,
        organizationId: orgId,
        attemptId: initial.attemptId,
        requestFingerprint: initial.requestFingerprint,
        newTokenHash: uniqueTokenHash(),
      });
      expect(retry.attempt.status).toBe('pending');

      await expect(
        markHandoffDeliveryFailed({
          db: db.prisma,
          organizationId: orgId,
          attemptId: initial.attemptId,
          failureCode: 'GMAIL_STALE',
          failureCategory: 'provider',
          failureFingerprint: 'fp_stale',
          retryable: true,
          expectedSendGeneration: 1,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });

      const cap = await getCapabilityById(db.prisma, orgId, initial.capabilityId);
      expect(cap.actionableAt).toBeNull();
    });
  });
});
