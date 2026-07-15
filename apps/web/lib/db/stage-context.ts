import { AsyncLocalStorage } from 'node:async_hooks';
import type { DbRuntimeStage, DbRuntimeStageFailureCategory } from '@/lib/db/stage-diagnostics';

export interface DbStageContext {
  routePathname?: string;
  requestId?: string;
  lastStage?: DbRuntimeStage;
  failureCategory?: DbRuntimeStageFailureCategory;
  errorName?: string;
  prismaErrorCode?: string;
  nodeErrorCode?: string;
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
