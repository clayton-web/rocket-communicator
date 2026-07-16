import type { DbClient } from '@aicaa/db';
import {
  classifyPrismaConnectProbeResult,
  type PrismaConnectProbeResult,
} from '@/lib/db/prisma-connect-probe';
import { updateDbStageContext } from '@/lib/db/stage-context';
import {
  classifyDbRuntimeStageFailure,
  logDbRuntimeStage,
  logDbRuntimeStageFailure,
} from '@/lib/db/stage-diagnostics';
import { DbRuntimeConfigurationError, loadDbRuntime } from './runtime-db';

let client: DbClient | undefined;
let clientInitPromise: Promise<DbClient> | undefined;

/**
 * Request-scoped Prisma client for Owner task HTTP routes (DATABASE_URL).
 * Tests should mock this module and inject PGlite via createTestDatabase().
 *
 * Temporary `$connect()` probe runs once per newly constructed singleton to
 * capture pre-query Prisma error codes before RequestHandler can strip them.
 * Layout diagnostics for PrismaClientInitializationError are captured inside
 * logDbRuntimeStageFailure (construction and query-time paths).
 */
export async function getDb(): Promise<DbClient> {
  if (client) {
    return client;
  }
  if (clientInitPromise) {
    return clientInitPromise;
  }

  clientInitPromise = constructAndConnectClient();
  try {
    return await clientInitPromise;
  } catch (error) {
    clientInitPromise = undefined;
    throw error;
  }
}

async function constructAndConnectClient(): Promise<DbClient> {
  logDbRuntimeStage('PRISMA_CLIENT_CONSTRUCTION_START');
  let created: DbClient;
  try {
    const runtime = await loadDbRuntime();
    created = runtime.createPrismaClient();
    logDbRuntimeStage('PRISMA_CLIENT_CONSTRUCTED');
  } catch (error) {
    if (!(error instanceof DbRuntimeConfigurationError)) {
      logDbRuntimeStageFailure(error, classifyDbRuntimeStageFailure(error));
    }
    throw error;
  }

  logDbRuntimeStage('PRISMA_CONNECT_PROBE_START');
  try {
    await created.$connect();
    updateDbStageContext({ prismaConnectProbeResult: 'SUCCESS' });
    logDbRuntimeStage('PRISMA_CONNECT_PROBE_SUCCEEDED');
  } catch (error) {
    const probeResult = classifyPrismaConnectProbeResult(error);
    updateDbStageContext({ prismaConnectProbeResult: probeResult });
    if (!(error instanceof DbRuntimeConfigurationError)) {
      logDbRuntimeStageFailure(error, classifyDbRuntimeStageFailure(error));
    }
    updateDbStageContext({ lastStage: 'PRISMA_CONNECT_PROBE_FAILED' });
    throw error;
  }

  client = created;
  return created;
}

/** Test-only override. Bypasses construction/connect probe. */
export function setDbForTests(db: DbClient | undefined): void {
  client = db;
  clientInitPromise = undefined;
}

/** Test-only reset of singleton client and in-flight init promise. */
export function resetDbClientForTests(): void {
  client = undefined;
  clientInitPromise = undefined;
}

export type { PrismaConnectProbeResult };
