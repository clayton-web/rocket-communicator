import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import {
  mapHandoffAttempt,
  fromIso,
  type PersistedHandoffAttempt,
} from '../mappers/domain-mappers.js';
import {
  domainConflict,
  handoffInProgress,
  idempotencyKeyConflict,
  invalidState,
  notFound,
  uniqueViolation,
} from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

export type CreateHandoffAttemptInput = {
  id: string;
  organizationId: string;
  taskId: string;
  recipientId: string;
  assignmentId: string;
  capabilityId: string;
  acknowledgement: string;
  deliveryPath: 'gmail_forward' | 'assignment_email';
  status: 'pending' | 'sent' | 'failed';
  intent: 'initial' | 'retry_failed' | 'explicit_reforward' | 'reassignment';
  idempotencyKey: string;
  requestFingerprint: string;
  providerMessageId?: string | null;
  providerAcceptedAt?: string | null;
  failureCode?: string | null;
  failureCategory?:
    | 'validation'
    | 'authorization'
    | 'concurrency'
    | 'domain_conflict'
    | 'retryable_dependency'
    | 'not_found'
    | 'provider'
    | null;
  failureFingerprint?: string | null;
  retryable?: boolean | null;
  attemptCount?: number;
  priorAttemptId?: string | null;
  rootAttemptId?: string | null;
};

/** Row lock so concurrent lifecycle ops on the same attempt serialize under READ COMMITTED. */
export async function lockHandoffAttemptForUpdate(
  db: Client,
  organizationId: string,
  attemptId: string,
): Promise<PersistedHandoffAttempt> {
  const rows = await db.$queryRaw<
    Array<{
      id: string;
    }>
  >`
    SELECT id
    FROM handoff_attempts
    WHERE id = ${attemptId}
      AND organization_id = ${organizationId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw notFound(`Handoff attempt ${attemptId} not found.`);
  }
  return getHandoffAttemptById(db, organizationId, attemptId);
}

export async function createHandoffAttempt(
  db: Client,
  input: CreateHandoffAttemptInput,
): Promise<PersistedHandoffAttempt> {
  try {
    const row = await db.handoffAttempt.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        taskId: input.taskId,
        recipientId: input.recipientId,
        assignmentId: input.assignmentId,
        capabilityId: input.capabilityId,
        acknowledgement: input.acknowledgement,
        deliveryPath: input.deliveryPath,
        status: input.status,
        intent: input.intent,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        providerMessageId: input.providerMessageId ?? null,
        providerAcceptedAt: fromIso(input.providerAcceptedAt ?? null),
        failureCode: input.failureCode ?? null,
        failureCategory: input.failureCategory ?? null,
        failureFingerprint: input.failureFingerprint ?? null,
        retryable: input.retryable ?? null,
        attemptCount: input.attemptCount ?? 1,
        priorAttemptId: input.priorAttemptId ?? null,
        rootAttemptId: input.rootAttemptId ?? input.id,
      },
    });
    return mapHandoffAttempt(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = JSON.stringify(error.meta?.target ?? '');
      if (target.includes('provider_message')) {
        throw uniqueViolation(
          'Provider message id is already associated with another handoff attempt.',
        );
      }
      throw uniqueViolation('Idempotency key already exists for this organization.');
    }
    throw error;
  }
}

export async function getHandoffAttemptById(
  db: Client,
  organizationId: string,
  attemptId: string,
): Promise<PersistedHandoffAttempt> {
  const row = await db.handoffAttempt.findFirst({
    where: { id: attemptId, organizationId },
  });
  if (!row) {
    throw notFound(`Handoff attempt ${attemptId} not found.`);
  }
  return mapHandoffAttempt(row);
}

export async function findHandoffAttemptByIdempotencyKey(
  db: Client,
  organizationId: string,
  idempotencyKey: string,
): Promise<PersistedHandoffAttempt | null> {
  const row = await db.handoffAttempt.findUnique({
    where: {
      organizationId_idempotencyKey: { organizationId, idempotencyKey },
    },
  });
  return row ? mapHandoffAttempt(row) : null;
}

export async function findPendingHandoffAttemptForTask(
  db: Client,
  organizationId: string,
  taskId: string,
): Promise<PersistedHandoffAttempt | null> {
  const row = await db.handoffAttempt.findFirst({
    where: { organizationId, taskId, status: 'pending' },
    orderBy: { createdAt: 'desc' },
  });
  return row ? mapHandoffAttempt(row) : null;
}

export async function findPendingHandoffAttemptForAssignment(
  db: Client,
  organizationId: string,
  assignmentId: string,
): Promise<PersistedHandoffAttempt | null> {
  const row = await db.handoffAttempt.findFirst({
    where: { organizationId, assignmentId, status: 'pending' },
    orderBy: { createdAt: 'desc' },
  });
  return row ? mapHandoffAttempt(row) : null;
}

/**
 * "Latest relevant attempt" for an Assignment (A7.3 admin-issuance policy).
 * Selection: scoped to (organizationId, assignmentId); newest first by
 * `created_at DESC, id DESC` (id breaks equal-timestamp ties deterministically); LIMIT 1.
 * Historical sent/re-forwarded/reassigned attempts never win over the current row because
 * they are older (or belong to a different, cleared Assignment).
 */
export async function findLatestHandoffAttemptForAssignment(
  db: Client,
  organizationId: string,
  assignmentId: string,
): Promise<PersistedHandoffAttempt | null> {
  const row = await db.handoffAttempt.findFirst({
    where: { organizationId, assignmentId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return row ? mapHandoffAttempt(row) : null;
}

/**
 * A7 lineage is "unresolved" for A4 administrative issuance when the latest attempt is
 * `pending` or `failed`. Failed rows block regardless of `retryable`: A7.3 has no implicit
 * abandon/cancel state, so an unresolved failed lineage must be resolved through the A7
 * workflow (retry / explicit re-forward / reassignment) rather than bypassed administratively.
 */
export function isUnresolvedHandoffAttemptForAdminIssuance(
  attempt: Pick<PersistedHandoffAttempt, 'status'>,
): boolean {
  return attempt.status === 'pending' || attempt.status === 'failed';
}

/**
 * Transaction-level gate for A4 administrative capability issuance / replacement.
 * Locks the latest handoff attempt row for the Assignment with `FOR UPDATE`, then rejects when
 * that attempt is unresolved (pending or failed). The row lock serializes against retry
 * preparation, explicit re-forward, reassignment, and failure recording, so a race cannot
 * orphan the attempt or supersede its non-actionable capability. This must be called INSIDE the
 * authoritative issuance transaction — a preflight check alone cannot guarantee this.
 */
export async function assertAdminIssuanceNotBlockedByHandoff(
  db: Client,
  organizationId: string,
  assignmentId: string,
): Promise<void> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM handoff_attempts
    WHERE organization_id = ${organizationId}
      AND assignment_id = ${assignmentId}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    FOR UPDATE
  `;
  if (rows.length === 0) {
    return;
  }
  const latest = await getHandoffAttemptById(db, organizationId, rows[0].id);
  if (isUnresolvedHandoffAttemptForAdminIssuance(latest)) {
    throw handoffInProgress(
      `Administrative capability issuance is blocked: the latest handoff attempt (${latest.id}) is ${latest.status} and must be resolved through the A7 workflow (retry, explicit re-forward, or reassignment).`,
    );
  }
}

export async function listHandoffAttemptsForTask(
  db: Client,
  organizationId: string,
  taskId: string,
): Promise<PersistedHandoffAttempt[]> {
  const rows = await db.handoffAttempt.findMany({
    where: { organizationId, taskId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(mapHandoffAttempt);
}

/** Stale/uncertain pending attempts for a later, explicitly-authorized reconciliation worker (not A7.4). */
export async function listStalePendingHandoffAttempts(
  db: Client,
  organizationId: string,
  olderThan: string,
  limit = 50,
): Promise<PersistedHandoffAttempt[]> {
  const rows = await db.handoffAttempt.findMany({
    where: {
      organizationId,
      status: 'pending',
      updatedAt: { lt: fromIso(olderThan)! },
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });
  return rows.map(mapHandoffAttempt);
}

export type HandoffIdempotencyLookup =
  | { kind: 'new_request' }
  | { kind: 'replay_pending'; attempt: PersistedHandoffAttempt }
  | { kind: 'retry_failed'; attempt: PersistedHandoffAttempt }
  | { kind: 'replay_sent'; attempt: PersistedHandoffAttempt }
  | { kind: 'key_conflict'; attempt: PersistedHandoffAttempt };

export async function lookupHandoffIdempotency(
  db: Client,
  input: {
    organizationId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  },
): Promise<HandoffIdempotencyLookup> {
  const existing = await findHandoffAttemptByIdempotencyKey(
    db,
    input.organizationId,
    input.idempotencyKey,
  );
  if (!existing) {
    return { kind: 'new_request' };
  }
  if (existing.requestFingerprint !== input.requestFingerprint) {
    return { kind: 'key_conflict', attempt: existing };
  }
  switch (existing.status) {
    case 'pending':
      return { kind: 'replay_pending', attempt: existing };
    case 'failed':
      return { kind: 'retry_failed', attempt: existing };
    case 'sent':
      return { kind: 'replay_sent', attempt: existing };
    default: {
      const _exhaustive: never = existing.status;
      return _exhaustive;
    }
  }
}

/**
 * Atomic pending → sent only (D092 / A7.3 concurrency hardening).
 * Uses conditional UPDATE … WHERE status = 'pending' so concurrent fail/sent races
 * yield exactly one winner under READ COMMITTED row locking.
 * Failed attempts must be prepared back to pending via prepareHandoffAttemptRetry first.
 */
export async function markHandoffAttemptSent(
  db: Client,
  input: {
    organizationId: string;
    attemptId: string;
    providerMessageId: string;
    providerAcceptedAt: string;
    /**
     * Send generation (attemptCount) of the execution that produced this provider result. A stale
     * result from a superseded send generation (e.g. the prior send before an explicit retry rotated
     * the token) must NOT finalize the current pending generation.
     */
    expectedSendGeneration: number;
  },
): Promise<PersistedHandoffAttempt> {
  if (!input.providerMessageId.trim()) {
    throw invalidState('Provider message id is required for sent transition.');
  }

  try {
    const updated = await db.handoffAttempt.updateMany({
      where: {
        id: input.attemptId,
        organizationId: input.organizationId,
        status: 'pending',
        providerMessageId: null,
        attemptCount: input.expectedSendGeneration,
      },
      data: {
        status: 'sent',
        providerMessageId: input.providerMessageId,
        providerAcceptedAt: fromIso(input.providerAcceptedAt)!,
        failureCode: null,
        failureCategory: null,
        failureFingerprint: null,
        retryable: null,
      },
    });

    if (updated.count === 1) {
      return getHandoffAttemptById(db, input.organizationId, input.attemptId);
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw uniqueViolation(
        'Provider message id is already associated with another handoff attempt.',
      );
    }
    throw error;
  }

  const existing = await getHandoffAttemptById(db, input.organizationId, input.attemptId);
  if (existing.status === 'sent') {
    if (
      existing.providerMessageId === input.providerMessageId &&
      existing.attemptCount === input.expectedSendGeneration
    ) {
      return existing;
    }
    throw invalidState('Conflicting provider message id for already-sent handoff attempt.');
  }
  if (existing.attemptCount !== input.expectedSendGeneration) {
    // The attempt has advanced to a newer send generation (a retry rotated the capability). This
    // provider result belongs to a superseded execution and must not mutate state.
    throw invalidState('Stale send generation; the handoff attempt has advanced past this send.');
  }
  if (existing.status === 'failed') {
    throw invalidState(
      'Only pending attempts can transition to sent; prepare a failed retry first.',
    );
  }
  throw invalidState('Handoff attempt could not transition to sent.');
}

/**
 * Atomic pending → failed only.
 * Cannot overwrite sent. Concurrent sent winner causes typed INVALID_STATE for the loser.
 * Already-failed with identical fingerprint is idempotent; different fingerprint conflicts.
 */
export async function markHandoffAttemptFailed(
  db: Client,
  input: {
    organizationId: string;
    attemptId: string;
    failureCode: string;
    failureCategory: NonNullable<PersistedHandoffAttempt['failureCategory']>;
    failureFingerprint: string;
    retryable: boolean;
    /**
     * Send generation (attemptCount) of the execution that produced this failure. A stale failure
     * from a superseded send generation must NOT mark a newer retry generation failed.
     */
    expectedSendGeneration: number;
  },
): Promise<PersistedHandoffAttempt> {
  const updated = await db.handoffAttempt.updateMany({
    where: {
      id: input.attemptId,
      organizationId: input.organizationId,
      status: 'pending',
      providerMessageId: null,
      attemptCount: input.expectedSendGeneration,
    },
    data: {
      status: 'failed',
      failureCode: input.failureCode,
      failureCategory: input.failureCategory,
      failureFingerprint: input.failureFingerprint,
      retryable: input.retryable,
    },
  });

  if (updated.count === 1) {
    return getHandoffAttemptById(db, input.organizationId, input.attemptId);
  }

  const existing = await getHandoffAttemptById(db, input.organizationId, input.attemptId);
  if (existing.status === 'sent') {
    throw invalidState('A sent handoff cannot transition to failed.');
  }
  if (existing.attemptCount !== input.expectedSendGeneration) {
    // The attempt has advanced to a newer send generation (a retry rotated the capability). This
    // failure belongs to a superseded execution and must not mutate state.
    throw invalidState('Stale send generation; the handoff attempt has advanced past this send.');
  }
  if (existing.status === 'failed') {
    if (
      existing.failureCode === input.failureCode &&
      existing.failureFingerprint === input.failureFingerprint
    ) {
      return existing;
    }
    throw domainConflict('Handoff attempt already failed with different failure metadata.');
  }
  throw invalidState('Only pending attempts can transition to failed.');
}

/**
 * Atomic failed → pending retry. Serializes against reassignment/re-forward via FOR UPDATE
 * in the calling transaction plus conditional UPDATE on status=failed.
 */
/**
 * Result of an in-place retry transition. `won` is the authoritative execution-ownership lease:
 * exactly ONE concurrent invocation observes `won = true` (it performed the atomic failed → pending
 * transition and advanced `attemptCount`, the send generation). All other invocations observe
 * `won = false` (a deterministic replay of the already-in-progress retry) and must NOT send Gmail,
 * rotate the token, or receive a raw capability token. Ownership is never inferred from status or
 * timestamps after the fact.
 */
export type PrepareHandoffAttemptRetryResult = {
  attempt: PersistedHandoffAttempt;
  won: boolean;
};

export async function prepareHandoffAttemptRetry(
  db: Client,
  input: {
    organizationId: string;
    attemptId: string;
    requestFingerprint: string;
  },
): Promise<PrepareHandoffAttemptRetryResult> {
  await lockHandoffAttemptForUpdate(db, input.organizationId, input.attemptId);

  // Authoritative CAS: only a retryable, failed, un-sent attempt with a matching fingerprint
  // transitions failed → pending and increments the send generation (attemptCount).
  const updated = await db.handoffAttempt.updateMany({
    where: {
      id: input.attemptId,
      organizationId: input.organizationId,
      status: 'failed',
      retryable: true,
      providerMessageId: null,
      requestFingerprint: input.requestFingerprint,
    },
    data: {
      status: 'pending',
      intent: 'retry_failed',
      attemptCount: { increment: 1 },
      failureCode: null,
      failureCategory: null,
      failureFingerprint: null,
      retryable: null,
    },
  });

  if (updated.count === 1) {
    return {
      attempt: await getHandoffAttemptById(db, input.organizationId, input.attemptId),
      won: true,
    };
  }

  const existing = await getHandoffAttemptById(db, input.organizationId, input.attemptId);
  if (existing.status === 'pending' && existing.intent === 'retry_failed') {
    if (existing.requestFingerprint !== input.requestFingerprint) {
      throw idempotencyKeyConflict(
        'Retry fingerprint does not match the failed attempt security inputs.',
      );
    }
    // A concurrent retry already won; this invocation is a deterministic replay (loser).
    return { attempt: existing, won: false };
  }
  if (existing.status === 'sent') {
    throw invalidState('Attempt already has a provider message id; use explicit re-forward.');
  }
  if (existing.status !== 'failed') {
    throw invalidState('Only failed handoff attempts can be retried in place.');
  }
  if (existing.providerMessageId) {
    throw invalidState('Attempt already has a provider message id; use explicit re-forward.');
  }
  if (existing.requestFingerprint !== input.requestFingerprint) {
    throw idempotencyKeyConflict(
      'Retry fingerprint does not match the failed attempt security inputs.',
    );
  }
  if (existing.retryable === false) {
    throw invalidState('Only retryable failed handoff attempts can be retried.');
  }
  throw invalidState('Failed-attempt retry could not be prepared.');
}

/**
 * Assert authoritative attempt status matches denormalized Assignment.deliveryStatus.
 * Application code must trust HandoffAttempt.status if history ever diverges.
 */
export function assertAttemptAssignmentDeliveryAligned(input: {
  attemptStatus: PersistedHandoffAttempt['status'];
  assignmentDeliveryStatus: 'pending' | 'sent' | 'failed' | null | undefined;
}): void {
  if (input.assignmentDeliveryStatus == null) {
    throw invalidState('Active Assignment is missing denormalized deliveryStatus.');
  }
  if (input.attemptStatus !== input.assignmentDeliveryStatus) {
    throw invalidState(
      `Delivery state mismatch: attempt=${input.attemptStatus} assignment=${input.assignmentDeliveryStatus}. Trust HandoffAttempt.status.`,
    );
  }
}
