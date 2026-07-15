#!/usr/bin/env node
/**
 * Post-build verification for lazy DB runtime bridge behavior in a traced Lambda layout.
 *
 * Usage (from repo root after Vercel-equivalent build):
 *   node apps/web/scripts/verify-lambda-layout-bridge.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DB_BACKED_API_ROUTE_NFTS,
  assertCompiledBridgeNamespace,
  simulateLambdaLayoutBridgeInit,
} from './lib/db-package-trace.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(webRoot, '../..');

function fail(message) {
  console.error(`verify-lambda-layout-bridge: ${message}`);
  process.exit(1);
}

function main() {
  const nextDir = path.join(webRoot, '.next');
  if (!fs.existsSync(nextDir)) {
    fail('missing .next build output — run pnpm build first');
  }

  assertCompiledBridgeNamespace(webRoot);

  for (const relativeNft of DB_BACKED_API_ROUTE_NFTS) {
    const nftPath = path.join(webRoot, '.next/server', relativeNft);
    if (!fs.existsSync(nftPath)) {
      fail(`missing NFT trace for ${relativeNft}`);
    }

    simulateLambdaLayoutBridgeInit({
      webRoot,
      repoRoot,
      nftRelativePath: relativeNft,
    });
  }

  console.log(`verify-lambda-layout-bridge: ok (node=${process.version})`);
}

main();
