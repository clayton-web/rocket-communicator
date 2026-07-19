import type {
  CapabilityRevocationReason,
  Task,
  TaskAssignment,
  TaskCapability,
} from '@aicaa/domain';
import type { DbClient } from '../client/create-prisma-client.js';
import { createAuditEvent, type CreateAuditEventInput } from '../repositories/audit-repository.js';
import {
  activateCapabilityRecord,
  createCapability,
  getCapabilityById,
  isPersistedCapabilityActionable,
  revokeCapabilityRecord,
  rotateCapabilityTokenHash,
  type PersistedCapability,
} from '../repositories/capability-repository.js';
import {
  assertAttemptAssignmentDeliveryAligned,
  createHandoffAttempt,
  findPendingHandoffAttemptForTask,
  getHandoffAttemptById,
  lockHandoffAttemptForUpdate,
  lookupHandoffIdempotency,
  markHandoffAttemptFailed,
  markHandoffAttemptSent,
  prepareHandoffAttemptRetry,
  type HandoffIdempotencyLookup,
} from '../repositories/handoff-attempt-repository.js';
import type { PersistedHandoffAttempt } from '../mappers/domain-mappers.js';
import { PersistenceError } from '../errors/persistence-errors.js';
import { requireActiveRecipientForHandoff } from '../repositories/recipient-repository.js';
import {
  clearAssignment,
  createActiveAssignment,
  getTaskById,
  updateActiveAssignmentCapabilityBinding,
  updateActiveAssignmentDeliveryStatus,
  updateTaskWithExpectedVersion,
} from '../repositories/task-repository.js';
import type { AuditEventRecord } from '../mappers/domain-mappers.js';
import {
  domainConflict,
  handoffInProgress,
  idempotencyKeyConflict,
  invalidState,
  persistenceValidation,
  recipientHandoffNotAvailable,
  uniqueViolation,
} from '../errors/persistence-errors.js';
import { Prisma } from '../generated/client/index.js';

/**
 * Distributed boundary (for later application orchestration — NOT A7.4; A7.4 is Gmail OAuth
 * send-scope preparation + transport/MIME utilities only):
 * 1) DB txn creates durable pending state and commits.
 * 2) Application calls Gmail (outside any DB transaction).
 * 3) DB txn records accepted or failed outcome.
 *
 * Uncertain windows that cannot be eliminated by a DB transaction:
 * - Gmail accepts send but app fails before recording sent
 * - pending recorded but Gmail never called
 * - timeout while provider outcome unknown
 * Pending + timestamps remain discoverable for a later, explicitly-authorized reconciliation
 * worker (not A7.4); no separate "unknown" status.
 */

export type BeginInitialHandoffInput = {
  db: DbClient;
  organizationId: string;
  ownerId: string;
  expectedTaskVersion: number;
  task: Task;
  assignment: TaskAssignment;
  capability: TaskCapability;
  tokenHash: string;
  attemptId: string;
  acknowledgement: string;
  deliveryPath: 'gmail_forward' | 'assignment_email';
  idempotencyKey: string;
  requestFingerprint: string;
  audit?: CreateAuditEventInput;
};

export type BeginInitialHandoffResult = {
  kind: 'created' | 'replay_pending' | 'replay_sent' | 'retry_failed';
  attempt: PersistedHandoffAttempt;
  task: Task;
  capability: PersistedCapability;
  audit?: AuditEventRecord;
};

async function assertTaskEligibleForInitialHandoff(
  db: Parameters<typeof getTaskById>[0],
  organizationId: string,
  taskId: string,
): Promise<Task> {
  const task = await getTaskById(db, organizationId, taskId);
  if (task.assignment) {
    throw domainConflict('Task is already assigned; use reassignment or explicit re-forward.');
  }
  if (task.status === 'completed' || task.status === 'dismissed') {
    throw persistenceValidation('Terminal Tasks cannot enter handoff.');
  }
  const pending = await findPendingHandoffAttemptForTask(db, organizationId, taskId);
  if (pending) {
    throw handoffInProgress('A handoff attempt is already in progress for this Task.');
  }
  return task;
}

async function replayFromIdempotencyLookup(
  db: Parameters<typeof getTaskById>[0],
  organizationId: string,
  taskId: string,
  idempotency: Exclude<HandoffIdempotencyLookup, { kind: 'new_request' }>,
): Promise<BeginInitialHandoffResult> {
  if (idempotency.kind === 'key_conflict') {
    throw idempotencyKeyConflict('Idempotency-Key was reused with a conflicting handoff payload.');
  }
  const capability = await getCapabilityById(db, organizationId, idempotency.attempt.capabilityId);
  const task = await getTaskById(db, organizationId, taskId);
  const kind =
    idempotency.kind === 'replay_pending'
      ? 'replay_pending'
      : idempotency.kind === 'replay_sent'
        ? 'replay_sent'
        : 'retry_failed';
  return { kind, attempt: idempotency.attempt, task, capability };
}

/**
 * A. Begin initial handoff — stops before Gmail is called.
 * Same-key races: unique (organization_id, idempotency_key) + post-conflict replay.
 * Different-key races: one-active Assignment partial unique.
 */
export async function beginInitialHandoff(
  input: BeginInitialHandoffInput,
): Promise<BeginInitialHandoffResult> {
  try {
    return await input.db.$transaction(async (tx) => {
      const idempotency = await lookupHandoffIdempotency(tx, {
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
      });

      if (idempotency.kind !== 'new_request') {
        return replayFromIdempotencyLookup(tx, input.organizationId, input.task.id, idempotency);
      }

      await assertTaskEligibleForInitialHandoff(tx, input.organizationId, input.task.id);
      await requireActiveRecipientForHandoff(
        tx,
        input.organizationId,
        input.assignment.recipientId,
      );

      // Bump Task version under If-Match CAS so the post-handoff ETag advances (OpenAPI / A7.7).
      // Replays never reach this write — they return from the idempotency lookup above.
      const nextVersion = input.expectedTaskVersion + 1;
      const taskAfterVersion = await updateTaskWithExpectedVersion(
        tx,
        input.organizationId,
        input.expectedTaskVersion,
        {
          ...input.task,
          assignment: undefined,
          version: nextVersion,
          updatedAt: input.task.updatedAt,
        },
      );
      void taskAfterVersion;

      const assignment: TaskAssignment = {
        ...input.assignment,
        deliveryStatus: 'pending',
        capabilityStatus: 'active',
        activeCapabilityId: input.capability.id,
      };

      try {
        await createActiveAssignment(tx, input.organizationId, input.task.id, assignment);
      } catch (error) {
        if (error instanceof PersistenceError && error.code === 'UNIQUE_VIOLATION') {
          throw uniqueViolation('Concurrent handoff won the active assignment slot.');
        }
        throw error;
      }

      let capability: PersistedCapability;
      try {
        capability = await createCapability(
          tx,
          input.organizationId,
          input.capability,
          input.tokenHash,
          { actionableAt: null },
        );
      } catch (error) {
        if (error instanceof PersistenceError && error.code === 'UNIQUE_VIOLATION') {
          throw uniqueViolation('Concurrent capability issuance violated one-active rule.');
        }
        throw error;
      }

      const attempt = await createHandoffAttempt(tx, {
        id: input.attemptId,
        organizationId: input.organizationId,
        taskId: input.task.id,
        recipientId: input.assignment.recipientId,
        assignmentId: input.assignment.id,
        capabilityId: input.capability.id,
        acknowledgement: input.acknowledgement,
        deliveryPath: input.deliveryPath,
        status: 'pending',
        intent: 'initial',
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        rootAttemptId: input.attemptId,
      });

      const audit = input.audit ? await createAuditEvent(tx, input.audit) : undefined;
      const reloaded = await getTaskById(tx, input.organizationId, input.task.id);
      return { kind: 'created', attempt, task: reloaded, capability, audit };
    });
  } catch (error) {
    // Concurrent create loser: the transaction rolled back after hitting a uniqueness guard
    // (idempotency key for a same-key race, or the one-active Assignment slot for a
    // different-key race). Re-resolve against the winning transaction.
    if (error instanceof PersistenceError && error.code === 'UNIQUE_VIOLATION') {
      const idempotency = await lookupHandoffIdempotency(input.db, {
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
      });
      if (idempotency.kind !== 'new_request') {
        // Winner is visible: deterministic replay of the single durable attempt.
        return replayFromIdempotencyLookup(
          input.db,
          input.organizationId,
          input.task.id,
          idempotency,
        );
      }
      // Winner not yet visible under READ COMMITTED (or a different-key slot loser). Never leak a
      // raw UNIQUE_VIOLATION across the persistence boundary — surface a stable typed retry/conflict.
      // A later call deterministically replays the winning same-key attempt, or observes the
      // durable conflict for a different-key loser.
      throw handoffInProgress(
        'A concurrent handoff attempt is being created for this task; retry to replay or observe the conflict.',
      );
    }
    throw error;
  }
}

/**
 * B. Mark Gmail send accepted — after provider acceptance, outside the create txn.
 * Attempt pending→sent, Assignment pending→sent, and capability activation are one transaction.
 */
export async function markHandoffSendAccepted(input: {
  db: DbClient;
  organizationId: string;
  attemptId: string;
  providerMessageId: string;
  providerAcceptedAt: string;
  /**
   * Send generation (attemptCount) of the winning execution that performed this send. A stale result
   * from a superseded generation (e.g. a prior send before an explicit retry rotated the token) is
   * rejected with INVALID_STATE without mutating state or activating the rotated capability.
   */
  expectedSendGeneration: number;
  audit?: CreateAuditEventInput;
}): Promise<{
  attempt: PersistedHandoffAttempt;
  capability: PersistedCapability;
  audit?: AuditEventRecord;
}> {
  return input.db.$transaction(async (tx) => {
    const attempt = await markHandoffAttemptSent(tx, {
      organizationId: input.organizationId,
      attemptId: input.attemptId,
      providerMessageId: input.providerMessageId,
      providerAcceptedAt: input.providerAcceptedAt,
      expectedSendGeneration: input.expectedSendGeneration,
    });

    const assignmentSync = await updateActiveAssignmentDeliveryStatus(
      tx,
      input.organizationId,
      attempt.taskId,
      'sent',
      { fromStatus: 'pending' },
    );
    if (!assignmentSync.updated) {
      // Idempotent replay of sent, or loser of a race that already set sent.
      const task = await getTaskById(tx, input.organizationId, attempt.taskId);
      if (task.assignment?.deliveryStatus !== 'sent') {
        throw invalidState(
          'Sent attempt requires Assignment.deliveryStatus=sent. Trust HandoffAttempt.status.',
        );
      }
    }

    const capability = await activateCapabilityRecord(
      tx,
      input.organizationId,
      attempt.capabilityId,
      input.providerAcceptedAt,
    );

    if (!isPersistedCapabilityActionable(capability, input.providerAcceptedAt)) {
      throw invalidState('Capability must be actionable after send acceptance.');
    }

    await updateActiveAssignmentCapabilityBinding(tx, input.organizationId, attempt.taskId, {
      activeCapabilityId: capability.id,
      capabilityStatus: 'active',
      deliveryStatus: 'sent',
    });

    const task = await getTaskById(tx, input.organizationId, attempt.taskId);
    assertAttemptAssignmentDeliveryAligned({
      attemptStatus: attempt.status,
      assignmentDeliveryStatus: task.assignment?.deliveryStatus,
    });

    const audit = input.audit ? await createAuditEvent(tx, input.audit) : undefined;
    return { attempt, capability, audit };
  });
}

/**
 * C. Mark delivery failed — capability is not superseded and remains non-actionable.
 */
export async function markHandoffDeliveryFailed(input: {
  db: DbClient;
  organizationId: string;
  attemptId: string;
  failureCode: string;
  failureCategory: NonNullable<PersistedHandoffAttempt['failureCategory']>;
  failureFingerprint: string;
  retryable: boolean;
  /**
   * Send generation (attemptCount) of the execution that produced this failure. A stale failure from
   * a superseded generation must not mark a newer retry generation failed (rejected INVALID_STATE).
   */
  expectedSendGeneration: number;
  audit?: CreateAuditEventInput;
}): Promise<{ attempt: PersistedHandoffAttempt; audit?: AuditEventRecord }> {
  return input.db.$transaction(async (tx) => {
    const attempt = await markHandoffAttemptFailed(tx, {
      organizationId: input.organizationId,
      attemptId: input.attemptId,
      failureCode: input.failureCode,
      failureCategory: input.failureCategory,
      failureFingerprint: input.failureFingerprint,
      retryable: input.retryable,
      expectedSendGeneration: input.expectedSendGeneration,
    });

    const assignmentSync = await updateActiveAssignmentDeliveryStatus(
      tx,
      input.organizationId,
      attempt.taskId,
      'failed',
      { fromStatus: 'pending' },
    );
    if (!assignmentSync.updated) {
      const task = await getTaskById(tx, input.organizationId, attempt.taskId);
      if (task.assignment?.deliveryStatus === 'sent') {
        throw invalidState('A sent handoff cannot transition Assignment delivery to failed.');
      }
      if (task.assignment?.deliveryStatus !== 'failed') {
        throw invalidState(
          'Failed attempt requires Assignment.deliveryStatus=failed. Trust HandoffAttempt.status.',
        );
      }
    }

    const capability = await getCapabilityById(tx, input.organizationId, attempt.capabilityId);
    if (capability.actionableAt != null) {
      throw invalidState('Failed handoff must leave capability non-actionable.');
    }

    const task = await getTaskById(tx, input.organizationId, attempt.taskId);
    assertAttemptAssignmentDeliveryAligned({
      attemptStatus: attempt.status,
      assignmentDeliveryStatus: task.assignment?.deliveryStatus,
    });

    const audit = input.audit ? await createAuditEvent(tx, input.audit) : undefined;
    return { attempt, audit };
  });
}

/**
 * D. Retry failed attempt — same attempt, Assignment, and Capability identity with a rotated token.
 *
 * Exclusive execution ownership: exactly ONE concurrent invocation atomically wins the failed →
 * pending transition (`won = true`). Only the winner rotates the capability token to the freshly
 * generated `newTokenHash` and receives the new `sendGeneration`. Losing invocations observe
 * `won = false`, do NOT rotate the token or touch the Assignment, and must be surfaced by callers as
 * a typed handoff-in-progress result. Ownership is the database transition result — never inferred
 * from status or timestamps.
 *
 * Token rotation: the previous token hash is replaced in place; the prior link becomes invalid
 * immediately. The Capability stays `status = active`, `actionableAt = null` until Gmail acceptance.
 * The raw token corresponding to `newTokenHash` is generated by the caller and never seen here (D063).
 *
 * Crash semantics (token generated before commit): if the caller generates the raw token and hash
 * before calling this transaction and the transaction rolls back or the process crashes before
 * commit, nothing is persisted — the capability keeps its previous hash and the prior link remains
 * valid; the ephemeral raw token is discarded. If the transaction commits but the process crashes
 * before the winning caller uses the raw token, the capability holds the new hash (prior link
 * invalid) while the winning raw token is lost; the capability is non-actionable, so no link is
 * usable until a later explicit retry rotates again. In neither case is a raw token persisted.
 */
export async function prepareFailedHandoffRetry(input: {
  db: DbClient;
  organizationId: string;
  attemptId: string;
  requestFingerprint: string;
  /** Hash of a freshly generated raw token, bound to the capability only when this invocation wins. */
  newTokenHash: string;
  audit?: CreateAuditEventInput;
}): Promise<{
  won: boolean;
  attempt: PersistedHandoffAttempt;
  capability: PersistedCapability;
  /** Send generation (attemptCount) required by the terminal transitions. Set only when `won`. */
  sendGeneration: number;
  audit?: AuditEventRecord;
}> {
  return input.db.$transaction(async (tx) => {
    const { attempt, won } = await prepareHandoffAttemptRetry(tx, {
      organizationId: input.organizationId,
      attemptId: input.attemptId,
      requestFingerprint: input.requestFingerprint,
    });

    if (!won) {
      // Deterministic replay of a retry another invocation already won. Do not rotate the token or
      // mutate the Assignment; the winning invocation owns delivery.
      const capability = await getCapabilityById(tx, input.organizationId, attempt.capabilityId);
      return { won: false, attempt, capability, sendGeneration: attempt.attemptCount };
    }

    const assignmentSync = await updateActiveAssignmentDeliveryStatus(
      tx,
      input.organizationId,
      attempt.taskId,
      'pending',
      { fromStatus: 'failed' },
    );
    if (!assignmentSync.updated) {
      const task = await getTaskById(tx, input.organizationId, attempt.taskId);
      if (task.assignment?.deliveryStatus !== 'pending') {
        throw invalidState(
          'Retry requires Assignment.deliveryStatus=pending. Trust HandoffAttempt.status.',
        );
      }
    }

    const existing = await getCapabilityById(tx, input.organizationId, attempt.capabilityId);
    if (existing.actionableAt != null) {
      throw invalidState('Failed-attempt retry must reuse a non-actionable capability.');
    }
    if (existing.status !== 'active') {
      throw invalidState('Failed-attempt retry requires the original active capability row.');
    }

    // Rotate the token hash in place: same capability row identity, new secret, prior link invalid.
    const capability = await rotateCapabilityTokenHash(
      tx,
      input.organizationId,
      attempt.capabilityId,
      input.newTokenHash,
    );

    const audit = input.audit ? await createAuditEvent(tx, input.audit) : undefined;
    return { won: true, attempt, capability, sendGeneration: attempt.attemptCount, audit };
  });
}

/**
 * E. Begin explicit re-forward after a prior successful send.
 */
export async function beginExplicitReforward(input: {
  db: DbClient;
  organizationId: string;
  priorAttemptId: string;
  expectedTaskVersion: number;
  task: Task;
  capability: TaskCapability;
  tokenHash: string;
  attemptId: string;
  acknowledgement: string;
  deliveryPath: 'gmail_forward' | 'assignment_email';
  idempotencyKey: string;
  requestFingerprint: string;
  now: string;
  audit?: CreateAuditEventInput;
}): Promise<BeginInitialHandoffResult> {
  return input.db.$transaction(async (tx) => {
    const prior = await lockHandoffAttemptForUpdate(tx, input.organizationId, input.priorAttemptId);
    if (prior.status !== 'sent') {
      throw invalidState('Explicit re-forward requires a prior successful send.');
    }

    const idempotency = await lookupHandoffIdempotency(tx, {
      organizationId: input.organizationId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
    });
    if (idempotency.kind === 'key_conflict') {
      throw idempotencyKeyConflict(
        'Idempotency-Key was reused with a conflicting handoff payload.',
      );
    }
    if (idempotency.kind !== 'new_request') {
      const capability = await getCapabilityById(
        tx,
        input.organizationId,
        idempotency.attempt.capabilityId,
      );
      const task = await getTaskById(tx, input.organizationId, input.task.id);
      return {
        kind:
          idempotency.kind === 'replay_pending'
            ? 'replay_pending'
            : idempotency.kind === 'replay_sent'
              ? 'replay_sent'
              : 'retry_failed',
        attempt: idempotency.attempt,
        task,
        capability,
      };
    }

    await revokeCapabilityRecord(
      tx,
      input.organizationId,
      prior.capabilityId,
      input.now,
      'superseded',
    );

    await updateTaskWithExpectedVersion(tx, input.organizationId, input.expectedTaskVersion, {
      ...input.task,
    });

    const capability = await createCapability(
      tx,
      input.organizationId,
      input.capability,
      input.tokenHash,
      { actionableAt: null },
    );

    await updateActiveAssignmentCapabilityBinding(tx, input.organizationId, input.task.id, {
      activeCapabilityId: capability.id,
      capabilityStatus: 'active',
      deliveryStatus: 'pending',
    });

    const attempt = await createHandoffAttempt(tx, {
      id: input.attemptId,
      organizationId: input.organizationId,
      taskId: input.task.id,
      recipientId: prior.recipientId,
      assignmentId: prior.assignmentId,
      capabilityId: capability.id,
      acknowledgement: input.acknowledgement,
      deliveryPath: input.deliveryPath,
      status: 'pending',
      intent: 'explicit_reforward',
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      priorAttemptId: prior.id,
      rootAttemptId: prior.rootAttemptId ?? prior.id,
    });

    const audit = input.audit ? await createAuditEvent(tx, input.audit) : undefined;
    const task = await getTaskById(tx, input.organizationId, input.task.id);
    return { kind: 'created', attempt, task, capability, audit };
  });
}

/**
 * F. Begin reassignment to a different Recipient.
 */
export async function beginReassignment(input: {
  db: DbClient;
  organizationId: string;
  priorAttemptId: string;
  expectedTaskVersion: number;
  task: Task;
  newAssignment: TaskAssignment;
  capability: TaskCapability;
  tokenHash: string;
  attemptId: string;
  acknowledgement: string;
  deliveryPath: 'gmail_forward' | 'assignment_email';
  idempotencyKey: string;
  requestFingerprint: string;
  now: string;
  audit?: CreateAuditEventInput;
}): Promise<BeginInitialHandoffResult> {
  return input.db.$transaction(async (tx) => {
    const prior = await lockHandoffAttemptForUpdate(tx, input.organizationId, input.priorAttemptId);
    if (prior.status === 'pending') {
      throw handoffInProgress(
        'Cannot reassign while a handoff attempt is pending; wait for sent/failed or cancel.',
      );
    }
    if (prior.recipientId === input.newAssignment.recipientId) {
      throw persistenceValidation('Reassignment requires a different Recipient.');
    }
    await requireActiveRecipientForHandoff(
      tx,
      input.organizationId,
      input.newAssignment.recipientId,
    );

    const idempotency = await lookupHandoffIdempotency(tx, {
      organizationId: input.organizationId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
    });
    if (idempotency.kind === 'key_conflict') {
      throw idempotencyKeyConflict(
        'Idempotency-Key was reused with a conflicting handoff payload.',
      );
    }
    if (idempotency.kind !== 'new_request') {
      const capability = await getCapabilityById(
        tx,
        input.organizationId,
        idempotency.attempt.capabilityId,
      );
      const task = await getTaskById(tx, input.organizationId, input.task.id);
      return {
        kind:
          idempotency.kind === 'replay_pending'
            ? 'replay_pending'
            : idempotency.kind === 'replay_sent'
              ? 'replay_sent'
              : 'retry_failed',
        attempt: idempotency.attempt,
        task,
        capability,
      };
    }

    await revokeCapabilityRecord(
      tx,
      input.organizationId,
      prior.capabilityId,
      input.now,
      'superseded' satisfies CapabilityRevocationReason,
    );

    // Preserve historical Assignment row; clear active and insert new.
    await clearAssignment(tx, input.organizationId, input.task.id, input.now);

    await updateTaskWithExpectedVersion(tx, input.organizationId, input.expectedTaskVersion, {
      ...input.task,
      assignment: undefined,
    });

    const assignment: TaskAssignment = {
      ...input.newAssignment,
      deliveryStatus: 'pending',
      capabilityStatus: 'active',
      activeCapabilityId: input.capability.id,
    };
    await createActiveAssignment(tx, input.organizationId, input.task.id, assignment);

    const capability = await createCapability(
      tx,
      input.organizationId,
      input.capability,
      input.tokenHash,
      { actionableAt: null },
    );

    const attempt = await createHandoffAttempt(tx, {
      id: input.attemptId,
      organizationId: input.organizationId,
      taskId: input.task.id,
      recipientId: input.newAssignment.recipientId,
      assignmentId: input.newAssignment.id,
      capabilityId: capability.id,
      acknowledgement: input.acknowledgement,
      deliveryPath: input.deliveryPath,
      status: 'pending',
      intent: 'reassignment',
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      priorAttemptId: prior.id,
      rootAttemptId: prior.rootAttemptId ?? prior.id,
    });

    const audit = input.audit ? await createAuditEvent(tx, input.audit) : undefined;
    const task = await getTaskById(tx, input.organizationId, input.task.id);
    return { kind: 'created', attempt, task, capability, audit };
  });
}

/**
 * G. Idempotency lookup/replay without mutating.
 */
export async function resolveHandoffIdempotency(input: {
  db: DbClient;
  organizationId: string;
  idempotencyKey: string;
  requestFingerprint: string;
}): Promise<HandoffIdempotencyLookup> {
  return lookupHandoffIdempotency(input.db, input);
}

/**
 * D091 persistence boundary: Task create must not silently create an Assignment.
 * HTTP handlers must call this (or createUnassignedTask) once A7 ships.
 */
export function assertCreateTaskRejectsAssignment(
  assignment: TaskAssignment | undefined | null,
): void {
  if (assignment) {
    throw recipientHandoffNotAvailable(
      'Create Task must remain unassigned; use POST /api/v1/tasks/{taskId}/handoff for Recipient handoff.',
    );
  }
}

/** Concurrent same-key helper used by tests — maps P2002 to UNIQUE_VIOLATION. */
export function mapHandoffUniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw uniqueViolation('Handoff uniqueness constraint violated.');
  }
  throw error;
}
