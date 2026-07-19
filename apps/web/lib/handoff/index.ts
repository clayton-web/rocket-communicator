import 'server-only';

/**
 * A7.5/A7.7 handoff application orchestration — internal barrel.
 *
 * Coordinates the A7.3 persistence primitives with the A7.4 Gmail transport across the distributed
 * transaction boundary. The A7.7 route-facing service (`executeHandoff` / `runHandoffService`) is the
 * sole public HTTP entry point; the orchestrator itself remains internal (no auth, no untrusted payloads).
 */

export { createHandoffOrchestrator } from './orchestrator';
export { createRuntimeHandoffOrchestrator } from './create-orchestrator';
export {
  createRuntimeHandoffStore,
  type RuntimeHandoffStoreDeps,
  type HandoffRuntime,
} from './runtime-store';
export {
  createGmailAccessResolver,
  createHandoffTransportPort,
  createOutboundMessagePreparer,
} from './runtime-adapters';
export { noopHandoffLogger, createConsoleHandoffLogger } from './observability';
export {
  outcome,
  outcomeFromTransportFailure,
  outcomeFromPersistenceError,
  persistedFailureCategory,
  readAnyPersistenceErrorCode,
} from './outcomes';
export {
  computeProductionHandoffRequestFingerprint,
  sha256HandoffFingerprintHasher,
} from './fingerprint';
export { resolveTaskGmailForwardSource, createTaskGmailForwardSource } from './forward-source';
export {
  executeHandoff,
  runHandoffService,
  type HandoffServiceDeps,
  type HandoffServiceParams,
  type HandoffServiceResult,
  type HandoffServiceRuntime,
  type HandoffClassification,
} from './service';
export { parseHandoffBody, parseIdempotencyKey, type ParsedHandoffBody } from './validate';
export type {
  BeginHandoffResult,
  GmailAccessResolution,
  GmailAccessResolver,
  HandoffLogRecord,
  HandoffLogger,
  HandoffOrchestrator,
  HandoffOrchestratorDeps,
  HandoffOrchestrationResult,
  HandoffOutcomeCategory,
  HandoffOutcomeStatus,
  HandoffPhase,
  HandoffStore,
  HandoffTransportPort,
  HandoffTransitionAudit,
  InitialHandoffCommand,
  OutboundMessagePreparer,
  PrepareMessageInput,
  PrepareMessageResult,
  PrepareRetryResult,
  RecordAcceptedInput,
  RecordAcceptedResult,
  RecordFailedInput,
  RetryHandoffCommand,
} from './types';
