#!/usr/bin/env node
/**
 * Post-build verification for @aicaa/db/runtime package resolution in traced layouts.
 *
 * Usage (from repo root after Vercel-equivalent build):
 *   node apps/web/scripts/verify-db-package-require.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DB_PACKAGE_LITERAL,
  DB_BACKED_API_ROUTE_NFTS,
  assertRuntimeGraphExcludesPglite,
  getRequiredDbPackageRuntimeFiles,
  getRequiredDomainPackageRuntimeFiles,
  simulateRouteRuntimeRequire,
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
  return (
    normalized.endsWith('packages/db/dist/runtime.js') ||
    normalized.endsWith('node_modules/@aicaa/db/dist/runtime.js')
  );
}

function main() {
  const nextDir = path.join(webRoot, '.next');
  if (!fs.existsSync(nextDir)) {
    fail('missing .next build output — run pnpm build first');
  }

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
    const result = simulateRouteRuntimeRequire({
      webRoot,
      repoRoot,
      nftRelativePath: relativeNft,
    });
    if (!isValidRuntimeResolution(result.resolved)) {
      fail(`${relativeNft} resolved runtime to unexpected path: ${result.resolved}`);
    }
  }

  console.log(
    `verify-db-package-require: ok (${DB_PACKAGE_LITERAL}, domain files=${domainRequired.importGraphJs.length}, node=${process.version})`,
  );
}

main();
