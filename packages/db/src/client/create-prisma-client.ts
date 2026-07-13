import { Prisma, PrismaClient } from '../generated/client/index.js';

export { PrismaClient, Prisma };

/**
 * Create a Prisma client for server-side use with DATABASE_URL.
 * Authorization is application-enforced (D006); this is not an RLS substitute.
 */
export function createPrismaClient(databaseUrl = process.env.DATABASE_URL): PrismaClient {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to create the Prisma client.');
  }
  return new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });
}

export type DbClient = PrismaClient;
export type DbTransaction = Prisma.TransactionClient;
