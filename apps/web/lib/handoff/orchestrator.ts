import 'server-only';
import type { HandoffDeliveryPath, Task } from '@aicaa/domain';
import type { PersistedCapability, PersistedHandoffAttempt } from '@aicaa/db';
import { transportFailure } from '@/lib/gmail/transport/errors';
import type { GmailSendResult } from '@/lib/gmail/transport/gmail-transport';
import type { OutboundMessage } from '@/lib/gmail/transport/outbound-types';
import { noopHandoffLogger } from './observability';
import { outcome, outcomeFromPersistenceError, outcomeFromTransportFailure } from './outcomes';
import type {
  GmailAccessResolution,
  HandoffLogRecord,
  HandoffLogger,
  HandoffOrchestrationResult,
  HandoffOrchestrator,
  HandoffOrchestratorDeps,
  InitialHandoffCommand,
  RetryHandoffCommand,
} from './types';

/**
 * A7.5 handoff delivery orchestrator.
 *
 * ┌────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ Distributed transaction boundary (NEVER hold a DB transaction open across the Gmail call):    │
 * │                                                                                                │
 * │   DB txn: begin/replay pending handoff   (store.beginInitialHandoff / store.prepareRetry)      │
 * │                     ↓                                                                           │
 * │   Gmail transport call OUTSIDE any DB txn   (transport.send — exactly once per execution)      │
 * │                     ↓                                                                           │
 * │   DB txn: record accepted or failed outcome (store.recordAccepted / store.recordFailed)        │
 * └────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Exactly-once email delivery is NOT claimed. The service provides: durable idempotency for creating
 * handoff state; at-most-one known provider acceptance recording per attempt; duplicate-send
 * prevention on normal replays; and explicit uncertainty after process/provider boundary failures.
 *
 * Process-crash windows (a crash = the invocation dies before the next DB txn commits):
 *  - Window A: begin committed, crash before the Gmail call → attempt stays pending; a later replay
 *    returns `in_progress` and never blindly resends; reconciliation resolves it.
 *  - Window B: Gmail returns a known rejection, crash before the failed outcome persists → attempt
 *    stays pending; replay returns `in_progress`, never resends; reconciliation resolves it.
 *  - Window C: Gmail accepts, crash before the accepted outcome persists → attempt stays pending
 *    although the email may have been delivered; capability stays non-actionable; replay returns
 *    `in_progress`, never resends; reconciliation resolves it.
 *  - Window D: accepted outcome persists, the response to the caller is lost → same-key replay
 *    returns the existing sent result (`delivered_replay`) and never calls Gmail again.
 */
export function createHandoffOrchestrator(deps: HandoffOrchestratorDeps): HandoffOrchestrator {
  const clock = deps.clock ?? (() => new Date());
  const logger = deps.logger ?? noopHandoffLogger;

  function log(record: Omit<HandoffLogRecord, 'event'>): void {
    logger.log({ event: 'handoff_orchestration', ...record });
  }

  function accessPrerequisiteFailure(
    resolution: Exclude<GmailAccessResolution, { state: 'send_available' }>,
  ): HandoffOrchestrationResult {
    return resolution.state === 'not_connected'
      ? outcome('gmail_not_connected', { retryable: false })
      : outcome('send_reconsent_required', { retryable: false });
  }

  async function runSendPipeline(params: {
    operation: 'initial' | 'retry';
    organizationId: string;
    correlationId?: string;
    startedAt: number;
    access: Extract<GmailAccessResolution, { state: 'send_available' }>;
    attempt: PersistedHandoffAttempt;
    capability: PersistedCapability;
    task: Task;
    deliveryPath: HandoffDeliveryPath;
    capabilityUrl?: string;
    /** Send generation this execution owns; required so stale terminal results are rejected. */
    sendGeneration: number;
    ownerNote?: string;
    ownerId?: string;
    requestId?: string;
    emitAudits?: boolean;
  }): Promise<HandoffOrchestrationResult> {
    const {
      operation,
      organizationId,
      correlationId,
      startedAt,
      access,
      attempt,
      capability,
      task,
      deliveryPath,
      capabilityUrl,
      sendGeneration,
      ownerNote,
      ownerId,
      requestId,
      emitAudits,
    } = params;

    const base = { operation, organizationId, correlationId, attemptId: attempt.id, deliveryPath };
    const elapsed = () => clock().getTime() - startedAt;
    // Durable-audit context (privacy-safe stable identifiers only). Undefined for internal/test
    // callers that do not opt into auditing; written atomically inside the A7.3 terminal transitions.
    const transitionAudit = () =>
      emitAudits && ownerId
        ? {
            ownerId,
            requestId,
            correlationId,
            taskId: attempt.taskId,
            assignmentId: attempt.assignmentId,
            capabilityId: attempt.capabilityId,
          }
        : undefined;

    // ── message_build ────────────────────────────────────────────────────────────────────────
    log({ ...base, phase: 'message_build' });
    const prepared = await deps.messages.prepare({
      context: operation,
      attempt,
      capability,
      task,
      access,
      deliveryPath,
      capabilityUrl,
      ownerNote,
    });
    if (!prepared.ok) {
      // Deterministic message-preparation failure (unsupported / incomplete / attachment / too large).
      // Record a typed failed attempt so no unexplained pending row is left behind. Never reaches Gmail.
      log({
        ...base,
        phase: 'persistence_fail',
        failureCode: prepared.failure.code,
        failureFingerprint: prepared.failure.fingerprint,
        retryable: prepared.failure.retryable,
        ambiguous: false,
        elapsedMs: elapsed(),
      });
      await deps.store.recordFailed({
        organizationId,
        attemptId: attempt.id,
        failure: prepared.failure,
        expectedSendGeneration: sendGeneration,
        correlationId,
        audit: transitionAudit(),
      });
      return outcomeFromTransportFailure(prepared.failure, { attemptId: attempt.id, deliveryPath });
    }

    const message = prepared.message;
    const attachmentCount = countAttachments(message);
    const attachmentBytes = sumAttachmentBytes(message);

    // ── provider_send (OUTSIDE any DB transaction, exactly once) ───────────────────────────────
    log({ ...base, phase: 'provider_send', attachmentCount, attachmentBytes });
    let sendResult: GmailSendResult;
    try {
      sendResult = await deps.transport.send({
        accessToken: access.accessToken,
        message,
        correlationId,
      });
    } catch {
      // A throw (crash / abort / timeout surfaced as an exception) after we began the send cannot
      // prove the message was not accepted → ambiguous. Leave the attempt pending; never record a
      // failure and never blindly resend. Reconciliation is required.
      const failure = transportFailure('GMAIL_AMBIGUOUS_SEND', 'transport_threw');
      log({
        ...base,
        phase: 'provider_send',
        outcomeCategory: 'ambiguous',
        ambiguous: true,
        reconciliationRequired: true,
        failureCode: failure.code,
        failureFingerprint: failure.fingerprint,
        elapsedMs: elapsed(),
      });
      return outcomeFromTransportFailure(failure, { attemptId: attempt.id, deliveryPath });
    }

    if (!sendResult.ok) {
      const failure = sendResult.failure;
      if (failure.ambiguous) {
        // Uncertain outcome: preserve that delivery may have occurred. Do NOT record failed; leave
        // pending + capability non-actionable; return a stable uncertain result for reconciliation.
        log({
          ...base,
          phase: 'provider_send',
          outcomeCategory: 'ambiguous',
          ambiguous: true,
          reconciliationRequired: true,
          failureCode: failure.code,
          failureFingerprint: failure.fingerprint,
          elapsedMs: elapsed(),
        });
        return outcomeFromTransportFailure(failure, { attemptId: attempt.id, deliveryPath });
      }

      // Known rejection (retryable or not). Record failed in a new short transaction.
      log({
        ...base,
        phase: 'persistence_fail',
        failureCode: failure.code,
        failureFingerprint: failure.fingerprint,
        retryable: failure.retryable,
        ambiguous: false,
        elapsedMs: elapsed(),
      });
      await deps.store.recordFailed({
        organizationId,
        attemptId: attempt.id,
        failure,
        expectedSendGeneration: sendGeneration,
        correlationId,
        audit: transitionAudit(),
      });
      return outcomeFromTransportFailure(failure, { attemptId: attempt.id, deliveryPath });
    }

    // ── persistence_accept (new short transaction) ─────────────────────────────────────────────
    const acceptance = sendResult.acceptance;
    log({ ...base, phase: 'persistence_accept' });
    let recorded;
    try {
      recorded = await deps.store.recordAccepted({
        organizationId,
        attemptId: attempt.id,
        providerMessageId: acceptance.providerMessageId,
        providerAcceptedAt: acceptance.acceptedAt,
        expectedSendGeneration: sendGeneration,
        correlationId,
        audit: transitionAudit(),
      });
    } catch {
      // Gmail accepted but persisting acceptance failed (e.g. a crash-window C style failure). The
      // attempt remains pending and the capability remains non-actionable → treat as ambiguous and
      // require reconciliation. Never resend and never leak the raw error.
      const failure = transportFailure('GMAIL_AMBIGUOUS_SEND', 'accept_persist_failed');
      log({
        ...base,
        phase: 'persistence_accept',
        outcomeCategory: 'ambiguous',
        ambiguous: true,
        reconciliationRequired: true,
        failureCode: failure.code,
        failureFingerprint: failure.fingerprint,
        elapsedMs: elapsed(),
      });
      return outcomeFromTransportFailure(failure, { attemptId: attempt.id, deliveryPath });
    }

    if (!recorded.ok) {
      log({
        ...base,
        phase: 'persistence_accept',
        outcomeCategory: 'provider_message_conflict',
        elapsedMs: elapsed(),
      });
      return outcome('provider_message_conflict', {
        attemptId: attempt.id,
        deliveryPath,
        retryable: false,
      });
    }

    log({
      ...base,
      phase: 'persistence_accept',
      outcomeCategory: 'delivered',
      elapsedMs: elapsed(),
    });
    return outcome('delivered', {
      attemptId: attempt.id,
      deliveryPath,
      providerMessageId: acceptance.providerMessageId,
      retryable: false,
    });
  }

  async function deliverInitialHandoff(
    command: InitialHandoffCommand,
  ): Promise<HandoffOrchestrationResult> {
    const startedAt = clock().getTime();
    const { organizationId, correlationId, deliveryPath } = command;

    // ── prerequisite (deterministic, pre-persistence) ──────────────────────────────────────────
    log({
      operation: 'initial',
      phase: 'prerequisite',
      organizationId,
      correlationId,
      deliveryPath,
    });
    const access = await deps.access.resolve(organizationId);
    if (access.state !== 'send_available') {
      return accessPrerequisiteFailure(access);
    }

    // ── persistence_begin ──────────────────────────────────────────────────────────────────────
    log({
      operation: 'initial',
      phase: 'persistence_begin',
      organizationId,
      correlationId,
      deliveryPath,
    });
    let begin;
    try {
      begin = await deps.store.beginInitialHandoff(command);
    } catch (error) {
      const normalized = outcomeFromPersistenceError(error, { deliveryPath });
      if (normalized) {
        return normalized;
      }
      throw error;
    }

    // ── replay awareness (distinguish creator vs replay via the A7.3 `kind` discriminant) ──────
    switch (begin.kind) {
      case 'replay_sent':
        return outcome('delivered_replay', {
          attemptId: begin.attempt.id,
          deliveryPath: begin.attempt.deliveryPath,
          providerMessageId: begin.attempt.providerMessageId ?? undefined,
          retryable: false,
        });
      case 'replay_pending':
        // May be Window A/B/C: pending exists, provider outcome not durable. Never resend here.
        return outcome('in_progress', {
          attemptId: begin.attempt.id,
          deliveryPath: begin.attempt.deliveryPath,
          reconciliationRequired: true,
        });
      case 'retry_failed':
        // Same-key request whose attempt is failed: require the explicit retry operation.
        return outcome('previous_attempt_failed', {
          attemptId: begin.attempt.id,
          deliveryPath: begin.attempt.deliveryPath,
          retryable: true,
        });
      case 'created':
        break;
    }

    if (!begin.capabilityUrl) {
      // Defensive: a created attempt must carry a freshly minted capability URL. Do not send.
      await deps.store.recordFailed({
        organizationId,
        attemptId: begin.attempt.id,
        failure: transportFailure('GMAIL_CONFIGURATION_ERROR', 'missing_capability_url'),
        expectedSendGeneration: begin.sendGeneration,
        correlationId,
      });
      return outcome('configuration_error', { attemptId: begin.attempt.id, deliveryPath });
    }

    return runSendPipeline({
      operation: 'initial',
      organizationId,
      correlationId,
      startedAt,
      access,
      attempt: begin.attempt,
      capability: begin.capability,
      task: begin.task,
      deliveryPath: begin.attempt.deliveryPath,
      capabilityUrl: begin.capabilityUrl,
      sendGeneration: begin.sendGeneration,
      ownerNote: command.ownerNote,
      ownerId: command.ownerId,
      requestId: command.requestId,
      emitAudits: command.emitAudits,
    });
  }

  async function retryHandoff(command: RetryHandoffCommand): Promise<HandoffOrchestrationResult> {
    const startedAt = clock().getTime();
    const { organizationId, correlationId } = command;

    log({ operation: 'retry', phase: 'prerequisite', organizationId, correlationId });
    const access = await deps.access.resolve(organizationId);
    if (access.state !== 'send_available') {
      return accessPrerequisiteFailure(access);
    }

    log({ operation: 'retry', phase: 'persistence_begin', organizationId, correlationId });
    let prep;
    try {
      prep = await deps.store.prepareRetry(command);
    } catch (error) {
      const normalized = outcomeFromPersistenceError(error);
      if (normalized) {
        return normalized;
      }
      throw error;
    }

    // Exclusive execution ownership: only the invocation that atomically won `failed → pending` may
    // build a message and call Gmail. A loser holds no rotated token/URL and must never send.
    if (!prep.won) {
      log({
        operation: 'retry',
        phase: 'persistence_begin',
        organizationId,
        correlationId,
        attemptId: prep.attempt.id,
        outcomeCategory: 'handoff_in_progress',
      });
      return outcome('handoff_in_progress', {
        attemptId: prep.attempt.id,
        deliveryPath: prep.attempt.deliveryPath,
        retryable: false,
      });
    }

    if (!prep.capabilityUrl) {
      // Defensive: a winning retry must carry a freshly rotated capability URL. Do not send.
      await deps.store.recordFailed({
        organizationId,
        attemptId: prep.attempt.id,
        failure: transportFailure('GMAIL_CONFIGURATION_ERROR', 'missing_capability_url'),
        expectedSendGeneration: prep.sendGeneration,
        correlationId,
      });
      return outcome('configuration_error', {
        attemptId: prep.attempt.id,
        deliveryPath: prep.attempt.deliveryPath,
      });
    }

    return runSendPipeline({
      operation: 'retry',
      organizationId,
      correlationId,
      startedAt,
      access,
      attempt: prep.attempt,
      capability: prep.capability,
      task: prep.task,
      deliveryPath: prep.attempt.deliveryPath,
      capabilityUrl: prep.capabilityUrl,
      sendGeneration: prep.sendGeneration,
      ownerId: command.ownerId,
      requestId: command.requestId,
      emitAudits: command.emitAudits,
    });
  }

  return { deliverInitialHandoff, retryHandoff };
}

function countAttachments(message: OutboundMessage): number {
  return (message.attachments?.length ?? 0) + (message.inlineImages?.length ?? 0);
}

function sumAttachmentBytes(message: OutboundMessage): number {
  let total = 0;
  for (const attachment of message.attachments ?? []) {
    total += attachment.content.byteLength;
  }
  for (const inline of message.inlineImages ?? []) {
    total += inline.content.byteLength;
  }
  return total;
}
