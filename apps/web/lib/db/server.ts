import { createPrismaClient, type DbClient } from '@aicaa/db';

let client: DbClient | undefined;

/**
 * Request-scoped Prisma client for Owner task HTTP routes (DATABASE_URL).
 * Tests should mock this module and inject PGlite via createTestDatabase().
 */
export function getDb(): DbClient {
  if (!client) {
    client = createPrismaClient();
  }
  return client;
}

/** Test-only override. */
export function setDbForTests(db: DbClient | undefined): void {
  client = db;
}
