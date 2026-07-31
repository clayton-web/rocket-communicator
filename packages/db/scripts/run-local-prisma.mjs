#!/usr/bin/env node
/**
 * Run a Prisma CLI command against the local Docker Postgres URL only.
 * Always overrides DATABASE_URL so packages/db/.env cannot target production.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertLocalDatabaseUrl } from './assert-local-database-url.mjs';

const LOCAL_DATABASE_URL =
  process.env.AICAA_LOCAL_DATABASE_URL ??
  'postgresql://prisma:prisma@127.0.0.1:5433/prisma?schema=public';

assertLocalDatabaseUrl(LOCAL_DATABASE_URL);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/run-local-prisma.mjs <prisma-args...>');
  process.exit(1);
}

const dbRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync('pnpm', ['exec', 'prisma', ...args], {
  cwd: dbRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: LOCAL_DATABASE_URL,
  },
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
