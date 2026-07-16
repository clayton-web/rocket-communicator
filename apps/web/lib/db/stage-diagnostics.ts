import {
  classifyDatabaseRuntimeFailure,
  isDatabaseRuntimeDiagnosticsEnabled,
  isDatabaseUrlPresent,
  safeReadProperty,
  type DatabaseRuntimeFailureCategory,
} from '@/lib/db/diagnostics';
import {
  getDbStageContext,
  updateDbStageContext,
  type DbStageContext,
} from '@/lib/db/stage-context';

function safeReadString(value: unknown, key: string): string | undefined {
  const candidate = safeReadProperty(value, key);
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

export const DB_RUNTIME_STAGE_EVENT = 'db_runtime_stage' as const;

export type DbRuntimeStage =
  | 'DB_RUNTIME_LOAD_START'
  | 'DB_RUNTIME_MODULE_LOADED'
  | 'DB_RUNTIME_EXPORTS_VALIDATED'
  | 'PRISMA_CLIENT_CONSTRUCTION_START'
  | 'PRISMA_CLIENT_CONSTRUCTED'
  | 'PRISMA_QUERY_START'
  | 'PRISMA_QUERY_SUCCEEDED'
  | 'DB_RUNTIME_FAILURE';

export type DbRuntimeLoaderFailureCategory =
  'DB_MODULE_NOT_FOUND' | 'DB_MODULE_LOAD_FAILED' | 'DB_EXPORTS_MISSING';

export type DbRuntimeStageFailureCategory =
  DbRuntimeLoaderFailureCategory | DatabaseRuntimeFailureCategory;

export interface DbRuntimeStageLogPayload {
  event: typeof DB_RUNTIME_STAGE_EVENT;
  stage: DbRuntimeStage;
  timestamp: string;
  databaseUrlPresent: boolean;
  routePathname?: string;
  requestId?: string;
  moduleLoaded?: boolean;
  exportsValidated?: boolean;
  queryOperation?: string;
  category?: DbRuntimeStageFailureCategory;
  errorName?: string;
  prismaErrorCode?: string;
  nodeErrorCode?: string;
  clientVersion?: string;
}

const MAX_CAUSE_DEPTH = 12;

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

function prismaErrorCode(error: unknown): string | undefined {
  const name = safeReadString(error, 'name');
  if (name === 'PrismaClientKnownRequestError') {
    return safeReadString(error, 'code');
  }
  if (name === 'PrismaClientInitializationError') {
    return safeReadString(error, 'errorCode');
  }
  return undefined;
}

function clientVersion(error: unknown): string | undefined {
  return safeReadString(error, 'clientVersion');
}

function errorName(error: unknown): string | undefined {
  return safeReadString(error, 'name');
}

function contextFields(): Pick<DbRuntimeStageLogPayload, 'routePathname' | 'requestId'> {
  try {
    const context = getDbStageContext();
    return {
      routePathname: context?.routePathname,
      requestId: context?.requestId,
    };
  } catch {
    return {};
  }
}

function basePayload(stage: DbRuntimeStage): DbRuntimeStageLogPayload {
  return {
    event: DB_RUNTIME_STAGE_EVENT,
    stage,
    timestamp: new Date().toISOString(),
    databaseUrlPresent: isDatabaseUrlPresent(),
    ...contextFields(),
  };
}

function serializePayload(payload: DbRuntimeStageLogPayload): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({
      event: DB_RUNTIME_STAGE_EVENT,
      stage: payload.stage,
      timestamp: new Date().toISOString(),
      databaseUrlPresent: isDatabaseUrlPresent(),
    });
  }
}

function persistStageState(
  patch: Pick<
    DbStageContext,
    'lastStage' | 'failureCategory' | 'errorName' | 'prismaErrorCode' | 'nodeErrorCode'
  >,
): void {
  try {
    if (!getDbStageContext()) {
      return;
    }
    updateDbStageContext(patch);
  } catch {
    // Stage state must never affect request handling.
  }
}

function emitStagePayload(payload: DbRuntimeStageLogPayload): void {
  try {
    if (payload.stage === 'DB_RUNTIME_FAILURE') {
      persistStageState({
        lastStage: 'DB_RUNTIME_FAILURE',
        failureCategory: payload.category,
        errorName: payload.errorName,
        prismaErrorCode: payload.prismaErrorCode,
        nodeErrorCode: payload.nodeErrorCode,
      });
    } else {
      persistStageState({
        lastStage: payload.stage,
        failureCategory: undefined,
        errorName: undefined,
        prismaErrorCode: undefined,
        nodeErrorCode: undefined,
      });
    }

    if (!isDatabaseRuntimeDiagnosticsEnabled()) {
      return;
    }
    console.error(serializePayload(payload));
  } catch {
    // Diagnostics must never affect request handling.
  }
}

/** Classify require("@aicaa/db") failures without reading messages or paths. */
export function classifyDbModuleRequireFailure(error: unknown): DbRuntimeLoaderFailureCategory {
  try {
    const nodeCode = nodeErrorCodeFromCause(error);
    if (nodeCode === 'MODULE_NOT_FOUND') {
      return 'DB_MODULE_NOT_FOUND';
    }
    return 'DB_MODULE_LOAD_FAILED';
  } catch {
    return 'DB_MODULE_LOAD_FAILED';
  }
}

/**
 * Emit a non-failure stage marker. Never throws.
 * No-op unless ENABLE_DB_RUNTIME_DIAGNOSTICS=true.
 */
export function logDbRuntimeStage(
  stage: Exclude<DbRuntimeStage, 'DB_RUNTIME_FAILURE'>,
  extras: Pick<
    DbRuntimeStageLogPayload,
    'moduleLoaded' | 'exportsValidated' | 'queryOperation'
  > = {},
): void {
  try {
    emitStagePayload({
      ...basePayload(stage),
      ...extras,
    });
  } catch {
    // Never throw from diagnostics.
  }
}

/**
 * Emit a failure stage marker. Never throws and never changes the original error.
 * No-op unless ENABLE_DB_RUNTIME_DIAGNOSTICS=true.
 */
export function logDbRuntimeStageFailure(
  error: unknown,
  category: DbRuntimeStageFailureCategory,
  extras: Pick<
    DbRuntimeStageLogPayload,
    'moduleLoaded' | 'exportsValidated' | 'queryOperation'
  > = {},
): void {
  try {
    emitStagePayload({
      ...basePayload('DB_RUNTIME_FAILURE'),
      category,
      errorName: errorName(error),
      prismaErrorCode: prismaErrorCode(error),
      nodeErrorCode: nodeErrorCodeFromCause(error),
      clientVersion: clientVersion(error),
      ...extras,
    });
  } catch {
    // Never throw from diagnostics.
  }
}

/** Classify Prisma/client/query failures for stage logging. */
export function classifyDbRuntimeStageFailure(error: unknown): DbRuntimeStageFailureCategory {
  try {
    return classifyDatabaseRuntimeFailure(error);
  } catch {
    return 'UNKNOWN_DATABASE_ERROR';
  }
}
