#!/usr/bin/env node
/**
 * Post-build verification for Prisma serverless packaging (no database access).
 *
 * Usage (from repo root after Vercel-equivalent build):
 *   node apps/web/scripts/verify-prisma-serverless-trace.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(webRoot, '../..');

const RHEL_ENGINE = 'libquery_engine-rhel-openssl-3.0.x.so.node';
const SCHEMA_FILE = 'schema.prisma';
const TASKS_NFT = path.join(
  webRoot,
  '.next/server/app/api/v1/tasks/route.js.nft.json',
);
const GENERATED_CLIENT_DIR = path.join(
  repoRoot,
  'packages/db/dist/generated/client',
);
const INVALID_ROOT_PATTERN = '/ROOT/packages/db';

function fail(message) {
  console.error(`verify-prisma-serverless-trace: ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`missing file: ${path.relative(repoRoot, filePath)}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertGeneratedClientArtifacts() {
  const rhelPath = path.join(GENERATED_CLIENT_DIR, RHEL_ENGINE);
  const schemaPath = path.join(GENERATED_CLIENT_DIR, SCHEMA_FILE);

  if (!fs.existsSync(rhelPath)) {
    fail(
      `Linux query engine not found at packages/db/dist/generated/client/${RHEL_ENGINE} — run pnpm build:db`,
    );
  }
  if (!fs.existsSync(schemaPath)) {
    fail(
      `schema.prisma not found at packages/db/dist/generated/client/${SCHEMA_FILE} — run pnpm build:db`,
    );
  }
}

function assertTasksRouteNftTrace() {
  const nft = readJson(TASKS_NFT);
  const files = Array.isArray(nft.files) ? nft.files : [];

  const hasRhel = files.some((entry) => entry.includes(RHEL_ENGINE));
  const hasSchema = files.some((entry) => entry.endsWith(SCHEMA_FILE));

  if (!hasRhel) {
    fail(
      `task route NFT trace does not include ${RHEL_ENGINE} (macOS builds may still list darwin native — config must include rhel target)`,
    );
  }
  if (!hasSchema) {
    fail(`task route NFT trace does not include ${SCHEMA_FILE}`);
  }
}

function collectJsFiles(dir, results = []) {
  if (!fs.existsSync(dir)) {
    return results;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(fullPath, results);
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.js.map')) {
      results.push(fullPath);
    }
  }
  return results;
}

function assertNoInvalidRootBundling() {
  const tasksRouteJs = path.join(webRoot, '.next/server/app/api/v1/tasks/route.js');
  const chunkDirs = [
    path.join(webRoot, '.next/server/chunks'),
    path.dirname(tasksRouteJs),
  ];

  const offenders = [];
  for (const dir of chunkDirs) {
    for (const file of collectJsFiles(dir)) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes(INVALID_ROOT_PATTERN)) {
        offenders.push(path.relative(repoRoot, file));
      }
    }
  }

  if (offenders.length > 0) {
    fail(
      `built server output still contains ${INVALID_ROOT_PATTERN} in: ${offenders.join(', ')}`,
    );
  }
}

function assertNextConfig() {
  const configPath = path.join(webRoot, 'next.config.mjs');
  const configSource = fs.readFileSync(configPath, 'utf8');

  const requiredSnippets = [
    "serverExternalPackages: ['@aicaa/db']",
    "transpilePackages: ['@aicaa/domain']",
    'outputFileTracingRoot',
    'outputFileTracingIncludes',
    RHEL_ENGINE,
    SCHEMA_FILE,
  ];

  for (const snippet of requiredSnippets) {
    if (!configSource.includes(snippet)) {
      fail(`next.config.mjs missing expected setting: ${snippet}`);
    }
  }

  if (configSource.includes("'@aicaa/db'") && configSource.includes('transpilePackages')) {
    const transpileMatch = configSource.match(/transpilePackages:\s*\[([^\]]+)\]/);
    if (transpileMatch?.[1]?.includes('@aicaa/db')) {
      fail('next.config.mjs must not transpile @aicaa/db');
    }
  }
}

function main() {
  assertNextConfig();
  assertGeneratedClientArtifacts();
  assertTasksRouteNftTrace();
  assertNoInvalidRootBundling();
  console.log('verify-prisma-serverless-trace: ok');
}

main();
