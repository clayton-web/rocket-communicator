export {
  createPrismaClient,
  PrismaClient,
  Prisma,
  type DbClient,
  type DbTransaction,
} from './client/create-prisma-client.js';
// createTestDatabase (PGlite) is exported for in-process tests; not for persistent DBs.

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
  isSerializationFailure,
} from './errors/persistence-errors.js';

export {
  mapRecipient,
  mapTask,
  mapSuggestion,
  mapCapability,
  mapAuditEvent,
  mapNote,
  mapAssignment,
  mapCommunicationAccount,
  mapCommunicationEvent,
  mapTemporaryCommunicationExcerpt,
  mapGmailSyncRun,
  mapHandoffAttempt,
  mapInterpretationRun,
  type AuditEventRecord,
  type GmailOAuthCredentialRecord,
  type PersistedHandoffAttempt,
  type PersistedInterpretationRun,
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
  TASK_DETAIL_NOTE_LIMIT,
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
  getTaskSuggestionBySourceEventId,
  listTaskSuggestions,
  updateTaskSuggestionWithExpectedVersion,
  type ListTaskSuggestionsQuery,
  type ListTaskSuggestionsResult,
} from './repositories/suggestion-repository.js';
export {
  claimSuggestionProcessingBatch,
  completeSuggestionProcessingOutcome,
  releaseSuggestionProcessingClaim,
  type ClaimSuggestionProcessingBatchInput,
  type CompleteSuggestionProcessingOutcomeInput,
} from './repositories/suggestion-processing-repository.js';
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
  assertCapabilityRevocationReason,
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
  findPendingHandoffAttemptForTask,
  findPendingHandoffAttemptForAssignment,
  findLatestHandoffAttemptForAssignment,
  isUnresolvedHandoffAttemptForAdminIssuance,
  assertAdminIssuanceNotBlockedByHandoff,
  listHandoffAttemptsForTask,
  listStalePendingHandoffAttempts,
  lookupHandoffIdempotency,
  markHandoffAttemptSent,
  markHandoffAttemptFailed,
  prepareHandoffAttemptRetry,
  lockHandoffAttemptForUpdate,
  assertAttemptAssignmentDeliveryAligned,
  type CreateHandoffAttemptInput,
  type HandoffIdempotencyLookup,
} from './repositories/handoff-attempt-repository.js';
export {
  createAuditEvent,
  listAuditEventsForTask,
  type CreateAuditEventInput,
} from './repositories/audit-repository.js';

// A8.3a reminder persistence foundation. Storage only: no worker, scheduler, cron, delivery, or
// route is implemented in this slice. Scheduling decisions come from @aicaa/domain (D103).
export {
  mapReminderSchedule,
  mapReminderDeliveryAttempt,
  isLiveReminderSchedule,
  isTerminalReminderOutcome,
  NO_SCHEDULE_REMINDER_VERSION,
  toReminderOccurrenceOutcome,
  toStorableLocalDate,
  toStorableLocalDateOrNull,
  type PersistedReminderSchedule,
  type PersistedReminderDeliveryAttempt,
  type ReminderAdvanceDisposition,
  type ReminderDeliveryOutcome,
  type ReminderOccurrenceKind,
  type ReminderScheduleStatus,
  type ReminderScheduleStopReason,
  type ReminderSkipReason,
} from './mappers/reminder-mappers.js';
export {
  createReminderSchedule,
  findReminderScheduleByTaskId,
  getReminderScheduleById,
  openNextReminderGeneration,
  suspendReminderScheduleForWaiting,
  resumeReminderScheduleFromWaiting,
  stopReminderSchedule,
  setNextOverdueOccurrence,
  markReminderScheduleRequiresOwnerAttention,
  incrementOverdueDeliveredCount,
  claimReminderScheduleForProcessing,
  releaseReminderScheduleClaim,
  listReminderSchedulesDueForProcessing,
  listDueReminderSchedulesGlobally,
  listDueAdvanceReminderSchedulesGlobally,
  listReminderSchedulesRequiringOwnerAttention,
  type CreateReminderScheduleInput,
  type OpenNextReminderGenerationInput,
  type ClaimReminderScheduleInput,
  type ListSchedulesDueForProcessingInput,
  type DueReminderScheduleRow,
  type DueAdvanceReminderScheduleRow,
  type OwnerAttentionReminderRow,
  type ReminderOccurrenceInput,
} from './repositories/reminder-schedule-repository.js';
export {
  requireTaskScope,
  requireScheduleScope,
  type AuthoritativeTaskScope,
  type AuthoritativeScheduleScope,
} from './repositories/reminder-scope-guard.js';
// Owner Event Notification intent (A8.5a, D133) and its delivery workflow (A8.5b, D135).
export {
  mapOwnerNotificationIntent,
  mapOwnerNotificationAttempt,
  type OwnerNotificationActor,
  type OwnerNotificationAttemptOutcomeValue,
  type OwnerNotificationAttemptRecord,
  type OwnerNotificationEventTypeValue,
  type OwnerNotificationIntentRecord,
  type OwnerNotificationStateValue,
  type OwnerNotificationSubjectKindValue,
  type OwnerNotificationSuppressionReasonValue,
} from './mappers/owner-notification-mappers.js';
export {
  beginOwnerNotificationAttempt,
  claimOwnerNotificationIntent,
  createOwnerNotificationIntent,
  findOwnerNotificationIntentById,
  findOwnerNotificationIntentByIdentity,
  findOwnerNotificationSubjectTaskId,
  listClaimableOwnerNotificationIntents,
  listExpiredOwnerNotificationClaims,
  listInFlightOwnerNotificationAttempts,
  listOwnerNotificationAttempts,
  listOwnerNotificationIntentsForSubject,
  listUndeliveredOwnerNotifications,
  recoverExpiredOwnerNotificationClaim,
  type BeginOwnerNotificationAttemptInput,
  type BeginOwnerNotificationAttemptResult,
  type ClaimOwnerNotificationIntentInput,
  type ClaimOwnerNotificationResult,
  type CreateOwnerNotificationIntentInput,
  type OwnerMissedNotificationRow,
  type OwnerNotificationCapture,
  type OwnerNotificationSystemCapture,
  type RecoverExpiredClaimResult,
} from './repositories/owner-notification-repository.js';
// A8.5b settlement. The only way a delivery attempt ends: intent state, attempt outcome, and the
// system-attributed audit event commit together, fenced on the claim (D133, D135).
export {
  settleOwnerNotificationAttempt,
  terminalizeOwnerNotificationWithoutDelivery,
  type OwnerNotificationSettlement,
  type SettleOwnerNotificationAttemptInput,
  type SettleOwnerNotificationAttemptResult,
  type TerminalizeWithoutDeliveryInput,
} from './transactions/a8-5b-notification-transactions.js';
// `recordTerminalOccurrenceOutcomeUnsafe` is deliberately absent (A8.3a audit F8). It can write a
// `success` without counting it, without evaluating the D106 ceiling, and without settling an
// advance disposition. `finalizeReminderOccurrence` below is the only public success path, and
// `packages/db/__tests__/a8-4a-worker-safety-boundary.test.ts` fails if the raw writer reappears in
// this barrel or in the runtime entry.
export {
  claimReminderOccurrence,
  recordSkippedReminderOccurrence,
  listReminderDeliveryAttemptsForTask,
  listReminderDeliveryAttemptsForGeneration,
  listRecentAmbiguitySequenceOutcomes,
  countSuccessfulOverdueDeliveriesForGeneration,
  hasTerminalAdvanceOccurrence,
  listExpiredOccurrenceClaims,
  listRetryBudgetExhaustedOccurrences,
  listUnsettledTerminalOccurrences,
  markProviderCallStarted,
  RETRY_BUDGET_EXHAUSTED_FAILURE_CODE,
  type ClaimReminderOccurrenceInput,
  type ClaimReminderOccurrenceResult,
  type ClaimRefusalReason,
  type ExhaustedRetryOccurrence,
  type ExpiredOccurrenceClaim,
  type RecoveryScheduleContext,
  type RecordTerminalOutcomeInput,
  type RecordSkippedOccurrenceInput,
  type TerminalReminderDeliveryOutcome,
  type UnsettledTerminalOccurrence,
} from './repositories/reminder-delivery-attempt-repository.js';
// A8.4a occurrence lifecycle: the safe success path, the two settlement phases, and the recovery
// primitives that discharge whatever the seam between them left behind (A8.4a audit B1, B2, H1).
export {
  finalizeReminderOccurrence,
  finalizeAbandonedInFlightOccurrence,
  releaseReminderOccurrenceClaim,
  settleReminderOccurrenceSchedule,
  terminalizeExhaustedRetryOccurrence,
  type FinalizeReminderOccurrenceInput,
  type FinalizeReminderOccurrenceResult,
  type NextOverdueOccurrenceInput,
  type ReminderScheduleSettlementResult,
  type SettleReminderOccurrenceScheduleInput,
} from './transactions/a8-4a-occurrence-transactions.js';

export {
  getCommunicationAccountByOrganization,
  getCommunicationAccountById,
  createOrUpdatePendingCommunicationAccount,
  persistConnectedCommunicationAccount,
  markCommunicationAccountNeedsReauth,
  markCommunicationAccountResyncRequired,
  disconnectCommunicationAccount,
  acquireGmailSyncLock,
  releaseGmailSyncLock,
  listEligibleGmailAccountsForPoll,
  type EligibleGmailAccountForPoll,
} from './repositories/communication-account-repository.js';
export {
  persistEncryptedGmailCredential,
  getGmailOAuthCredentialByAccountId,
  requireGmailOAuthCredentialByAccountId,
} from './repositories/gmail-credential-repository.js';
export {
  createGmailOAuthState,
  consumeGmailOAuthState,
  inspectGmailOAuthState,
  deleteFinishedGmailOAuthStates,
  type GmailOAuthStateRecord,
} from './repositories/gmail-oauth-state-repository.js';
export {
  getCommunicationEventById,
  getCommunicationEventByProviderMessageId,
  upsertCommunicationEvent,
  upsertTemporaryCommunicationExcerpt,
  purgeTemporaryCommunicationExcerpt,
  getTemporaryCommunicationExcerptByEventId,
  updateExcerptPurgeAtIfPresent,
} from './repositories/communication-event-repository.js';
export {
  createGmailSyncRun,
  finishGmailSyncRun,
  getGmailSyncRunById,
  listGmailSyncRuns,
  listRecentGmailSyncRuns,
  type ListGmailSyncRunsQuery,
  type ListGmailSyncRunsResult,
} from './repositories/gmail-sync-run-repository.js';
export {
  createInterpretationRun,
  findInterpretationRunByIdempotencyKey,
  lookupInterpretationRunIdempotency,
  resolveInterpretationRunIdempotency,
  type CreateInterpretationRunInput,
  type InterpretationRunIdempotencyLookup,
  type InterpretationRunOutcomeValue,
} from './repositories/interpretation-run-repository.js';

export {
  persistReturnToOwner,
  persistCapabilityAction,
  persistOwnerTaskMutation,
  persistWorkRequest,
} from './transactions/a4-transactions.js';
export {
  persistSuggestionFromClaimedEvent,
  persistSkippedIrrelevantOutcome,
  persistFailedRetryableOutcome,
  persistFailedPermanentOutcome,
  persistClaimResolvedForExistingSuggestion,
  persistClaimReleasedWithoutOutcome,
} from './transactions/a6-transactions.js';
export {
  persistApproveTaskSuggestion,
  persistEditTaskSuggestion,
  persistDismissTaskSuggestion,
  persistMergeTaskSuggestion,
} from './transactions/a6-owner-suggestion-transactions.js';
export {
  persistGmailHistoryPageTransaction,
  persistGmailConnectionTransaction,
  persistGmailDisconnectTransaction,
  persistGmailChannelUnavailableTransaction,
  type PersistGmailHistoryPageResult,
  type PersistGmailConnectionResult,
  type PersistGmailDisconnectResult,
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

export {
  persistEstablishedReminderSchedule,
  persistDueDateRemoval,
  persistCanonicalDueLocalDate,
  getTaskDueLocalDate,
  readCoherentReminderProjection,
  readReminderPreSendSnapshot,
  type EstablishReminderScheduleInput,
  type CoherentReminderProjection,
  type EstablishReminderScheduleResult,
  type ReminderCapabilityState,
  type ReminderDeliveryTarget,
  type ReminderPreSendSnapshot,
} from './transactions/a8-reminder-transactions.js';

// A8.3b Owner-facing reminder units of work: the A8.3a primitives plus an audit event in the same
// transaction. Still storage only — no worker, scheduler, cron, or delivery path.
export {
  persistOwnerReminderEstablishment,
  persistOwnerReminderGenerationChange,
  persistOwnerReminderDueDateRemoval,
  type OwnerReminderMutationResult,
  type OwnerReminderRemovalOutcome,
  type OwnerReminderRemovalResult,
  type OwnerReminderSaveOutcome,
  type OwnerReminderSaveResult,
  type SkippedAdvanceAttemptInput,
} from './transactions/a8b-owner-reminder-transactions.js';

// A8 lifecycle wiring: reminder schedule state reconciled inside the Task status transaction (D107).
// Reconciles and clears claimable state only — no scan, claim, or delivery path.
export {
  buildReminderLifecycleAudit,
  reconcileReminderScheduleForTaskStatus,
  REMINDER_LIFECYCLE_AUDIT_ACTIONS,
  type ReconcileReminderScheduleInput,
  type ReminderLifecycleEffect,
  type ReminderLifecycleTransition,
} from './transactions/a8-lifecycle-reminder-effects.js';
