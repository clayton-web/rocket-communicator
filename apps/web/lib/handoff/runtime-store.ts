import 'server-only';
import { randomUUID } from 'node:crypto';
import type {
  BeginInitialHandoffInput,
  BeginInitialHandoffResult,
  CreateAuditEventInput,
  DbClient,
  PersistedCapability,
  PersistedHandoffAttempt,
  PersistenceError,
} from '@aicaa/db';
import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  asAssignmentId,
  asCapabilityId,
  asOwnerId,
  asRecipientId,
  type Recipient,
  type Task,
  type TaskAssignment,
  type TaskCapability,
} from '@aicaa/domain';
import { generateCapabilityToken, hashCapabilityToken } from '@/lib/capability/token';
import { buildCapabilityUrl } from '@/lib/capability/urls';
import { readAnyPersistenceErrorCode, persistedFailureCategory } from './outcomes';
import type {
  BeginHandoffResult,
  HandoffStore,
  InitialHandoffCommand,
  PrepareRetryResult,
  RecordAcceptedInput,
  RecordAcceptedResult,
  RecordFailedInput,
  RetryHandoffCommand,
} from './types';

/**
 * Structural subset of the A7.3 persistence runtime the store adapter depends on. Satisfied by the
 * `@aicaa/db` module (tests) and by the traced production runtime bridge (`loadDbRuntime()`), so the
 * adapter never resolves the workspace package name directly and never re-implements persistence.
 */
export interface HandoffRuntime {
  beginInitialHandoff(input: BeginInitialHandoffInput): Promise<BeginInitialHandoffResult>;
  markHandoffSendAccepted(input: {
    db: DbClient;
    organizationId: string;
    attemptId: string;
    providerMessageId: string;
    providerAcceptedAt: string;
    expectedSendGeneration: number;
    audit?: CreateAuditEventInput;
  }): Promise<{ attempt: PersistedHandoffAttempt; capability: PersistedCapability }>;
  markHandoffDeliveryFailed(input: {
    db: DbClient;
    organizationId: string;
    attemptId: string;
    failureCode: string;
    failureCategory: NonNullable<PersistedHandoffAttempt['failureCategory']>;
    failureFingerprint: string;
    retryable: boolean;
    expectedSendGeneration: number;
    audit?: CreateAuditEventInput;
  }): Promise<{ attempt: PersistedHandoffAttempt }>;
  prepareFailedHandoffRetry(input: {
    db: DbClient;
    organizationId: string;
    attemptId: string;
    requestFingerprint: string;
    newTokenHash: string;
  }): Promise<{
    won: boolean;
    attempt: PersistedHandoffAttempt;
    capability: PersistedCapability;
    sendGeneration: number;
  }>;
  getTaskById(db: DbClient, organizationId: string, taskId: string): Promise<Task>;
  getRecipientById(db: DbClient, organizationId: string, recipientId: string): Promise<Recipient>;
  getHandoffAttemptById(
    db: DbClient,
    organizationId: string,
    attemptId: string,
  ): Promise<PersistedHandoffAttempt>;
  getCapabilityById(
    db: DbClient,
    organizationId: string,
    capabilityId: string,
  ): Promise<PersistedCapability>;
  invalidState(message: string): PersistenceError;
  handoffInProgress(message: string): PersistenceError;
}

export interface RuntimeHandoffStoreDeps {
  /** DB client (embedded Postgres/PGlite in tests, traced Prisma client in production). */
  db: DbClient;
  runtime: HandoffRuntime;
  /** Server-only capability token configuration (pepper never leaves the server). */
  capabilityConfig: { pepper: string; ttlMs: number; appUrl: string };
  clock?: () => Date;
  /** Deterministic id factory for tests; defaults to UUID-based ids. */
  newId?: (prefix: string) => string;
  /** Injectable CSPRNG for capability token entropy (tests). */
  random?: () => Buffer;
}

/**
 * Production/testable {@link HandoffStore} backed by the A7.3 transaction primitives.
 *
 * `beginInitialHandoff` mints the capability token + hash + URL at the application boundary (the raw
 * token is never persisted), assembles the Assignment + capability domain objects, and delegates the
 * durable write to `beginInitialHandoff`. The one-time capability URL is returned ONLY for a freshly
 * created attempt — a replay cannot recover the raw token, and a replay never sends.
 *
 * Retry: `prepareRetry` mints a NEW raw token at the application boundary and passes only its hash
 * into `prepareFailedHandoffRetry`, which atomically rotates the SAME capability row's token hash
 * (invalidating the prior link) when this invocation wins the `failed → pending` transition. The new
 * one-time URL is returned ONLY to the winner; losers receive `won = false` and no URL. The raw
 * token is never persisted, logged, or recovered — production needs no injected/reconstructed URL.
 */
export function createRuntimeHandoffStore(deps: RuntimeHandoffStoreDeps): HandoffStore {
  const { db, runtime, capabilityConfig } = deps;
  const clock = deps.clock ?? (() => new Date());
  const newId = deps.newId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);

  async function beginInitialHandoff(command: InitialHandoffCommand): Promise<BeginHandoffResult> {
    const now = clock();
    const nowIso = now.toISOString();
    const task = await runtime.getTaskById(db, command.organizationId, command.taskId);
    const recipient = await runtime.getRecipientById(
      db,
      command.organizationId,
      command.recipientId,
    );

    const assignmentId = asAssignmentId(newId('asg'));
    const capabilityId = asCapabilityId(newId('cap'));
    const attemptId = newId('att');
    const scope = [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE];

    const assignment: TaskAssignment = {
      id: assignmentId,
      recipientId: asRecipientId(command.recipientId),
      intendedRecipientEmail: recipient.email,
      assignedAt: nowIso,
      assignedByOwnerId: asOwnerId(command.ownerId),
      allowedCapabilityActions: scope,
      capabilityStatus: 'active',
    };

    const capability: TaskCapability = {
      id: capabilityId,
      taskId: task.id,
      assignmentId,
      recipientId: asRecipientId(command.recipientId),
      intendedRecipientEmail: recipient.email,
      scope,
      status: 'active',
      issuedAt: nowIso,
      expiresAt: new Date(now.getTime() + capabilityConfig.ttlMs).toISOString(),
      revokedAt: null,
    };

    // Mint the one-time token at the application boundary. Only the hash is persisted; the raw token
    // and the derived URL are returned to the caller (created path only) and never logged.
    const rawToken = generateCapabilityToken(deps.random);
    const tokenHash = hashCapabilityToken(rawToken, capabilityConfig.pepper);
    const capabilityUrl = buildCapabilityUrl(capabilityConfig.appUrl, rawToken);

    // Durable "prepared" audit is written atomically with the created attempt inside the A7.3
    // transaction (never on a replay, which returns before the audit seam). Privacy-safe: no
    // Recipient email, token, MIME, or provider body — only stable identifiers.
    const audit: CreateAuditEventInput | undefined = command.emitAudits
      ? {
          id: newId('aud'),
          organizationId: command.organizationId,
          actorKind: 'owner',
          ownerId: command.ownerId,
          assignmentId,
          taskId: task.id,
          capabilityId,
          action: 'handoff.prepared',
          outcome: 'succeeded',
          resourceVersion: task.version,
          requestId: command.requestId,
          correlationId: command.correlationId ?? null,
          recordedAt: nowIso,
        }
      : undefined;

    const result = await runtime.beginInitialHandoff({
      db,
      organizationId: command.organizationId,
      ownerId: command.ownerId,
      // Prefer the caller-supplied If-Match version (A7.7) so concurrent Task mutations cannot race
      // past the route eligibility check. Fall back to the freshly loaded version for internal callers.
      expectedTaskVersion: command.expectedTaskVersion ?? task.version,
      task,
      assignment,
      capability,
      tokenHash,
      attemptId,
      acknowledgement: command.acknowledgement,
      deliveryPath: command.deliveryPath,
      idempotencyKey: command.idempotencyKey,
      requestFingerprint: command.requestFingerprint,
      audit,
    });

    return {
      kind: result.kind,
      attempt: result.attempt,
      capability: result.capability,
      task: result.task,
      capabilityUrl: result.kind === 'created' ? capabilityUrl : undefined,
      sendGeneration: result.attempt.attemptCount,
    };
  }

  async function prepareRetry(command: RetryHandoffCommand): Promise<PrepareRetryResult> {
    // Mint a fresh one-time token BEFORE the transaction; only its hash crosses the boundary. The
    // authoritative failed→pending transition rotates the capability's hash to this value and reports
    // ownership (`won`). A losing/replay invocation never binds this hash — the raw token is discarded.
    const rawToken = generateCapabilityToken(deps.random);
    const newTokenHash = hashCapabilityToken(rawToken, capabilityConfig.pepper);

    const prepared = await runtime.prepareFailedHandoffRetry({
      db,
      organizationId: command.organizationId,
      attemptId: command.attemptId,
      requestFingerprint: command.requestFingerprint,
      newTokenHash,
    });
    const task = await runtime.getTaskById(db, command.organizationId, prepared.attempt.taskId);

    if (!prepared.won) {
      // Lost the ownership lease to a concurrent retry: no URL, no send. Discard the raw token.
      return {
        won: false,
        attempt: prepared.attempt,
        capability: prepared.capability,
        task,
        capabilityUrl: undefined,
        sendGeneration: prepared.sendGeneration,
      };
    }

    return {
      won: true,
      attempt: prepared.attempt,
      capability: prepared.capability,
      task,
      // Freshly rotated one-time URL, returned only to the winner. Never persisted or logged.
      capabilityUrl: buildCapabilityUrl(capabilityConfig.appUrl, rawToken),
      sendGeneration: prepared.sendGeneration,
    };
  }

  async function recordAccepted(input: RecordAcceptedInput): Promise<RecordAcceptedResult> {
    try {
      const result = await runtime.markHandoffSendAccepted({
        db,
        organizationId: input.organizationId,
        attemptId: input.attemptId,
        providerMessageId: input.providerMessageId,
        providerAcceptedAt: input.providerAcceptedAt,
        expectedSendGeneration: input.expectedSendGeneration,
        audit: input.audit
          ? {
              id: newId('aud'),
              organizationId: input.organizationId,
              actorKind: 'owner',
              ownerId: input.audit.ownerId,
              assignmentId: input.audit.assignmentId,
              taskId: input.audit.taskId,
              capabilityId: input.audit.capabilityId,
              action: 'handoff.sent',
              outcome: 'succeeded',
              requestId: input.audit.requestId,
              correlationId: input.audit.correlationId ?? null,
              recordedAt: clock().toISOString(),
            }
          : undefined,
      });
      return { ok: true, attempt: result.attempt, capability: result.capability };
    } catch (error) {
      const code = readAnyPersistenceErrorCode(error);
      // Conflicting provider message id (different id for an already-sent attempt, an id already
      // associated with another attempt, or a stale send generation) → typed conflict, never a raw
      // DB error. The orchestrator only ever records the generation it won, so this path signals a
      // genuine terminal conflict rather than a benign replay.
      if (code === 'INVALID_STATE' || code === 'UNIQUE_VIOLATION') {
        return { ok: false, conflict: 'provider_message_conflict' };
      }
      throw error;
    }
  }

  async function recordFailed(input: RecordFailedInput): Promise<void> {
    await runtime.markHandoffDeliveryFailed({
      db,
      organizationId: input.organizationId,
      attemptId: input.attemptId,
      failureCode: input.failure.code,
      failureCategory: persistedFailureCategory(input.failure.category),
      failureFingerprint: input.failure.fingerprint,
      retryable: input.failure.retryable,
      expectedSendGeneration: input.expectedSendGeneration,
      audit: input.audit
        ? {
            id: newId('aud'),
            organizationId: input.organizationId,
            actorKind: 'owner',
            ownerId: input.audit.ownerId,
            assignmentId: input.audit.assignmentId,
            taskId: input.audit.taskId,
            capabilityId: input.audit.capabilityId,
            action: 'handoff.failed',
            outcome: 'failed',
            // Privacy-safe: stable failure code only (never a raw provider/OAuth error or email).
            note: input.failure.code,
            requestId: input.audit.requestId,
            correlationId: input.audit.correlationId ?? null,
            recordedAt: clock().toISOString(),
          }
        : undefined,
    });
  }

  return { beginInitialHandoff, prepareRetry, recordAccepted, recordFailed };
}
