import { test as base, expect, type Page } from '@playwright/test';
import { E2E_AUTH_URL, E2E_OWNER_ID, E2E_WORKSPACE_DOMAIN } from '../config/e2e-env';
import { redactCapabilityPaths } from './artifact-safety';

/**
 * Shared harness fixtures: real Owner sign-in, browser diagnostics capture, and
 * run-unique identifiers so tests are repeatable and order-independent.
 */

export interface BrowserDiagnostics {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  /** Redacted, protected-content-free summary safe to attach to a report. */
  safeReport(): string;
}

interface HarnessFixtures {
  diagnostics: BrowserDiagnostics;
  ownerPage: Page;
  runId: string;
}

/** Stable per-run prefix so fixtures never collide and assertions never match other runs. */
const RUN_ID = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function uniqueLabel(kind: string): string {
  return `${RUN_ID}-${kind}`;
}

export const OWNER_ID = E2E_OWNER_ID;

/** Drive the application's real login flow against the local Supabase Auth double. */
export async function signInAsOwner(page: Page, next = '/tasks'): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await page.waitForURL((url) => url.pathname === next, { timeout: 30_000 });
}

/**
 * Control the verified Google hosted-domain claim served by the local auth double so the
 * application's real Workspace allowlist rejection can be exercised.
 */
export async function setAuthDoubleHostedDomain(hostedDomain: string | null): Promise<void> {
  const response = await fetch(`${E2E_AUTH_URL}/__e2e__/hosted-domain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostedDomain }),
  });
  if (!response.ok) {
    throw new Error(`Auth double rejected hosted-domain control: ${response.status}`);
  }
}

export async function resetAuthDouble(): Promise<void> {
  await setAuthDoubleHostedDomain(null);
}

export const WORKSPACE_DOMAIN = E2E_WORKSPACE_DOMAIN;

function createDiagnostics(page: Page): BrowserDiagnostics {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(redactCapabilityPaths(message.text()));
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(redactCapabilityPaths(error.message));
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(
      redactCapabilityPaths(
        `${request.method()} ${request.url()} failed: ${request.failure()?.errorText ?? 'unknown'}`,
      ),
    );
  });
  page.on('response', (response) => {
    if (response.status() >= 500) {
      failedRequests.push(
        redactCapabilityPaths(
          `${response.request().method()} ${response.url()} -> ${response.status()}`,
        ),
      );
    }
  });

  return {
    consoleErrors,
    pageErrors,
    failedRequests,
    safeReport() {
      return [
        `console errors (${consoleErrors.length}):`,
        ...consoleErrors,
        `page errors (${pageErrors.length}):`,
        ...pageErrors,
        `failed or 5xx requests (${failedRequests.length}):`,
        ...failedRequests,
      ].join('\n');
    },
  };
}

export const test = base.extend<HarnessFixtures>({
  // The fixture callback's second argument is named `provide` rather than Playwright's
  // conventional `use` so the React hooks lint rule does not misread it as a hook call.
  runId: async ({}, provide) => {
    await provide(RUN_ID);
  },

  diagnostics: [
    async ({ page }, provide, testInfo) => {
      const diagnostics = createDiagnostics(page);
      await provide(diagnostics);
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('browser-diagnostics.txt', {
          body: diagnostics.safeReport(),
          contentType: 'text/plain',
        });
      }
    },
    { auto: true },
  ],

  ownerPage: async ({ page }, provide) => {
    await signInAsOwner(page);
    await provide(page);
  },
});

export { expect };
