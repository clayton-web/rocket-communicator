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
  createAuditEvent: typeof TracedRuntimeBindings.createAuditEvent;
  persistOwnerTaskMutation: typeof TracedRuntimeBindings.persistOwnerTaskMutation;
  persistReturnToOwner: typeof TracedRuntimeBindings.persistReturnToOwner;
  findCapabilityByTokenHash: typeof TracedRuntimeBindings.findCapabilityByTokenHash;
  createCapability: typeof TracedRuntimeBindings.createCapability;
  findActiveCapabilitiesForAssignment: typeof TracedRuntimeBindings.findActiveCapabilitiesForAssignment;
  revokeCapabilityRecord: typeof TracedRuntimeBindings.revokeCapabilityRecord;
  updateActiveAssignmentCapabilityBinding: typeof TracedRuntimeBindings.updateActiveAssignmentCapabilityBinding;
  updateTaskWithExpectedVersion: typeof TracedRuntimeBindings.updateTaskWithExpectedVersion;
  getCapabilityById: typeof TracedRuntimeBindings.getCapabilityById;
  markCapabilityExpiredRecord: typeof TracedRuntimeBindings.markCapabilityExpiredRecord;
  persistCapabilityAction: typeof TracedRuntimeBindings.persistCapabilityAction;
  persistWorkRequest: typeof TracedRuntimeBindings.persistWorkRequest;
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
    createAuditEvent: tracedRuntime.createAuditEvent,
    persistOwnerTaskMutation: tracedRuntime.persistOwnerTaskMutation,
    persistReturnToOwner: tracedRuntime.persistReturnToOwner,
    findCapabilityByTokenHash: tracedRuntime.findCapabilityByTokenHash,
    createCapability: tracedRuntime.createCapability,
    findActiveCapabilitiesForAssignment: tracedRuntime.findActiveCapabilitiesForAssignment,
    revokeCapabilityRecord: tracedRuntime.revokeCapabilityRecord,
    updateActiveAssignmentCapabilityBinding: tracedRuntime.updateActiveAssignmentCapabilityBinding,
    updateTaskWithExpectedVersion: tracedRuntime.updateTaskWithExpectedVersion,
    getCapabilityById: tracedRuntime.getCapabilityById,
    markCapabilityExpiredRecord: tracedRuntime.markCapabilityExpiredRecord,
    persistCapabilityAction: tracedRuntime.persistCapabilityAction,
    persistWorkRequest: tracedRuntime.persistWorkRequest,
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
