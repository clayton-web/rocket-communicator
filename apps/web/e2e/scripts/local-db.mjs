#!/usr/bin/env node
/**
 * Disposable local Postgres for the P1.2 browser harness (D119).
 *
 * Provisions a dedicated cluster on a non-default port so it can never be confused with a
 * developer's primary database, and never with Supabase/production. Requires a local
 * PostgreSQL installation (`initdb`, `pg_ctl`, `createdb`) already present on the machine;
 * it installs nothing.
 *
 * Usage: node e2e/scripts/local-db.mjs <start|stop|reset|status>
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertLocalClusterTarget } from '../config/local-db-guard.mjs';

const PORT = process.env.E2E_PG_PORT ?? '55432';
const DB_NAME = process.env.E2E_PG_DATABASE ?? 'aicaa_e2e';
const SOCKET_DIR = process.env.E2E_PG_SOCKET_DIR ?? '/tmp';
const PGDATA = process.env.E2E_PGDATA ?? path.join(os.homedir(), '.aicaa-e2e-pg');

/**
 * `initdb`, `pg_ctl stop`, and `dropdb` are destructive and take their target from the
 * environment variables above. Validate before any of them runs so an override cannot
 * re-point a destructive command at a developer's real cluster or a remote host — note
 * `dropdb -h` treats a non-absolute value as a TCP hostname.
 */
assertLocalClusterTarget({ socketDir: SOCKET_DIR, database: DB_NAME, port: PORT, pgData: PGDATA });

// initdb refuses to run under some inherited locales; the harness pins a deterministic one.
const ENV = { ...process.env, LC_ALL: 'C', LANG: 'C', PGPORT: PORT, PGHOST: SOCKET_DIR };

function run(command, args, options = {}) {
  return execFileSync(command, args, { env: ENV, encoding: 'utf8', stdio: 'pipe', ...options });
}

function tryRun(command, args) {
  try {
    return { ok: true, output: run(command, args) };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}

function isReady() {
  return tryRun('pg_isready', ['-p', PORT, '-h', SOCKET_DIR]).ok;
}

function start() {
  if (!fs.existsSync(PGDATA)) {
    process.stdout.write(`Initializing disposable cluster at ${PGDATA}\n`);
    run('initdb', [
      '-D',
      PGDATA,
      '-U',
      'postgres',
      '--auth=trust',
      '--locale=C',
      '--encoding=UTF8',
    ]);
  }
  if (!isReady()) {
    run('pg_ctl', [
      '-D',
      PGDATA,
      '-o',
      `-p ${PORT} -k ${SOCKET_DIR}`,
      '-l',
      path.join(PGDATA, 'server.log'),
      'start',
    ]);
    for (let attempt = 0; attempt < 30 && !isReady(); attempt += 1) {
      execFileSync('sleep', ['0.5']);
    }
  }
  if (!isReady()) {
    throw new Error(`Local Postgres did not become ready on port ${PORT}.`);
  }
  const created = tryRun('createdb', ['-p', PORT, '-h', SOCKET_DIR, '-U', 'postgres', DB_NAME]);
  process.stdout.write(
    created.ok
      ? `Created database ${DB_NAME} on port ${PORT}.\n`
      : `Database ${DB_NAME} already present on port ${PORT}.\n`,
  );
  process.stdout.write(
    `DATABASE_URL=postgresql://postgres@127.0.0.1:${PORT}/${DB_NAME}?schema=public\n`,
  );
}

function stop() {
  if (!fs.existsSync(PGDATA)) {
    process.stdout.write('No disposable cluster present.\n');
    return;
  }
  const stopped = tryRun('pg_ctl', ['-D', PGDATA, '-m', 'fast', 'stop']);
  process.stdout.write(stopped.ok ? 'Stopped disposable cluster.\n' : 'Cluster already stopped.\n');
}

/** Drop and recreate the database so every run starts from migrations only. */
function reset() {
  start();
  run('dropdb', ['-p', PORT, '-h', SOCKET_DIR, '-U', 'postgres', '--if-exists', DB_NAME]);
  run('createdb', ['-p', PORT, '-h', SOCKET_DIR, '-U', 'postgres', DB_NAME]);
  process.stdout.write(`Recreated empty database ${DB_NAME}.\n`);
}

function status() {
  process.stdout.write(
    `cluster: ${fs.existsSync(PGDATA) ? PGDATA : 'absent'}\nready: ${isReady()}\nport: ${PORT}\ndatabase: ${DB_NAME}\n`,
  );
}

const action = process.argv[2] ?? 'status';
const actions = { start, stop, reset, status };
if (!Object.hasOwn(actions, action)) {
  process.stderr.write(`Unknown action "${action}". Use start, stop, reset, or status.\n`);
  process.exit(2);
}
actions[action]();
