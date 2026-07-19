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
  updateRecipient,
  deactivateRecipient,
  requireActiveRecipientForHandoff,
} from './repositories/recipient-repository.js';
export {
  getTaskById,
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
  activateCapabilityRecord,
  isPersistedCapabilityActionable,
  type PersistedCapability,
} from './repositories/capability-repository.js';
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
} from './repositories/communication-event-repository.js';
export { getTaskSuggestionBySourceEventId } from './repositories/suggestion-repository.js';

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
  type PersistGmailConnectionResult,
  type PersistGmailDisconnectResult,
  type PersistGmailHistoryPageResult,
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
