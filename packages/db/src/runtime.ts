export {
  createPrismaClient,
  PrismaClient,
  Prisma,
  type DbClient,
  type DbTransaction,
} from './client/create-prisma-client.js';

export {
  PersistenceError,
  type PersistenceErrorCode,
  notFound,
  organizationMismatch,
  optimisticConcurrency,
  uniqueViolation,
  persistenceValidation,
  recipientHandoffNotAvailable,
  idempotencyKeyConflict,
  handoffInProgress,
  domainConflict,
  invalidState,
  isPersistenceError,
} from './errors/persistence-errors.js';

export {
  mapRecipient,
  mapTask,
  mapSuggestion,
  mapCapability,
  mapAuditEvent,
  mapNote,
  mapAssignment,
  mapHandoffAttempt,
  type AuditEventRecord,
  type PersistedHandoffAttempt,
} from './mappers/domain-mappers.js';

export {
  upsertRecipient,
  getRecipientById,
  createRecipient,
  listActiveRecipients,
  listActiveRecipientsPage,
  updateRecipient,
  deactivateRecipient,
  requireActiveRecipientForHandoff,
  type ListActiveRecipientsQuery,
  type ListActiveRecipientsResult,
} from './repositories/recipient-repository.js';
export {
  getTaskById,
  getTaskForCapabilityAuthorization,
  listTasks,
  createTask,
  updateTaskWithExpectedVersion,
  appendTaskNote,
  createActiveAssignment,
  updateActiveAssignmentCapabilityBinding,
  updateActiveAssignmentDeliveryStatus,
  clearAssignment,
  listTaskAssignments,
  type ListTasksQuery,
  type ListTasksResult,
} from './repositories/task-repository.js';
export {
  createTaskSuggestion,
  getTaskSuggestionById,
  listTaskSuggestions,
  type ListTaskSuggestionsQuery,
  type ListTaskSuggestionsResult,
} from './repositories/suggestion-repository.js';
export {
  createCapability,
  getCapabilityById,
  findCapabilityByTokenHash,
  findActiveCapabilitiesForAssignment,
  revokeCapabilityRecord,
  markCapabilityExpiredRecord,
  listExpirableCapabilities,
  expireCapabilityIfDue,
  activateCapabilityRecord,
  isPersistedCapabilityActionable,
  type ExpirableCapabilityRow,
  type PersistedCapability,
} from './repositories/capability-repository.js';
export {
  observeCapabilityExpiry,
  type ObserveCapabilityExpiryInput,
  type ObserveCapabilityExpiryResult,
} from './transactions/a8-5d-capability-expiry.js';
export {
  createHandoffAttempt,
  getHandoffAttemptById,
  findHandoffAttemptByIdempotencyKey,
  findPendingHandoffAttemptForAssignment,
  findLatestHandoffAttemptForAssignment,
  isUnresolvedHandoffAttemptForAdminIssuance,
  assertAdminIssuanceNotBlockedByHandoff,
  lookupHandoffIdempotency,
  listStalePendingHandoffAttempts,
  type HandoffIdempotencyLookup,
} from './repositories/handoff-attempt-repository.js';
export {
  createAuditEvent,
  listAuditEventsForTask,
  type CreateAuditEventInput,
} from './repositories/audit-repository.js';

export {
  persistReturnToOwner,
  persistCapabilityAction,
  persistOwnerTaskMutation,
  persistWorkRequest,
} from './transactions/a4-transactions.js';

export {
  persistApproveTaskSuggestion,
  persistEditTaskSuggestion,
  persistDismissTaskSuggestion,
  persistMergeTaskSuggestion,
} from './transactions/a6-owner-suggestion-transactions.js';

// S3.1 shared interpretation persistence (D169). Present on the runtime bridge for the same reason
// the A8.4a worker primitives are: the application service that calls them is real code that must
// fail loudly at load if the bundle loses a binding. Nothing reaches that service — there is no
// interpretation route, worker, or cron, and the provider factory is default closed.
export {
  persistInterpretationOccurrence,
  resolveInterpretationOccurrence,
  type InterpretationOccurrence,
  type InterpretationOccurrenceResolution,
} from './transactions/s3-interpretation-transactions.js';

// A6.3 Application Suggestion Engine processing surface (claim + outcomes).
// Owner suggestion routes use a6-owner-suggestion-transactions only; they must not
// import @aicaa/ai. Processing symbols are available on the shared runtime module.
export {
  claimSuggestionProcessingBatch,
  releaseSuggestionProcessingClaim,
  type ClaimSuggestionProcessingBatchInput,
  type CompleteSuggestionProcessingOutcomeInput,
} from './repositories/suggestion-processing-repository.js';
export {
  persistSuggestionFromClaimedEvent,
  persistSkippedIrrelevantOutcome,
  persistFailedRetryableOutcome,
  persistFailedPermanentOutcome,
  persistClaimResolvedForExistingSuggestion,
  persistClaimReleasedWithoutOutcome,
} from './transactions/a6-transactions.js';
export {
  getCommunicationEventById,
  getTemporaryCommunicationExcerptByEventId,
  listEligibleGmailIntakeEvents,
  // D181 Messages Review. The Owner review route writes these only after D161 classifies a
  // request as new; they must fail at load if the serverless bundle loses the binding.
  upsertGoogleMessagesReviewEvent,
  upsertTemporaryCommunicationExcerpt,
} from './repositories/communication-event-repository.js';
export { getTaskSuggestionBySourceEventId } from './repositories/suggestion-repository.js';
export {
  findGmailSenderExclusionById,
  findGmailSenderExclusionByOrgAndAddress,
  listGmailExcludedSenderAddresses,
} from './repositories/gmail-sender-exclusion-repository.js';
export {
  persistGmailSenderExclusion,
  removeGmailSenderExclusion,
} from './transactions/gmail-sender-exclusion-transactions.js';

// A5.3 Owner Gmail OAuth / connection surface (server-only runtime bridge).
export {
  getCommunicationAccountByOrganization,
  getCommunicationAccountById,
  acquireGmailSyncLock,
  releaseGmailSyncLock,
  markCommunicationAccountNeedsReauth,
  markCommunicationAccountResyncRequired,
  listEligibleGmailAccountsForPoll,
  type EligibleGmailAccountForPoll,
} from './repositories/communication-account-repository.js';
export { getGmailOAuthCredentialByAccountId } from './repositories/gmail-credential-repository.js';
export {
  createGmailOAuthState,
  consumeGmailOAuthState,
  inspectGmailOAuthState,
  deleteFinishedGmailOAuthStates,
  type GmailOAuthStateRecord,
} from './repositories/gmail-oauth-state-repository.js';
export {
  createGmailSyncRun,
  finishGmailSyncRun,
  listGmailSyncRuns,
  type ListGmailSyncRunsQuery,
  type ListGmailSyncRunsResult,
} from './repositories/gmail-sync-run-repository.js';
export {
  persistGmailConnectionTransaction,
  persistGmailDisconnectTransaction,
  persistGmailHistoryPageTransaction,
  persistGmailChannelUnavailableTransaction,
  type PersistGmailConnectionResult,
  type PersistGmailDisconnectResult,
  type PersistGmailHistoryPageResult,
  type PersistGmailChannelUnavailableResult,
  type GmailChannelUnavailableTransition,
} from './transactions/gmail-transactions.js';

export {
  beginInitialHandoff,
  markHandoffSendAccepted,
  markHandoffDeliveryFailed,
  prepareFailedHandoffRetry,
  beginExplicitReforward,
  beginReassignment,
  resolveHandoffIdempotency,
  assertCreateTaskRejectsAssignment,
  type BeginInitialHandoffInput,
  type BeginInitialHandoffResult,
} from './transactions/a7-handoff-transactions.js';

// A8.3b Owner reminder API surface plus the A8.4a worker-safety foundation.
//
// The worker primitives are present from A8.4a because the internal processing endpoint calls them,
// but the endpoint is built dark and unreachable — it has never been deployed, delivery is off, and
// the processing service refuses to run at all unless a transport is injected, which nothing in
// production does. `recordTerminalOccurrenceOutcomeUnsafe` and `terminalizeExhaustedOccurrenceUnsafe`
// remain absent deliberately (A8.3a audit F8, A8.4a audit B2): both write a terminal outcome without
// settling the schedule, `finalizeReminderOccurrence` and `terminalizeExhaustedRetryOccurrence` are
// the public paths that run both phases, and
// `apps/web/__tests__/a8-4a-worker-safety-guards.test.ts` fails if either raw writer appears here.
export {
  findReminderScheduleByTaskId,
  claimReminderScheduleForProcessing,
  releaseReminderScheduleClaim,
  listDueReminderSchedulesGlobally,
  listDueAdvanceReminderSchedulesGlobally,
  // A8.6a Owner attention read. Owner-facing rather than worker-facing, and the first reminder
  // read in this bundle that a signed-in Owner reaches directly.
  listReminderSchedulesRequiringOwnerAttention,
  type CreateReminderScheduleInput,
  type OpenNextReminderGenerationInput,
  type ReminderOccurrenceInput,
  type DueReminderScheduleRow,
  type DueAdvanceReminderScheduleRow,
  type OwnerAttentionReminderRow,
} from './repositories/reminder-schedule-repository.js';
export {
  claimReminderOccurrence,
  listExpiredOccurrenceClaims,
  listRetryBudgetExhaustedOccurrences,
  listUnsettledTerminalOccurrences,
  markProviderCallStarted,
  RETRY_BUDGET_EXHAUSTED_FAILURE_CODE,
  type ClaimReminderOccurrenceResult,
  type ExhaustedRetryOccurrence,
  type ExpiredOccurrenceClaim,
  type UnsettledTerminalOccurrence,
} from './repositories/reminder-delivery-attempt-repository.js';
export {
  finalizeReminderOccurrence,
  finalizeAbandonedInFlightOccurrence,
  releaseReminderOccurrenceClaim,
  settleReminderOccurrenceSchedule,
  terminalizeExhaustedRetryOccurrence,
  type FinalizeReminderOccurrenceResult,
  type ReminderScheduleSettlementResult,
} from './transactions/a8-4a-occurrence-transactions.js';
export {
  getTaskDueLocalDate,
  readCoherentReminderProjection,
  readReminderPreSendSnapshot,
  type CoherentReminderProjection,
  type ReminderCapabilityState,
  type ReminderDeliveryTarget,
  type ReminderPreSendSnapshot,
} from './transactions/a8-reminder-transactions.js';
export {
  persistOwnerReminderEstablishment,
  persistOwnerReminderGenerationChange,
  persistOwnerReminderDueDateRemoval,
  type OwnerReminderMutationResult,
  type OwnerReminderRemovalResult,
  type OwnerReminderSaveResult,
  type SkippedAdvanceAttemptInput,
} from './transactions/a8b-owner-reminder-transactions.js';
export type {
  PersistedReminderSchedule,
  ReminderAdvanceDisposition,
  ReminderScheduleStatus,
  ReminderScheduleStopReason,
} from './mappers/reminder-mappers.js';
// A8.5a Owner Event Notification intent (D133). `createOwnerNotificationIntent` is exported for the
// A8.5d producers that write from their own transactions; the A8.5a producer reaches it through
// `persistCapabilityAction`, which derives the identity rather than accepting one.
export {
  createOwnerNotificationIntent,
  findOwnerNotificationIntentByIdentity,
  findOwnerNotificationSubjectTaskId,
  listOwnerNotificationIntentsForSubject,
  type CreateOwnerNotificationIntentInput,
  type OwnerNotificationCapture,
  type OwnerNotificationSystemCapture,
} from './repositories/owner-notification-repository.js';
// A8.5b delivery workflow. The worker reaches persistence only through these, and only with
// `ENABLE_OWNER_EVENT_DELIVERY` already established above it.
export {
  beginOwnerNotificationAttempt,
  claimOwnerNotificationIntent,
  findOwnerNotificationIntentById,
  listClaimableOwnerNotificationIntents,
  listExpiredOwnerNotificationClaims,
  listInFlightOwnerNotificationAttempts,
  listOwnerNotificationAttempts,
  recoverExpiredOwnerNotificationClaim,
  type BeginOwnerNotificationAttemptInput,
  type BeginOwnerNotificationAttemptResult,
  type ClaimOwnerNotificationIntentInput,
  type ClaimOwnerNotificationResult,
  type RecoverExpiredClaimResult,
} from './repositories/owner-notification-repository.js';
// A8.6c Owner visibility read, reached from the `/attention` server component. Read-only, bounded,
// and organization-scoped; it writes nothing and needs no flag, unlike the delivery workflow above.
export {
  listUndeliveredOwnerNotifications,
  type OwnerMissedNotificationRow,
} from './repositories/owner-notification-repository.js';
export {
  settleOwnerNotificationAttempt,
  terminalizeOwnerNotificationWithoutDelivery,
  type OwnerNotificationSettlement,
  type SettleOwnerNotificationAttemptInput,
  type SettleOwnerNotificationAttemptResult,
  type TerminalizeWithoutDeliveryInput,
} from './transactions/a8-5b-notification-transactions.js';
export type {
  OwnerNotificationActor,
  OwnerNotificationAttemptOutcomeValue,
  OwnerNotificationAttemptRecord,
  OwnerNotificationEventTypeValue,
  OwnerNotificationIntentRecord,
  OwnerNotificationStateValue,
  OwnerNotificationSubjectKindValue,
  OwnerNotificationSuppressionReasonValue,
} from './mappers/owner-notification-mappers.js';
