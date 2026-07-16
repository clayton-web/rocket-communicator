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
import {
  INVALID_ROOT_PATTERN,
  RHEL_ENGINE,
  SCHEMA_FILE,
  assertNftIncludesDbPackageRuntime,
  assertNftIncludesResolvableDomainPackage,
  getRequiredDbPackageRuntimeFiles,
  nftIncludesNodeModulesDomainIndex,
} from './lib/db-package-trace.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(webRoot, '../..');

const TASKS_NFT = path.join(webRoot, '.next/server/app/api/v1/tasks/route.js.nft.json');

const FORBIDDEN_TRACE_GLOBS = ['../../packages/db/**/*', '../../**/*'];

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

function assertTasksRouteNftTrace() {
  const nft = readJson(TASKS_NFT);
  const files = Array.isArray(nft.files) ? nft.files : [];
  if (files.some((entry) => entry.includes('.nft-sim'))) {
    fail('task route NFT trace contains stale local simulation artifacts');
  }
  assertNftIncludesDbPackageRuntime(files, repoRoot, 'task route');
  assertNftIncludesResolvableDomainPackage(files, repoRoot, 'task route');
  if (!nftIncludesNodeModulesDomainIndex(files)) {
    fail('task route NFT trace is missing node_modules/@aicaa/domain/dist/index.js');
  }
}

function assertNoInvalidRootBundling() {
  const tasksRouteJs = path.join(webRoot, '.next/server/app/api/v1/tasks/route.js');
  const chunkDirs = [path.join(webRoot, '.next/server/chunks'), path.dirname(tasksRouteJs)];

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
    fail(`built server output still contains ${INVALID_ROOT_PATTERN} in: ${offenders.join(', ')}`);
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
    'dbPackageRuntimeTraceFiles',
    'dbPackageRoot',
    '${dbPackageRoot}/package.json',
    '${dbPackageRoot}/dist/**/*.js',
    'domainPackageRoot',
    '${domainPackageRoot}/package.json',
    '${domainPackageRoot}/dist/**/*.js',
    'node_modules/@aicaa/db/package.json',
    'node_modules/@aicaa/domain/package.json',
    'node_modules/@aicaa/domain/dist/**/*.js',
    RHEL_ENGINE,
    SCHEMA_FILE,
    "'/c/[token]'",
    "'/c/**/*'",
  ];

  for (const snippet of requiredSnippets) {
    if (!configSource.includes(snippet)) {
      fail(`next.config.mjs missing expected setting: ${snippet}`);
    }
  }

  for (const forbidden of FORBIDDEN_TRACE_GLOBS) {
    if (configSource.includes(forbidden)) {
      fail(`next.config.mjs must not use broad trace glob: ${forbidden}`);
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
  getRequiredDbPackageRuntimeFiles(repoRoot);
  assertTasksRouteNftTrace();
  assertNoInvalidRootBundling();
  console.log('verify-prisma-serverless-trace: ok');
}

main();
