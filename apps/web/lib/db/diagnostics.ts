import { Prisma, PersistenceError } from '@aicaa/db';
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

export const ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV = 'ENABLE_DB_RUNTIME_DIAGNOSTICS' as const;

export function isDatabaseRuntimeDiagnosticsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
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

function isPrismaClientError(error: unknown): error is { name: string } {
  return (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientValidationError
  );
}

function isDatabaseUrlConfigurationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === DATABASE_URL_REQUIRED_MESSAGE &&
    error.name === 'Error'
  );
}

function nodeErrorCodeFromCause(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === 'string' && record.code.length > 0) {
      return record.code;
    }
    current = record.cause;
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

function classifyPrismaInitializationError(
  error: Prisma.PrismaClientInitializationError,
): DatabaseRuntimeFailureCategory {
  const code = error.errorCode;
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
 */
export function classifyDatabaseRuntimeFailure(error: unknown): DatabaseRuntimeFailureCategory {
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

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return classifyPrismaInitializationError(error);
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return classifyPrismaKnownRequestCode(error.code);
  }

  if (
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return 'DATABASE_QUERY_FAILED';
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return 'DATABASE_QUERY_FAILED';
  }

  if (error instanceof PersistenceError) {
    if (error.code === 'TRANSACTION_FAILED' || error.code === 'UNIQUE_VIOLATION') {
      return 'DATABASE_QUERY_FAILED';
    }
  }

  const nodeErrorCode = nodeErrorCodeFromCause(error);
  if (nodeErrorCode) {
    const nodeCategory = classifyNodeErrorCode(nodeErrorCode);
    if (nodeCategory !== 'UNKNOWN_DATABASE_ERROR') {
      return nodeCategory;
    }
  }

  if (error instanceof Error && error.name.includes('Prisma')) {
    return 'PRISMA_CLIENT_INITIALIZATION';
  }

  return 'UNKNOWN_DATABASE_ERROR';
}

/**
 * True when an Owner task route error should emit structured database runtime diagnostics.
 */
export function shouldLogDatabaseRuntimeFailure(error: unknown): boolean {
  if (error instanceof TaskServiceError) {
    return false;
  }
  if (error instanceof CapabilityTokenError) {
    return false;
  }
  if (error instanceof AuthConfigError) {
    return false;
  }
  if (error instanceof PersistenceError) {
    return error.code === 'TRANSACTION_FAILED' || error.code === 'UNIQUE_VIOLATION';
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
}

function prismaErrorClassName(error: unknown): string | undefined {
  if (error instanceof Error && error.name) {
    return error.name;
  }
  return undefined;
}

function prismaErrorCode(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }
  if (error instanceof Prisma.PrismaClientInitializationError && error.errorCode) {
    return error.errorCode;
  }
  return undefined;
}

function clientVersion(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientInitializationError && error.clientVersion) {
    return error.clientVersion;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.clientVersion) {
    return error.clientVersion;
  }
  return undefined;
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
}

/** Serialize diagnostics for tests and runtime logging without unsafe fields. */
export function serializeDatabaseRuntimeFailureLogPayload(
  payload: DatabaseRuntimeFailureLogPayload,
): string {
  return JSON.stringify(payload);
}

/**
 * Emit structured, server-side-only diagnostics. Never logs messages, stacks, or secrets.
 */
export function logDatabaseRuntimeFailure(
  error: unknown,
  context: DatabaseRuntimeFailureContext = {},
): DatabaseRuntimeFailureLogPayload | undefined {
  if (!isDatabaseRuntimeDiagnosticsEnabled()) {
    return undefined;
  }
  if (!shouldLogDatabaseRuntimeFailure(error)) {
    return undefined;
  }

  const payload = buildDatabaseRuntimeFailureLogPayload(error, context);
  console.error(serializeDatabaseRuntimeFailureLogPayload(payload));
  return payload;
}
