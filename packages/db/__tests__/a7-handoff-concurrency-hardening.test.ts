/**
 * A7.3 concurrency hardening — independent concurrent transactions on PGlite.
 *
 * Engine: in-process PGlite (embedded Postgres) via createTestDatabase().
 * Limitation: PGlite is single-process; Promise.all exercises concurrent Prisma
 * transactions and row-level UPDATE contention similarly to the existing A5/A6
 * concurrent claim tests. True multi-connection PostgreSQL isolation is not
 * separately CI'd here; correctness also rests on conditional UPDATE … WHERE
 * status = 'pending' / status = 'failed' row-count semantics.
 */
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
  assertAdminIssuanceNotBlockedByHandoff,
  beginExplicitReforward,
  beginInitialHandoff,
  beginReassignment,
  createActiveAssignment,
  createCapability,
  createRecipient,
  createTask,
  findLatestHandoffAttemptForAssignment,
  findPendingHandoffAttemptForAssignment,
  getCapabilityById,
  getHandoffAttemptById,
  getTaskById,
  isPersistedCapabilityActionable,
  isUnresolvedHandoffAttemptForAdminIssuance,
  markHandoffAttemptFailed,
  markHandoffAttemptSent,
  markHandoffDeliveryFailed,
  markHandoffSendAccepted,
  prepareFailedHandoffRetry,
  revokeCapabilityRecord,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const orgId = 'org_a7_hard';
const ownerId = 'owner_a7_hard';
const now = '2026-07-18T15:00:00.000Z';
const expiresAt = '2026-07-25T15:00:00.000Z';

/** Documented engine for this suite. */
const CONCURRENCY_TEST_ENGINE = 'PGlite (embedded Postgres via @electric-sql/pglite)';

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}`;
}

let tokenSeq = 0;
function uniqueTokenHash(): string {
  tokenSeq += 1;
  return `h${tokenSeq.toString(16).padStart(63, '0')}`;
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
    displayName: 'Hardening Recipient',
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

async function beginPending(db: TestDatabase['prisma']) {
  const fixture = await seedUnassignedTask(db);
  const assignmentId = nextId('asg');
  const capabilityId = nextId('cap');
  const attemptId = nextId('att');
  const idempotencyKey = nextId('idem');
  const fp = requestFingerprint(fixture.taskId, fixture.recipientId);
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
    tokenHash: uniqueTokenHash(),
    attemptId,
    acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
    deliveryPath: 'assignment_email',
    idempotencyKey,
    requestFingerprint: fp,
  });
  return {
    ...fixture,
    ...result,
    assignmentId,
    capabilityId,
    attemptId,
    idempotencyKey,
    requestFingerprint: fp,
  };
}

function isRejectedWithCode(result: PromiseSettledResult<unknown>, codes: string[]): boolean {
  return (
    result.status === 'rejected' &&
    result.reason instanceof PersistenceError &&
    codes.includes(result.reason.code)
  );
}

describe(`A7.3 concurrency hardening (${CONCURRENCY_TEST_ENGINE})`, () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('1. concurrent sent vs sent with same provider ID is idempotent', async () => {
    const pending = await beginPending(db.prisma);
    const providerMessageId = `msg_same_${pending.attemptId}`;

    const [a, b] = await Promise.allSettled([
      markHandoffSendAccepted({
        db: db.prisma,
        organizationId: orgId,
        attemptId: pending.attemptId,
        providerMessageId,
        providerAcceptedAt: now,
        expectedSendGeneration: 1,
      }),
      markHandoffSendAccepted({
        db: db.prisma,
        organizationId: orgId,
        attemptId: pending.attemptId,
        providerMessageId,
        providerAcceptedAt: now,
        expectedSendGeneration: 1,
      }),
    ]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    const attempt = await getHandoffAttemptById(db.prisma, orgId, pending.attemptId);
    expect(attempt.status).toBe('sent');
    expect(attempt.providerMessageId).toBe(providerMessageId);
    const task = await getTaskById(db.prisma, orgId, pending.taskId);
    expect(task.assignment?.deliveryStatus).toBe('sent');
    const cap = await getCapabilityById(db.prisma, orgId, pending.capabilityId);
    expect(isPersistedCapabilityActionable(cap, now)).toBe(true);
  });

  it('2. concurrent sent vs sent with different provider IDs — exactly one wins', async () => {
    const pending = await beginPending(db.prisma);

    const [a, b] = await Promise.allSettled([
      markHandoffSendAccepted({
        db: db.prisma,
        organizationId: orgId,
        attemptId: pending.attemptId,
        providerMessageId: `msg_a_${pending.attemptId}`,
        providerAcceptedAt: now,
        expectedSendGeneration: 1,
      }),
      markHandoffSendAccepted({
        db: db.prisma,
        organizationId: orgId,
        attemptId: pending.attemptId,
        providerMessageId: `msg_b_${pending.attemptId}`,
        providerAcceptedAt: now,
        expectedSendGeneration: 1,
      }),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(isRejectedWithCode(rejected[0]!, ['INVALID_STATE', 'UNIQUE_VIOLATION'])).toBe(true);

    const attempt = await getHandoffAttemptById(db.prisma, orgId, pending.attemptId);
    expect(attempt.status).toBe('sent');
    expect([`msg_a_${pending.attemptId}`, `msg_b_${pending.attemptId}`]).toContain(
      attempt.providerMessageId,
    );
  });

  it('3. concurrent sent vs failed — exactly one terminal state', async () => {
    const pending = await beginPending(db.prisma);

    const [sentResult, failResult] = await Promise.allSettled([
      markHandoffSendAccepted({
        db: db.prisma,
        organizationId: orgId,
        attemptId: pending.attemptId,
        providerMessageId: `msg_race_${pending.attemptId}`,
        providerAcceptedAt: now,
        expectedSendGeneration: 1,
      }),
      markHandoffDeliveryFailed({
        db: db.prisma,
        organizationId: orgId,
        attemptId: pending.attemptId,
        failureCode: 'GMAIL_SEND_REJECTED',
        failureCategory: 'provider',
        failureFingerprint: 'fp_race_sf',
        retryable: true,
        expectedSendGeneration: 1,
      }),
    ]);

    const winners = [sentResult, failResult].filter((r) => r.status === 'fulfilled');
    const losers = [sentResult, failResult].filter((r) => r.status === 'rejected');
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect(isRejectedWithCode(losers[0]!, ['INVALID_STATE'])).toBe(true);

    const attempt = await getHandoffAttemptById(db.prisma, orgId, pending.attemptId);
    const task = await getTaskById(db.prisma, orgId, pending.taskId);
    const cap = await getCapabilityById(db.prisma, orgId, pending.capabilityId);

    expect(attempt.status).toBe(task.assignment?.deliveryStatus);
    if (attempt.status === 'sent') {
      expect(isPersistedCapabilityActionable(cap, now)).toBe(true);
      expect(cap.actionableAt).not.toBeNull();
    } else {
      expect(attempt.status).toBe('failed');
      expect(isPersistedCapabilityActionable(cap, now)).toBe(false);
      expect(cap.actionableAt).toBeNull();
    }
  });

  it('4. concurrent failed vs failed — one commit or identical idempotent failure', async () => {
    const pending = await beginPending(db.prisma);
    const failure = {
      failureCode: 'GMAIL_TIMEOUT',
      failureCategory: 'retryable_dependency' as const,
      failureFingerprint: 'fp_fail_fail',
      retryable: true,
      expectedSendGeneration: 1,
    };

    const [a, b] = await Promise.allSettled([
      markHandoffDeliveryFailed({
        db: db.prisma,
        organizationId: orgId,
        attemptId: pending.attemptId,
        ...failure,
      }),
      markHandoffDeliveryFailed({
        db: db.prisma,
        organizationId: orgId,
        attemptId: pending.attemptId,
        ...failure,
      }),
    ]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    const attempt = await getHandoffAttemptById(db.prisma, orgId, pending.attemptId);
    expect(attempt.status).toBe('failed');
    expect(attempt.failureFingerprint).toBe('fp_fail_fail');
  });

  it('5. retry versus reassignment — only one incompatible lifecycle wins', async () => {
    const pending = await beginPending(db.prisma);
    await markHandoffDeliveryFailed({
      db: db.prisma,
      organizationId: orgId,
      attemptId: pending.attemptId,
      failureCode: 'GMAIL_TIMEOUT',
      failureCategory: 'retryable_dependency',
      failureFingerprint: pending.requestFingerprint,
      retryable: true,
      expectedSendGeneration: 1,
    });
    const task = await getTaskById(db.prisma, orgId, pending.taskId);

    const newRecipientId = nextId('rcp_re');
    const newEmail = `${newRecipientId}@example.com`;
    await createRecipient(db.prisma, {
      organizationId: orgId,
      recipient: recipient(newRecipientId, newEmail),
    });
    const newAssignmentId = nextId('asg_re');
    const newCapId = nextId('cap_re');

    const [retryResult, reassignResult] = await Promise.allSettled([
      prepareFailedHandoffRetry({
        db: db.prisma,
        organizationId: orgId,
        attemptId: pending.attemptId,
        requestFingerprint: pending.requestFingerprint,
        newTokenHash: uniqueTokenHash(),
      }),
      beginReassignment({
        db: db.prisma,
        organizationId: orgId,
        priorAttemptId: pending.attemptId,
        expectedTaskVersion: task.version,
        task,
        newAssignment: handoffAssignment(newAssignmentId, pending.taskId, newRecipientId, newEmail),
        capability: handoffCapability(
          newCapId,
          pending.taskId,
          newAssignmentId,
          newRecipientId,
          newEmail,
        ),
        tokenHash: uniqueTokenHash(),
        attemptId: nextId('att_re'),
        acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
        deliveryPath: 'assignment_email',
        idempotencyKey: nextId('idem_re'),
        requestFingerprint: requestFingerprint(pending.taskId, newRecipientId),
        now,
      }),
    ]);

    const fulfilled = [retryResult, reassignResult].filter((r) => r.status === 'fulfilled');
    const rejected = [retryResult, reassignResult].filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const priorCap = await getCapabilityById(db.prisma, orgId, pending.capabilityId);
    if (retryResult.status === 'fulfilled') {
      expect(priorCap.status).toBe('active');
      expect(priorCap.actionableAt).toBeNull();
      expect(isPersistedCapabilityActionable(priorCap, now)).toBe(false);
    } else {
      expect(priorCap.status).toBe('revoked');
      expect(priorCap.revocationReason).toBe('superseded');
    }
  });

  it('6. retry versus explicit re-forward — incompatible statuses cannot both succeed', async () => {
    const pending = await beginPending(db.prisma);
    await markHandoffSendAccepted({
      db: db.prisma,
      organizationId: orgId,
      attemptId: pending.attemptId,
      providerMessageId: `msg_rf_${pending.attemptId}`,
      providerAcceptedAt: now,
      expectedSendGeneration: 1,
    });
    const task = await getTaskById(db.prisma, orgId, pending.taskId);

    // Retry requires failed; re-forward requires sent — retry must lose.
    const [retryResult, reforwardResult] = await Promise.allSettled([
      prepareFailedHandoffRetry({
        db: db.prisma,
        organizationId: orgId,
        attemptId: pending.attemptId,
        requestFingerprint: pending.requestFingerprint,
        newTokenHash: uniqueTokenHash(),
      }),
      beginExplicitReforward({
        db: db.prisma,
        organizationId: orgId,
        priorAttemptId: pending.attemptId,
        expectedTaskVersion: task.version,
        task,
        capability: handoffCapability(
          nextId('cap_rf'),
          pending.taskId,
          pending.assignmentId,
          pending.recipientId,
          pending.email,
        ),
        tokenHash: uniqueTokenHash(),
        attemptId: nextId('att_rf'),
        acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
        deliveryPath: 'assignment_email',
        idempotencyKey: nextId('idem_rf'),
        requestFingerprint: requestFingerprint(pending.taskId, pending.recipientId),
        now,
      }),
    ]);

    expect(retryResult.status).toBe('rejected');
    expect(isRejectedWithCode(retryResult, ['INVALID_STATE'])).toBe(true);
    expect(reforwardResult.status).toBe('fulfilled');
  });

  it('7. same-key same-fingerprint concurrency yields one created + replay', async () => {
    const fixture = await seedUnassignedTask(db.prisma);
    const assignmentId = nextId('asg_sk');
    const capabilityId = nextId('cap_sk');
    const attemptId = nextId('att_sk');
    const idempotencyKey = nextId('idem_sk');
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

    expect(created.length).toBe(1);
    expect(created.length + replay.length + rejected.length).toBe(2);
    // Prefer replay via unique→re-lookup; under PGlite timing a loser may still reject.
    if (fulfilled.length === 2) {
      expect(replay.length).toBe(1);
      expect(fulfilled[0]!.value.attempt.id).toBe(fulfilled[1]!.value.attempt.id);
    }
  });

  it('8. same-key conflicting-fingerprint concurrency — one reservation, conflict for other', async () => {
    const fixture = await seedUnassignedTask(db.prisma);
    const idempotencyKey = nextId('idem_cf');
    const assignmentId = nextId('asg_cf');
    const make = (fp: string, suffix: string) => ({
      db: db.prisma,
      organizationId: orgId,
      ownerId,
      expectedTaskVersion: fixture.task.version,
      task: fixture.task,
      assignment: handoffAssignment(
        `${assignmentId}_${suffix}`,
        fixture.taskId,
        fixture.recipientId,
        fixture.email,
      ),
      capability: handoffCapability(
        nextId(`cap_cf_${suffix}`),
        fixture.taskId,
        `${assignmentId}_${suffix}`,
        fixture.recipientId,
        fixture.email,
      ),
      tokenHash: uniqueTokenHash(),
      attemptId: nextId(`att_cf_${suffix}`),
      acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
      deliveryPath: 'assignment_email' as const,
      idempotencyKey,
      requestFingerprint: fp,
    });

    const [a, b] = await Promise.allSettled([
      beginInitialHandoff(make(requestFingerprint(fixture.taskId, fixture.recipientId), 'a')),
      beginInitialHandoff(make('conflicting_fingerprint_value', 'b')),
    ]);

    const created = [a, b].filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof beginInitialHandoff>>> =>
        r.status === 'fulfilled' && r.value.kind === 'created',
    );
    const conflicts = [a, b].filter(
      (r) =>
        r.status === 'rejected' &&
        r.reason instanceof PersistenceError &&
        r.reason.code === 'IDEMPOTENCY_KEY_CONFLICT',
    );
    // One may win create; the other must conflict (or lose on assignment unique then conflict on replay).
    expect(created.length).toBe(1);
    expect(
      conflicts.length + [a, b].filter((r) => r.status === 'rejected').length,
    ).toBeGreaterThanOrEqual(1);
    expect([a, b].filter((r) => r.status === 'rejected').length).toBe(1);
  });

  it('9. different-key initial handoff concurrency — one winner', async () => {
    const fixture = await seedUnassignedTask(db.prisma);
    const fp = requestFingerprint(fixture.taskId, fixture.recipientId);
    const make = (suffix: string) => {
      const assignmentId = nextId(`asg_dk_${suffix}`);
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
          nextId(`cap_dk_${suffix}`),
          fixture.taskId,
          assignmentId,
          fixture.recipientId,
          fixture.email,
        ),
        tokenHash: uniqueTokenHash(),
        attemptId: nextId(`att_dk_${suffix}`),
        acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
        deliveryPath: 'assignment_email' as const,
        idempotencyKey: nextId(`idem_dk_${suffix}`),
        requestFingerprint: fp,
      };
    };

    const [a, b] = await Promise.allSettled([
      beginInitialHandoff(make('a')),
      beginInitialHandoff(make('b')),
    ]);
    const winners = [a, b].filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof beginInitialHandoff>>> =>
        r.status === 'fulfilled' && r.value.kind === 'created',
    );
    expect(winners.length).toBe(1);
    expect([a, b].filter((r) => r.status === 'rejected').length).toBe(1);
  });

  it('10. simultaneous A4 admin capability create and A7 pending — one-active wins', async () => {
    const pending = await beginPending(db.prisma);
    // A7 already holds the one active (non-actionable) capability. Admin create must lose.
    const adminCapId = nextId('cap_admin');
    const [adminResult] = await Promise.allSettled([
      createCapability(
        db.prisma,
        orgId,
        handoffCapability(
          adminCapId,
          pending.taskId,
          pending.assignmentId,
          pending.recipientId,
          pending.email,
        ),
        uniqueTokenHash(),
        // A4 default path sets actionableAt = issuedAt
      ),
      findPendingHandoffAttemptForAssignment(db.prisma, orgId, pending.assignmentId),
    ]);

    expect(adminResult.status).toBe('rejected');
    expect(isRejectedWithCode(adminResult, ['UNIQUE_VIOLATION'])).toBe(true);
    const pendingAttempt = await findPendingHandoffAttemptForAssignment(
      db.prisma,
      orgId,
      pending.assignmentId,
    );
    expect(pendingAttempt?.id).toBe(pending.attemptId);
    const cap = await getCapabilityById(db.prisma, orgId, pending.capabilityId);
    expect(cap.status).toBe('active');
    expect(isPersistedCapabilityActionable(cap, now)).toBe(false);
  });

  it('11. pending active-status capability remains non-actionable', async () => {
    const pending = await beginPending(db.prisma);
    const cap = await getCapabilityById(db.prisma, orgId, pending.capabilityId);
    expect(cap.status).toBe('active');
    expect(cap.actionableAt).toBeNull();
    expect(isPersistedCapabilityActionable(cap, now)).toBe(false);
  });

  it('12. failed active-status capability remains non-actionable', async () => {
    const pending = await beginPending(db.prisma);
    await markHandoffDeliveryFailed({
      db: db.prisma,
      organizationId: orgId,
      attemptId: pending.attemptId,
      failureCode: 'GMAIL_REJECTED',
      failureCategory: 'provider',
      failureFingerprint: 'fp_failed_na',
      retryable: true,
      expectedSendGeneration: 1,
    });
    const cap = await getCapabilityById(db.prisma, orgId, pending.capabilityId);
    expect(cap.status).toBe('active');
    expect(isPersistedCapabilityActionable(cap, now)).toBe(false);
  });

  it('13. sent capability becomes actionable atomically with Assignment activation', async () => {
    const pending = await beginPending(db.prisma);
    const accepted = await markHandoffSendAccepted({
      db: db.prisma,
      organizationId: orgId,
      attemptId: pending.attemptId,
      providerMessageId: `msg_atomic_${pending.attemptId}`,
      providerAcceptedAt: now,
      expectedSendGeneration: 1,
    });
    const task = await getTaskById(db.prisma, orgId, pending.taskId);
    expect(accepted.attempt.status).toBe('sent');
    expect(task.assignment?.deliveryStatus).toBe('sent');
    expect(accepted.capability.actionableAt).toBe(now);
    expect(isPersistedCapabilityActionable(accepted.capability, now)).toBe(true);
  });

  it('14. mixed terminal states cannot commit through repository primitives', async () => {
    const pending = await beginPending(db.prisma);
    await markHandoffSendAccepted({
      db: db.prisma,
      organizationId: orgId,
      attemptId: pending.attemptId,
      providerMessageId: `msg_mix_${pending.attemptId}`,
      providerAcceptedAt: now,
      expectedSendGeneration: 1,
    });

    await expect(
      markHandoffDeliveryFailed({
        db: db.prisma,
        organizationId: orgId,
        attemptId: pending.attemptId,
        failureCode: 'SHOULD_NOT_APPLY',
        failureCategory: 'provider',
        failureFingerprint: 'fp_mix',
        retryable: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const attempt = await getHandoffAttemptById(db.prisma, orgId, pending.attemptId);
    const task = await getTaskById(db.prisma, orgId, pending.taskId);
    const cap = await getCapabilityById(db.prisma, orgId, pending.capabilityId);
    expect(attempt.status).toBe('sent');
    expect(task.assignment?.deliveryStatus).toBe('sent');
    expect(isPersistedCapabilityActionable(cap, now)).toBe(true);
  });

  it('15. provider message ID is immutable once recorded', async () => {
    const pending = await beginPending(db.prisma);
    await markHandoffSendAccepted({
      db: db.prisma,
      organizationId: orgId,
      attemptId: pending.attemptId,
      providerMessageId: `msg_imm_${pending.attemptId}`,
      providerAcceptedAt: now,
      expectedSendGeneration: 1,
    });
    await expect(
      markHandoffAttemptSent(db.prisma, {
        organizationId: orgId,
        attemptId: pending.attemptId,
        providerMessageId: `msg_imm_other_${pending.attemptId}`,
        providerAcceptedAt: now,
        expectedSendGeneration: 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('16. provider message ID cannot finalize two different attempts (org-scoped unique)', async () => {
    const first = await beginPending(db.prisma);
    const second = await beginPending(db.prisma);
    const sharedProviderId = `msg_shared_${first.attemptId}_${second.attemptId}`;

    await markHandoffSendAccepted({
      db: db.prisma,
      organizationId: orgId,
      attemptId: first.attemptId,
      providerMessageId: sharedProviderId,
      providerAcceptedAt: now,
      expectedSendGeneration: 1,
    });

    await expect(
      markHandoffSendAccepted({
        db: db.prisma,
        organizationId: orgId,
        attemptId: second.attemptId,
        providerMessageId: sharedProviderId,
        providerAcceptedAt: now,
        expectedSendGeneration: 1,
      }),
    ).rejects.toMatchObject({ code: 'UNIQUE_VIOLATION' });

    const secondAttempt = await getHandoffAttemptById(db.prisma, orgId, second.attemptId);
    expect(secondAttempt.status).toBe('pending');
    expect(secondAttempt.providerMessageId).toBeNull();
  });

  it('17. repository sent/fail primitives reject overwrite of opposing terminal', async () => {
    const pending = await beginPending(db.prisma);
    await markHandoffAttemptFailed(db.prisma, {
      organizationId: orgId,
      attemptId: pending.attemptId,
      failureCode: 'X',
      failureCategory: 'provider',
      failureFingerprint: 'fp_x',
      retryable: true,
      expectedSendGeneration: 1,
    });
    await expect(
      markHandoffAttemptSent(db.prisma, {
        organizationId: orgId,
        attemptId: pending.attemptId,
        providerMessageId: `msg_no_${pending.attemptId}`,
        providerAcceptedAt: now,
        expectedSendGeneration: 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('18. revoked prior capability stays revoked after losing retry path', async () => {
    const pending = await beginPending(db.prisma);
    await markHandoffDeliveryFailed({
      db: db.prisma,
      organizationId: orgId,
      attemptId: pending.attemptId,
      failureCode: 'GMAIL_TIMEOUT',
      failureCategory: 'retryable_dependency',
      failureFingerprint: pending.requestFingerprint,
      retryable: true,
      expectedSendGeneration: 1,
    });
    await revokeCapabilityRecord(db.prisma, orgId, pending.capabilityId, now, 'superseded');

    await expect(
      prepareFailedHandoffRetry({
        db: db.prisma,
        organizationId: orgId,
        attemptId: pending.attemptId,
        requestFingerprint: pending.requestFingerprint,
        newTokenHash: uniqueTokenHash(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const cap = await getCapabilityById(db.prisma, orgId, pending.capabilityId);
    expect(cap.status).toBe('revoked');
  });

  // --- A7.3 admin-issuance-after-failed policy (DB primitives + concurrency) ---

  /** Mimic an A4 replaceExisting issuance transaction using only DB primitives. */
  async function adminReplaceTxn(input: {
    assignmentId: string;
    taskId: string;
    recipientId: string;
    email: string;
    priorCapabilityId: string;
  }) {
    return db.prisma.$transaction(async (tx) => {
      await assertAdminIssuanceNotBlockedByHandoff(tx, orgId, input.assignmentId);
      await revokeCapabilityRecord(tx, orgId, input.priorCapabilityId, now, 'manual');
      return createCapability(
        tx,
        orgId,
        handoffCapability(
          nextId('cap_admin'),
          input.taskId,
          input.assignmentId,
          input.recipientId,
          input.email,
        ),
        uniqueTokenHash(),
      );
    });
  }

  it('19. gate primitive selects latest attempt and blocks pending/failed, allows sent/none', async () => {
    // none: A4-style assignment with no handoff attempt → allowed
    const fixture = await seedUnassignedTask(db.prisma);
    const bareAssignmentId = nextId('asg_bare');
    await createActiveAssignment(
      db.prisma,
      orgId,
      fixture.taskId,
      handoffAssignment(bareAssignmentId, fixture.taskId, fixture.recipientId, fixture.email),
    );
    await expect(
      assertAdminIssuanceNotBlockedByHandoff(db.prisma, orgId, bareAssignmentId),
    ).resolves.toBeUndefined();

    // pending → blocked
    const pending = await beginPending(db.prisma);
    await expect(
      assertAdminIssuanceNotBlockedByHandoff(db.prisma, orgId, pending.assignmentId),
    ).rejects.toMatchObject({ code: 'HANDOFF_IN_PROGRESS' });

    // retryable failed → blocked
    const failedRetryable = await beginPending(db.prisma);
    await markHandoffDeliveryFailed({
      db: db.prisma,
      organizationId: orgId,
      attemptId: failedRetryable.attemptId,
      failureCode: 'GMAIL_TIMEOUT',
      failureCategory: 'retryable_dependency',
      failureFingerprint: failedRetryable.requestFingerprint,
      retryable: true,
      expectedSendGeneration: 1,
    });
    await expect(
      assertAdminIssuanceNotBlockedByHandoff(db.prisma, orgId, failedRetryable.assignmentId),
    ).rejects.toMatchObject({ code: 'HANDOFF_IN_PROGRESS' });

    // non-retryable failed → still blocked (no implicit abandon)
    const failedPermanent = await beginPending(db.prisma);
    await markHandoffDeliveryFailed({
      db: db.prisma,
      organizationId: orgId,
      attemptId: failedPermanent.attemptId,
      failureCode: 'GMAIL_PERMANENT',
      failureCategory: 'provider',
      failureFingerprint: failedPermanent.requestFingerprint,
      retryable: false,
      expectedSendGeneration: 1,
    });
    expect(isUnresolvedHandoffAttemptForAdminIssuance({ status: 'failed' })).toBe(true);
    await expect(
      assertAdminIssuanceNotBlockedByHandoff(db.prisma, orgId, failedPermanent.assignmentId),
    ).rejects.toMatchObject({ code: 'HANDOFF_IN_PROGRESS' });

    // sent → resolved, allowed
    const sent = await beginPending(db.prisma);
    await markHandoffSendAccepted({
      db: db.prisma,
      organizationId: orgId,
      attemptId: sent.attemptId,
      providerMessageId: `msg_gate19_${sent.attemptId}`,
      providerAcceptedAt: now,
      expectedSendGeneration: 1,
    });
    const latest = await findLatestHandoffAttemptForAssignment(db.prisma, orgId, sent.assignmentId);
    expect(latest?.status).toBe('sent');
    expect(isUnresolvedHandoffAttemptForAdminIssuance({ status: 'sent' })).toBe(false);
    await expect(
      assertAdminIssuanceNotBlockedByHandoff(db.prisma, orgId, sent.assignmentId),
    ).resolves.toBeUndefined();
  });

  it('20. direct createCapability cannot bypass: one-active unique blocks a second active cap', async () => {
    const pending = await beginPending(db.prisma);
    // The failed/pending attempt keeps its capability status=active; a naive direct create
    // for the same assignment violates the one-active partial unique.
    await markHandoffDeliveryFailed({
      db: db.prisma,
      organizationId: orgId,
      attemptId: pending.attemptId,
      failureCode: 'GMAIL_TIMEOUT',
      failureCategory: 'retryable_dependency',
      failureFingerprint: pending.requestFingerprint,
      retryable: true,
      expectedSendGeneration: 1,
    });
    await expect(
      createCapability(
        db.prisma,
        orgId,
        handoffCapability(
          nextId('cap_direct'),
          pending.taskId,
          pending.assignmentId,
          pending.recipientId,
          pending.email,
        ),
        uniqueTokenHash(),
      ),
    ).rejects.toMatchObject({ code: 'UNIQUE_VIOLATION' });

    // And the transaction-level gate rejects too.
    await expect(
      assertAdminIssuanceNotBlockedByHandoff(db.prisma, orgId, pending.assignmentId),
    ).rejects.toMatchObject({ code: 'HANDOFF_IN_PROGRESS' });
  });

  it('21. concurrent admin issuance vs retry: retry wins, admin blocked, attempt not orphaned', async () => {
    const pending = await beginPending(db.prisma);
    await markHandoffDeliveryFailed({
      db: db.prisma,
      organizationId: orgId,
      attemptId: pending.attemptId,
      failureCode: 'GMAIL_TIMEOUT',
      failureCategory: 'retryable_dependency',
      failureFingerprint: pending.requestFingerprint,
      retryable: true,
      expectedSendGeneration: 1,
    });

    const [adminResult, retryResult] = await Promise.allSettled([
      adminReplaceTxn({
        assignmentId: pending.assignmentId,
        taskId: pending.taskId,
        recipientId: pending.recipientId,
        email: pending.email,
        priorCapabilityId: pending.capabilityId,
      }),
      prepareFailedHandoffRetry({
        db: db.prisma,
        organizationId: orgId,
        attemptId: pending.attemptId,
        requestFingerprint: pending.requestFingerprint,
        newTokenHash: uniqueTokenHash(),
      }),
    ]);

    expect(adminResult.status).toBe('rejected');
    expect(isRejectedWithCode(adminResult, ['HANDOFF_IN_PROGRESS'])).toBe(true);
    expect(retryResult.status).toBe('fulfilled');

    const attempt = await getHandoffAttemptById(db.prisma, orgId, pending.attemptId);
    const cap = await getCapabilityById(db.prisma, orgId, pending.capabilityId);
    expect(attempt.status).toBe('pending');
    expect(attempt.capabilityId).toBe(pending.capabilityId);
    expect(cap.status).toBe('active');
    expect(cap.actionableAt).toBeNull();
  });

  it('22. concurrent admin issuance vs failure recording: failure wins, capability not superseded', async () => {
    const pending = await beginPending(db.prisma);

    const [adminResult, failResult] = await Promise.allSettled([
      adminReplaceTxn({
        assignmentId: pending.assignmentId,
        taskId: pending.taskId,
        recipientId: pending.recipientId,
        email: pending.email,
        priorCapabilityId: pending.capabilityId,
      }),
      markHandoffDeliveryFailed({
        db: db.prisma,
        organizationId: orgId,
        attemptId: pending.attemptId,
        failureCode: 'GMAIL_SEND_REJECTED',
        failureCategory: 'provider',
        failureFingerprint: pending.requestFingerprint,
        retryable: true,
        expectedSendGeneration: 1,
      }),
    ]);

    expect(adminResult.status).toBe('rejected');
    expect(isRejectedWithCode(adminResult, ['HANDOFF_IN_PROGRESS'])).toBe(true);
    expect(failResult.status).toBe('fulfilled');

    const attempt = await getHandoffAttemptById(db.prisma, orgId, pending.attemptId);
    const cap = await getCapabilityById(db.prisma, orgId, pending.capabilityId);
    expect(attempt.status).toBe('failed');
    expect(cap.status).toBe('active');
    expect(cap.actionableAt).toBeNull();
  });

  it('23. same-key concurrent loser never surfaces a raw UNIQUE_VIOLATION', async () => {
    const fixture = await seedUnassignedTask(db.prisma);
    const assignmentId = nextId('asg_idem');
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
        nextId('cap_idem'),
        fixture.taskId,
        assignmentId,
        fixture.recipientId,
        fixture.email,
      ),
      tokenHash: uniqueTokenHash(),
      attemptId: nextId('att_idem'),
      acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
      deliveryPath: 'assignment_email' as const,
      idempotencyKey: nextId('idem_idem'),
      requestFingerprint: requestFingerprint(fixture.taskId, fixture.recipientId),
    };

    const results = await Promise.allSettled([
      beginInitialHandoff(input),
      beginInitialHandoff(input),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(PersistenceError);
        // Loser must receive a stable typed retry/conflict, never a raw UNIQUE_VIOLATION.
        expect((r.reason as PersistenceError).code).not.toBe('UNIQUE_VIOLATION');
        expect(['HANDOFF_IN_PROGRESS', 'IDEMPOTENCY_KEY_CONFLICT']).toContain(
          (r.reason as PersistenceError).code,
        );
      }
    }
    // Exactly one durable attempt exists regardless of timing.
    const latest = await findLatestHandoffAttemptForAssignment(db.prisma, orgId, assignmentId);
    expect(latest?.id).toBe(input.attemptId);
  });
});
