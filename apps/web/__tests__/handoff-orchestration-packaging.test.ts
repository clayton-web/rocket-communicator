// @vitest-environment node
/**
 * A7.5 handoff orchestration — runtime-bridge / serverless-packaging coverage.
 *
 * The orchestration store adapter reaches the A7.3 persistence primitives ONLY through the traced
 * runtime bridge (`loadDbRuntime()`), never by resolving `@aicaa/db/runtime` directly in app code.
 * These tests assert the seven A7 primitives are explicitly exposed by every bridge surface so the
 * production Next.js/serverless (NFT) trace bundles them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import * as aicaaDb from '@aicaa/db/runtime';
import { loadDbRuntime, resetDbRuntimeForTests, setDbRuntimeForTests } from '@/lib/db/runtime-db';
// @ts-expect-error - .mjs helper has no type declarations
import { REQUIRED_RUNTIME_EXPORTS } from '../scripts/lib/db-package-trace.mjs';

const A7_PRIMITIVES = [
  'beginInitialHandoff',
  'markHandoffSendAccepted',
  'markHandoffDeliveryFailed',
  'prepareFailedHandoffRetry',
  'getHandoffAttemptById',
  'invalidState',
  'handoffInProgress',
] as const;

afterEach(() => {
  resetDbRuntimeForTests();
});

describe('A7.5 runtime bridge / packaging', () => {
  it('48. the traced runtime bridge exposes every A7 primitive the store adapter needs', async () => {
    setDbRuntimeForTests(aicaaDb);
    const runtime = await loadDbRuntime();
    for (const name of A7_PRIMITIVES) {
      expect(typeof (runtime as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('48b. the NFT packaging guard requires the A7 primitives as explicit runtime exports', () => {
    for (const name of A7_PRIMITIVES) {
      expect(REQUIRED_RUNTIME_EXPORTS).toContain(name);
    }
  });

  it('48c. the literal re-export bridge lists the A7 primitives (Turbopack external tracing)', () => {
    const reexports = readFileSync(
      fileURLToPath(new URL('../lib/db/db-runtime-reexports.ts', import.meta.url)),
      'utf8',
    );
    for (const name of A7_PRIMITIVES) {
      expect(reexports).toContain(name);
    }
  });
});
