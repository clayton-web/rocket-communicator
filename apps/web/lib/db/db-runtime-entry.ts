import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as TracedRuntimeBindings from './db-runtime-reexports';

/**
 * Production DB runtime bridge.
 *
 * Uses a literal relative specifier so Turbopack can trace and retain the
 * external packages/db runtime at build time. Production Lambda code must not
 * resolve the workspace package name at runtime.
 *
 * Runtime loading resolves the traced packages/db/dist/runtime.js path at
 * runtime and imports it through a non-static import hook so Turbopack cannot
 * elide or stub the traced ESM module bindings.
 */
const TRACED_RUNTIME_RELATIVE = path.join('packages', 'db', 'dist', 'runtime.js');

type TracedRuntimeImport = (
  specifier: string,
) => Promise<typeof import('../../../../packages/db/dist/runtime.js')>;

const importExternalModule = new Function(
  'specifier',
  'return import(specifier)',
) as TracedRuntimeImport;

function walkUpForTracedRuntime(startDir: string): string | undefined {
  let dir = startDir;
  for (let depth = 0; depth < 24; depth += 1) {
    const candidate = path.join(dir, TRACED_RUNTIME_RELATIVE);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

export function resolveTracedRuntimePath(): string {
  const cwdCandidate = path.join(process.cwd(), TRACED_RUNTIME_RELATIVE);
  if (fs.existsSync(cwdCandidate)) {
    return cwdCandidate;
  }

  const fromCwdWalk = walkUpForTracedRuntime(process.cwd());
  if (fromCwdWalk) {
    return fromCwdWalk;
  }

  throw new Error(`Traced DB runtime not found at ${TRACED_RUNTIME_RELATIVE}`);
}

export type TracedRuntimeModule = {
  createPrismaClient: typeof TracedRuntimeBindings.createPrismaClient;
  getTaskById: typeof TracedRuntimeBindings.getTaskById;
  listTasks: typeof TracedRuntimeBindings.listTasks;
  createTask: typeof TracedRuntimeBindings.createTask;
  getRecipientById: typeof TracedRuntimeBindings.getRecipientById;
  createRecipient: typeof TracedRuntimeBindings.createRecipient;
  updateRecipient: typeof TracedRuntimeBindings.updateRecipient;
  deactivateRecipient: typeof TracedRuntimeBindings.deactivateRecipient;
  listActiveRecipientsPage: typeof TracedRuntimeBindings.listActiveRecipientsPage;
  createAuditEvent: typeof TracedRuntimeBindings.createAuditEvent;
  beginInitialHandoff: typeof TracedRuntimeBindings.beginInitialHandoff;
  markHandoffSendAccepted: typeof TracedRuntimeBindings.markHandoffSendAccepted;
  markHandoffDeliveryFailed: typeof TracedRuntimeBindings.markHandoffDeliveryFailed;
  prepareFailedHandoffRetry: typeof TracedRuntimeBindings.prepareFailedHandoffRetry;
  getHandoffAttemptById: typeof TracedRuntimeBindings.getHandoffAttemptById;
  invalidState: typeof TracedRuntimeBindings.invalidState;
  handoffInProgress: typeof TracedRuntimeBindings.handoffInProgress;
  persistOwnerTaskMutation: typeof TracedRuntimeBindings.persistOwnerTaskMutation;
  persistReturnToOwner: typeof TracedRuntimeBindings.persistReturnToOwner;
  findCapabilityByTokenHash: typeof TracedRuntimeBindings.findCapabilityByTokenHash;
  createCapability: typeof TracedRuntimeBindings.createCapability;
  findActiveCapabilitiesForAssignment: typeof TracedRuntimeBindings.findActiveCapabilitiesForAssignment;
  findPendingHandoffAttemptForAssignment: typeof TracedRuntimeBindings.findPendingHandoffAttemptForAssignment;
  findLatestHandoffAttemptForAssignment: typeof TracedRuntimeBindings.findLatestHandoffAttemptForAssignment;
  isUnresolvedHandoffAttemptForAdminIssuance: typeof TracedRuntimeBindings.isUnresolvedHandoffAttemptForAdminIssuance;
  assertAdminIssuanceNotBlockedByHandoff: typeof TracedRuntimeBindings.assertAdminIssuanceNotBlockedByHandoff;
  isPersistedCapabilityActionable: typeof TracedRuntimeBindings.isPersistedCapabilityActionable;
  revokeCapabilityRecord: typeof TracedRuntimeBindings.revokeCapabilityRecord;
  updateActiveAssignmentCapabilityBinding: typeof TracedRuntimeBindings.updateActiveAssignmentCapabilityBinding;
  updateTaskWithExpectedVersion: typeof TracedRuntimeBindings.updateTaskWithExpectedVersion;
  getCapabilityById: typeof TracedRuntimeBindings.getCapabilityById;
  markCapabilityExpiredRecord: typeof TracedRuntimeBindings.markCapabilityExpiredRecord;
  persistCapabilityAction: typeof TracedRuntimeBindings.persistCapabilityAction;
  persistWorkRequest: typeof TracedRuntimeBindings.persistWorkRequest;
  listTaskSuggestions: typeof TracedRuntimeBindings.listTaskSuggestions;
  getTaskSuggestionById: typeof TracedRuntimeBindings.getTaskSuggestionById;
  persistApproveTaskSuggestion: typeof TracedRuntimeBindings.persistApproveTaskSuggestion;
  persistEditTaskSuggestion: typeof TracedRuntimeBindings.persistEditTaskSuggestion;
  persistDismissTaskSuggestion: typeof TracedRuntimeBindings.persistDismissTaskSuggestion;
  persistMergeTaskSuggestion: typeof TracedRuntimeBindings.persistMergeTaskSuggestion;
  claimSuggestionProcessingBatch: typeof TracedRuntimeBindings.claimSuggestionProcessingBatch;
  persistSuggestionFromClaimedEvent: typeof TracedRuntimeBindings.persistSuggestionFromClaimedEvent;
  persistSkippedIrrelevantOutcome: typeof TracedRuntimeBindings.persistSkippedIrrelevantOutcome;
  persistFailedRetryableOutcome: typeof TracedRuntimeBindings.persistFailedRetryableOutcome;
  persistFailedPermanentOutcome: typeof TracedRuntimeBindings.persistFailedPermanentOutcome;
  persistClaimResolvedForExistingSuggestion: typeof TracedRuntimeBindings.persistClaimResolvedForExistingSuggestion;
  persistClaimReleasedWithoutOutcome: typeof TracedRuntimeBindings.persistClaimReleasedWithoutOutcome;
  getCommunicationEventById: typeof TracedRuntimeBindings.getCommunicationEventById;
  getTemporaryCommunicationExcerptByEventId: typeof TracedRuntimeBindings.getTemporaryCommunicationExcerptByEventId;
  getTaskSuggestionBySourceEventId: typeof TracedRuntimeBindings.getTaskSuggestionBySourceEventId;
  getCommunicationAccountByOrganization: typeof TracedRuntimeBindings.getCommunicationAccountByOrganization;
  getCommunicationAccountById: typeof TracedRuntimeBindings.getCommunicationAccountById;
  getGmailOAuthCredentialByAccountId: typeof TracedRuntimeBindings.getGmailOAuthCredentialByAccountId;
  listEligibleGmailAccountsForPoll: typeof TracedRuntimeBindings.listEligibleGmailAccountsForPoll;
  createGmailOAuthState: typeof TracedRuntimeBindings.createGmailOAuthState;
  consumeGmailOAuthState: typeof TracedRuntimeBindings.consumeGmailOAuthState;
  inspectGmailOAuthState: typeof TracedRuntimeBindings.inspectGmailOAuthState;
  deleteFinishedGmailOAuthStates: typeof TracedRuntimeBindings.deleteFinishedGmailOAuthStates;
  persistGmailConnectionTransaction: typeof TracedRuntimeBindings.persistGmailConnectionTransaction;
  persistGmailDisconnectTransaction: typeof TracedRuntimeBindings.persistGmailDisconnectTransaction;
  acquireGmailSyncLock: typeof TracedRuntimeBindings.acquireGmailSyncLock;
  releaseGmailSyncLock: typeof TracedRuntimeBindings.releaseGmailSyncLock;
  markCommunicationAccountNeedsReauth: typeof TracedRuntimeBindings.markCommunicationAccountNeedsReauth;
  markCommunicationAccountResyncRequired: typeof TracedRuntimeBindings.markCommunicationAccountResyncRequired;
  createGmailSyncRun: typeof TracedRuntimeBindings.createGmailSyncRun;
  finishGmailSyncRun: typeof TracedRuntimeBindings.finishGmailSyncRun;
  listGmailSyncRuns: typeof TracedRuntimeBindings.listGmailSyncRuns;
  persistGmailHistoryPageTransaction: typeof TracedRuntimeBindings.persistGmailHistoryPageTransaction;
};

export async function loadTracedRuntimeModule(): Promise<TracedRuntimeModule> {
  const runtimePath = resolveTracedRuntimePath();
  const tracedRuntime = await importExternalModule(pathToFileURL(runtimePath).href);

  return {
    createPrismaClient: tracedRuntime.createPrismaClient,
    getTaskById: tracedRuntime.getTaskById,
    listTasks: tracedRuntime.listTasks,
    createTask: tracedRuntime.createTask,
    getRecipientById: tracedRuntime.getRecipientById,
    createRecipient: tracedRuntime.createRecipient,
    updateRecipient: tracedRuntime.updateRecipient,
    deactivateRecipient: tracedRuntime.deactivateRecipient,
    listActiveRecipientsPage: tracedRuntime.listActiveRecipientsPage,
    createAuditEvent: tracedRuntime.createAuditEvent,
    beginInitialHandoff: tracedRuntime.beginInitialHandoff,
    markHandoffSendAccepted: tracedRuntime.markHandoffSendAccepted,
    markHandoffDeliveryFailed: tracedRuntime.markHandoffDeliveryFailed,
    prepareFailedHandoffRetry: tracedRuntime.prepareFailedHandoffRetry,
    getHandoffAttemptById: tracedRuntime.getHandoffAttemptById,
    invalidState: tracedRuntime.invalidState,
    handoffInProgress: tracedRuntime.handoffInProgress,
    persistOwnerTaskMutation: tracedRuntime.persistOwnerTaskMutation,
    persistReturnToOwner: tracedRuntime.persistReturnToOwner,
    findCapabilityByTokenHash: tracedRuntime.findCapabilityByTokenHash,
    createCapability: tracedRuntime.createCapability,
    findActiveCapabilitiesForAssignment: tracedRuntime.findActiveCapabilitiesForAssignment,
    findPendingHandoffAttemptForAssignment: tracedRuntime.findPendingHandoffAttemptForAssignment,
    findLatestHandoffAttemptForAssignment: tracedRuntime.findLatestHandoffAttemptForAssignment,
    isUnresolvedHandoffAttemptForAdminIssuance:
      tracedRuntime.isUnresolvedHandoffAttemptForAdminIssuance,
    assertAdminIssuanceNotBlockedByHandoff: tracedRuntime.assertAdminIssuanceNotBlockedByHandoff,
    isPersistedCapabilityActionable: tracedRuntime.isPersistedCapabilityActionable,
    revokeCapabilityRecord: tracedRuntime.revokeCapabilityRecord,
    updateActiveAssignmentCapabilityBinding: tracedRuntime.updateActiveAssignmentCapabilityBinding,
    updateTaskWithExpectedVersion: tracedRuntime.updateTaskWithExpectedVersion,
    getCapabilityById: tracedRuntime.getCapabilityById,
    markCapabilityExpiredRecord: tracedRuntime.markCapabilityExpiredRecord,
    persistCapabilityAction: tracedRuntime.persistCapabilityAction,
    persistWorkRequest: tracedRuntime.persistWorkRequest,
    listTaskSuggestions: tracedRuntime.listTaskSuggestions,
    getTaskSuggestionById: tracedRuntime.getTaskSuggestionById,
    persistApproveTaskSuggestion: tracedRuntime.persistApproveTaskSuggestion,
    persistEditTaskSuggestion: tracedRuntime.persistEditTaskSuggestion,
    persistDismissTaskSuggestion: tracedRuntime.persistDismissTaskSuggestion,
    persistMergeTaskSuggestion: tracedRuntime.persistMergeTaskSuggestion,
    claimSuggestionProcessingBatch: tracedRuntime.claimSuggestionProcessingBatch,
    persistSuggestionFromClaimedEvent: tracedRuntime.persistSuggestionFromClaimedEvent,
    persistSkippedIrrelevantOutcome: tracedRuntime.persistSkippedIrrelevantOutcome,
    persistFailedRetryableOutcome: tracedRuntime.persistFailedRetryableOutcome,
    persistFailedPermanentOutcome: tracedRuntime.persistFailedPermanentOutcome,
    persistClaimResolvedForExistingSuggestion:
      tracedRuntime.persistClaimResolvedForExistingSuggestion,
    persistClaimReleasedWithoutOutcome: tracedRuntime.persistClaimReleasedWithoutOutcome,
    getCommunicationEventById: tracedRuntime.getCommunicationEventById,
    getTemporaryCommunicationExcerptByEventId:
      tracedRuntime.getTemporaryCommunicationExcerptByEventId,
    getTaskSuggestionBySourceEventId: tracedRuntime.getTaskSuggestionBySourceEventId,
    getCommunicationAccountByOrganization: tracedRuntime.getCommunicationAccountByOrganization,
    getCommunicationAccountById: tracedRuntime.getCommunicationAccountById,
    getGmailOAuthCredentialByAccountId: tracedRuntime.getGmailOAuthCredentialByAccountId,
    listEligibleGmailAccountsForPoll: tracedRuntime.listEligibleGmailAccountsForPoll,
    createGmailOAuthState: tracedRuntime.createGmailOAuthState,
    consumeGmailOAuthState: tracedRuntime.consumeGmailOAuthState,
    inspectGmailOAuthState: tracedRuntime.inspectGmailOAuthState,
    deleteFinishedGmailOAuthStates: tracedRuntime.deleteFinishedGmailOAuthStates,
    persistGmailConnectionTransaction: tracedRuntime.persistGmailConnectionTransaction,
    persistGmailDisconnectTransaction: tracedRuntime.persistGmailDisconnectTransaction,
    acquireGmailSyncLock: tracedRuntime.acquireGmailSyncLock,
    releaseGmailSyncLock: tracedRuntime.releaseGmailSyncLock,
    markCommunicationAccountNeedsReauth: tracedRuntime.markCommunicationAccountNeedsReauth,
    markCommunicationAccountResyncRequired: tracedRuntime.markCommunicationAccountResyncRequired,
    createGmailSyncRun: tracedRuntime.createGmailSyncRun,
    finishGmailSyncRun: tracedRuntime.finishGmailSyncRun,
    listGmailSyncRuns: tracedRuntime.listGmailSyncRuns,
    persistGmailHistoryPageTransaction: tracedRuntime.persistGmailHistoryPageTransaction,
  };
}
