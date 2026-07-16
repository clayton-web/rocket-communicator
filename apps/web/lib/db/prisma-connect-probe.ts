/**
 * Temporary allowlisted Prisma `$connect()` probe classification.
 * Uses structured codes only — never inspects raw messages.
 */
import { safeReadProperty } from '@/lib/db/diagnostics';

export type PrismaConnectProbeResult =
  | 'SUCCESS'
  | 'REACHED_NETWORK_P1001'
  | 'DATABASE_AUTH_P1000'
  | 'DATABASE_TLS_P1011'
  | 'DATASOURCE_P1012'
  | 'DATASOURCE_P1013'
  | 'OTHER_CODED_INIT'
  | 'NO_CODE_INIT'
  | 'NODE_CODE_ONLY'
  | 'NON_PRISMA_ERROR'
  | 'NOT_RUN'
  | 'UNKNOWN';

const SAFE_PRISMA_CODE = /^P\d{4}$/;
const SAFE_NODE_CODE = /^[A-Z][A-Z0-9_]+$/;
const MAX_CAUSE_DEPTH = 12;

function safeReadString(value: unknown, key: string): string | undefined {
  const candidate = safeReadProperty(value, key);
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
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
    if (code && SAFE_NODE_CODE.test(code) && !SAFE_PRISMA_CODE.test(code)) {
      return code;
    }

    current = safeReadProperty(current, 'cause');
    depth += 1;
  }

  return undefined;
}

function prismaInitErrorCode(error: unknown): string | undefined {
  const name = safeReadString(error, 'name');
  if (name === 'PrismaClientInitializationError') {
    const code = safeReadString(error, 'errorCode');
    if (code && SAFE_PRISMA_CODE.test(code)) {
      return code;
    }
  }
  return undefined;
}

/**
 * Classify a `$connect()` probe outcome using structured codes only.
 * Never reads or returns raw messages.
 */
export function classifyPrismaConnectProbeResult(error: unknown): PrismaConnectProbeResult {
  try {
    const prismaCode = prismaInitErrorCode(error);
    if (prismaCode === 'P1001') {
      return 'REACHED_NETWORK_P1001';
    }
    if (prismaCode === 'P1000') {
      return 'DATABASE_AUTH_P1000';
    }
    if (prismaCode === 'P1011') {
      return 'DATABASE_TLS_P1011';
    }
    if (prismaCode === 'P1012') {
      return 'DATASOURCE_P1012';
    }
    if (prismaCode === 'P1013') {
      return 'DATASOURCE_P1013';
    }
    if (prismaCode) {
      return 'OTHER_CODED_INIT';
    }

    const name = safeReadString(error, 'name');
    const nodeCode = nodeErrorCodeFromCause(error);

    if (name === 'PrismaClientInitializationError') {
      if (nodeCode) {
        return 'NODE_CODE_ONLY';
      }
      return 'NO_CODE_INIT';
    }

    if (nodeCode) {
      return 'NODE_CODE_ONLY';
    }

    if (name?.includes('Prisma')) {
      return 'UNKNOWN';
    }

    return 'NON_PRISMA_ERROR';
  } catch {
    return 'UNKNOWN';
  }
}
