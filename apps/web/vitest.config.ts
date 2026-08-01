import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * The `.pg.test.ts` suites share one PostgreSQL database and must not run alongside each other.
 *
 * They contend deliberately, and several of them exercise queries that are global by design — the
 * A8.4a worker due-scan carries no organization filter, because a cron-driven worker must not
 * enumerate organizations in application memory. Run two such files at once and one suite's worker
 * legitimately processes another suite's armed schedules: correct behaviour, ruinous as a test
 * fixture. Making each suite defensive against the others would mean asserting against global
 * aggregates instead of the rows under test, which is weaker evidence.
 *
 * Serialize only when the concurrency URL is present, so an ordinary `pnpm verify` — where every
 * `.pg.test.ts` skips itself — keeps full file parallelism.
 */
const sharesOnePostgres = Boolean(process.env.AICAA_PG_CONCURRENCY_URL);

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts', './vitest.env.ts'],
    // Browser specs belong to the Playwright harness (`pnpm e2e`), not Vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    fileParallelism: !sharesOnePostgres,
  },
  resolve: {
    alias: {
      '@': rootDir,
    },
  },
});
