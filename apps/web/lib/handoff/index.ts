import 'server-only';

/**
 * A7.5 handoff application orchestration — internal barrel.
 *
 * Coordinates the A7.3 persistence primitives with the A7.4 Gmail transport across the distributed
 * transaction boundary. Internal only: no HTTP surface, no auth, no untrusted payloads.
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
