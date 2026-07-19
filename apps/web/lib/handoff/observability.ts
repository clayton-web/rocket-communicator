import 'server-only';
import type { HandoffLogRecord, HandoffLogger } from './types';

/**
 * A7.5 privacy-safe observability seam.
 *
 * Every field emitted here is already privacy-safe (stable identifiers, categories, fingerprints, and
 * counters). The record type structurally forbids content: there is no place for OAuth tokens, the
 * capability URL/token, MIME, source body, summary/body text, subject, plaintext recipient email,
 * attachment content, or raw provider errors. Failure fingerprints are non-reversible.
 */

/** No-op logger for tests and callers that wire their own telemetry. */
export const noopHandoffLogger: HandoffLogger = {
  log() {
    /* intentionally empty */
  },
};

/** Default logger emitting one structured JSON line per phase via console.info. */
export function createConsoleHandoffLogger(): HandoffLogger {
  return {
    log(record: HandoffLogRecord): void {
      // The record is structurally content-free; JSON serialization cannot leak sensitive data.
      console.info(JSON.stringify(record));
    },
  };
}
