#!/usr/bin/env node
/**
 * Harness entry point (D114, D119).
 *
 * Runs Playwright, then **always** runs the capability-secret sweep — on pass and on failure.
 *
 * Two gates are needed, not one:
 *  - `globalTeardown` sweeps as soon as the tests finish, so even a raw `playwright test`
 *    invocation is covered;
 *  - this wrapper sweeps again after the process exits, because late reporter output finishes
 *    *after* global teardown. The default config uses `list` only (HTML is opt-in), but any
 *    reporter or attachment written after teardown would otherwise escape a teardown-only gate.
 *
 * A test failure takes precedence in the exit code; a sweep failure fails an otherwise green run.
 *
 * Usage: node e2e/scripts/run-harness.mjs [playwright args...]
 */
import { spawnSync } from 'node:child_process';

const testRun = spawnSync('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
});

const sweep = spawnSync('node', ['./e2e/scripts/verify-artifact-safety.mjs'], {
  stdio: 'inherit',
});

if (testRun.status !== 0) {
  process.exit(testRun.status ?? 1);
}
process.exit(sweep.status ?? 1);
