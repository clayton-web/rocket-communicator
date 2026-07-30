import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_DATABASE_URL, assertLocalDatabaseUrl, SERVER_LOG_PATH } from './config/e2e-env';
import { FINGERPRINT_FILE } from './support/capability-secrets.mjs';

/**
 * Prepare the disposable local database and a clean diagnostics log before the application
 * server starts.
 *
 * Fails closed: the harness refuses to run unless the target is a local database, so it can
 * never migrate or mutate a Supabase/production host.
 */
export default function globalSetup(): void {
  assertLocalDatabaseUrl(E2E_DATABASE_URL);

  const logPath = path.resolve(__dirname, '..', SERVER_LOG_PATH);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, '');

  // Token fingerprints are scoped to one run, matching Playwright's per-run cleaning of the
  // output directory. Keeping them in step means the sweep always covers exactly the tokens
  // that could appear in the artifacts currently on disk, and the file cannot grow forever.
  fs.writeFileSync(path.resolve(path.dirname(logPath), FINGERPRINT_FILE), '');

  const dbPackageDir = path.resolve(__dirname, '../../../packages/db');

  try {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: dbPackageDir,
      env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        'P1.2 harness could not prepare the local database.',
        'Start the disposable local Postgres first: pnpm --filter @aicaa/web e2e:db:start',
        `Underlying failure: ${detail}`,
      ].join('\n'),
    );
  }
}
