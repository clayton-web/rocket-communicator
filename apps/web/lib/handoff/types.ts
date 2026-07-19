import 'server-only';
import type { HandoffDeliveryPath, Task } from '@aicaa/domain';
import type { PersistedCapability, PersistedHandoffAttempt } from '@aicaa/db';
import type { OutboundAddress, OutboundMessage } from '@/lib/gmail/transport/outbound-types';
import type { GmailSendResult } from '@/lib/gmail/transport/gmail-transport';
import type { TransportFailure } from '@/lib/gmail/transport/errors';

/**
 * A7.5 application orchestration — internal type surface.
 *
 * This layer coordinates the A7.3 persistence primitives with the A7.4 Gmail transport across the
 * distributed transaction boundary:
 *
 *   DB txn: begin/replay pending handoff  →  Gmail send (OUTSIDE any DB txn)  →  DB txn: record outcome
 *
 * It is internal only: no HTTP surface, no cookie/header auth, no untrusted payloads. The future
 * authorized HTTP layer constructs {@link InitialHandoffCommand} / {@link RetryHandoffCommand} after
 * authentication + validation, then invokes the orchestrator. None of these types are public OpenAPI
 * shapes; a later HTTP mapping collapses the richer private discriminants into approved public codes.
 */

/* ------------------------------------------------------------------------------------------------ *
 * Commands (already-authorized application inputs)
 * ------------------------------------------------------------------------------------------------ */

/**
 * Trusted initial-handoff command. Contains only inputs an authorized caller may supply. It NEVER
 * carries OAuth tokens, Gmail account/message ids, MIME headers, capability tokens, or provider
 * message ids — those are resolved internally from trusted persisted records or minted by the store.
 */
export interface InitialHandoffCommand {
  organizationId: string;
  ownerId: string;
  taskId: string;
  /** Resolved, trusted Recipient id (email + deliverability are enforced in the A7.3 transaction). */
  recipientId: string;
  /** Server-selected delivery path — never re-decided or downgraded during orchestration. */
  deliveryPath: HandoffDeliveryPath;
  /** Idempotency key reserved by A7.3 (organization-scoped uniqueness). */
  idempotencyKey: string;
  /** Deterministic request fingerprint (domain `computeHandoffRequestFingerprint`). */
  requestFingerprint: string;
  /** Handoff acknowledgement string (e.g. HANDOFF_ACKNOWLEDGEMENT_V1). */
  acknowledgement: string;
  /** Optional short Owner-authored assignment intro/note. Never logged. */
  ownerNote?: string;
  /** Optional correlation id for privacy-safe logs. */
  correlationId?: string;
}

/**
 * Trusted retry command for a previously failed, retryable attempt. Reuses the same attempt,
 * assignment, capability, idempotency identity, and request fingerprint.
 */
export interface RetryHandoffCommand {
  organizationId: string;
  ownerId: string;
  /** The failed attempt to retry (resolved from trusted persisted records). */
  attemptId: string;
  /** Must match the failed attempt's request fingerprint (A7.3 verifies). */
  requestFingerprint: string;
  correlationId?: string;
}

/* ------------------------------------------------------------------------------------------------ *
 * Ports (dependency-injected; no hidden globals)
 * ------------------------------------------------------------------------------------------------ */

/** Gmail send-access resolution (connection + `gmail.send` capability + sender identity + token). */
export type GmailAccessResolution =
  | {
      state: 'send_available';
      /** Already-authorized Gmail access token. NEVER logged. */
      accessToken: string;
      /** Owner Gmail identity used as the outbound `From`. */
      from: OutboundAddress;
      /** Communication account id (used to guard forward-source ownership). */
      accountId: string;
    }
  | { state: 'not_connected' }
  | { state: 'send_scope_required' };

export interface GmailAccessResolver {
  /** Resolve send access for the org. Deterministic pre-persistence prerequisite. */
  resolve(organizationId: string): Promise<GmailAccessResolution>;
}

/** Result of the A7.3 begin/replay primitive, plus the (created-only) freshly minted capability URL. */
export interface BeginHandoffResult {
  kind: 'created' | 'replay_pending' | 'replay_sent' | 'retry_failed';
  attempt: PersistedHandoffAttempt;
  capability: PersistedCapability;
  task: Task;
  /**
   * The one-time capability URL bound to the newly minted capability. Present ONLY for `created`
   * (a replay cannot recover the raw token). NEVER logged.
   */
  capabilityUrl?: string;
  /** Send generation (attemptCount) required by terminal recording. `created` sends at generation 1. */
  sendGeneration: number;
}

export interface PrepareRetryResult {
  /**
   * Exclusive execution-ownership lease from the authoritative A7.3 retry transition. Only when
   * `won` is true did this invocation atomically claim `failed → pending`; only the winner rotates
   * the token, receives a usable {@link capabilityUrl}, and may build a message and call Gmail.
   * Losers (`won = false`) must return a typed handoff-in-progress result and never send.
   */
  won: boolean;
  attempt: PersistedHandoffAttempt;
  capability: PersistedCapability;
  task: Task;
  /**
   * Freshly rotated one-time capability URL bound to the SAME capability row with a NEW token hash.
   * Present only for the winning invocation (`won = true`). The prior link is invalidated atomically
   * during retry preparation. NEVER logged or persisted.
   */
  capabilityUrl?: string;
  /** Send generation (attemptCount) of the winning retry; required by terminal recording. */
  sendGeneration: number;
}

export interface RecordAcceptedInput {
  organizationId: string;
  attemptId: string;
  providerMessageId: string;
  providerAcceptedAt: string;
  /** Send generation the winning execution sent at; a stale generation is rejected without mutation. */
  expectedSendGeneration: number;
  correlationId?: string;
}

export type RecordAcceptedResult =
  | { ok: true; attempt: PersistedHandoffAttempt; capability: PersistedCapability }
  | { ok: false; conflict: 'provider_message_conflict' };

export interface RecordFailedInput {
  organizationId: string;
  attemptId: string;
  failure: TransportFailure;
  /** Send generation the failing execution sent at; a stale generation is rejected without mutation. */
  expectedSendGeneration: number;
  correlationId?: string;
}

/** Persistence port wrapping the A7.3 transaction primitives (short transactions only). */
export interface HandoffStore {
  beginInitialHandoff(command: InitialHandoffCommand): Promise<BeginHandoffResult>;
  prepareRetry(command: RetryHandoffCommand): Promise<PrepareRetryResult>;
  recordAccepted(input: RecordAcceptedInput): Promise<RecordAcceptedResult>;
  recordFailed(input: RecordFailedInput): Promise<void>;
}

export interface PrepareMessageInput {
  context: 'initial' | 'retry';
  attempt: PersistedHandoffAttempt;
  capability: PersistedCapability;
  task: Task;
  access: Extract<GmailAccessResolution, { state: 'send_available' }>;
  deliveryPath: HandoffDeliveryPath;
  /**
   * Fully-formed capability URL (included exactly once per alternative). Present for both `initial`
   * (freshly minted token) and `retry` (freshly rotated token). The production preparer never
   * reconstructs or injects a prior URL.
   */
  capabilityUrl?: string;
  ownerNote?: string;
}

export type PrepareMessageResult =
  { ok: true; message: OutboundMessage } | { ok: false; failure: TransportFailure };

/** Builds the outbound message (assignment_email / gmail_forward) using A7.4 builders + source loader. */
export interface OutboundMessagePreparer {
  prepare(input: PrepareMessageInput): Promise<PrepareMessageResult>;
}

/** Gmail transport port (A7.4). The provider call MUST happen outside any DB transaction. */
export interface HandoffTransportPort {
  send(input: {
    accessToken: string;
    message: OutboundMessage;
    correlationId?: string;
  }): Promise<GmailSendResult>;
}

/* ------------------------------------------------------------------------------------------------ *
 * Observability
 * ------------------------------------------------------------------------------------------------ */

export type HandoffPhase =
  | 'prerequisite'
  | 'persistence_begin'
  | 'message_build'
  | 'provider_send'
  | 'persistence_accept'
  | 'persistence_fail';

/**
 * Privacy-safe structured log record. NEVER carries OAuth tokens, capability URL/token, MIME, source
 * body, summary/body text, subject, plaintext recipient email, attachment content, or raw provider
 * errors. Only stable identifiers, categories, fingerprints, and counters.
 */
export interface HandoffLogRecord {
  event: 'handoff_orchestration';
  operation: 'initial' | 'retry';
  phase: HandoffPhase;
  organizationId: string;
  correlationId?: string;
  attemptId?: string;
  deliveryPath?: HandoffDeliveryPath;
  outcomeCategory?: HandoffOutcomeCategory;
  retryable?: boolean;
  ambiguous?: boolean;
  reconciliationRequired?: boolean;
  /** Privacy-safe transport/failure fingerprint (never reversible to content). */
  failureFingerprint?: string;
  failureCode?: string;
  attachmentCount?: number;
  attachmentBytes?: number;
  elapsedMs?: number;
}

export interface HandoffLogger {
  log(record: HandoffLogRecord): void;
}

/* ------------------------------------------------------------------------------------------------ *
 * Normalized outcome taxonomy (internal; richer than public OpenAPI)
 * ------------------------------------------------------------------------------------------------ */

export type HandoffOutcomeCategory =
  // successes
  | 'delivered'
  | 'delivered_replay'
  // in-progress / uncertain (reconciliation may be required)
  | 'in_progress'
  | 'ambiguous'
  // needs an explicit follow-up operation
  | 'previous_attempt_failed'
  // pre-persistence prerequisite failures (no durable state created)
  | 'gmail_not_connected'
  | 'send_reconsent_required'
  | 'unsupported_delivery_path'
  // message-preparation failures (recorded as a typed failed attempt)
  | 'source_unavailable'
  | 'attachment_unavailable'
  | 'message_too_large'
  | 'invalid_recipient'
  | 'incomplete_forward'
  | 'unsupported_source_shape'
  | 'configuration_error'
  // provider outcomes
  | 'known_provider_rejection'
  | 'retryable_provider_failure'
  | 'non_retryable_provider_failure'
  | 'provider_message_conflict'
  // persistence conflicts
  | 'idempotency_conflict'
  | 'handoff_in_progress'
  | 'unresolved_prior_handoff'
  | 'invalid_recipient_state'
  | 'persistence_conflict'
  | 'not_found';

export type HandoffOutcomeStatus = 'success' | 'in_progress' | 'failure';

/**
 * Normalized, privacy-safe orchestration result. No raw Prisma / Postgres / Google / MIME / OAuth /
 * network errors ever appear here. `providerMessageId` is present only on success.
 */
export interface HandoffOrchestrationResult {
  status: HandoffOutcomeStatus;
  category: HandoffOutcomeCategory;
  /** Safe, generic human-readable message. Never contains content, tokens, or provider bodies. */
  message: string;
  attemptId?: string;
  deliveryPath?: HandoffDeliveryPath;
  providerMessageId?: string;
  /** True when the caller/operator may attempt an explicit retry. */
  retryable: boolean;
  /** True when delivery may have occurred but cannot be confirmed (never blindly resend). */
  ambiguous: boolean;
  /** True when a later, explicitly-authorized reconciliation step is required to resolve truth. */
  reconciliationRequired: boolean;
  /** Privacy-safe failure discriminants for logs/telemetry (never content). */
  failureCode?: string;
  failureFingerprint?: string;
}

/* ------------------------------------------------------------------------------------------------ *
 * Orchestrator dependencies
 * ------------------------------------------------------------------------------------------------ */

export interface HandoffOrchestratorDeps {
  store: HandoffStore;
  access: GmailAccessResolver;
  messages: OutboundMessagePreparer;
  transport: HandoffTransportPort;
  /** Injectable clock (used for elapsed-time metrics only; acceptance time comes from transport). */
  clock?: () => Date;
  logger?: HandoffLogger;
}

export interface HandoffOrchestrator {
  deliverInitialHandoff(command: InitialHandoffCommand): Promise<HandoffOrchestrationResult>;
  retryHandoff(command: RetryHandoffCommand): Promise<HandoffOrchestrationResult>;
}
