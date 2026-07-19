import type { PersistenceErrorCode } from '@aicaa/db';
import type { DomainErrorCode } from '@aicaa/domain';
import type { CapabilityTokenErrorCode } from '@/lib/capability/errors';
import type { RecipientCapabilityServiceErrorCode } from '@/lib/capability/recipient-errors';
import type { RecipientManagementErrorCode } from '@/lib/recipients/errors';
import type { TaskServiceErrorCode } from '@/lib/tasks/errors';
import { AuthConfigError } from '@/lib/auth/errors';
import { CapabilityTokenError } from '@/lib/capability/errors';
import { RecipientCapabilityServiceError } from '@/lib/capability/recipient-errors';
import { RecipientManagementError } from '@/lib/recipients/errors';
import { TaskServiceError } from '@/lib/tasks/errors';
import { DomainError } from '@aicaa/domain';

export const PERSISTENCE_ERROR_NAME = 'PersistenceError';

export const PERSISTENCE_ERROR_CODES = new Set<PersistenceErrorCode>([
  'NOT_FOUND',
  'ORGANIZATION_MISMATCH',
  'OPTIMISTIC_CONCURRENCY',
  'UNIQUE_VIOLATION',
  'VALIDATION',
  'TRANSACTION_FAILED',
  'DOMAIN_CONFLICT',
  'RECIPIENT_HANDOFF_NOT_AVAILABLE',
  // A7.3: the in-transaction admin-issuance gate surfaces HANDOFF_IN_PROGRESS, which
  // issue.ts normalizes to the existing public ISSUANCE_CONFLICT code.
  'HANDOFF_IN_PROGRESS',
]);

const DOMAIN_ERROR_NAME = 'DomainError';
const TASK_SERVICE_ERROR_NAME = 'TaskServiceError';
const CAPABILITY_TOKEN_ERROR_NAME = 'CapabilityTokenError';
const RECIPIENT_CAPABILITY_SERVICE_ERROR_NAME = 'RecipientCapabilityServiceError';
const RECIPIENT_MANAGEMENT_ERROR_NAME = 'RecipientManagementError';
const AUTH_CONFIG_ERROR_NAME = 'AuthConfigError';

const RECIPIENT_MANAGEMENT_ERROR_CODES = new Set<RecipientManagementErrorCode>([
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'DOMAIN_CONFLICT',
  'FORBIDDEN',
]);

const TASK_SERVICE_ERROR_CODES = new Set<TaskServiceErrorCode>([
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'INVALID_STATE_TRANSITION',
  'PRECONDITION_REQUIRED',
  'PRECONDITION_FAILED',
  'DOMAIN_CONFLICT',
  'FORBIDDEN',
  'ASSIGNMENT_PRECONDITION',
  'PERSISTENCE_CONFLICT',
  'RECIPIENT_HANDOFF_NOT_AVAILABLE',
]);

/** Read a property without throwing on proxies, getters, or non-objects. */
export function safeReadProperty(value: unknown, key: string): unknown {
  try {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value !== 'object' && typeof value !== 'function') {
      return undefined;
    }
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

export function safeReadString(value: unknown, key: string): string | undefined {
  const candidate = safeReadProperty(value, key);
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

export function safeInstanceof(value: unknown, constructor: unknown): boolean {
  if (typeof constructor !== 'function') {
    return false;
  }
  try {
    return value instanceof constructor;
  } catch {
    return false;
  }
}

function hasErrorName(value: unknown, expectedName: string): boolean {
  return safeReadString(value, 'name') === expectedName;
}

function hasKnownCode<T extends string>(
  value: unknown,
  knownCodes: ReadonlySet<T>,
): value is { code: T } {
  const code = safeReadString(value, 'code');
  return typeof code === 'string' && knownCodes.has(code as T);
}

export function isPersistenceErrorShape(error: unknown): boolean {
  return (
    hasErrorName(error, PERSISTENCE_ERROR_NAME) && hasKnownCode(error, PERSISTENCE_ERROR_CODES)
  );
}

export function readPersistenceErrorCode(error: unknown): PersistenceErrorCode | undefined {
  if (!isPersistenceErrorShape(error)) {
    return undefined;
  }
  return safeReadString(error, 'code') as PersistenceErrorCode;
}

export function isTaskServiceErrorShape(error: unknown): boolean {
  return (
    hasErrorName(error, TASK_SERVICE_ERROR_NAME) && hasKnownCode(error, TASK_SERVICE_ERROR_CODES)
  );
}

export function isTaskServiceError(error: unknown): boolean {
  return safeInstanceof(error, TaskServiceError) || isTaskServiceErrorShape(error);
}

export function readTaskServiceErrorCode(error: unknown): TaskServiceErrorCode | undefined {
  if (!isTaskServiceError(error)) {
    return undefined;
  }
  return safeReadString(error, 'code') as TaskServiceErrorCode | undefined;
}

export function readTaskServiceErrorMessage(error: unknown): string {
  return safeReadString(error, 'message') ?? 'An unexpected error occurred.';
}

export function readTaskServiceErrorDetails(
  error: unknown,
): ReadonlyArray<{ field: string; message: string }> | undefined {
  const details = safeReadProperty(error, 'details');
  if (!Array.isArray(details)) {
    return undefined;
  }
  return details as ReadonlyArray<{ field: string; message: string }>;
}

export function isCapabilityTokenError(error: unknown): boolean {
  return (
    safeInstanceof(error, CapabilityTokenError) || hasErrorName(error, CAPABILITY_TOKEN_ERROR_NAME)
  );
}

export function readCapabilityTokenErrorCode(error: unknown): CapabilityTokenErrorCode | undefined {
  if (!isCapabilityTokenError(error)) {
    return undefined;
  }
  return safeReadString(error, 'code') as CapabilityTokenErrorCode | undefined;
}

export function isAuthConfigError(error: unknown): boolean {
  return safeInstanceof(error, AuthConfigError) || hasErrorName(error, AUTH_CONFIG_ERROR_NAME);
}

export function isRecipientCapabilityServiceError(error: unknown): boolean {
  return (
    safeInstanceof(error, RecipientCapabilityServiceError) ||
    hasErrorName(error, RECIPIENT_CAPABILITY_SERVICE_ERROR_NAME)
  );
}

export function readRecipientCapabilityServiceErrorCode(
  error: unknown,
): RecipientCapabilityServiceErrorCode | undefined {
  if (!isRecipientCapabilityServiceError(error)) {
    return undefined;
  }
  return safeReadString(error, 'code') as RecipientCapabilityServiceErrorCode | undefined;
}

export function readRecipientCapabilityServiceErrorMessage(error: unknown): string {
  return safeReadString(error, 'message') ?? 'An unexpected error occurred.';
}

export function readRecipientCapabilityServiceErrorDetails(
  error: unknown,
): ReadonlyArray<{ field: string; message: string }> | undefined {
  const details = safeReadProperty(error, 'details');
  if (!Array.isArray(details)) {
    return undefined;
  }
  return details as ReadonlyArray<{ field: string; message: string }>;
}

export function isRecipientManagementError(error: unknown): boolean {
  return (
    safeInstanceof(error, RecipientManagementError) ||
    (hasErrorName(error, RECIPIENT_MANAGEMENT_ERROR_NAME) &&
      hasKnownCode(error, RECIPIENT_MANAGEMENT_ERROR_CODES))
  );
}

export function readRecipientManagementErrorCode(
  error: unknown,
): RecipientManagementErrorCode | undefined {
  if (!isRecipientManagementError(error)) {
    return undefined;
  }
  return safeReadString(error, 'code') as RecipientManagementErrorCode | undefined;
}

export function readRecipientManagementErrorMessage(error: unknown): string {
  return safeReadString(error, 'message') ?? 'An unexpected error occurred.';
}

export function readRecipientManagementErrorDetails(
  error: unknown,
): ReadonlyArray<{ field: string; message: string }> | undefined {
  const details = safeReadProperty(error, 'details');
  if (!Array.isArray(details)) {
    return undefined;
  }
  return details as ReadonlyArray<{ field: string; message: string }>;
}

export function isDomainError(error: unknown): boolean {
  return safeInstanceof(error, DomainError) || hasErrorName(error, DOMAIN_ERROR_NAME);
}

export function readDomainErrorCode(error: unknown): DomainErrorCode | undefined {
  if (!isDomainError(error)) {
    return undefined;
  }
  return safeReadString(error, 'code') as DomainErrorCode | undefined;
}

export function readDomainErrorMessage(error: unknown): string {
  return safeReadString(error, 'message') ?? 'An unexpected error occurred.';
}

export function readDomainErrorDetails(
  error: unknown,
): ReadonlyArray<{ field: string; message: string }> | undefined {
  const details = safeReadProperty(error, 'details');
  if (!Array.isArray(details)) {
    return undefined;
  }
  return details as ReadonlyArray<{ field: string; message: string }>;
}
