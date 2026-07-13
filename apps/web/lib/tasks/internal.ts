import { randomBytes } from 'node:crypto';
import {
  DomainError,
  formatETag,
  ownerActor,
  type OwnerActor,
  type UtcInstant,
} from '@aicaa/domain';
import {
  PersistenceError,
  getTaskById,
  listTasks as listTasksFromDb,
  type CreateAuditEventInput,
  type DbClient,
} from '@aicaa/db';
import { taskServiceError, TaskServiceError, type TaskServiceErrorCode } from './errors';

export function requireOwnerActor(owner: unknown): OwnerActor {
  if (
    !owner ||
    typeof owner !== 'object' ||
    !('kind' in owner) ||
    (owner as { kind: unknown }).kind !== 'owner' ||
    !('ownerId' in owner) ||
    !('organizationId' in owner)
  ) {
    throw taskServiceError('FORBIDDEN', 'Owner task services require an Owner actor.');
  }
  const candidate = owner as OwnerActor;
  return ownerActor(candidate.ownerId, candidate.organizationId);
}

export function newEntityId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

export function ifMatchFromExpectedVersion(
  taskId: string,
  expectedVersion: number | undefined,
): string | undefined {
  if (expectedVersion === undefined) {
    return undefined;
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw taskServiceError('VALIDATION_ERROR', 'expectedVersion must be a positive integer.', [
      { field: 'expectedVersion', message: 'Invalid concurrency version.' },
    ]);
  }
  return formatETag('task', taskId, expectedVersion);
}

export function mapDomainOrPersistenceError(error: unknown): never {
  if (error instanceof TaskServiceError) {
    throw error;
  }
  if (error instanceof DomainError) {
    throw taskServiceError(mapDomainCode(error.code), error.message, error.details);
  }
  if (error instanceof PersistenceError) {
    throw taskServiceError(mapPersistenceCode(error.code), sanitizePersistenceMessage(error));
  }
  throw error;
}

function mapDomainCode(code: DomainError['code']): TaskServiceErrorCode {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 'VALIDATION_ERROR';
    case 'INVALID_STATE_TRANSITION':
      return 'INVALID_STATE_TRANSITION';
    case 'PRECONDITION_REQUIRED':
      return 'PRECONDITION_REQUIRED';
    case 'PRECONDITION_FAILED':
      return 'PRECONDITION_FAILED';
    case 'DOMAIN_CONFLICT':
      return 'DOMAIN_CONFLICT';
    case 'FORBIDDEN':
    case 'UNAUTHORIZED':
      return 'FORBIDDEN';
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    default:
      return 'VALIDATION_ERROR';
  }
}

function mapPersistenceCode(code: PersistenceError['code']): TaskServiceErrorCode {
  switch (code) {
    case 'NOT_FOUND':
    case 'ORGANIZATION_MISMATCH':
      return 'NOT_FOUND';
    case 'OPTIMISTIC_CONCURRENCY':
      return 'PRECONDITION_FAILED';
    case 'UNIQUE_VIOLATION':
      return 'PERSISTENCE_CONFLICT';
    case 'VALIDATION':
      return 'VALIDATION_ERROR';
    default:
      return 'PERSISTENCE_CONFLICT';
  }
}

function sanitizePersistenceMessage(error: PersistenceError): string {
  switch (error.code) {
    case 'NOT_FOUND':
    case 'ORGANIZATION_MISMATCH':
      return 'Resource not found.';
    case 'OPTIMISTIC_CONCURRENCY':
      return 'The resource has changed since the provided version.';
    case 'UNIQUE_VIOLATION':
      return 'A conflicting resource already exists.';
    case 'VALIDATION':
      return 'Request validation failed.';
    default:
      return 'Persistence operation failed.';
  }
}

export async function loadOwnerTask(db: DbClient, owner: OwnerActor, taskId: string) {
  try {
    return await getTaskById(db, owner.organizationId, taskId);
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}

export function buildOwnerAudit(input: {
  id: string;
  owner: OwnerActor;
  action: string;
  taskId: string;
  now: UtcInstant;
  resourceVersion?: number;
  taskStatus?: string;
  assignmentId?: string;
  requestId?: string;
  correlationId?: string | null;
  note?: string;
}): CreateAuditEventInput {
  return {
    id: input.id,
    organizationId: input.owner.organizationId,
    actorKind: 'owner',
    ownerId: input.owner.ownerId,
    taskId: input.taskId,
    assignmentId: input.assignmentId,
    action: input.action,
    outcome: 'succeeded',
    resourceVersion: input.resourceVersion,
    taskStatus: input.taskStatus,
    requestId: input.requestId,
    correlationId: input.correlationId ?? undefined,
    note: input.note,
    recordedAt: input.now,
  };
}

export { listTasksFromDb };
