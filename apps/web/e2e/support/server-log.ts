import fs from 'node:fs';
import path from 'node:path';
import { SERVER_LOG_PATH } from '../config/e2e-env';

/**
 * Access to the local application's captured stdout, which carries the P1.1 structured
 * diagnostic seam (D113/D114). This is a controlled local log capture, not a new telemetry
 * system, and never a platform-specific production log.
 */

const LOG_PATH = path.resolve(__dirname, '../..', SERVER_LOG_PATH);

export function readServerLog(): string {
  return fs.existsSync(LOG_PATH) ? fs.readFileSync(LOG_PATH, 'utf8') : '';
}

/**
 * P1.1 structured diagnostic lines only.
 *
 * The framework's own dev-server request logger prints raw request URLs on adjacent lines,
 * which is outside the application's diagnostic seam. Scoping assertions to structured events
 * is what makes the capability-path guarantee meaningful rather than accidental.
 *
 * Each candidate is parsed as JSON and must carry a string `event` field, so unparseable
 * output — or an arbitrary line that merely looks JSON-ish — is never mistaken for an
 * operational record.
 */
export function structuredEventLines(): string[] {
  return readServerLog()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line.startsWith('{')) {
        return false;
      }
      try {
        const parsed: unknown = JSON.parse(line);
        return (
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as { event?: unknown }).event === 'string'
        );
      } catch {
        // Malformed or truncated output is not a diagnostic record.
        return false;
      }
    });
}

/** Structured diagnostics flush asynchronously; poll briefly for a given request id. */
export async function waitForStructuredLines(
  requestId: string,
  timeoutMs = 10_000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const lines = structuredEventLines().filter((line) => line.includes(requestId));
    if (lines.length > 0 || Date.now() >= deadline) {
      return lines;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
