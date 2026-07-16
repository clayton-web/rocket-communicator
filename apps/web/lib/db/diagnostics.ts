import { AuthConfigError } from '@/lib/auth/errors';
import { CapabilityTokenError } from '@/lib/capability/errors';
import { TaskServiceError } from '@/lib/tasks/errors';

export const DATABASE_RUNTIME_FAILURE_EVENT = 'database_runtime_failure' as const;

export type DatabaseRuntimeFailureCategory =
  | 'DATABASE_URL_MISSING'
  | 'DATABASE_URL_INVALID_FORMAT'
  | 'PRISMA_CLIENT_INITIALIZATION'
  | 'PRISMA_ENGINE_OR_CLIENT_LOAD'
  | 'DATABASE_AUTHENTICATION_FAILED'
  | 'DATABASE_UNREACHABLE'
  | 'DATABASE_TLS_OR_DNS'
  | 'DATABASE_QUERY_FAILED'
  | 'UNKNOWN_DATABASE_ERROR';

export interface DatabaseRuntimeFailureLogPayload {
  event: typeof DATABASE_RUNTIME_FAILURE_EVENT;
  category: DatabaseRuntimeFailureCategory;
  prismaErrorClass?: string;
  prismaErrorCode?: string;
  nodeErrorCode?: string;
  clientVersion?: string;
  routePathname?: string;
  deploymentRuntime?: string;
  databaseUrlPresent: boolean;
  requestId?: string;
  timestamp: string;
}

export interface DatabaseRuntimeFailureContext {
  routePathname?: string;
  requestId?: string;
}

const DATABASE_URL_REQUIRED_MESSAGE = 'DATABASE_URL is required to create the Prisma client.';

const PRISMA_INITIALIZATION_ERROR_NAME = 'PrismaClientInitializationError';
const PRISMA_KNOWN_REQUEST_ERROR_NAME = 'PrismaClientKnownRequestError';
const PRISMA_UNKNOWN_REQUEST_ERROR_NAME = 'PrismaClientUnknownRequestError';
const PRISMA_RUST_PANIC_ERROR_NAME = 'PrismaClientRustPanicError';
const PRISMA_VALIDATION_ERROR_NAME = 'PrismaClientValidationError';
const PERSISTENCE_ERROR_NAME = 'PersistenceError';

const PERSISTENCE_DATABASE_LOG_CODES = new Set(['TRANSACTION_FAILED', 'UNIQUE_VIOLATION']);

const MAX_CAUSE_DEPTH = 12;

export const ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV = 'ENABLE_DB_RUNTIME_DIAGNOSTICS' as const;

export function isDatabaseRuntimeDiagnosticsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] === 'true';
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isDatabaseUrlPresent(): boolean {
  return isNonEmptyString(process.env.DATABASE_URL);
}

function isPostgresDatabaseUrlFormat(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    return parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:';
  } catch {
    return false;
  }
}

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

function safeReadString(value: unknown, key: string): string | undefined {
  const candidate = safeReadProperty(value, key);
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function safeInstanceof(value: unknown, constructor: unknown): boolean {
  if (typeof constructor !== 'function') {
    return false;
  }
  try {
    return value instanceof constructor;
  } catch {
    return false;
  }
}

function errorName(value: unknown): string | undefined {
  return safeReadString(value, 'name');
}

function isDatabaseUrlConfigurationError(error: unknown): boolean {
  return (
    safeInstanceof(error, Error) &&
    safeReadString(error, 'message') === DATABASE_URL_REQUIRED_MESSAGE &&
    errorName(error) === 'Error'
  );
}

function isPrismaInitializationError(error: unknown): boolean {
  return errorName(error) === PRISMA_INITIALIZATION_ERROR_NAME;
}

function isPrismaKnownRequestError(error: unknown): boolean {
  return errorName(error) === PRISMA_KNOWN_REQUEST_ERROR_NAME;
}

function isPrismaUnknownRequestError(error: unknown): boolean {
  return errorName(error) === PRISMA_UNKNOWN_REQUEST_ERROR_NAME;
}

function isPrismaRustPanicError(error: unknown): boolean {
  return errorName(error) === PRISMA_RUST_PANIC_ERROR_NAME;
}

function isPrismaValidationError(error: unknown): boolean {
  return errorName(error) === PRISMA_VALIDATION_ERROR_NAME;
}

function isPrismaClientError(error: unknown): boolean {
  return (
    isPrismaInitializationError(error) ||
    isPrismaKnownRequestError(error) ||
    isPrismaUnknownRequestError(error) ||
    isPrismaRustPanicError(error) ||
    isPrismaValidationError(error)
  );
}

function isPersistenceError(error: unknown): boolean {
  if (errorName(error) !== PERSISTENCE_ERROR_NAME) {
    return false;
  }
  const code = safeReadString(error, 'code');
  return typeof code === 'string';
}

function persistenceErrorCode(error: unknown): string | undefined {
  if (!isPersistenceError(error)) {
    return undefined;
  }
  return safeReadString(error, 'code');
}

function nodeErrorCodeFromCause(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  let depth = 0;

  while (current !== null && current !== undefined && depth < MAX_CAUSE_DEPTH) {
    if (typeof current === 'object' || typeof current === 'function') {
      if (seen.has(current)) {
        break;
      }
      seen.add(current);
    }

    const code = safeReadString(current, 'code');
    if (code) {
      return code;
    }

    current = safeReadProperty(current, 'cause');
    depth += 1;
  }

  return undefined;
}

function classifyPrismaKnownRequestCode(code: string): DatabaseRuntimeFailureCategory {
  switch (code) {
    case 'P1000':
    case 'P1010':
      return 'DATABASE_AUTHENTICATION_FAILED';
    case 'P1001':
    case 'P1002':
    case 'P1003':
    case 'P1017':
      return 'DATABASE_UNREACHABLE';
    case 'P1011':
      return 'DATABASE_TLS_OR_DNS';
    default:
      return 'DATABASE_QUERY_FAILED';
  }
}

function classifyNodeErrorCode(code: string): DatabaseRuntimeFailureCategory {
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
    case 'ETIMEDOUT':
    case 'ECONNREFUSED':
    case 'ECONNRESET':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        ? 'DATABASE_TLS_OR_DNS'
        : 'DATABASE_UNREACHABLE';
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'CERT_HAS_EXPIRED':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return 'DATABASE_TLS_OR_DNS';
    default:
      return 'UNKNOWN_DATABASE_ERROR';
  }
}

function classifyPrismaInitializationError(error: unknown): DatabaseRuntimeFailureCategory {
  const code = safeReadString(error, 'errorCode');
  if (code === 'P1000' || code === 'P1010') {
    return 'DATABASE_AUTHENTICATION_FAILED';
  }
  if (code === 'P1001' || code === 'P1002' || code === 'P1003' || code === 'P1017') {
    return 'DATABASE_UNREACHABLE';
  }
  if (code === 'P1011') {
    return 'DATABASE_TLS_OR_DNS';
  }
  if (code?.startsWith('P1')) {
    return 'PRISMA_CLIENT_INITIALIZATION';
  }
  return 'PRISMA_ENGINE_OR_CLIENT_LOAD';
}

/**
 * Classify unexpected database failures using error types/codes only — never messages.
 * Never throws for any input value.
 */
export function classifyDatabaseRuntimeFailure(error: unknown): DatabaseRuntimeFailureCategory {
  try {
    if (!isDatabaseUrlPresent()) {
      return 'DATABASE_URL_MISSING';
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (isNonEmptyString(databaseUrl) && !isPostgresDatabaseUrlFormat(databaseUrl)) {
      return 'DATABASE_URL_INVALID_FORMAT';
    }

    if (isDatabaseUrlConfigurationError(error)) {
      return 'DATABASE_URL_MISSING';
    }

    if (isPrismaInitializationError(error)) {
      return classifyPrismaInitializationError(error);
    }

    if (isPrismaKnownRequestError(error)) {
      const code = safeReadString(error, 'code');
      if (code) {
        return classifyPrismaKnownRequestCode(code);
      }
      return 'DATABASE_QUERY_FAILED';
    }

    if (isPrismaUnknownRequestError(error) || isPrismaRustPanicError(error)) {
      return 'DATABASE_QUERY_FAILED';
    }

    if (isPrismaValidationError(error)) {
      return 'DATABASE_QUERY_FAILED';
    }

    const persistenceCode = persistenceErrorCode(error);
    if (persistenceCode && PERSISTENCE_DATABASE_LOG_CODES.has(persistenceCode)) {
      return 'DATABASE_QUERY_FAILED';
    }

    const nodeErrorCode = nodeErrorCodeFromCause(error);
    if (nodeErrorCode) {
      const nodeCategory = classifyNodeErrorCode(nodeErrorCode);
      if (nodeCategory !== 'UNKNOWN_DATABASE_ERROR') {
        return nodeCategory;
      }
    }

    const name = errorName(error);
    if (name?.includes('Prisma')) {
      return 'PRISMA_CLIENT_INITIALIZATION';
    }

    return 'UNKNOWN_DATABASE_ERROR';
  } catch {
    return 'UNKNOWN_DATABASE_ERROR';
  }
}

/**
 * True when an Owner task route error should emit structured database runtime diagnostics.
 * Never throws for any input value.
 */
export function shouldLogDatabaseRuntimeFailure(error: unknown): boolean {
  try {
    if (safeInstanceof(error, TaskServiceError)) {
      return false;
    }
    if (safeInstanceof(error, CapabilityTokenError)) {
      return false;
    }
    if (safeInstanceof(error, AuthConfigError)) {
      return false;
    }

    const persistenceCode = persistenceErrorCode(error);
    if (persistenceCode && PERSISTENCE_DATABASE_LOG_CODES.has(persistenceCode)) {
      return true;
    }

    if (!isDatabaseUrlPresent()) {
      return true;
    }
    if (isDatabaseUrlConfigurationError(error)) {
      return true;
    }
    if (isPrismaClientError(error)) {
      return true;
    }

    const nodeErrorCode = nodeErrorCodeFromCause(error);
    if (nodeErrorCode) {
      return classifyNodeErrorCode(nodeErrorCode) !== 'UNKNOWN_DATABASE_ERROR';
    }

    return false;
  } catch {
    return false;
  }
}

function prismaErrorClassName(error: unknown): string | undefined {
  return errorName(error);
}

function prismaErrorCode(error: unknown): string | undefined {
  if (isPrismaKnownRequestError(error)) {
    return safeReadString(error, 'code');
  }
  if (isPrismaInitializationError(error)) {
    return safeReadString(error, 'errorCode');
  }
  return undefined;
}

function clientVersion(error: unknown): string | undefined {
  return safeReadString(error, 'clientVersion');
}

function deploymentRuntimeMarker(): string | undefined {
  if (process.env.VERCEL === '1') {
    return 'vercel';
  }
  if (process.env.NODE_ENV) {
    return process.env.NODE_ENV;
  }
  return undefined;
}

export function buildDatabaseRuntimeFailureLogPayload(
  error: unknown,
  context: DatabaseRuntimeFailureContext = {},
): DatabaseRuntimeFailureLogPayload {
  try {
    return {
      event: DATABASE_RUNTIME_FAILURE_EVENT,
      category: classifyDatabaseRuntimeFailure(error),
      prismaErrorClass: prismaErrorClassName(error),
      prismaErrorCode: prismaErrorCode(error),
      nodeErrorCode: nodeErrorCodeFromCause(error),
      clientVersion: clientVersion(error),
      routePathname: context.routePathname,
      deploymentRuntime: deploymentRuntimeMarker(),
      databaseUrlPresent: isDatabaseUrlPresent(),
      requestId: context.requestId,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return {
      event: DATABASE_RUNTIME_FAILURE_EVENT,
      category: 'UNKNOWN_DATABASE_ERROR',
      databaseUrlPresent: isDatabaseUrlPresent(),
      timestamp: new Date().toISOString(),
    };
  }
}

/** Serialize diagnostics for tests and runtime logging without unsafe fields. */
export function serializeDatabaseRuntimeFailureLogPayload(
  payload: DatabaseRuntimeFailureLogPayload,
): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({
      event: DATABASE_RUNTIME_FAILURE_EVENT,
      category: 'UNKNOWN_DATABASE_ERROR',
      databaseUrlPresent: isDatabaseUrlPresent(),
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Emit structured, server-side-only diagnostics. Never logs messages, stacks, or secrets.
 * Never throws; returns undefined when diagnostics cannot be produced.
 */
export function logDatabaseRuntimeFailure(
  error: unknown,
  context: DatabaseRuntimeFailureContext = {},
): DatabaseRuntimeFailureLogPayload | undefined {
  try {
    if (!isDatabaseRuntimeDiagnosticsEnabled()) {
      return undefined;
    }
    if (!shouldLogDatabaseRuntimeFailure(error)) {
      return undefined;
    }

    let payload: DatabaseRuntimeFailureLogPayload;
    try {
      payload = buildDatabaseRuntimeFailureLogPayload(error, context);
    } catch {
      return undefined;
    }

    try {
      const serialized = serializeDatabaseRuntimeFailureLogPayload(payload);
      console.error(serialized);
    } catch {
      return undefined;
    }

    return payload;
  } catch {
    return undefined;
  }
}
