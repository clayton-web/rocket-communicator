import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '../generated/client/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDir = path.join(packageRoot, 'prisma', 'migrations');

async function applyMigrations(client: PGlite): Promise<void> {
  const dirs = readdirSync(migrationsDir)
    .filter((name) => statSync(path.join(migrationsDir, name)).isDirectory())
    .sort();

  for (const dir of dirs) {
    const sqlPath = path.join(migrationsDir, dir, 'migration.sql');
    const sql = readFileSync(sqlPath, 'utf8');
    await client.exec(sql);
  }
}

export interface TestDatabase {
  prisma: PrismaClient;
  pglite: PGlite;
  close: () => Promise<void>;
}

/** In-process Postgres for ordinary tests — no Docker required. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const pglite = new PGlite();
  await applyMigrations(pglite);
  const adapter = new PrismaPGlite(pglite);
  // pglite-prisma-adapter and @prisma/client may resolve slightly different adapter-utils
  // minor versions in the monorepo; runtime compatibility is validated by Vitest.
  const prisma = new PrismaClient({ adapter: adapter as never });
  await prisma.$connect();

  return {
    prisma,
    pglite,
    async close() {
      await prisma.$disconnect();
      await pglite.close();
    },
  };
}
