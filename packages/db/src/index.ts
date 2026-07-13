export {
  createPrismaClient,
  PrismaClient,
  Prisma,
  type DbClient,
  type DbTransaction,
} from './client/create-prisma-client.js';
// createTestDatabase is test-only (PGlite); import from relative path in Vitest suites.

export {
  PersistenceError,
  type PersistenceErrorCode,
  notFound,
  organizationMismatch,
  optimisticConcurrency,
  uniqueViolation,
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
  createTask,
  updateTaskWithExpectedVersion,
  appendTaskNote,
  createActiveAssignment,
  clearAssignment,
  listTaskAssignments,
} from './repositories/task-repository.js';
export {
  createTaskSuggestion,
  getTaskSuggestionById,
} from './repositories/suggestion-repository.js';
export {
  createCapability,
  getCapabilityById,
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
  persistWorkRequest,
} from './transactions/a4-transactions.js';
