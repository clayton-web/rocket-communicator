import { randomBytes } from 'node:crypto';
import {
  formatETag,
  type CapabilityAction,
  type CapabilityActor,
  type DomainError,
  type UtcInstant,
} from '@aicaa/domain';
import type { CreateAuditEventInput, DbClient, PersistenceErrorCode } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { CapabilityTokenError, type CapabilityTokenErrorCode } from './errors';
import {
  isCapabilityTokenError,
  isDomainError,
  isRecipientCapabilityServiceError,
  readCapabilityTokenErrorCode,
  readDomainErrorCode,
  readDomainErrorDetails,
  readDomainErrorMessage,
  readPersistenceErrorCode,
} from '@/lib/errors/safe-error-shapes';
import { persistCapabilityExpiryIfNeeded } from './lifecycle';
import { hashCapabilityToken } from './token';
import { assertValidCapabilityPepper } from './config';
import { validateCapabilityToken, type ValidatedCapabilityContext } from './validate';
import {
  recipientCapabilityServiceError,
  RecipientCapabilityServiceError,
  type RecipientCapabilityServiceErrorCode,
} from './recipient-errors';

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
    throw recipientCapabilityServiceError(
      'VALIDATION_ERROR',
      'expectedVersion must be a positive integer.',
      [{ field: 'expectedVersion', message: 'Invalid concurrency version.' }],
    );
  }
  return formatETag('task', taskId, expectedVersion);
}

export function requireExpectedVersion(expectedVersion: number | undefined): number {
  if (expectedVersion === undefined) {
    throw recipientCapabilityServiceError(
      'PRECONDITION_REQUIRED',
      'expectedVersion is required for Recipient capability mutations.',
    );
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw recipientCapabilityServiceError(
      'VALIDATION_ERROR',
      'expectedVersion must be a positive integer.',
      [{ field: 'expectedVersion', message: 'Invalid concurrency version.' }],
    );
  }
  return expectedVersion;
}

/**
 * Map internal capability / domain / persistence errors to RecipientCapabilityServiceError.
 * Collapses unknown/expired/revoked/malformed tokens to UNAUTHORIZED with a non-distinguishing message.
 */
export function mapRecipientServiceError(error: unknown): never {
  if (isRecipientCapabilityServiceError(error)) {
    throw error;
  }
  if (isCapabilityTokenError(error)) {
    const code = readCapabilityTokenErrorCode(error);
    if (code) {
      throw recipientCapabilityServiceError(
        mapCapabilityTokenCode(code),
        sanitizeCapabilityMessage(code),
      );
    }
  }
  if (isDomainError(error)) {
    const code = readDomainErrorCode(error);
    if (code) {
      throw recipientCapabilityServiceError(
        mapDomainCode(code),
        readDomainErrorMessage(error),
        readDomainErrorDetails(error),
      );
    }
  }
  const persistenceCode = readPersistenceErrorCode(error);
  if (persistenceCode) {
    throw recipientCapabilityServiceError(
      mapPersistenceCode(persistenceCode),
      sanitizePersistenceMessage(persistenceCode),
    );
  }
  throw error;
}

function mapCapabilityTokenCode(
  code: CapabilityTokenErrorCode,
): RecipientCapabilityServiceErrorCode {
  switch (code) {
    case 'INVALID_CAPABILITY':
    case 'CAPABILITY_EXPIRED':
    case 'CAPABILITY_REVOKED':
    case 'MISSING_CONFIGURATION':
    case 'INVALID_TTL_CONFIGURATION':
      return 'UNAUTHORIZED';
    case 'INSUFFICIENT_SCOPE':
      return 'FORBIDDEN';
    case 'WRONG_RESOURCE':
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'TERMINAL_TASK':
    case 'ISSUANCE_CONFLICT':
    case 'ISSUANCE_PRECONDITION':
      return 'DOMAIN_CONFLICT';
    case 'PRECONDITION_FAILED':
      return 'PRECONDITION_FAILED';
    default:
      return 'UNAUTHORIZED';
  }
}

function sanitizeCapabilityMessage(code: CapabilityTokenErrorCode): string {
  switch (code) {
    case 'INSUFFICIENT_SCOPE':
      return 'Capability token does not authorize this action.';
    case 'WRONG_RESOURCE':
    case 'NOT_FOUND':
      return 'Resource not found.';
    case 'TERMINAL_TASK':
      return 'Task cannot be modified in its current state.';
    case 'PRECONDITION_FAILED':
      return 'The resource has changed since the provided version.';
    case 'INVALID_CAPABILITY':
    case 'CAPABILITY_EXPIRED':
    case 'CAPABILITY_REVOKED':
    default:
      // Intentionally non-distinguishing (public Recipient error policy).
      return 'Capability token is invalid.';
  }
}

function mapDomainCode(code: DomainError['code']): RecipientCapabilityServiceErrorCode {
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

function mapPersistenceCode(code: PersistenceErrorCode): RecipientCapabilityServiceErrorCode {
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

function sanitizePersistenceMessage(code: PersistenceErrorCode): string {
  switch (code) {
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

/**
 * Validate capability for a Recipient service call.
 * On mutation + wall-clock expiry, best-effort persists expired status before mapping UNAUTHORIZED.
 */
export async function validateRecipientCapability(input: {
  db: DbClient;
  rawToken: string;
  pepper: string;
  now: UtcInstant;
  taskId: string;
  action: CapabilityAction;
  mode: 'get' | 'mutation';
}): Promise<ValidatedCapabilityContext> {
  try {
    return await validateCapabilityToken({
      db: input.db,
      rawToken: input.rawToken.trim(),
      pepper: input.pepper,
      now: input.now,
      taskId: input.taskId,
      action: input.action,
      mode: input.mode,
    });
  } catch (error) {
    if (
      input.mode === 'mutation' &&
      error instanceof CapabilityTokenError &&
      error.code === 'CAPABILITY_EXPIRED'
    ) {
      await persistExpiredStatusBestEffort(input);
    }
    mapRecipientServiceError(error);
  }
}

async function persistExpiredStatusBestEffort(input: {
  db: DbClient;
  rawToken: string;
  pepper: string;
  now: UtcInstant;
}): Promise<void> {
  try {
    const pepper = assertValidCapabilityPepper(input.pepper, 'pepper');
    const tokenHash = hashCapabilityToken(input.rawToken.trim(), pepper);
    const { findCapabilityByTokenHash } = loadDbRuntime();
    const found = await findCapabilityByTokenHash(input.db, tokenHash);
    if (!found || found.status === 'revoked' || found.status === 'expired') {
      return;
    }
    await persistCapabilityExpiryIfNeeded({
      db: input.db,
      organizationId: found.organizationId,
      capabilityId: found.id,
      now: input.now,
    });
  } catch {
    // Non-fatal: public error remains UNAUTHORIZED.
  }
}

export function buildCapabilityAudit(input: {
  id: string;
  actor: CapabilityActor;
  organizationId: string;
  action: string;
  taskId: string;
  now: UtcInstant;
  resourceVersion?: number;
  taskStatus?: string;
  assignmentId?: string;
  suggestionId?: string;
  requestId?: string;
  correlationId?: string | null;
  note?: string;
}): CreateAuditEventInput {
  return {
    id: input.id,
    organizationId: input.organizationId,
    actorKind: 'capability',
    capabilityId: input.actor.capabilityId,
    assignmentId: input.assignmentId ?? input.actor.assignmentId,
    taskId: input.taskId,
    suggestionId: input.suggestionId,
    intendedRecipientEmail: input.actor.intendedRecipientEmail,
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
