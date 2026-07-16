import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';
import { isDatabaseRuntimeDiagnosticsEnabled } from '@/lib/db/diagnostics';
import {
  adjacentMissing,
  presentMissing,
  type PrismaEngineArchitecture,
  type PrismaEngineElfClass,
  type PrismaEngineIdentityClass,
  type PrismaExpectedEngineTarget,
  type PrismaLayoutFailureClass,
} from '@/lib/db/prisma-layout-diagnostics';
import { getDbStageContext } from '@/lib/db/stage-context';
import type { DbRuntimeStage, DbRuntimeStageFailureCategory } from '@/lib/db/stage-diagnostics';

type ErrorResponse = components['schemas']['ErrorResponse'];

export const DB_STAGE_HEADER = 'X-AICAA-DB-Stage' as const;
export const DB_CATEGORY_HEADER = 'X-AICAA-DB-Category' as const;
export const DB_ERROR_CLASS_HEADER = 'X-AICAA-DB-Error-Class' as const;
export const DB_PRISMA_CODE_HEADER = 'X-AICAA-DB-Prisma-Code' as const;
export const DB_NODE_CODE_HEADER = 'X-AICAA-DB-Node-Code' as const;

export const DB_PRISMA_CLIENT_INDEX_HEADER = 'X-AICAA-DB-Prisma-Client-Index' as const;
export const DB_PRISMA_SCHEMA_HEADER = 'X-AICAA-DB-Prisma-Schema' as const;
export const DB_PRISMA_ENGINE_HEADER = 'X-AICAA-DB-Prisma-Engine' as const;
export const DB_PRISMA_LIBRARY_HEADER = 'X-AICAA-DB-Prisma-Library' as const;
export const DB_PRISMA_PACKAGE_HEADER = 'X-AICAA-DB-Prisma-Package' as const;
export const DB_PRISMA_TARGET_HEADER = 'X-AICAA-DB-Prisma-Target' as const;
export const DB_PRISMA_FAILURE_HEADER = 'X-AICAA-DB-Prisma-Failure' as const;
export const DB_PRISMA_ENGINE_BYTES_HEADER = 'X-AICAA-DB-Prisma-Engine-Bytes' as const;
export const DB_PRISMA_ENGINE_SHA256_HEADER = 'X-AICAA-DB-Prisma-Engine-SHA256' as const;
export const DB_PRISMA_ENGINE_READABLE_HEADER = 'X-AICAA-DB-Prisma-Engine-Readable' as const;
export const DB_PRISMA_ENGINE_EXECUTABLE_HEADER = 'X-AICAA-DB-Prisma-Engine-Executable' as const;
export const DB_PRISMA_ENGINE_ELF_HEADER = 'X-AICAA-DB-Prisma-Engine-ELF' as const;
export const DB_PRISMA_ENGINE_ARCH_HEADER = 'X-AICAA-DB-Prisma-Engine-Arch' as const;
export const DB_PRISMA_ENGINE_IDENTITY_HEADER = 'X-AICAA-DB-Prisma-Engine-Identity' as const;

const ALLOWED_STAGES = new Set<DbRuntimeStage>([
  'DB_RUNTIME_LOAD_START',
  'DB_RUNTIME_MODULE_LOADED',
  'DB_RUNTIME_EXPORTS_VALIDATED',
  'PRISMA_CLIENT_CONSTRUCTION_START',
  'PRISMA_CLIENT_CONSTRUCTED',
  'PRISMA_QUERY_START',
  'PRISMA_QUERY_SUCCEEDED',
  'DB_RUNTIME_FAILURE',
]);

const ALLOWED_CATEGORIES = new Set<DbRuntimeStageFailureCategory>([
  'DB_MODULE_NOT_FOUND',
  'DB_MODULE_LOAD_FAILED',
  'DB_EXPORTS_MISSING',
  'DATABASE_URL_MISSING',
  'DATABASE_URL_INVALID_FORMAT',
  'PRISMA_CLIENT_INITIALIZATION',
  'PRISMA_ENGINE_OR_CLIENT_LOAD',
  'DATABASE_AUTHENTICATION_FAILED',
  'DATABASE_UNREACHABLE',
  'DATABASE_TLS_OR_DNS',
  'DATABASE_QUERY_FAILED',
  'UNKNOWN_DATABASE_ERROR',
]);

const ALLOWED_ENGINE_TARGETS = new Set<PrismaExpectedEngineTarget>([
  'RHEL_OPENSSL_3',
  'OTHER',
  'UNKNOWN',
]);

const ALLOWED_LAYOUT_FAILURES = new Set<PrismaLayoutFailureClass>([
  'ENGINE_NOT_FOUND',
  'ENGINE_LOAD_FAILED',
  'ENGINE_DLOPEN_FAILED',
  'OPENSSL_LIBRARY_MISSING',
  'GLIBC_INCOMPATIBLE',
  'ELF_ARCHITECTURE_MISMATCH',
  'NATIVE_MODULE_REGISTRATION_FAILED',
  'ENGINE_PERMISSION_DENIED',
  'ENGINE_FILE_TRUNCATED',
  'ENGINE_CHECKSUM_MISMATCH',
  'QUERY_ENGINE_PANIC',
  'SCHEMA_NOT_FOUND',
  'GENERATED_CLIENT_RUNTIME_MISSING',
  'WRONG_CLIENT_DIRECTORY',
  'BINARY_TARGET_MISMATCH',
  'DATASOURCE_CONFIGURATION',
  'OTHER',
  'UNKNOWN',
]);

const ALLOWED_ENGINE_ELF_CLASSES = new Set<PrismaEngineElfClass>(['ELF64', 'OTHER', 'UNKNOWN']);
const ALLOWED_ENGINE_ARCHITECTURES = new Set<PrismaEngineArchitecture>([
  'X86_64',
  'OTHER',
  'UNKNOWN',
]);
const ALLOWED_ENGINE_IDENTITIES = new Set<PrismaEngineIdentityClass>([
  'MATCHES_CI_ENGINE',
  'SIZE_MISMATCH',
  'HASH_MISMATCH',
  'UNREADABLE',
  'INVALID_ELF',
  'WRONG_ARCHITECTURE',
  'UNKNOWN',
]);

const SAFE_ERROR_NAME = /^[A-Z][A-Za-z0-9]*Error$/;
const SAFE_PRISMA_CODE = /^P\d{4}$/;
const SAFE_NODE_CODE = /^[A-Z][A-Z0-9_]+$/;
const SAFE_ENGINE_BYTES = /^\d{1,10}$/;
const SAFE_ENGINE_SHA256 = /^[a-f0-9]{64}$/;
const MAX_ENGINE_BYTES_HEADER = 99_999_999;

const FORBIDDEN_HEADER_SUBSTRINGS = [
  'postgresql',
  'postgres',
  '://',
  '@',
  'password',
  'token',
  'pepper',
  'packages/',
  'node_modules',
  'DATABASE_URL',
  'findMany',
  'select ',
  '\n',
  ' at ',
];

export function isOwnerTaskDiagnosticRoute(pathname: string | undefined): boolean {
  if (!pathname) {
    return false;
  }
  if (pathname === '/api/v1/session') {
    return false;
  }
  if (pathname.startsWith('/api/v1/capabilities/')) {
    return false;
  }
  if (pathname.startsWith('/c/')) {
    return false;
  }
  return pathname === '/api/v1/tasks' || pathname.startsWith('/api/v1/tasks/');
}

function isSafeHeaderValue(value: string): boolean {
  if (!value || value.length > 128) {
    return false;
  }
  const lower = value.toLowerCase();
  for (const forbidden of FORBIDDEN_HEADER_SUBSTRINGS) {
    if (lower.includes(forbidden.toLowerCase())) {
      return false;
    }
  }
  return true;
}

function sanitizeStage(stage: string | undefined): DbRuntimeStage | undefined {
  if (!stage || !ALLOWED_STAGES.has(stage as DbRuntimeStage)) {
    return undefined;
  }
  return stage as DbRuntimeStage;
}

function sanitizeCategory(category: string | undefined): DbRuntimeStageFailureCategory | undefined {
  if (!category || !ALLOWED_CATEGORIES.has(category as DbRuntimeStageFailureCategory)) {
    return undefined;
  }
  return category as DbRuntimeStageFailureCategory;
}

function sanitizeErrorName(name: string | undefined): string | undefined {
  if (!name || !SAFE_ERROR_NAME.test(name) || !isSafeHeaderValue(name)) {
    return undefined;
  }
  return name;
}

function sanitizePrismaCode(code: string | undefined): string | undefined {
  if (!code || !SAFE_PRISMA_CODE.test(code) || !isSafeHeaderValue(code)) {
    return undefined;
  }
  return code;
}

function sanitizeNodeCode(code: string | undefined): string | undefined {
  if (!code || !SAFE_NODE_CODE.test(code) || !isSafeHeaderValue(code)) {
    return undefined;
  }
  return code;
}

function sanitizeEngineTarget(target: string | undefined): PrismaExpectedEngineTarget | undefined {
  if (!target || !ALLOWED_ENGINE_TARGETS.has(target as PrismaExpectedEngineTarget)) {
    return undefined;
  }
  return target as PrismaExpectedEngineTarget;
}

function sanitizeLayoutFailure(failure: string | undefined): PrismaLayoutFailureClass | undefined {
  if (!failure || !ALLOWED_LAYOUT_FAILURES.has(failure as PrismaLayoutFailureClass)) {
    return undefined;
  }
  return failure as PrismaLayoutFailureClass;
}

function sanitizeEngineBytes(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_ENGINE_BYTES_HEADER) {
    return undefined;
  }
  const digits = String(value);
  if (!SAFE_ENGINE_BYTES.test(digits) || !isSafeHeaderValue(digits)) {
    return undefined;
  }
  return digits;
}

function sanitizeEngineSha256(value: string | undefined): string | undefined {
  if (!value || !SAFE_ENGINE_SHA256.test(value) || !isSafeHeaderValue(value)) {
    return undefined;
  }
  return value;
}

function sanitizeTrueFalse(value: boolean | undefined): 'true' | 'false' | undefined {
  if (typeof value !== 'boolean') {
    return undefined;
  }
  return value ? 'true' : 'false';
}

function sanitizeEngineElfClass(value: string | undefined): PrismaEngineElfClass | undefined {
  if (!value || !ALLOWED_ENGINE_ELF_CLASSES.has(value as PrismaEngineElfClass)) {
    return undefined;
  }
  return value as PrismaEngineElfClass;
}

function sanitizeEngineArchitecture(
  value: string | undefined,
): PrismaEngineArchitecture | undefined {
  if (!value || !ALLOWED_ENGINE_ARCHITECTURES.has(value as PrismaEngineArchitecture)) {
    return undefined;
  }
  return value as PrismaEngineArchitecture;
}

function sanitizeEngineIdentity(value: string | undefined): PrismaEngineIdentityClass | undefined {
  if (!value || !ALLOWED_ENGINE_IDENTITIES.has(value as PrismaEngineIdentityClass)) {
    return undefined;
  }
  return value as PrismaEngineIdentityClass;
}

export function buildOwnerTaskDbDiagnosticHeaders(): HeadersInit | undefined {
  if (!isDatabaseRuntimeDiagnosticsEnabled()) {
    return undefined;
  }

  const context = getDbStageContext();
  if (!context || !isOwnerTaskDiagnosticRoute(context.routePathname)) {
    return undefined;
  }

  const stage = sanitizeStage(context.lastStage);
  if (!stage) {
    return undefined;
  }

  const headers: Record<string, string> = {
    [DB_STAGE_HEADER]: stage,
  };

  const category = sanitizeCategory(context.failureCategory);
  if (category) {
    headers[DB_CATEGORY_HEADER] = category;
  }

  const errorName = sanitizeErrorName(context.errorName);
  if (errorName) {
    headers[DB_ERROR_CLASS_HEADER] = errorName;
  }

  const prismaCode = sanitizePrismaCode(context.prismaErrorCode);
  if (prismaCode) {
    headers[DB_PRISMA_CODE_HEADER] = prismaCode;
  }

  const nodeCode = sanitizeNodeCode(context.nodeErrorCode);
  if (nodeCode) {
    headers[DB_NODE_CODE_HEADER] = nodeCode;
  }

  if (typeof context.prismaFailureClass === 'string') {
    if (typeof context.prismaClientIndexPresent === 'boolean') {
      headers[DB_PRISMA_CLIENT_INDEX_HEADER] = presentMissing(context.prismaClientIndexPresent);
    }
    if (typeof context.prismaSchemaAdjacent === 'boolean') {
      headers[DB_PRISMA_SCHEMA_HEADER] = adjacentMissing(context.prismaSchemaAdjacent);
    }
    if (typeof context.prismaEngineAdjacent === 'boolean') {
      headers[DB_PRISMA_ENGINE_HEADER] = adjacentMissing(context.prismaEngineAdjacent);
    }
    if (typeof context.prismaRuntimeLibraryPresent === 'boolean') {
      headers[DB_PRISMA_LIBRARY_HEADER] = presentMissing(context.prismaRuntimeLibraryPresent);
    }
    if (typeof context.prismaGeneratedPackagePresent === 'boolean') {
      headers[DB_PRISMA_PACKAGE_HEADER] = presentMissing(context.prismaGeneratedPackagePresent);
    }

    const target = sanitizeEngineTarget(context.prismaExpectedEngineTarget);
    if (target) {
      headers[DB_PRISMA_TARGET_HEADER] = target;
    }

    const failure = sanitizeLayoutFailure(context.prismaFailureClass);
    if (failure) {
      headers[DB_PRISMA_FAILURE_HEADER] = failure;
    }

    const engineBytes = sanitizeEngineBytes(context.prismaEngineByteLength);
    if (engineBytes) {
      headers[DB_PRISMA_ENGINE_BYTES_HEADER] = engineBytes;
    }

    const engineSha256 = sanitizeEngineSha256(context.prismaEngineSha256);
    if (engineSha256) {
      headers[DB_PRISMA_ENGINE_SHA256_HEADER] = engineSha256;
    }

    const engineReadable = sanitizeTrueFalse(context.prismaEngineReadable);
    if (engineReadable) {
      headers[DB_PRISMA_ENGINE_READABLE_HEADER] = engineReadable;
    }

    const engineExecutable = sanitizeTrueFalse(context.prismaEngineExecutable);
    if (engineExecutable) {
      headers[DB_PRISMA_ENGINE_EXECUTABLE_HEADER] = engineExecutable;
    }

    const engineElf = sanitizeEngineElfClass(context.prismaEngineElfClass);
    if (engineElf) {
      headers[DB_PRISMA_ENGINE_ELF_HEADER] = engineElf;
    }

    const engineArch = sanitizeEngineArchitecture(context.prismaEngineArchitecture);
    if (engineArch) {
      headers[DB_PRISMA_ENGINE_ARCH_HEADER] = engineArch;
    }

    const engineIdentity = sanitizeEngineIdentity(context.prismaEngineIdentity);
    if (engineIdentity) {
      headers[DB_PRISMA_ENGINE_IDENTITY_HEADER] = engineIdentity;
    }
  }

  return headers;
}

export function attachOwnerTaskDbDiagnosticHeaders<T extends NextResponse<ErrorResponse>>(
  response: T,
): T {
  if (response.status !== 500) {
    return response;
  }

  const headers = buildOwnerTaskDbDiagnosticHeaders();
  if (!headers) {
    return response;
  }

  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  return response;
}
