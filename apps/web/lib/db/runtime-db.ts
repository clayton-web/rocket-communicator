import 'server-only';
import {
  classifyDbModuleRequireFailure,
  logDbRuntimeStage,
  logDbRuntimeStageFailure,
} from '@/lib/db/stage-diagnostics';
import { loadTracedRuntimeModule } from './db-runtime-entry';

export type DbRuntimeModule = Awaited<ReturnType<typeof loadTracedRuntimeModule>>;

const REQUIRED_EXPORTS = [
  'createPrismaClient',
  'getTaskById',
  'listTasks',
  'createTask',
  'getRecipientById',
  'createAuditEvent',
  'persistOwnerTaskMutation',
  'persistReturnToOwner',
  'findCapabilityByTokenHash',
  'createCapability',
  'findActiveCapabilitiesForAssignment',
  'revokeCapabilityRecord',
  'updateActiveAssignmentCapabilityBinding',
  'updateTaskWithExpectedVersion',
  'getCapabilityById',
  'markCapabilityExpiredRecord',
  'persistCapabilityAction',
  'persistWorkRequest',
] as const satisfies ReadonlyArray<keyof DbRuntimeModule>;

let cachedRuntime: DbRuntimeModule | undefined;
let testRuntimeOverride: DbRuntimeModule | undefined;
let runtimePromise: Promise<DbRuntimeModule> | undefined;

export class DbRuntimeConfigurationError extends Error {
  constructor() {
    super('Database runtime is not configured correctly.');
    this.name = 'DbRuntimeConfigurationError';
  }
}

function assertRuntimeExportPresent(
  runtime: DbRuntimeModule,
  exportName: (typeof REQUIRED_EXPORTS)[number],
): void {
  if (typeof runtime[exportName] === 'undefined') {
    throw new DbRuntimeConfigurationError();
  }
}

function validateRuntimeModule(runtime: unknown): DbRuntimeModule {
  if (runtime === null || typeof runtime !== 'object') {
    throw new DbRuntimeConfigurationError();
  }

  const runtimeModule = runtime as DbRuntimeModule;
  for (const exportName of REQUIRED_EXPORTS) {
    assertRuntimeExportPresent(runtimeModule, exportName);
  }
  return runtimeModule;
}

/** Test-only reset for runtime loader cache. */
export function resetDbRuntimeForTests(): void {
  cachedRuntime = undefined;
  testRuntimeOverride = undefined;
  runtimePromise = undefined;
}

/** Test-only injection for Vitest and other non-serverless runtimes. */
export function setDbRuntimeForTests(runtime: DbRuntimeModule | undefined): void {
  testRuntimeOverride = runtime ? validateRuntimeModule(runtime) : undefined;
  cachedRuntime = testRuntimeOverride;
  runtimePromise = undefined;
}

async function loadProductionRuntimeModule(): Promise<unknown> {
  return loadTracedRuntimeModule();
}

async function loadAndValidateRuntime(): Promise<DbRuntimeModule> {
  if (testRuntimeOverride) {
    return testRuntimeOverride;
  }

  if (cachedRuntime) {
    return cachedRuntime;
  }

  logDbRuntimeStage('DB_RUNTIME_LOAD_START');

  let loaded: unknown;
  try {
    loaded = await loadProductionRuntimeModule();
  } catch (error) {
    logDbRuntimeStageFailure(error, classifyDbModuleRequireFailure(error), {
      moduleLoaded: false,
      exportsValidated: false,
    });
    throw new DbRuntimeConfigurationError();
  }

  logDbRuntimeStage('DB_RUNTIME_MODULE_LOADED', { moduleLoaded: true });

  try {
    cachedRuntime = validateRuntimeModule(loaded);
  } catch (error) {
    logDbRuntimeStageFailure(error, 'DB_EXPORTS_MISSING', {
      moduleLoaded: true,
      exportsValidated: false,
    });
    throw error;
  }

  logDbRuntimeStage('DB_RUNTIME_EXPORTS_VALIDATED', {
    moduleLoaded: true,
    exportsValidated: true,
  });

  return cachedRuntime;
}

/**
 * Load the traced packages/db runtime via the app-local bridge.
 * Must remain the only production code path that resolves DB runtime values.
 */
export async function loadDbRuntime(): Promise<DbRuntimeModule> {
  if (testRuntimeOverride) {
    return testRuntimeOverride;
  }

  if (cachedRuntime) {
    return cachedRuntime;
  }

  if (!runtimePromise) {
    runtimePromise = loadAndValidateRuntime().catch((error) => {
      runtimePromise = undefined;
      throw error;
    });
  }

  return runtimePromise;
}
