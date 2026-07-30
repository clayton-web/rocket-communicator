import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CAPABILITY_REDACTIONS, FINGERPRINT_FILE } from './capability-secrets.mjs';

/**
 * Capability-secret protection for retained browser artifacts (D114, D119).
 *
 * The harness never writes a raw capability token into a test title, filename, console
 * output, or report. These helpers make that guarantee assertable rather than aspirational.
 */

export const ARTIFACT_ROOT = path.resolve(__dirname, '../.artifacts');

/** Redaction placeholder used whenever a capability path must appear in a message. */
export const REDACTED_CAPABILITY = '/c/[redacted]';

/**
 * Replace every capability-bearing path shape so a value is safe to print or attach.
 * Covers the Recipient page (`/c/{token}`) and the Recipient API
 * (`/api/v1/capabilities/{token}/...`), which a failed-request diagnostic can otherwise
 * record verbatim.
 */
export function redactCapabilityPaths(value: string): string {
  let redacted = value;
  for (const { pattern, replacement } of CAPABILITY_REDACTIONS) {
    redacted = redacted.replace(new RegExp(pattern.source, pattern.flags), replacement);
  }
  return redacted;
}

/**
 * Record a one-way fingerprint of a freshly minted token so the post-run sweep can detect a
 * BARE token anywhere in an artifact, not just one that happens to sit behind a `/c/` prefix.
 *
 * Only the SHA-256 digest is written. The raw secret never reaches disk, so this file is a
 * detection aid rather than a new secret at rest.
 */
export function recordCapabilityTokenFingerprint(rawToken: string): void {
  const digest = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
  const target = path.join(ARTIFACT_ROOT, FINGERPRINT_FILE);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (!existing.split('\n').includes(digest)) {
    fs.appendFileSync(target, `${digest}\n`);
  }
}

/** Recursively collect retained artifact files (reports, screenshots, logs). */
export function listArtifactFiles(root = ARTIFACT_ROOT): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...listArtifactFiles(full));
    } else {
      found.push(full);
    }
  }
  return found;
}

/**
 * Assert a raw token appears in no retained artifact: not in file contents, not in a path.
 * Binary-safe: files are compared as raw bytes. Unreadable files are reported rather than
 * skipped, so a scan error can never look like a pass.
 */
export function assertTokenAbsentFromArtifacts(rawToken: string): {
  scannedFiles: number;
  offenders: string[];
} {
  const files = listArtifactFiles();
  const needle = Buffer.from(rawToken, 'utf8');
  const offenders: string[] = [];

  for (const file of files) {
    if (file.includes(rawToken)) {
      offenders.push(`${path.basename(file)} (filename)`);
      continue;
    }
    let contents: Buffer;
    try {
      contents = fs.readFileSync(file);
    } catch (error) {
      offenders.push(
        `${path.basename(file)} (unreadable, cannot prove absence: ${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      continue;
    }
    if (contents.includes(needle)) {
      offenders.push(`${path.basename(file)} (contents)`);
    }
  }

  return { scannedFiles: files.length, offenders };
}
