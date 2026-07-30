/**
 * P1.2 browser harness environment (D119).
 *
 * Every value here targets a controlled LOCAL environment only:
 * a disposable local Postgres database and a local Supabase Auth double.
 * No production credential, production database, or real Google account is used.
 */

/** Local app server started by Playwright `webServer`. */
export const E2E_APP_PORT = Number(process.env.E2E_APP_PORT ?? 3210);
export const E2E_APP_URL = `http://127.0.0.1:${E2E_APP_PORT}`;

/** Retained harness artifacts (gitignored). */
export const ARTIFACT_DIR = 'e2e/.artifacts';

/**
 * Local application log. Holds P1.1 structured diagnostics so a browser test can verify
 * request-id correlation without inventing a second telemetry system.
 */
export const SERVER_LOG_PATH = `${ARTIFACT_DIR}/server.log`;

/** Local Supabase Auth double started by Playwright `webServer`. */
export const E2E_AUTH_PORT = Number(process.env.E2E_AUTH_PORT ?? 54329);
export const E2E_AUTH_URL = `http://127.0.0.1:${E2E_AUTH_PORT}`;

/** Disposable local Postgres. Never a Supabase/production host. */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55432/aicaa_e2e?schema=public';

/** Workspace domain the auth double asserts as the verified Google `hd` claim. */
export const E2E_WORKSPACE_DOMAIN = 'e2e.invalid';
export const E2E_OWNER_EMAIL = `owner@${E2E_WORKSPACE_DOMAIN}`;
export const E2E_OWNER_ID = '00000000-0000-4000-8000-00000000e2e1';

/** Disposable organization scope. Local database only; recreated by the reset script. */
export const E2E_ORGANIZATION_ID = 'org_e2e_local';

/** Test-only capability pepper. Not a production secret; the local DB is disposable. */
export const E2E_CAPABILITY_PEPPER = 'e2e-local-capability-pepper-value-0123456789';
export const E2E_CAPABILITY_TTL_MS = 3_600_000;

/**
 * Environment passed to the local Next.js server.
 * Deliberately explicit so a developer's real `.env.local` cannot leak in.
 */
export function appServerEnv(): Record<string, string> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: E2E_AUTH_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-local-anon-key',
    NEXT_PUBLIC_APP_URL: E2E_APP_URL,
    OWNER_WORKSPACE_DOMAIN: E2E_WORKSPACE_DOMAIN,
    OWNER_ORGANIZATION_ID: E2E_ORGANIZATION_ID,
    CAPABILITY_TOKEN_PEPPER: E2E_CAPABILITY_PEPPER,
    CAPABILITY_TTL_MS: String(E2E_CAPABILITY_TTL_MS),
    DATABASE_URL: E2E_DATABASE_URL,
    // Gmail configuration must load, but no Gmail call is exercised by P1.2.
    GOOGLE_GMAIL_CLIENT_ID: 'e2e-local-client-id.apps.googleusercontent.com',
    GOOGLE_GMAIL_CLIENT_SECRET: 'e2e-local-client-secret',
    GMAIL_TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    GMAIL_TOKEN_ENCRYPTION_KEY_VERSION: '1',
  };
}

/**
 * Guard: refuse to run the harness against anything that is not a local database.
 * Re-exported from the shared `.mjs` implementation so the TypeScript harness, the global
 * setup, and the standalone `.mjs` scripts cannot drift apart.
 */
export { assertLocalDatabaseUrl } from './local-db-guard.mjs';
