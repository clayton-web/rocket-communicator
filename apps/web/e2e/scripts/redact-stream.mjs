#!/usr/bin/env node
/**
 * Redacting log capture for the P1.2 browser harness (D114, D119).
 *
 * Replaces `tee` when capturing the local application's stdout. The application's own
 * structured diagnostics only ever record route templates, but the framework's dev-server
 * request logger prints raw request URLs — which for a capability route contains the token.
 * Retained harness artifacts must never hold that value, so it is stripped at capture time
 * rather than after the fact.
 *
 * Usage: <producer> 2>&1 | node e2e/scripts/redact-stream.mjs <logFile>
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const logFile = process.argv[2];
if (!logFile) {
  process.stderr.write('redact-stream.mjs requires a log file path.\n');
  process.exit(2);
}

// The capture may start before global setup, so own the directory here too.
fs.mkdirSync(path.dirname(path.resolve(logFile)), { recursive: true });

const REDACTIONS = [
  // Recipient capability page: /c/{token}
  [/\/c\/[A-Za-z0-9_-]{8,}/g, '/c/[redacted]'],
  // Recipient capability API: /api/v1/capabilities/{token}/...
  [/\/api\/v1\/capabilities\/[A-Za-z0-9_-]{8,}/g, '/api/v1/capabilities/[redacted]'],
];

function redact(line) {
  return REDACTIONS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    line,
  );
}

const sink = fs.createWriteStream(logFile, { flags: 'a' });
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

input.on('line', (line) => {
  const safe = redact(line);
  process.stdout.write(`${safe}\n`);
  sink.write(`${safe}\n`);
});

input.on('close', () => {
  sink.end();
});
