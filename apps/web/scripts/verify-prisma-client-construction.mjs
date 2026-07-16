#!/usr/bin/env node
/**
 * Linux-faithful Prisma client construction verification for traced NFT layouts.
 *
 * Usage (from repo root after production-equivalent build):
 *   PRISMA_CLIENT_CONSTRUCTION_PROBE_REQUIRED=true node apps/web/scripts/verify-prisma-client-construction.mjs
 *
 * On non-Linux hosts the script skips unless PRISMA_CLIENT_CONSTRUCTION_PROBE_REQUIRED=true.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  assertPrismaClientConstructionProbeSuccess,
  isLinuxPlatform,
  repoRootFromScript,
  runPrismaClientConstructionProbe,
  runPrismaEngineSyntheticMatrix,
  webRootFromScript,
} from './lib/prisma-client-construction-probe.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const webRoot = webRootFromScript(import.meta.url);
const required = process.env.PRISMA_CLIENT_CONSTRUCTION_PROBE_REQUIRED === 'true';

function fail(message) {
  console.error(`verify-prisma-client-construction: ${message}`);
  process.exit(1);
}

function main() {
  const nextDir = path.join(webRoot, '.next');
  if (!fs.existsSync(nextDir)) {
    fail('missing .next build output — run pnpm build first');
  }

  if (!isLinuxPlatform()) {
    if (required) {
      fail('requires genuine Linux (platform spoofing is not supported)');
    }
    console.log(
      'verify-prisma-client-construction: skipped (requires linux; run in CI ubuntu-latest)',
    );
    process.exit(0);
  }

  const result = runPrismaClientConstructionProbe({ webRoot, repoRoot });
  try {
    assertPrismaClientConstructionProbeSuccess(result);
  } catch (error) {
    const probe1 = result.probe1?.classification ?? 'unknown';
    const probe2 = result.probe2?.classification ?? 'unknown';
    fail(
      `${error instanceof Error ? error.message : String(error)} (probe1=${probe1}, probe2=${probe2})`,
    );
  }

  console.log(
    `verify-prisma-client-construction: ok (node=${process.version}, probe1=${result.probe1.classification}, probe2=${result.probe2.classification})`,
  );

  // Optional synthetic matrix: informational only; never weakens CASE E pass criteria.
  try {
    const matrix = runPrismaEngineSyntheticMatrix({ webRoot, repoRoot });
    if (matrix.skipped) {
      console.log(
        `verify-prisma-client-construction: synthetic-matrix skipped (${matrix.reason ?? 'unknown'})`,
      );
    } else {
      const summary = matrix.variants
        .map((v) => `${v.variant}:${v.failureClass ?? 'UNKNOWN'}/${v.engineIdentity ?? 'UNKNOWN'}`)
        .join(',');
      console.log(`verify-prisma-client-construction: synthetic-matrix ${summary}`);
    }
  } catch (error) {
    console.log(
      `verify-prisma-client-construction: synthetic-matrix non-blocking failure (${
        error instanceof Error ? error.message : 'unknown'
      })`,
    );
  }
}

main();
