// @vitest-environment node
/**
 * A7.3 policy: A4 administrative capability issuance/replacement must not supersede the
 * capability of the latest UNRESOLVED A7 handoff attempt (pending, or failed — retryable or not).
 *
 * Engine: in-process PGlite (embedded Postgres) via createTestDatabase().
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_CAPABILITY_TTL_MS,
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
  ownerActor,
  type Task,
  type TaskAssignment,
  type TaskCapability,
  type Recipient,
} from '@aicaa/domain';
import * as aicaaDb from '@aicaa/db/runtime';
import {
  beginInitialHandoff,
  createRecipient,
  createTask,
  getCapabilityById,
  getHandoffAttemptById,
  getTaskById,
  markHandoffDeliveryFailed,
  markHandoffSendAccepted,
  prepareFailedHandoffRetry,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { resetDbRuntimeForTests, setDbRuntimeForTests } from '@/lib/db/runtime-db';
import { issueCapabilityForTask, replaceCapabilityForTask } from '@/lib/capability';
import { readCapabilityTokenErrorCode } from '@/lib/errors/safe-error-shapes';

const org = 'org_gate';
const ownerId = 'owner_gate';
const now = '2026-07-18T16:00:00.000Z';
const expiresAt = '2026-07-25T16:00:00.000Z';
const pepper = 'capability-pepper-value-32chars!!';
const appUrl = 'http://localhost:3000';
const owner = ownerActor(asOwnerId(ownerId), asOrganizationId(org));

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}`;
}

let tokenSeq = 0;
function uniqueTokenHash(): string {
  tokenSeq += 1;
  return `g${tokenSeq.toString(16).padStart(63, '0')}`;
}

function requestFingerprint(taskId: string, recipientId: string): string {
  return computeHandoffRequestFingerprint(
    {
      organizationId: org,
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
    displayName: 'Gate Recipient',
    email,
    active: true,
    relationshipLabel: 'assistant',
  };
}

function unassignedTask(taskId: string): Task {
  return {
    id: asTaskId(taskId),
    organizationId: asOrganizationId(org),
    status: 'open',
    summaryPoints: [{ id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Do it' }],
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

let db: TestDatabase;

async function beginPendingHandoff() {
  const taskId = nextId('task');
  const recipientId = nextId('rcp');
  const email = `${recipientId}@example.com`;
  const assignmentId = nextId('asg');
  const capabilityId = nextId('cap');
  const attemptId = nextId('att');
  const idempotencyKey = nextId('idem');
  await createRecipient(db.prisma, {
    organizationId: org,
    recipient: recipient(recipientId, email),
  });
  const task = unassignedTask(taskId);
  await createTask(db.prisma, org, task);
  const fp = requestFingerprint(taskId, recipientId);
  const result = await beginInitialHandoff({
    db: db.prisma,
    organizationId: org,
    ownerId,
    expectedTaskVersion: task.version,
    task,
    assignment: handoffAssignment(assignmentId, recipientId, email),
    capability: handoffCapability(capabilityId, taskId, assignmentId, recipientId, email),
    tokenHash: uniqueTokenHash(),
    attemptId,
    acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
    deliveryPath: 'assignment_email',
    idempotencyKey,
    requestFingerprint: fp,
  });
  return {
    taskId,
    recipientId,
    email,
    assignmentId,
    capabilityId,
    attemptId,
    requestFingerprint: fp,
    result,
  };
}

function issueArgs(taskId: string, overrides: Record<string, unknown> = {}) {
  return {
    db: db.prisma,
    owner,
    taskId,
    ttlMs: DEFAULT_CAPABILITY_TTL_MS,
    pepper,
    appUrl,
    now,
    ...overrides,
  } as Parameters<typeof issueCapabilityForTask>[0];
}

describe('A7.3 admin issuance vs unresolved handoff (PGlite)', () => {
  beforeAll(async () => {
    setDbRuntimeForTests(aicaaDb);
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
    resetDbRuntimeForTests();
  });

  it('1. blocks administrative issue while latest attempt is pending', async () => {
    const pending = await beginPendingHandoff();
    const error = await issueCapabilityForTask(issueArgs(pending.taskId)).catch((e: unknown) => e);
    expect(readCapabilityTokenErrorCode(error)).toBe('ISSUANCE_CONFLICT');
  });

  it('2. blocks replaceExisting while latest attempt is pending', async () => {
    const pending = await beginPendingHandoff();
    const error = await replaceCapabilityForTask(issueArgs(pending.taskId)).catch(
      (e: unknown) => e,
    );
    expect(readCapabilityTokenErrorCode(error)).toBe('ISSUANCE_CONFLICT');
  });

  it('3. blocks administrative issue while latest attempt is retryable failed', async () => {
    const pending = await beginPendingHandoff();
    await markHandoffDeliveryFailed({
      db: db.prisma,
      organizationId: org,
      attemptId: pending.attemptId,
      failureCode: 'GMAIL_TIMEOUT',
      failureCategory: 'retryable_dependency',
      failureFingerprint: pending.requestFingerprint,
      retryable: true,
      expectedSendGeneration: 1,
    });
    const error = await issueCapabilityForTask(issueArgs(pending.taskId)).catch((e: unknown) => e);
    expect(readCapabilityTokenErrorCode(error)).toBe('ISSUANCE_CONFLICT');
  });

  it('4. blocks replaceExisting while latest attempt is retryable failed', async () => {
    const pending = await beginPendingHandoff();
    await markHandoffDeliveryFailed({
      db: db.prisma,
      organizationId: org,
      attemptId: pending.attemptId,
      failureCode: 'GMAIL_TIMEOUT',
      failureCategory: 'retryable_dependency',
      failureFingerprint: pending.requestFingerprint,
      retryable: true,
      expectedSendGeneration: 1,
    });
    const error = await replaceCapabilityForTask(issueArgs(pending.taskId)).catch(
      (e: unknown) => e,
    );
    expect(readCapabilityTokenErrorCode(error)).toBe('ISSUANCE_CONFLICT');
  });

  it('4b. blocks administrative issue while latest attempt is non-retryable failed', async () => {
    const pending = await beginPendingHandoff();
    await markHandoffDeliveryFailed({
      db: db.prisma,
      organizationId: org,
      attemptId: pending.attemptId,
      failureCode: 'GMAIL_PERMANENT',
      failureCategory: 'provider',
      failureFingerprint: pending.requestFingerprint,
      retryable: false,
      expectedSendGeneration: 1,
    });
    const error = await issueCapabilityForTask(issueArgs(pending.taskId)).catch((e: unknown) => e);
    expect(readCapabilityTokenErrorCode(error)).toBe('ISSUANCE_CONFLICT');
  });

  it('5. failed attempt retains the same non-actionable capability after blocked issuance', async () => {
    const pending = await beginPendingHandoff();
    await markHandoffDeliveryFailed({
      db: db.prisma,
      organizationId: org,
      attemptId: pending.attemptId,
      failureCode: 'GMAIL_TIMEOUT',
      failureCategory: 'retryable_dependency',
      failureFingerprint: pending.requestFingerprint,
      retryable: true,
      expectedSendGeneration: 1,
    });
    await replaceCapabilityForTask(issueArgs(pending.taskId)).catch(() => undefined);

    const cap = await getCapabilityById(db.prisma, org, pending.capabilityId);
    expect(cap.status).toBe('active');
    expect(cap.actionableAt).toBeNull();
    const attempt = await getHandoffAttemptById(db.prisma, org, pending.attemptId);
    expect(attempt.status).toBe('failed');
    expect(attempt.capabilityId).toBe(pending.capabilityId);
  });

  it('6. retry remains possible after a blocked administrative issuance', async () => {
    const pending = await beginPendingHandoff();
    await markHandoffDeliveryFailed({
      db: db.prisma,
      organizationId: org,
      attemptId: pending.attemptId,
      failureCode: 'GMAIL_TIMEOUT',
      failureCategory: 'retryable_dependency',
      failureFingerprint: pending.requestFingerprint,
      retryable: true,
      expectedSendGeneration: 1,
    });
    await issueCapabilityForTask(issueArgs(pending.taskId)).catch(() => undefined);

    const retry = await prepareFailedHandoffRetry({
      db: db.prisma,
      organizationId: org,
      attemptId: pending.attemptId,
      requestFingerprint: pending.requestFingerprint,
      newTokenHash: uniqueTokenHash(),
    });
    expect(retry.won).toBe(true);
    expect(retry.attempt.status).toBe('pending');
    expect(retry.attempt.id).toBe(pending.attemptId);
    expect(retry.capability.id).toBe(pending.capabilityId);
  });

  it('7. allows administrative issue for an Assignment with no A7 attempt', async () => {
    const taskId = nextId('task_noa7');
    const recipientId = nextId('rcp_noa7');
    const email = `${recipientId}@example.com`;
    const assignmentId = nextId('asg_noa7');
    await createRecipient(db.prisma, {
      organizationId: org,
      recipient: recipient(recipientId, email),
    });
    const task: Task = {
      ...unassignedTask(taskId),
      assignment: handoffAssignment(assignmentId, recipientId, email),
    };
    await createTask(db.prisma, org, task, task.assignment);

    const issued = await issueCapabilityForTask(
      issueArgs(taskId, { capabilityId: asCapabilityId(nextId('cap_noa7')) }),
    );
    expect(issued.capability.status).toBe('active');
    expect(issued.capability.assignmentId).toBe(assignmentId);
  });

  it('8. does not block once the latest attempt is resolved (sent)', async () => {
    const pending = await beginPendingHandoff();
    await markHandoffSendAccepted({
      db: db.prisma,
      organizationId: org,
      attemptId: pending.attemptId,
      providerMessageId: `msg_gate_${pending.attemptId}`,
      providerAcceptedAt: now,
      expectedSendGeneration: 1,
    });
    const task = await getTaskById(db.prisma, org, pending.taskId);

    const replaced = await replaceCapabilityForTask(
      issueArgs(pending.taskId, {
        capabilityId: asCapabilityId(nextId('cap_after_sent')),
        expectedVersion: task.version,
      }),
    );
    expect(replaced.capability.status).toBe('active');
    expect(replaced.replacedCapabilityId).toBe(pending.capabilityId);
  });

  it('12. exposes no new public error-code distinction (reuses ISSUANCE_CONFLICT)', async () => {
    const pending = await beginPendingHandoff();
    const pendingError = await issueCapabilityForTask(issueArgs(pending.taskId)).catch(
      (e: unknown) => e,
    );
    await markHandoffDeliveryFailed({
      db: db.prisma,
      organizationId: org,
      attemptId: pending.attemptId,
      failureCode: 'GMAIL_TIMEOUT',
      failureCategory: 'retryable_dependency',
      failureFingerprint: pending.requestFingerprint,
      retryable: true,
      expectedSendGeneration: 1,
    });
    const failedError = await issueCapabilityForTask(issueArgs(pending.taskId)).catch(
      (e: unknown) => e,
    );
    expect(readCapabilityTokenErrorCode(pendingError)).toBe('ISSUANCE_CONFLICT');
    expect(readCapabilityTokenErrorCode(failedError)).toBe('ISSUANCE_CONFLICT');
  });
});
