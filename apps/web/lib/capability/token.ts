import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Opaque token entropy in bytes (256-bit). */
export const CAPABILITY_TOKEN_BYTES = 32;

/** HMAC-SHA256 hex digest length. */
export const CAPABILITY_TOKEN_HASH_HEX_LENGTH = 64;

/**
 * Generate a high-entropy opaque capability token (URL-safe base64url, no padding).
 * Does not embed task, email, scope, or expiry claims.
 */
export function generateCapabilityToken(random: () => Buffer = defaultRandom): string {
  const bytes = random();
  if (bytes.length < CAPABILITY_TOKEN_BYTES) {
    throw new Error('Capability token generator produced insufficient entropy.');
  }
  return bytes.subarray(0, CAPABILITY_TOKEN_BYTES).toString('base64url');
}

function defaultRandom(): Buffer {
  return randomBytes(CAPABILITY_TOKEN_BYTES);
}

/**
 * Deterministic lookup fingerprint: HMAC-SHA256(pepper, rawToken) as lowercase hex.
 * A database-only leak without the pepper does not permit offline verification of guesses.
 */
export function hashCapabilityToken(rawToken: string, pepper: string): string {
  if (!rawToken) {
    throw new Error('Raw capability token is required for hashing.');
  }
  if (!pepper) {
    throw new Error('Capability token pepper is required for hashing.');
  }
  return createHmac('sha256', pepper).update(rawToken, 'utf8').digest('hex');
}

/** Constant-time equality for equal-length digests/strings. */
export function capabilitySecretsEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
