import type { DbClient } from '@aicaa/db';
import {
  classifyDbRuntimeStageFailure,
  logDbRuntimeStage,
  logDbRuntimeStageFailure,
} from '@/lib/db/stage-diagnostics';
import { DbRuntimeConfigurationError, loadDbRuntime } from './runtime-db';

let client: DbClient | undefined;

/**
 * Request-scoped Prisma client for Owner task HTTP routes (DATABASE_URL).
 * Tests should mock this module and inject PGlite via createTestDatabase().
 */
export function getDb(): DbClient {
  if (!client) {
    logDbRuntimeStage('PRISMA_CLIENT_CONSTRUCTION_START');
    try {
      client = loadDbRuntime().createPrismaClient();
      logDbRuntimeStage('PRISMA_CLIENT_CONSTRUCTED');
    } catch (error) {
      if (!(error instanceof DbRuntimeConfigurationError)) {
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
