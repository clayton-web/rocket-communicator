import 'server-only';
import { loadTracedRuntimeModule } from './db-runtime-entry';

export type DbRuntimeModule = Awaited<ReturnType<typeof loadTracedRuntimeModule>>;

const REQUIRED_EXPORTS = [
  'createPrismaClient',
  'getTaskById',
  'getTaskForCapabilityAuthorization',
  'listTasks',
  'createTask',
  'getRecipientById',
  'createRecipient',
  'updateRecipient',
  'deactivateRecipient',
  'listActiveRecipientsPage',
  'createAuditEvent',
  'persistOwnerTaskMutation',
  'persistReturnToOwner',
  'findReminderScheduleByTaskId',
  'getTaskDueLocalDate',
  'readCoherentReminderProjection',
  // A8.6a Owner attention read, reached from the `/attention` server component.
  'listReminderSchedulesRequiringOwnerAttention',
  // A8.4a worker-safety foundation. Reachable only from the dark internal processing endpoint.
  'claimReminderScheduleForProcessing',
  'releaseReminderScheduleClaim',
  'listDueReminderSchedulesGlobally',
  // A8.4b.3 advance due scan. Same shape, same bound, different predicate and index.
  'listDueAdvanceReminderSchedulesGlobally',
  'claimReminderOccurrence',
  'listExpiredOccurrenceClaims',
  'listRetryBudgetExhaustedOccurrences',
  'listUnsettledTerminalOccurrences',
  'markProviderCallStarted',
  'readReminderPreSendSnapshot',
  'finalizeReminderOccurrence',
  'finalizeAbandonedInFlightOccurrence',
  'releaseReminderOccurrenceClaim',
  'settleReminderOccurrenceSchedule',
  'terminalizeExhaustedRetryOccurrence',
  'persistOwnerReminderEstablishment',
  'persistOwnerReminderGenerationChange',
  'persistOwnerReminderDueDateRemoval',
  // A8.5b Owner notification delivery. Listed for the same reason the reminder worker functions
  // are: the bundle losing one should fail loudly at load rather than at the first claim.
  'listClaimableOwnerNotificationIntents',
  'listExpiredOwnerNotificationClaims',
  'listInFlightOwnerNotificationAttempts',
  'listOwnerNotificationAttempts',
  'findOwnerNotificationIntentById',
  'findOwnerNotificationSubjectTaskId',
  'claimOwnerNotificationIntent',
  'beginOwnerNotificationAttempt',
  'recoverExpiredOwnerNotificationClaim',
  'settleOwnerNotificationAttempt',
  'terminalizeOwnerNotificationWithoutDelivery',
  // A8.6c Owner visibility read, reached from the `/attention` server component.
  'listUndeliveredOwnerNotifications',
  'findCapabilityByTokenHash',
  'createCapability',
  'findActiveCapabilitiesForAssignment',
  'findPendingHandoffAttemptForAssignment',
  'findLatestHandoffAttemptForAssignment',
  'isUnresolvedHandoffAttemptForAdminIssuance',
  'assertAdminIssuanceNotBlockedByHandoff',
  'beginInitialHandoff',
  'markHandoffSendAccepted',
  'markHandoffDeliveryFailed',
  'prepareFailedHandoffRetry',
  'resolveHandoffIdempotency',
  'getHandoffAttemptById',
  'invalidState',
  'handoffInProgress',
  'isPersistedCapabilityActionable',
  // A8.7b-INCIDENT-1j. The suggestion processor classifies persistence failures through this
  // predicate instead of importing the `PersistenceError` class, so the bundle losing it must fail
  // loudly at load rather than by silently misclassifying a `UNIQUE_VIOLATION` as retryable.
  'isPersistenceError',
  'revokeCapabilityRecord',
  'updateActiveAssignmentCapabilityBinding',
  'updateTaskWithExpectedVersion',
  'getCapabilityById',
  'markCapabilityExpiredRecord',
  'listExpirableCapabilities',
  'expireCapabilityIfDue',
  'observeCapabilityExpiry',
  'persistCapabilityAction',
  'persistWorkRequest',
  'listTaskSuggestions',
  'getTaskSuggestionById',
  'persistApproveTaskSuggestion',
  'persistEditTaskSuggestion',
  'persistDismissTaskSuggestion',
  'persistMergeTaskSuggestion',
  'claimSuggestionProcessingBatch',
  'persistSuggestionFromClaimedEvent',
  'persistSkippedIrrelevantOutcome',
  'persistFailedRetryableOutcome',
  'persistFailedPermanentOutcome',
  'persistClaimResolvedForExistingSuggestion',
  'persistClaimReleasedWithoutOutcome',
  // S3.1 shared interpretation persistence (D169). The application service is dark — no route,
  // worker, or cron reaches it — but it resolves these through the bridge like every other
  // persistence caller, so a missing binding must fail at load rather than at first use.
  'persistInterpretationOccurrence',
  'resolveInterpretationOccurrence',
  'getCommunicationEventById',
  'getTemporaryCommunicationExcerptByEventId',
  'getTaskSuggestionBySourceEventId',
  'getCommunicationAccountByOrganization',
  'getCommunicationAccountById',
  'getGmailOAuthCredentialByAccountId',
  'listEligibleGmailAccountsForPoll',
  'createGmailOAuthState',
  'consumeGmailOAuthState',
  'inspectGmailOAuthState',
  'deleteFinishedGmailOAuthStates',
  'persistGmailConnectionTransaction',
  'persistGmailDisconnectTransaction',
  'persistGmailChannelUnavailableTransaction',
  'acquireGmailSyncLock',
  'releaseGmailSyncLock',
  'markCommunicationAccountNeedsReauth',
  'markCommunicationAccountResyncRequired',
  'createGmailSyncRun',
  'finishGmailSyncRun',
  'listGmailSyncRuns',
  'persistGmailHistoryPageTransaction',
] as const satisfies ReadonlyArray<keyof DbRuntimeModule>;

let cachedRuntime: DbRuntimeModule | undefined;
let testRuntimeOverride: DbRuntimeModule | undefined;
let runtimePromise: Promise<DbRuntimeModule> | undefined;

export class DbRuntimeConfigurationError extends Error {
  constructor() {
    super('Database runtime is not configured correctly.');
    this.name = 'DbRuntimeConfigurationError';
  }
}

function assertRuntimeExportPresent(
  runtime: DbRuntimeModule,
  exportName: (typeof REQUIRED_EXPORTS)[number],
): void {
  if (typeof runtime[exportName] === 'undefined') {
    throw new DbRuntimeConfigurationError();
  }
}

function validateRuntimeModule(runtime: unknown): DbRuntimeModule {
  if (runtime === null || typeof runtime !== 'object') {
    throw new DbRuntimeConfigurationError();
  }

  const runtimeModule = runtime as DbRuntimeModule;
  for (const exportName of REQUIRED_EXPORTS) {
    assertRuntimeExportPresent(runtimeModule, exportName);
  }
  return runtimeModule;
}

/** Test-only reset for runtime loader cache. */
export function resetDbRuntimeForTests(): void {
  cachedRuntime = undefined;
  testRuntimeOverride = undefined;
  runtimePromise = undefined;
}

/** Test-only injection for Vitest and other non-serverless runtimes. */
export function setDbRuntimeForTests(runtime: DbRuntimeModule | undefined): void {
  testRuntimeOverride = runtime ? validateRuntimeModule(runtime) : undefined;
  cachedRuntime = testRuntimeOverride;
  runtimePromise = undefined;
}

async function loadAndValidateRuntime(): Promise<DbRuntimeModule> {
  if (testRuntimeOverride) {
    return testRuntimeOverride;
  }

  if (cachedRuntime) {
    return cachedRuntime;
  }

  let loaded: unknown;
  try {
    loaded = await loadTracedRuntimeModule();
  } catch {
    throw new DbRuntimeConfigurationError();
  }

  try {
    cachedRuntime = validateRuntimeModule(loaded);
  } catch (error) {
    throw error;
  }

  return cachedRuntime;
}

/**
 * Load the traced packages/db runtime via the app-local bridge.
 * Must remain the only production code path that resolves DB runtime values.
 */
export async function loadDbRuntime(): Promise<DbRuntimeModule> {
  if (testRuntimeOverride) {
    return testRuntimeOverride;
  }

  if (cachedRuntime) {
    return cachedRuntime;
  }

  if (!runtimePromise) {
    runtimePromise = loadAndValidateRuntime().catch((error) => {
      runtimePromise = undefined;
      throw error;
    });
  }

  return runtimePromise;
}
