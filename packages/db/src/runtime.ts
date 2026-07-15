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
} from './errors/persistence-errors.js';

export {
  mapRecipient,
  mapTask,
  mapSuggestion,
  mapCapability,
  mapAuditEvent,
  mapNote,
  mapAssignment,
  type AuditEventRecord,
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
} from './repositories/suggestion-repository.js';
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
  persistReturnToOwner,
  persistCapabilityAction,
  persistOwnerTaskMutation,
  persistWorkRequest,
} from './transactions/a4-transactions.js';
