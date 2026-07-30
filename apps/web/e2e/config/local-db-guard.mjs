/**
 * Single source of truth for "is this a disposable LOCAL database?" (D119).
 *
 * Every harness entry point that migrates, mutates, or drops data must call this before
 * touching a database, so the browser harness can never reach Supabase or any other
 * production host. Plain `.mjs` so the TypeScript config, the Playwright global setup, and
 * the standalone fixture/lifecycle scripts all share one implementation instead of drifting
 * copies.
 *
 * Fails closed: anything not provably loopback is refused.
 */

/** Loopback literals only. A resolvable name such as `db.local` is deliberately refused. */
const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * libpq and Prisma both let a query parameter re-point the connection away from the URL
 * host, so a "loopback" URL can still open a remote or unix-socket connection.
 */
const TARGET_OVERRIDE_PARAMS = ['host', 'hostaddr', 'socket', 'servername'];

/** Secondary defence only. The loopback allowlist above is the primary control. */
const KNOWN_MANAGED_HOSTS = /supabase|pooler|amazonaws|rds\.|neon\.tech|azure|\.gcp\./i;

class LocalDatabaseGuardError extends Error {
  constructor(reason) {
    super(`P1.2 harness refuses to use this database: ${reason}`);
    this.name = 'LocalDatabaseGuardError';
  }
}

/**
 * Throw unless `rawUrl` is a disposable local Postgres URL.
 *
 * @param {unknown} rawUrl
 * @param {string} [label] Which entry point asked, for a useful failure message.
 */
export function assertLocalDatabaseUrl(rawUrl, label = 'database URL') {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new LocalDatabaseGuardError(`${label} is missing or empty`);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // An unparseable URL is never provably local.
    throw new LocalDatabaseGuardError(`${label} is not a parseable URL`);
  }

  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new LocalDatabaseGuardError(`${label} must use a postgres:// or postgresql:// scheme`);
  }

  // WHATWG parsing takes everything before the LAST "@" as user info, so
  // `postgresql://u@127.0.0.1:5432@evil.example.com/db` really targets evil.example.com.
  // Comparing the parsed hostname (not a regex over the whole string) is what closes that.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!ALLOWED_HOSTNAMES.has(hostname)) {
    throw new LocalDatabaseGuardError(
      `${label} host "${parsed.hostname}" is not a loopback address (allowed: 127.0.0.1, localhost, ::1)`,
    );
  }

  for (const param of TARGET_OVERRIDE_PARAMS) {
    if (parsed.searchParams.has(param)) {
      throw new LocalDatabaseGuardError(
        `${label} carries a "${param}" parameter, which can redirect the connection away from loopback`,
      );
    }
  }

  if (KNOWN_MANAGED_HOSTS.test(rawUrl)) {
    throw new LocalDatabaseGuardError(`${label} names a managed/production database host`);
  }
}

/**
 * Throw unless the disposable-cluster lifecycle arguments are local and test-scoped.
 *
 * `local-db.mjs` runs `dropdb`/`initdb`/`pg_ctl`, which are destructive and take their
 * target from environment variables. Validating them here stops an environment override
 * from re-pointing a destructive command at a real cluster after the URL was checked.
 *
 * @param {{ socketDir: string, database: string, port: string, pgData: string }} target
 */
export function assertLocalClusterTarget(target) {
  const { socketDir, database, port, pgData } = target;

  // `psql -h` treats a value starting with "/" as a socket directory and anything else as a
  // TCP hostname, so a non-absolute value here would send a destructive command to a host.
  if (typeof socketDir !== 'string' || !socketDir.startsWith('/')) {
    throw new LocalDatabaseGuardError(
      `cluster socket directory must be an absolute local path, received "${socketDir}"`,
    );
  }

  if (!/^aicaa_e2e[a-z0-9_]*$/.test(String(database))) {
    throw new LocalDatabaseGuardError(
      `cluster database name must start with "aicaa_e2e", received "${database}"`,
    );
  }

  if (!/^\d{4,5}$/.test(String(port)) || String(port) === '5432') {
    throw new LocalDatabaseGuardError(
      `cluster port must be a non-default local port, received "${port}"`,
    );
  }

  if (typeof pgData !== 'string' || !pgData.startsWith('/') || !pgData.includes('aicaa-e2e')) {
    throw new LocalDatabaseGuardError(
      `cluster data directory must be an absolute path containing "aicaa-e2e", received "${pgData}"`,
    );
  }
}
