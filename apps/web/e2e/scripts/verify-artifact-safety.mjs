#!/usr/bin/env node
/**
 * Post-run capability-secret sweep for retained harness artifacts (D114, D119).
 *
 * Runs from the Playwright global teardown, so it executes on pass AND on failure — failure
 * is precisely when artifacts are retained. It is also runnable by hand:
 *   node e2e/scripts/verify-artifact-safety.mjs [artifactDir]
 *
 * Three detections, all failing closed:
 *  1. Known capability path shapes (`/c/{token}`, `/api/v1/capabilities/{token}`).
 *  2. BARE tokens, matched against SHA-256 fingerprints recorded by the fixtures at mint
 *     time. This is what catches a token that reached an artifact without a path prefix —
 *     for example inside a Playwright assertion message or `error-context.md`.
 *  3. Archives, which cannot be inspected without decompression. The harness keeps
 *     `trace: 'off'` so none should exist; any archive is reported as unverifiable.
 *
 * Opaque base64 payloads (for example an HTML report's embedded zip) are never path-matched
 * or scrubbed in place: the base64 alphabet freely forms `/c/...` substrings, and scrubbing
 * them corrupts the payload. Those regions are fingerprint-scanned after decoding only.
 *
 * Unreadable files are reported, never skipped: a scan error must not look like a pass.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ARCHIVE_EXTENSIONS,
  CAPABILITY_REDACTIONS,
  FINGERPRINT_FILE,
  TOKEN_CANDIDATE,
} from '../support/capability-secrets.mjs';

const ROOT = path.resolve(process.argv[2] ?? 'e2e/.artifacts');
const FINGERPRINT_PATH = path.join(ROOT, FINGERPRINT_FILE);

/** Data-URI payloads whose alphabet can accidentally look like a capability path. */
const OPAQUE_DATA_URI = /data:application\/(?:zip|octet-stream);base64,([A-Za-z0-9+/=\s]+)/gi;

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** SHA-256 digests of tokens minted during this run. Hashes only; never the raw secret. */
function loadFingerprints() {
  if (!fs.existsSync(FINGERPRINT_PATH)) {
    return new Set();
  }
  return new Set(
    fs
      .readFileSync(FINGERPRINT_PATH, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Percent-decode in place, tolerating malformed escapes.
 *
 * A token inside a URL arrives as `%2Fc%2F<token>`, where the `%` characters split the token
 * away from its surrounding path. Decoding the whole text first is what lets the candidate
 * scan below see the token as one contiguous run.
 */
function percentDecoded(text) {
  return text.replace(/%[0-9A-Fa-f]{2}/g, (escape) =>
    String.fromCharCode(Number.parseInt(escape.slice(1), 16)),
  );
}

/** True when `text` contains a substring whose fingerprint was recorded this run. */
function containsFingerprintedToken(text, fingerprints) {
  if (fingerprints.size === 0) {
    return false;
  }
  const variants = text.includes('%') ? [text, percentDecoded(text)] : [text];
  for (const variant of variants) {
    for (const candidate of variant.matchAll(TOKEN_CANDIDATE)) {
      if (fingerprints.has(digest(candidate[0]))) {
        return true;
      }
    }
  }
  return false;
}

function containsCapabilityPath(text) {
  return CAPABILITY_REDACTIONS.some(({ pattern }) => new RegExp(pattern.source).test(text));
}

/**
 * Split a file into path-scannable text and opaque base64 payloads.
 *
 * Path-pattern matching and in-place scrubbing apply only to the scannable text. Opaque
 * payloads are decoded and fingerprint-scanned; they are never scrubbed in place.
 */
function splitOpaquePayloads(contents) {
  const opaque = [];
  const scannable = contents.replace(OPAQUE_DATA_URI, (_match, base64) => {
    opaque.push(String(base64).replace(/\s+/g, ''));
    return '[opaque-binary-payload]';
  });
  return { scannable, opaque };
}

const fingerprints = loadFingerprints();
const files = walk(ROOT).filter((file) => path.basename(file) !== FINGERPRINT_FILE);
const offenders = [];
let scrubbedAny = false;

for (const file of files) {
  const relative = path.relative(ROOT, file);

  if (ARCHIVE_EXTENSIONS.includes(path.extname(file).toLowerCase())) {
    offenders.push({
      file: relative,
      kind: 'unverifiable archive (harness policy keeps trace/video off)',
    });
    continue;
  }

  // A token must never appear in a path either.
  if (containsFingerprintedToken(relative, fingerprints)) {
    offenders.push({ file: relative, kind: 'raw token in filename' });
    continue;
  }
  if (containsCapabilityPath(relative)) {
    offenders.push({ file: relative, kind: 'capability path in filename' });
    continue;
  }

  let contents;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch (error) {
    offenders.push({
      file: relative,
      kind: `unreadable, absence cannot be proven (${error instanceof Error ? error.message : String(error)})`,
    });
    continue;
  }

  const { scannable, opaque } = splitOpaquePayloads(contents);

  if (containsFingerprintedToken(scannable, fingerprints)) {
    offenders.push({ file: relative, kind: 'raw capability token in contents' });
  }

  for (const [index, base64] of opaque.entries()) {
    let decoded;
    try {
      decoded = Buffer.from(base64, 'base64').toString('latin1');
    } catch (error) {
      offenders.push({
        file: relative,
        kind: `opaque payload #${index + 1} unreadable (${error instanceof Error ? error.message : String(error)})`,
      });
      continue;
    }
    // Fingerprint only: path-pattern matching on opaque bytes false-positives on base64/zip
    // entropy and must not drive in-place scrubbing.
    if (containsFingerprintedToken(decoded, fingerprints)) {
      offenders.push({
        file: relative,
        kind: `raw capability token inside opaque payload #${index + 1}`,
      });
    }
  }

  // Scrub capability paths only in non-opaque regions. Never rewrite base64 payloads in place:
  // their alphabet freely forms `/c/...` substrings, and replacing those corrupts the archive.
  let cursor = 0;
  let rebuilt = '';
  let changed = false;
  contents.replace(OPAQUE_DATA_URI, (match, _b64, offset) => {
    const slice = contents.slice(cursor, offset);
    let redactedSlice = slice;
    for (const { pattern, replacement } of CAPABILITY_REDACTIONS) {
      redactedSlice = redactedSlice.replace(new RegExp(pattern.source, pattern.flags), replacement);
    }
    if (redactedSlice !== slice) {
      changed = true;
    }
    rebuilt += redactedSlice + match;
    cursor = offset + match.length;
    return match;
  });
  const tail = contents.slice(cursor);
  let redactedTail = tail;
  for (const { pattern, replacement } of CAPABILITY_REDACTIONS) {
    redactedTail = redactedTail.replace(new RegExp(pattern.source, pattern.flags), replacement);
  }
  if (redactedTail !== tail) {
    changed = true;
  }
  rebuilt += redactedTail;

  if (changed) {
    fs.writeFileSync(file, rebuilt);
    scrubbedAny = true;
    offenders.push({ file: relative, kind: 'capability path in contents (scrubbed in place)' });
  }
}

if (offenders.length === 0) {
  const detail =
    fingerprints.size > 0
      ? `${files.length} retained artifact(s) scanned against ${fingerprints.size} token fingerprint(s)`
      : `${files.length} retained artifact(s) scanned (no capability token was minted this run)`;
  process.stdout.write(
    `Capability-secret sweep passed: ${detail}, no raw capability secret found.\n`,
  );
  process.exit(0);
}

process.stderr.write('Capability-secret sweep FAILED. Unsafe retained artifacts:\n');
for (const offender of offenders) {
  process.stderr.write(`  ${offender.file} — ${offender.kind}\n`);
}
process.stderr.write(
  [
    '',
    'Do not share these artifacts. Delete e2e/.artifacts and investigate:',
    ' - capability specs must keep trace/screenshot/video disabled;',
    ' - assertions must never take a raw token as an expected value;',
    scrubbedAny
      ? ' - some files were scrubbed in place, but the leak path must still be fixed.'
      : '',
    'A deliberate `--trace on` debugging run is expected to trip the archive check.',
    '',
  ]
    .filter(Boolean)
    .join('\n'),
);
process.exit(1);
