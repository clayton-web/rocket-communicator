#!/usr/bin/env node
/**
 * Post-build verification for Prisma serverless packaging (no database access).
 *
 * Also proves A6.2 Owner suggestion route NFTs, A6.3 process-route NFT, and
 * traced @aicaa/db / @aicaa/ai / Prisma runtime artifacts after `pnpm build:web`.
 *
 * Usage (from repo root after Vercel-equivalent build):
 *   node apps/web/scripts/verify-prisma-serverless-trace.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  A6_2_REQUIRED_RUNTIME_MODULES,
  A6_2_SUGGESTION_ROUTE_NFTS,
  A6_3_AI_PACKAGE_MARKERS,
  A6_3_PROCESS_ROUTE_NFT,
  A6_3_REQUIRED_RUNTIME_MODULES,
  INVALID_ROOT_PATTERN,
  RHEL_ENGINE,
  SCHEMA_FILE,
  assertNftIncludesDbPackageRuntime,
  assertNftIncludesResolvableDomainPackage,
  getRequiredDbPackageRuntimeFiles,
  nftIncludesNodeModulesDomainIndex,
  nftIncludesRepoFile,
  normalizeNftEntry,
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

function readNftFiles(relativeNft) {
  const nftPath = path.join(webRoot, '.next/server', relativeNft);
  const nft = readJson(nftPath);
  return Array.isArray(nft.files) ? nft.files : [];
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

function assertRequiredModulesInNft(files, relativeNft, requiredModules) {
  for (const required of requiredModules) {
    if (!nftIncludesRepoFile(files, repoRoot, required)) {
      fail(`${relativeNft} NFT trace is missing required runtime module: ${required}`);
    }
  }
}

function nftIncludesAiPackage(files) {
  if (A6_3_AI_PACKAGE_MARKERS.every((marker) => nftIncludesRepoFile(files, repoRoot, marker))) {
    return true;
  }
  const hasIndex = files.some((entry) => {
    const normalized = normalizeNftEntry(entry);
    return (
      normalized.includes('@aicaa/ai') &&
      (normalized.endsWith('/dist/index.js') || normalized.endsWith('packages/ai/dist/index.js'))
    );
  });
  const hasPackageJson = files.some((entry) => {
    const normalized = normalizeNftEntry(entry);
    return (
      normalized.endsWith('packages/ai/package.json') ||
      normalized.endsWith('node_modules/@aicaa/ai/package.json')
    );
  });
  return hasIndex && hasPackageJson;
}

function assertA62SuggestionRouteNfts() {
  for (const relativeNft of A6_2_SUGGESTION_ROUTE_NFTS) {
    const files = readNftFiles(relativeNft);
    assertRequiredModulesInNft(files, relativeNft, A6_2_REQUIRED_RUNTIME_MODULES);
    assertNftIncludesDbPackageRuntime(files, repoRoot, relativeNft);
    assertNftIncludesResolvableDomainPackage(files, repoRoot, relativeNft);
    if (!nftIncludesNodeModulesDomainIndex(files)) {
      fail(`${relativeNft} NFT trace is missing node_modules/@aicaa/domain/dist/index.js`);
    }
  }
}

function assertA63ProcessRouteNft() {
  const files = readNftFiles(A6_3_PROCESS_ROUTE_NFT);
  assertRequiredModulesInNft(files, A6_3_PROCESS_ROUTE_NFT, A6_3_REQUIRED_RUNTIME_MODULES);
  if (!nftIncludesAiPackage(files)) {
    fail(
      `${A6_3_PROCESS_ROUTE_NFT} NFT trace is missing @aicaa/ai runtime artifacts (${A6_3_AI_PACKAGE_MARKERS.join(', ')} or workspace-linked equivalents)`,
    );
  }
  assertNftIncludesDbPackageRuntime(files, repoRoot, A6_3_PROCESS_ROUTE_NFT);
  assertNftIncludesResolvableDomainPackage(files, repoRoot, A6_3_PROCESS_ROUTE_NFT);
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
    "serverExternalPackages: ['@aicaa/db', 'google-auth-library']",
    "transpilePackages: ['@aicaa/domain', '@aicaa/ai']",
    'outputFileTracingRoot',
    'outputFileTracingIncludes',
    'dbPackageRuntimeTraceFiles',
    'dbPackageRoot',
    '${dbPackageRoot}/package.json',
    '${dbPackageRoot}/dist/**/*.js',
    'domainPackageRoot',
    '${domainPackageRoot}/package.json',
    '${domainPackageRoot}/dist/**/*.js',
    'aiPackageRoot',
    '${aiPackageRoot}/package.json',
    '${aiPackageRoot}/dist/**/*.js',
    'node_modules/@aicaa/db/package.json',
    'node_modules/@aicaa/domain/package.json',
    'node_modules/@aicaa/domain/dist/**/*.js',
    'node_modules/@aicaa/ai/package.json',
    'node_modules/@aicaa/ai/dist/**/*.js',
    "'/api/v1/task-suggestions'",
    "'/api/v1/internal/suggestions/process'",
    'suggestionProcessRouteTraceFiles',
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
  assertA62SuggestionRouteNfts();
  assertA63ProcessRouteNft();
  assertNoInvalidRootBundling();
  console.log('verify-prisma-serverless-trace: ok');
}

main();
