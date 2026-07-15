#!/usr/bin/env node
/**
 * Post-build verification for traced DB runtime bridge loading without workspace symlinks.
 *
 * Usage (from repo root after Vercel-equivalent build):
 *   node apps/web/scripts/verify-db-package-require.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DB_BACKED_API_ROUTE_NFTS,
  DB_RUNTIME_RELATIVE,
  assertBuiltOutputUsesRuntimeBridge,
  assertRuntimeGraphExcludesPglite,
  getRequiredDbPackageRuntimeFiles,
  getRequiredDomainPackageRuntimeFiles,
  simulateRouteRuntimeBridge,
} from './lib/db-package-trace.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(webRoot, '../..');

function fail(message) {
  console.error(`verify-db-package-require: ${message}`);
  process.exit(1);
}

function isValidRuntimeResolution(resolvedPath) {
  const normalized = resolvedPath.replace(/\\/g, '/');
  return normalized.endsWith(DB_RUNTIME_RELATIVE);
}

function main() {
  const nextDir = path.join(webRoot, '.next');
  if (!fs.existsSync(nextDir)) {
    fail('missing .next build output — run pnpm build first');
  }

  assertBuiltOutputUsesRuntimeBridge(webRoot, repoRoot);

  const required = getRequiredDbPackageRuntimeFiles(repoRoot);
  const domainRequired = getRequiredDomainPackageRuntimeFiles(repoRoot);
  assertRuntimeGraphExcludesPglite(required.importGraphJs, repoRoot);

  if (!required.packageImports.includes('@aicaa/domain')) {
    fail('production runtime graph does not import @aicaa/domain');
  }
  if (required.importGraphJs.some((filePath) => filePath.includes('create-test-database.js'))) {
    fail('production runtime graph includes create-test-database.js');
  }

  for (const relativeNft of DB_BACKED_API_ROUTE_NFTS) {
    const result = simulateRouteRuntimeBridge({
      webRoot,
      repoRoot,
      nftRelativePath: relativeNft,
    });
    if (!isValidRuntimeResolution(result.resolved)) {
      fail(`${relativeNft} resolved runtime to unexpected path: ${result.resolved}`);
    }
  }

  console.log(
    `verify-db-package-require: ok (${DB_RUNTIME_RELATIVE}, domain files=${domainRequired.importGraphJs.length}, node=${process.version})`,
  );
}

main();
