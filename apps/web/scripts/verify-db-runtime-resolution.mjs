#!/usr/bin/env node
/**
 * Post-build verification for externalized @aicaa/db runtime resolution.
 *
 * Usage (from repo root after Vercel-equivalent build):
 *   node apps/web/scripts/verify-db-runtime-resolution.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(webRoot, '../..');

const INVALID_ROOT_PATTERN = '/ROOT/packages/db';
const DB_PACKAGE_LITERAL = '@aicaa/db';

const DB_BACKED_ROUTE_NFTS = [
  'app/api/v1/tasks/route.js.nft.json',
  'app/api/v1/tasks/[taskId]/route.js.nft.json',
  'app/api/v1/capabilities/[token]/tasks/[taskId]/route.js.nft.json',
];

const DB_STUB_PATTERNS = [
  /await\s+\(void\s+0\)\s*\(/,
  /\bgetDb\b[^;]{0,120}\(void\s+0\)\s*\(\)/,
  /\bcreatePrismaClient\b[^;]{0,80}\(void\s+0\)/,
  /\bloadDbRuntime\b[^;]{0,120}\(void\s+0\)/,
];

const REQUIRED_RUNTIME_MARKERS = ['@aicaa/db', 'createRequire', 'loadDbRuntime', 'requireImpl'];

function fail(message) {
  console.error(`verify-db-runtime-resolution: ${message}`);
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

function resolveNftFile(relativeNftPath) {
  return path.resolve(webRoot, '.next/server', relativeNftPath);
}

function nftChunkJsFiles(nftPath) {
  const nft = readJson(nftPath);
  const files = Array.isArray(nft.files) ? nft.files : [];
  const serverRoot = path.dirname(nftPath);
  const jsFiles = new Set();

  for (const entry of files) {
    if (!entry.endsWith('.js') || entry.endsWith('.js.map')) {
      continue;
    }
    jsFiles.add(path.resolve(serverRoot, entry));
  }

  const routeJs = nftPath.replace(/\.nft\.json$/, '');
  if (fs.existsSync(routeJs)) {
    jsFiles.add(routeJs);
  }

  return [...jsFiles];
}

function readRouteChunkImports(routeJsPath) {
  if (!fs.existsSync(routeJsPath)) {
    return [];
  }
  const content = fs.readFileSync(routeJsPath, 'utf8');
  const chunkMatches = [...content.matchAll(/server\/chunks\/[^"']+\.js/g)];
  const chunkDir = path.join(webRoot, '.next/server/chunks');
  return chunkMatches.map((match) => path.join(chunkDir, path.basename(match[0])));
}

function gatherRouteArtifacts(relativeNftPath) {
  const nftPath = resolveNftFile(relativeNftPath);
  const artifacts = new Set(nftChunkJsFiles(nftPath));
  const routeJs = nftPath.replace(/\.nft\.json$/, '');
  for (const chunk of readRouteChunkImports(routeJs)) {
    artifacts.add(chunk);
  }
  return [...artifacts].filter((filePath) => fs.existsSync(filePath));
}

function assertRuntimeReferencePresent(routeLabel, artifactPaths) {
  const combined = artifactPaths
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');

  for (const marker of REQUIRED_RUNTIME_MARKERS) {
    if (!combined.includes(marker)) {
      fail(`${routeLabel} server output is missing runtime marker: ${marker}`);
    }
  }

  if (!combined.includes(DB_PACKAGE_LITERAL)) {
    fail(`${routeLabel} server output does not reference ${DB_PACKAGE_LITERAL}`);
  }
}

function assertNoDbStubs(routeLabel, artifactPaths) {
  for (const filePath of artifactPaths) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes(INVALID_ROOT_PATTERN)) {
      fail(`${routeLabel} contains invalid bundling path ${INVALID_ROOT_PATTERN} in ${path.relative(repoRoot, filePath)}`);
    }

    for (const pattern of DB_STUB_PATTERNS) {
      if (pattern.test(content)) {
        fail(
          `${routeLabel} contains externalized DB stub pattern ${pattern} in ${path.relative(repoRoot, filePath)}`,
        );
      }
    }

    if (/\["getDb",0,function\(\)\{return[^}]*\(void 0\)\(\)/.test(content)) {
      fail(`${routeLabel} compiles getDb() to invoke void 0 in ${path.relative(repoRoot, filePath)}`);
    }
  }
}

function assertRuntimeLoaderChunkPresent() {
  const chunkDirs = [
    path.join(webRoot, '.next/server/chunks'),
    path.join(webRoot, '.next/server/app'),
  ];
  const candidates = [];
  for (const dir of chunkDirs) {
    candidates.push(...collectJsFiles(dir));
  }

  const loaderChunks = candidates.filter((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    return (
      content.includes('loadDbRuntime') &&
      content.includes('@aicaa/db') &&
      content.includes('createRequire')
    );
  });

  if (loaderChunks.length === 0) {
    fail(`no server chunk contains loadDbRuntime with a ${DB_PACKAGE_LITERAL} require reference`);
  }
}

function main() {
  const nextDir = path.join(webRoot, '.next');
  if (!fs.existsSync(nextDir)) {
    fail('missing .next build output — run pnpm build first');
  }

  assertRuntimeLoaderChunkPresent();

  for (const relativeNft of DB_BACKED_ROUTE_NFTS) {
    const nftPath = resolveNftFile(relativeNft);
    if (!fs.existsSync(nftPath)) {
      fail(`missing NFT trace for ${relativeNft}`);
    }
    const routeLabel = relativeNft.replace(/\.nft\.json$/, '');
    const artifacts = gatherRouteArtifacts(relativeNft);
    if (artifacts.length === 0) {
      fail(`no artifacts gathered for ${routeLabel}`);
    }
    assertRuntimeReferencePresent(routeLabel, artifacts);
    assertNoDbStubs(routeLabel, artifacts);
  }

  console.log('verify-db-runtime-resolution: ok');
}

main();
