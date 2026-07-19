import 'server-only';
import {
  HANDOFF_ACKNOWLEDGEMENT_V1,
  asOrganizationId,
  asRecipientId,
  asTaskId,
  formatETag,
  isTerminalTaskStatus,
  selectHandoffDeliveryPath,
  type OwnerActor,
  type Recipient,
  type Task,
} from '@aicaa/domain';
import type { DbClient, HandoffIdempotencyLookup, PersistedHandoffAttempt } from '@aicaa/db';
import type { components } from '@aicaa/contracts/schema';
import { getCapabilityTokenConfig } from '@/lib/capability/config';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { mapRecipientToDto } from '@/lib/recipients/map-to-dto';
import { mapTaskToDto } from '@/lib/tasks/map-to-dto';
import { createConsoleHandoffLogger } from './observability';
import { readAnyPersistenceErrorCode } from './outcomes';
import { computeProductionHandoffRequestFingerprint } from './fingerprint';
import { createTaskGmailForwardSource } from './forward-source';
import { createRuntimeHandoffOrchestrator } from './create-orchestrator';
import type { HandoffOrchestrationResult, HandoffOrchestrator } from './types';

type ErrorCode = components['schemas']['ErrorResponse']['error']['code'];
type HandoffTaskResponse = components['schemas']['HandoffTaskResponse'];

/** Idempotency-first classification tag (privacy-safe; used for logs and the route decision). */
export type HandoffClassification =
  'new_request' | 'replay_sent' | 'replay_pending' | 'retry_failed' | 'key_conflict';

export type HandoffServiceResult =
  | {
      ok: true;
      status: 200;
      body: HandoffTaskResponse;
      etag: string;
      classification: HandoffClassification;
    }
  | {
      ok: false;
      status: number;
      code: ErrorCode;
      message: string;
      classification: HandoffClassification;
    };

/**
 * Structural subset of the persistence runtime the route-facing service coordinates. Satisfied by
 * the traced production bridge (`loadDbRuntime()`) and by `@aicaa/db` in tests. The service performs
 * ONLY read/classification coordination here — all writes, Gmail calls, capability rotation, and
 * send-generation handling remain inside the A7.5 orchestrator.
 */
export interface HandoffServiceRuntime {
  resolveHandoffIdempotency(input: {
    db: DbClient;
    organizationId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<HandoffIdempotencyLookup>;
  getTaskById(db: DbClient, organizationId: string, taskId: string): Promise<Task>;
  getRecipientById(db: DbClient, organizationId: string, recipientId: string): Promise<Recipient>;
  getHandoffAttemptById(
    db: DbClient,
    organizationId: string,
    attemptId: string,
  ): Promise<PersistedHandoffAttempt>;
}

export interface HandoffServiceParams {
  db: DbClient;
  owner: OwnerActor;
  requestId: string;
  taskId: string;
  /** Syntactically valid If-Match version (compared to the current Task only for a new handoff). */
  expectedVersion: number;
  idempotencyKey: string;
  recipientId: string;
  acknowledgement: typeof HANDOFF_ACKNOWLEDGEMENT_V1;
}

export interface HandoffServiceDeps {
  runtime: HandoffServiceRuntime;
  orchestrator: HandoffOrchestrator;
}

/**
 * A7.7 route-facing handoff service.
 *
 * Idempotency-first: an organization-scoped idempotency classification runs BEFORE any current-state
 * eligibility or Gmail access check. This is required because a successful initial handoff bumps the
 * Task version and creates an Assignment; a literal replay carries the original (now-stale) If-Match
 * but MUST still replay. Only a genuinely new initial handoff compares the supplied If-Match version
 * to the current Task and requires the Task to be unassigned + the Recipient active. The orchestrator
 * is invoked only for a new initial handoff or an approved failed-attempt retry — never to replay a
 * persisted success/pending, so a successful or in-progress replay never re-calls Gmail.
 */
export async function executeHandoff(
  deps: HandoffServiceDeps,
  params: HandoffServiceParams,
): Promise<HandoffServiceResult> {
  const organizationId = params.owner.organizationId;
  const requestFingerprint = computeProductionHandoffRequestFingerprint({
    organizationId: asOrganizationId(organizationId),
    taskId: asTaskId(params.taskId),
    recipientId: asRecipientId(params.recipientId),
    acknowledgement: params.acknowledgement,
  });

  const lookup = await deps.runtime.resolveHandoffIdempotency({
    db: params.db,
    organizationId,
    idempotencyKey: params.idempotencyKey,
    requestFingerprint,
  });

  switch (lookup.kind) {
    case 'key_conflict':
      // Same org + key with a different payload/Task. Do not disclose which field differed; no Gmail;
      // no state mutation.
      return error(
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
        'Idempotency-Key was already used with a different request.',
        'key_conflict',
      );
    case 'replay_sent':
      // Persisted success replay: reconstruct from durable state. No eligibility recheck, no Gmail,
      // no audit row. Remains available even after the Task version changed, the Recipient was
      // edited/deactivated, Gmail was disconnected, or send scope was removed.
      return buildSuccess(
        deps.runtime,
        params.db,
        organizationId,
        lookup.attempt,
        true,
        'replay_sent',
      );
    case 'replay_pending':
      // A matching attempt is still in progress. Never resend, never rotate the capability.
      return error(
        409,
        'HANDOFF_IN_PROGRESS',
        'A handoff attempt for this Task is already in progress.',
        'replay_pending',
      );
    case 'retry_failed':
      return runFailedRetry(deps, params, requestFingerprint, lookup.attempt);
    case 'new_request':
      return runNewInitialHandoff(deps, params, requestFingerprint);
  }
}

async function runNewInitialHandoff(
  deps: HandoffServiceDeps,
  params: HandoffServiceParams,
  requestFingerprint: string,
): Promise<HandoffServiceResult> {
  const organizationId = params.owner.organizationId;

  let task: Task;
  try {
    task = await deps.runtime.getTaskById(params.db, organizationId, params.taskId);
  } catch (err) {
    if (isNotFound(err)) {
      return error(404, 'NOT_FOUND', 'Task not found.', 'new_request');
    }
    throw err;
  }

  // New initial handoff is the ONLY path that compares If-Match to the current Task version and
  // requires the Task to be currently unassigned + non-terminal.
  if (task.version !== params.expectedVersion) {
    return error(
      412,
      'PRECONDITION_FAILED',
      'The Task has changed since the provided ETag.',
      'new_request',
    );
  }
  if (isTerminalTaskStatus(task.status)) {
    return error(
      400,
      'HANDOFF_NOT_ELIGIBLE',
      'This Task is not eligible for handoff.',
      'new_request',
    );
  }
  if (task.assignment) {
    return error(
      409,
      'DOMAIN_CONFLICT',
      'This Task is already assigned; reassignment is not available.',
      'new_request',
    );
  }

  let recipient: Recipient;
  try {
    recipient = await deps.runtime.getRecipientById(params.db, organizationId, params.recipientId);
  } catch (err) {
    if (isNotFound(err)) {
      return error(404, 'NOT_FOUND', 'Recipient not found.', 'new_request');
    }
    throw err;
  }
  if (!recipient.active) {
    return error(400, 'RECIPIENT_INACTIVE', 'The Recipient is not active.', 'new_request');
  }

  // Server-selected delivery mode from the trusted Task source (never client-supplied).
  const deliveryPath = selectHandoffDeliveryPath(task.sourceReference);

  const result = await deps.orchestrator.deliverInitialHandoff({
    organizationId,
    ownerId: params.owner.ownerId,
    taskId: params.taskId,
    recipientId: params.recipientId,
    deliveryPath,
    idempotencyKey: params.idempotencyKey,
    requestFingerprint,
    acknowledgement: params.acknowledgement,
    expectedTaskVersion: params.expectedVersion,
    correlationId: params.requestId,
    requestId: params.requestId,
    emitAudits: true,
  });

  return finalizeOutcome(deps.runtime, params.db, organizationId, result, 'new_request');
}

async function runFailedRetry(
  deps: HandoffServiceDeps,
  params: HandoffServiceParams,
  requestFingerprint: string,
  failedAttempt: PersistedHandoffAttempt,
): Promise<HandoffServiceResult> {
  const organizationId = params.owner.organizationId;

  // Failed-delivery retry: reuse the existing attempt/capability/Assignment via the A7.5 retry
  // orchestration. Do NOT reject because the Task is now assigned, do NOT compare the original ETag
  // version to the current Task, and do NOT re-run initial Recipient-active eligibility — retry uses
  // the original capability/Assignment delivery snapshot.
  const result = await deps.orchestrator.retryHandoff({
    organizationId,
    ownerId: params.owner.ownerId,
    attemptId: failedAttempt.id,
    requestFingerprint,
    correlationId: params.requestId,
    requestId: params.requestId,
    emitAudits: true,
  });

  return finalizeOutcome(deps.runtime, params.db, organizationId, result, 'retry_failed');
}

async function finalizeOutcome(
  runtime: HandoffServiceRuntime,
  db: DbClient,
  organizationId: string,
  result: HandoffOrchestrationResult,
  classification: HandoffClassification,
): Promise<HandoffServiceResult> {
  if (result.category === 'delivered' || result.category === 'delivered_replay') {
    if (!result.attemptId) {
      return error(500, 'INTERNAL_ERROR', 'An unexpected error occurred.', classification);
    }
    const attempt = await runtime.getHandoffAttemptById(db, organizationId, result.attemptId);
    return buildSuccess(
      runtime,
      db,
      organizationId,
      attempt,
      result.category === 'delivered_replay',
      classification,
    );
  }
  const mapped = mapOutcomeToError(result);
  return { ok: false, ...mapped, classification };
}

async function buildSuccess(
  runtime: HandoffServiceRuntime,
  db: DbClient,
  organizationId: string,
  attempt: PersistedHandoffAttempt,
  idempotentReplay: boolean,
  classification: HandoffClassification,
): Promise<HandoffServiceResult> {
  const task = await runtime.getTaskById(db, organizationId, attempt.taskId);
  const recipient = await runtime.getRecipientById(db, organizationId, attempt.recipientId);
  const body: HandoffTaskResponse = {
    task: mapTaskToDto(task),
    deliveryPath: attempt.deliveryPath,
    deliveryStatus: 'sent',
    recipient: mapRecipientToDto(recipient),
    capabilityId: attempt.capabilityId,
    requiresSendReconsent: false,
    idempotentReplay,
  };
  return {
    ok: true,
    status: 200,
    body,
    etag: formatETag('task', task.id, task.version),
    classification,
  };
}

/**
 * Map a private A7.5 orchestration outcome to a public error (status + ErrorCode). Never exposes a
 * raw provider reason: `result.message` is the generic, content-free safe message.
 */
function mapOutcomeToError(result: HandoffOrchestrationResult): {
  status: number;
  code: ErrorCode;
  message: string;
} {
  const message = result.message;
  switch (result.category) {
    case 'in_progress':
    case 'handoff_in_progress':
      return { status: 409, code: 'HANDOFF_IN_PROGRESS', message };
    case 'idempotency_conflict':
      return { status: 409, code: 'IDEMPOTENCY_KEY_CONFLICT', message };
    case 'unresolved_prior_handoff':
    case 'provider_message_conflict':
      return { status: 409, code: 'DOMAIN_CONFLICT', message };
    case 'persistence_conflict':
      return result.retryable
        ? { status: 412, code: 'PRECONDITION_FAILED', message }
        : { status: 409, code: 'DOMAIN_CONFLICT', message };
    case 'not_found':
      return { status: 404, code: 'NOT_FOUND', message };
    case 'invalid_recipient_state':
      return { status: 400, code: 'RECIPIENT_INACTIVE', message };
    case 'gmail_not_connected':
      return { status: 503, code: 'GMAIL_NOT_CONNECTED', message };
    case 'send_reconsent_required':
      return { status: 403, code: 'GMAIL_SEND_SCOPE_REQUIRED', message };
    case 'source_unavailable':
      return { status: 400, code: 'GMAIL_SOURCE_UNAVAILABLE', message };
    case 'incomplete_forward':
    case 'attachment_unavailable':
    case 'unsupported_source_shape':
    case 'message_too_large':
      return { status: 400, code: 'HANDOFF_INCOMPLETE_FORWARD_PROHIBITED', message };
    case 'unsupported_delivery_path':
      return { status: 400, code: 'HANDOFF_NOT_ELIGIBLE', message };
    // Permanent, known provider rejections → 400 HANDOFF_DELIVERY_FAILED (409 is reserved for state).
    case 'known_provider_rejection':
    case 'non_retryable_provider_failure':
    case 'invalid_recipient':
      return { status: 400, code: 'HANDOFF_DELIVERY_FAILED', message };
    // Retryable known provider failures → 503 HANDOFF_DELIVERY_FAILED.
    case 'retryable_provider_failure':
    case 'previous_attempt_failed':
      return { status: 503, code: 'HANDOFF_DELIVERY_FAILED', message };
    // Ambiguous / unknown provider outcome → 503 DEPENDENCY_UNAVAILABLE; attempt stays pending.
    case 'ambiguous':
      return { status: 503, code: 'DEPENDENCY_UNAVAILABLE', message };
    case 'configuration_error':
      return { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' };
    default:
      return { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' };
  }
}

function error(
  status: number,
  code: ErrorCode,
  message: string,
  classification: HandoffClassification,
): HandoffServiceResult {
  return { ok: false, status, code, message, classification };
}

function isNotFound(err: unknown): boolean {
  const code = readAnyPersistenceErrorCode(err);
  return code === 'NOT_FOUND' || code === 'ORGANIZATION_MISMATCH';
}

/**
 * Production entry point used by the HTTP route. Builds the traced runtime + the real A7.5
 * orchestrator (real Gmail transport) with the trusted Task forward-source resolver, then runs the
 * idempotency-first service. Never called in tests that must avoid real Gmail.
 */
export async function runHandoffService(
  params: HandoffServiceParams,
): Promise<HandoffServiceResult> {
  const runtime = await loadDbRuntime();
  const orchestrator = await createRuntimeHandoffOrchestrator({
    db: params.db,
    capabilityConfig: getCapabilityTokenConfig(),
    forwardSource: createTaskGmailForwardSource(),
    logger: createConsoleHandoffLogger(),
  });
  return executeHandoff({ runtime, orchestrator }, params);
}
