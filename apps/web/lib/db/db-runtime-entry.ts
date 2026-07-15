import 'server-only';
import {
  createAuditEvent as createAuditEventExport,
  createCapability as createCapabilityExport,
  createPrismaClient as createPrismaClientExport,
  createTask as createTaskExport,
  findActiveCapabilitiesForAssignment as findActiveCapabilitiesForAssignmentExport,
  findCapabilityByTokenHash as findCapabilityByTokenHashExport,
  getCapabilityById as getCapabilityByIdExport,
  getRecipientById as getRecipientByIdExport,
  getTaskById as getTaskByIdExport,
  listTasks as listTasksExport,
  markCapabilityExpiredRecord as markCapabilityExpiredRecordExport,
  persistCapabilityAction as persistCapabilityActionExport,
  persistOwnerTaskMutation as persistOwnerTaskMutationExport,
  persistReturnToOwner as persistReturnToOwnerExport,
  persistWorkRequest as persistWorkRequestExport,
  revokeCapabilityRecord as revokeCapabilityRecordExport,
  updateActiveAssignmentCapabilityBinding as updateActiveAssignmentCapabilityBindingExport,
  updateTaskWithExpectedVersion as updateTaskWithExpectedVersionExport,
} from './db-runtime-reexports';

/**
 * Production DB runtime bridge.
 *
 * Uses a literal relative specifier so Turbopack can trace and retain the
 * external packages/db runtime at build time. Production Lambda code must not
 * resolve the workspace package name at runtime.
 */
export type TracedRuntimeModule = {
  createPrismaClient: typeof createPrismaClientExport;
  getTaskById: typeof getTaskByIdExport;
  listTasks: typeof listTasksExport;
  createTask: typeof createTaskExport;
  getRecipientById: typeof getRecipientByIdExport;
  createAuditEvent: typeof createAuditEventExport;
  persistOwnerTaskMutation: typeof persistOwnerTaskMutationExport;
  persistReturnToOwner: typeof persistReturnToOwnerExport;
  findCapabilityByTokenHash: typeof findCapabilityByTokenHashExport;
  createCapability: typeof createCapabilityExport;
  findActiveCapabilitiesForAssignment: typeof findActiveCapabilitiesForAssignmentExport;
  revokeCapabilityRecord: typeof revokeCapabilityRecordExport;
  updateActiveAssignmentCapabilityBinding: typeof updateActiveAssignmentCapabilityBindingExport;
  updateTaskWithExpectedVersion: typeof updateTaskWithExpectedVersionExport;
  getCapabilityById: typeof getCapabilityByIdExport;
  markCapabilityExpiredRecord: typeof markCapabilityExpiredRecordExport;
  persistCapabilityAction: typeof persistCapabilityActionExport;
  persistWorkRequest: typeof persistWorkRequestExport;
};

export async function loadTracedRuntimeModule(): Promise<TracedRuntimeModule> {
  return {
    createPrismaClient: createPrismaClientExport,
    getTaskById: getTaskByIdExport,
    listTasks: listTasksExport,
    createTask: createTaskExport,
    getRecipientById: getRecipientByIdExport,
    createAuditEvent: createAuditEventExport,
    persistOwnerTaskMutation: persistOwnerTaskMutationExport,
    persistReturnToOwner: persistReturnToOwnerExport,
    findCapabilityByTokenHash: findCapabilityByTokenHashExport,
    createCapability: createCapabilityExport,
    findActiveCapabilitiesForAssignment: findActiveCapabilitiesForAssignmentExport,
    revokeCapabilityRecord: revokeCapabilityRecordExport,
    updateActiveAssignmentCapabilityBinding: updateActiveAssignmentCapabilityBindingExport,
    updateTaskWithExpectedVersion: updateTaskWithExpectedVersionExport,
    getCapabilityById: getCapabilityByIdExport,
    markCapabilityExpiredRecord: markCapabilityExpiredRecordExport,
    persistCapabilityAction: persistCapabilityActionExport,
    persistWorkRequest: persistWorkRequestExport,
  };
}
