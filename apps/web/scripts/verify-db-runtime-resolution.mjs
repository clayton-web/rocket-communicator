#!/usr/bin/env node
/**
 * Post-build verification for app-local DB runtime bridge resolution.
 *
 * Usage (from repo root after Vercel-equivalent build):
 *   node apps/web/scripts/verify-db-runtime-resolution.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DB_BACKED_API_ROUTE_NFTS,
  DB_BACKED_PAGE_ROUTE_NFTS,
  TRACED_DB_RUNTIME_MARKER,
  INVALID_ROOT_PATTERN,
  assertBuiltOutputUsesRuntimeBridge,
  assertNftIncludesDbPackageRuntime,
} from './lib/db-package-trace.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(webRoot, '../..');

const DB_STUB_PATTERNS = [
  /await\s+\(void\s+0\)\s*\(/,
  /\bgetDb\b[^;]{0,120}\(void\s+0\)\s*\(\)/,
  /\bcreatePrismaClient\b[^;]{0,80}\(void\s+0\)/,
  /\bloadDbRuntime\b[^;]{0,120}\(void\s+0\)/,
];

const REQUIRED_RUNTIME_MARKERS = ['loadDbRuntime', TRACED_DB_RUNTIME_MARKER, 'createPrismaClient'];

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
  const chunkMatches = [...content.matchAll(/server\/chunks\/(?:ssr\/)?[^"']+\.js/g)];
  const chunks = [];
  for (const match of chunkMatches) {
    chunks.push(path.join(webRoot, '.next', match[0]));
  }
  return chunks;
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
  const combined = artifactPaths.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');

  for (const marker of REQUIRED_RUNTIME_MARKERS) {
    if (!combined.includes(marker)) {
      fail(`${routeLabel} server output is missing runtime marker: ${marker}`);
    }
  }
}

function assertNoDbStubs(routeLabel, artifactPaths) {
  for (const filePath of artifactPaths) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes(INVALID_ROOT_PATTERN)) {
      fail(
        `${routeLabel} contains invalid bundling path ${INVALID_ROOT_PATTERN} in ${path.relative(repoRoot, filePath)}`,
      );
    }

    for (const pattern of DB_STUB_PATTERNS) {
      if (pattern.test(content)) {
        fail(
          `${routeLabel} contains externalized DB stub pattern ${pattern} in ${path.relative(repoRoot, filePath)}`,
        );
      }
    }

    if (/\["getDb",0,function\(\)\{return[^}]*\(void 0\)\(\)/.test(content)) {
      fail(
        `${routeLabel} compiles getDb() to invoke void 0 in ${path.relative(repoRoot, filePath)}`,
      );
    }
  }
}

function assertDbPackageNftTrace(relativeNftPath) {
  const nftPath = resolveNftFile(relativeNftPath);
  const nft = readJson(nftPath);
  const files = Array.isArray(nft.files) ? nft.files : [];
  const routeLabel = relativeNftPath.replace(/\.nft\.json$/, '');
  assertNftIncludesDbPackageRuntime(files, repoRoot, routeLabel);
}

function main() {
  const nextDir = path.join(webRoot, '.next');
  if (!fs.existsSync(nextDir)) {
    fail('missing .next build output — run pnpm build first');
  }

  assertBuiltOutputUsesRuntimeBridge(webRoot, repoRoot);

  for (const relativeNft of DB_BACKED_API_ROUTE_NFTS) {
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
    assertDbPackageNftTrace(relativeNft);
  }

  for (const relativeNft of DB_BACKED_PAGE_ROUTE_NFTS) {
    const nftPath = resolveNftFile(relativeNft);
    if (!fs.existsSync(nftPath)) {
      fail(`missing NFT trace for ${relativeNft}`);
    }
    assertDbPackageNftTrace(relativeNft);
  }

  console.log('verify-db-runtime-resolution: ok');
}

main();
