#!/usr/bin/env node
/**
 * Local Next.js launcher for the P1.2 harness (D119).
 *
 * Owns the `next dev` child and the redacting log capture as one process tree so that when
 * Playwright stops the configured `webServer`, both die. A plain shell pipe
 * (`next | redact-stream`) leaves `next` orphaned on SIGTERM to the pipe head, which then
 * holds the app port and breaks the next run with EADDRINUSE.
 *
 * Usage: node e2e/scripts/run-web-server.mjs <port> <logFile>
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

const port = process.argv[2];
const logFile = process.argv[3];

if (!port || !logFile) {
  process.stderr.write('Usage: node run-web-server.mjs <port> <logFile>\n');
  process.exit(2);
}

fs.mkdirSync(path.dirname(path.resolve(logFile)), { recursive: true });

const REDACTIONS = [
  [/\/c\/[A-Za-z0-9_-]{8,}/g, '/c/[redacted]'],
  [/\/api\/v1\/capabilities\/[A-Za-z0-9_-]{8,}/g, '/api/v1/capabilities/[redacted]'],
];

function redact(line) {
  return REDACTIONS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    line,
  );
}

const sink = fs.createWriteStream(logFile, { flags: 'a' });

const child = spawn(
  'pnpm',
  ['exec', 'next', 'dev', '--port', String(port), '--hostname', '127.0.0.1'],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  },
);

function forward(stream) {
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  lines.on('line', (line) => {
    const safe = redact(line);
    process.stdout.write(`${safe}\n`);
    sink.write(`${safe}\n`);
  });
}

forward(child.stdout);
forward(child.stderr);

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  try {
    child.kill(signal);
  } catch {
    // Child may already be gone.
  }
  // Escalate if the child ignores the first signal (Next sometimes needs a moment).
  setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }, 3_000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => shutdown(signal));
}

child.on('exit', (code, signal) => {
  sink.end();
  if (signal) {
    process.exit(signal === 'SIGTERM' ? 0 : 1);
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  process.stderr.write(`Failed to start next dev: ${error.message}\n`);
  sink.end();
  process.exit(1);
});
