import type { DbClient } from '@aicaa/db';
import {
  inspectPrismaGeneratedClientLayout,
  resolveGeneratedClientDirFromTracedRuntimePath,
} from '@/lib/db/prisma-layout-diagnostics';
import { updateDbStageContext } from '@/lib/db/stage-context';
import {
  classifyDbRuntimeStageFailure,
  logDbRuntimeStage,
  logDbRuntimeStageFailure,
} from '@/lib/db/stage-diagnostics';
import {
  DbRuntimeConfigurationError,
  getLastResolvedTracedRuntimePath,
  loadDbRuntime,
} from './runtime-db';

let client: DbClient | undefined;

function capturePrismaLayoutProbe(error: unknown): void {
  try {
    const layout = inspectPrismaGeneratedClientLayout(
      error,
      resolveGeneratedClientDirFromTracedRuntimePath(getLastResolvedTracedRuntimePath()),
    );
    updateDbStageContext({
      prismaClientIndexPresent: layout.prismaClientIndexPresent,
      prismaSchemaAdjacent: layout.prismaSchemaAdjacent,
      prismaEngineAdjacent: layout.prismaEngineAdjacent,
      prismaRuntimeLibraryPresent: layout.prismaRuntimeLibraryPresent,
      prismaGeneratedPackagePresent: layout.prismaGeneratedPackagePresent,
      prismaExpectedEngineTarget: layout.prismaExpectedEngineTarget,
      prismaFailureClass: layout.prismaFailureClass,
      generatedClientDirectoryResolved: layout.generatedClientDirectoryResolved,
      engineFileReadable: layout.engineFileReadable,
      schemaFileReadable: layout.schemaFileReadable,
    });
  } catch {
    // Layout probe must never affect request handling.
  }
}

/**
 * Request-scoped Prisma client for Owner task HTTP routes (DATABASE_URL).
 * Tests should mock this module and inject PGlite via createTestDatabase().
 */
export async function getDb(): Promise<DbClient> {
  if (!client) {
    logDbRuntimeStage('PRISMA_CLIENT_CONSTRUCTION_START');
    try {
      const runtime = await loadDbRuntime();
      client = runtime.createPrismaClient();
      logDbRuntimeStage('PRISMA_CLIENT_CONSTRUCTED');
    } catch (error) {
      if (!(error instanceof DbRuntimeConfigurationError)) {
        capturePrismaLayoutProbe(error);
        logDbRuntimeStageFailure(error, classifyDbRuntimeStageFailure(error));
      }
      throw error;
    }
  }
  return client;
}

/** Test-only override. */
export function setDbForTests(db: DbClient | undefined): void {
  client = db;
}
