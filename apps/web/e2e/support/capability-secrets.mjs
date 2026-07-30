/**
 * Shared capability-secret constants for the P1.2 harness (D114, D119).
 *
 * Plain `.mjs` so the TypeScript support helpers and the standalone post-run sweep script
 * use one definition of "what a capability secret looks like" instead of drifting patterns.
 */

/**
 * Every path shape that carries a raw capability token, with the literal each is replaced by.
 * The replacements are deliberately bracketed so an approved template such as `/c/[redacted]`
 * or `/c/[token]` can never be mistaken for a secret by the sweep.
 */
export const CAPABILITY_REDACTIONS = [
  { pattern: /\/c\/[A-Za-z0-9_-]{16,}/g, replacement: '/c/[redacted]' },
  {
    pattern: /\/api\/v1\/capabilities\/[A-Za-z0-9_-]{16,}/g,
    replacement: '/api/v1/capabilities/[redacted]',
  },
];

/**
 * Token-shaped candidate for fingerprint matching. Capability tokens are URL-safe base64,
 * so any sufficiently long run of that alphabet is worth hashing and checking.
 */
export const TOKEN_CANDIDATE = /[A-Za-z0-9_-]{16,}/g;

/** Fingerprint sidecar (SHA-256 digests only, never raw tokens), relative to the artifact root. */
export const FINGERPRINT_FILE = '.capability-fingerprints';

/**
 * Archive extensions the sweep cannot inspect without decompressing. The harness keeps
 * `trace: 'off'` so none should ever be retained; the sweep treats any as unverifiable.
 */
export const ARCHIVE_EXTENSIONS = ['.zip', '.gz', '.tar', '.tgz', '.br', '.webm'];
