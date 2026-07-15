import 'server-only';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Production DB runtime bridge.
 *
 * Resolved at runtime via createRequire into traced packages/db/dist output.
 * Production Lambda code must not resolve the workspace package name at runtime.
 */
const TRACED_RUNTIME_RELATIVE = path.join('packages', 'db', 'dist', 'runtime.js');

export function resolveTracedRuntimePath(moduleUrl: string): string {
  let dir = path.dirname(fileURLToPath(moduleUrl));
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

  throw new Error(`Traced DB runtime not found at ${TRACED_RUNTIME_RELATIVE}`);
}

type TracedRuntimeModule = typeof import('../../../../packages/db/dist/runtime.js');

function loadTracedRuntimeModule(): TracedRuntimeModule {
  const runtimePath = resolveTracedRuntimePath(import.meta.url);
  const require = createRequire(runtimePath);
  return require(runtimePath) as TracedRuntimeModule;
}

const runtimeModule = loadTracedRuntimeModule();

export const createPrismaClient = runtimeModule.createPrismaClient;
export const getTaskById = runtimeModule.getTaskById;
export const listTasks = runtimeModule.listTasks;
export const createTask = runtimeModule.createTask;
export const getRecipientById = runtimeModule.getRecipientById;
export const createAuditEvent = runtimeModule.createAuditEvent;
export const persistOwnerTaskMutation = runtimeModule.persistOwnerTaskMutation;
export const persistReturnToOwner = runtimeModule.persistReturnToOwner;
export const findCapabilityByTokenHash = runtimeModule.findCapabilityByTokenHash;
export const createCapability = runtimeModule.createCapability;
export const findActiveCapabilitiesForAssignment = runtimeModule.findActiveCapabilitiesForAssignment;
export const revokeCapabilityRecord = runtimeModule.revokeCapabilityRecord;
export const updateActiveAssignmentCapabilityBinding =
  runtimeModule.updateActiveAssignmentCapabilityBinding;
export const updateTaskWithExpectedVersion = runtimeModule.updateTaskWithExpectedVersion;
export const getCapabilityById = runtimeModule.getCapabilityById;
export const markCapabilityExpiredRecord = runtimeModule.markCapabilityExpiredRecord;
export const persistCapabilityAction = runtimeModule.persistCapabilityAction;
export const persistWorkRequest = runtimeModule.persistWorkRequest;
