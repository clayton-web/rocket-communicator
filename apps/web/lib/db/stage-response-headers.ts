import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';
import { isDatabaseRuntimeDiagnosticsEnabled } from '@/lib/db/diagnostics';
import { getDbStageContext } from '@/lib/db/stage-context';
import type { DbRuntimeStage, DbRuntimeStageFailureCategory } from '@/lib/db/stage-diagnostics';

type ErrorResponse = components['schemas']['ErrorResponse'];

export const DB_STAGE_HEADER = 'X-AICAA-DB-Stage' as const;
export const DB_CATEGORY_HEADER = 'X-AICAA-DB-Category' as const;
export const DB_ERROR_CLASS_HEADER = 'X-AICAA-DB-Error-Class' as const;
export const DB_PRISMA_CODE_HEADER = 'X-AICAA-DB-Prisma-Code' as const;
export const DB_NODE_CODE_HEADER = 'X-AICAA-DB-Node-Code' as const;

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

const SAFE_ERROR_NAME = /^[A-Z][A-Za-z0-9]*Error$/;
const SAFE_PRISMA_CODE = /^P\d{4}$/;
const SAFE_NODE_CODE = /^[A-Z][A-Z0-9_]+$/;

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

function sanitizeCategory(
  category: string | undefined,
): DbRuntimeStageFailureCategory | undefined {
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
