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
  type AuditEventRecord,
  type GmailOAuthCredentialRecord,
} from './mappers/domain-mappers.js';

export { upsertRecipient, getRecipientById } from './repositories/recipient-repository.js';
export {
  getTaskById,
  listTasks,
  createTask,
  updateTaskWithExpectedVersion,
  appendTaskNote,
  createActiveAssignment,
  updateActiveAssignmentCapabilityBinding,
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
  type PersistedCapability,
} from './repositories/capability-repository.js';
export {
  createAuditEvent,
  listAuditEventsForTask,
  type CreateAuditEventInput,
} from './repositories/audit-repository.js';

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
  persistApproveTaskSuggestion,
  persistEditTaskSuggestion,
  persistDismissTaskSuggestion,
  persistMergeTaskSuggestion,
} from './transactions/a6-transactions.js';
export {
  persistGmailHistoryPageTransaction,
  persistGmailConnectionTransaction,
  persistGmailDisconnectTransaction,
  type PersistGmailHistoryPageResult,
  type PersistGmailConnectionResult,
  type PersistGmailDisconnectResult,
} from './transactions/gmail-transactions.js';
