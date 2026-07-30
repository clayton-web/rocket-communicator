import { defineConfig, devices } from '@playwright/test';
import {
  E2E_APP_URL,
  E2E_AUTH_PORT,
  E2E_APP_PORT,
  SERVER_LOG_PATH,
  appServerEnv,
} from './e2e/config/e2e-env';

/**
 * P1.2 browser verification harness (D119).
 *
 * Supported target: controlled LOCAL application plus disposable LOCAL Postgres and a
 * local Supabase Auth double. Never production, never a real Google account.
 * See docs/P1_2_BROWSER_HARNESS.md for prerequisites and commands.
 */
export default defineConfig({
  testDir: './e2e/specs',
  // Artifacts stay inside a single gitignored directory.
  outputDir: './e2e/.artifacts/test-results',
  globalSetup: './e2e/global-setup.ts',
  // The capability-secret sweep is a teardown, not a chained script, so it also runs when
  // the suite fails — which is when artifacts are actually retained.
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // List only. Playwright's HTML reporter embeds a base64 zip that can retain page URLs
  // (including `/c/{token}`) and that also produces nondeterministic `/c/...` substrings
  // inside opaque base64 — both unacceptable for a capability-secret-safe default. Opt in
  // with `pnpm exec playwright test --reporter=list --reporter=html` only when debugging,
  // then delete e2e/.artifacts afterwards; the post-run sweep still gates the result.
  reporter: [['list']],
  use: {
    baseURL: E2E_APP_URL,
    // Diagnostics: enough to debug a failure, never enough to retain protected content.
    screenshot: 'only-on-failure',
    // Traces are zip archives, so a secret inside one cannot be verified without
    // decompressing it. Keeping them off means the sweep can prove no archive is retained
    // at all. Failure diagnostics remain: screenshot, error context, console/network
    // capture, and the list reporter. Enable per-run with `--trace on` when debugging
    // locally, and delete the artifacts afterwards rather than sharing them.
    trace: 'off',
    video: 'off',
    // Capability links must never be resolved through a proxy or external service.
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'chromium-mobile',
      // Mobile-sized Chromium viewport for Owner list/detail and the capability page.
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: [
    {
      name: 'supabase-auth-double',
      command: 'node ./e2e/support/auth-double/server.mjs',
      url: `http://127.0.0.1:${E2E_AUTH_PORT}/__e2e__/health`,
      // Never reuse: a prior orphan or a developer process on the same port must fail clearly
      // rather than silently become the harness target.
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    },
    {
      name: 'web',
      // Owned launcher: redacts capability URLs from the captured log and kills `next` when
      // Playwright stops this webServer. A shell pipe (`next | redact-stream`) orphans `next`
      // on SIGTERM and leaves port 3210 held for the next run.
      command: `node ./e2e/scripts/run-web-server.mjs ${E2E_APP_PORT} ${SERVER_LOG_PATH}`,
      url: `${E2E_APP_URL}/login`,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 180_000,
      env: appServerEnv(),
    },
  ],
});
