import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  PrismaEngineArchitecture,
  PrismaEngineElfClass,
  PrismaEngineIdentityClass,
  PrismaExpectedEngineTarget,
  PrismaLayoutFailureClass,
} from '@/lib/db/prisma-layout-diagnostics';
import type { PrismaConnectProbeResult } from '@/lib/db/prisma-connect-probe';
import type { DbRuntimeStage, DbRuntimeStageFailureCategory } from '@/lib/db/stage-diagnostics';

export interface DbStageContext {
  routePathname?: string;
  requestId?: string;
  lastStage?: DbRuntimeStage;
  failureCategory?: DbRuntimeStageFailureCategory;
  errorName?: string;
  prismaErrorCode?: string;
  nodeErrorCode?: string;
  /** Temporary allowlisted Prisma layout probe fields (booleans/enums/safe hashes only). */
  prismaClientIndexPresent?: boolean;
  prismaSchemaAdjacent?: boolean;
  prismaEngineAdjacent?: boolean;
  prismaRuntimeLibraryPresent?: boolean;
  prismaGeneratedPackagePresent?: boolean;
  prismaExpectedEngineTarget?: PrismaExpectedEngineTarget;
  prismaFailureClass?: PrismaLayoutFailureClass;
  generatedClientDirectoryResolved?: boolean;
  engineFileReadable?: boolean;
  schemaFileReadable?: boolean;
  prismaEngineByteLength?: number;
  prismaEngineSha256?: string;
  prismaEngineReadable?: boolean;
  prismaEngineExecutable?: boolean;
  prismaEngineElfMagicValid?: boolean;
  prismaEngineElfClass?: PrismaEngineElfClass;
  prismaEngineArchitecture?: PrismaEngineArchitecture;
  prismaEngineIdentity?: PrismaEngineIdentityClass;
  /** Temporary allowlisted `$connect()` probe result (enum only). */
  prismaConnectProbeResult?: PrismaConnectProbeResult;
}

const stageContextStorage = new AsyncLocalStorage<DbStageContext>();
let testFallbackContext: DbStageContext | undefined;

function getMutableStore(): DbStageContext | undefined {
  return stageContextStorage.getStore();
}

function snapshotContext(context: DbStageContext): DbStageContext {
  return { ...context };
}

/** Run callback with isolated request-scoped DB stage context. */
export function runWithDbStageContext<T>(context: DbStageContext, fn: () => T): T {
  return stageContextStorage.run(snapshotContext(context), fn);
}

/** Bind route context for stage diagnostics within a single Owner task request. */
export function setDbStageContext(context: DbStageContext | undefined): void {
  if (context === undefined) {
    testFallbackContext = undefined;
    return;
  }

  const store = getMutableStore();
  if (store) {
    Object.assign(store, context);
    return;
  }

  testFallbackContext = snapshotContext(context);
}

export function getDbStageContext(): DbStageContext | undefined {
  const store = getMutableStore();
  if (store) {
    return snapshotContext(store);
  }
  return testFallbackContext ? snapshotContext(testFallbackContext) : undefined;
}

export function updateDbStageContext(patch: Partial<DbStageContext>): void {
  const store = getMutableStore();
  if (store) {
    Object.assign(store, patch);
    return;
  }
  if (testFallbackContext) {
    Object.assign(testFallbackContext, patch);
  }
}

/** Test-only reset for stage loader context. */
export function resetDbStageContextForTests(): void {
  testFallbackContext = undefined;
}
