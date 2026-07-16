import type { DbClient } from '@aicaa/db';
import { loadDbRuntime } from './runtime-db';

let client: DbClient | undefined;
let clientInitPromise: Promise<DbClient> | undefined;

/**
 * Request-scoped Prisma client for Owner task HTTP routes (DATABASE_URL).
 * Tests should mock this module and inject PGlite via createTestDatabase().
 */
export async function getDb(): Promise<DbClient> {
  if (client) {
    return client;
  }
  if (clientInitPromise) {
    return clientInitPromise;
  }

  clientInitPromise = constructClient();
  try {
    return await clientInitPromise;
  } catch (error) {
    clientInitPromise = undefined;
    throw error;
  }
}

async function constructClient(): Promise<DbClient> {
  const runtime = await loadDbRuntime();
  const created = runtime.createPrismaClient();
  client = created;
  return created;
}

/** Test-only override. */
export function setDbForTests(db: DbClient | undefined): void {
  client = db;
  clientInitPromise = undefined;
}

/** Test-only reset of singleton client and in-flight init promise. */
export function resetDbClientForTests(): void {
  client = undefined;
  clientInitPromise = undefined;
}
