import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

/** RFC 7636 code challenge method. Only S256 is used; `plain` is never permitted. */
export const PKCE_CODE_CHALLENGE_METHOD = 'S256' as const;

/**
 * Cryptographically strong OAuth `state` (≥256 bits of entropy).
 * Returned only in the Google authorization redirect — never persisted raw.
 */
export function generateStateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Deterministic SHA-256 hex digest of the raw OAuth state.
 * Only this hash is persisted; lookup/consume uses the hash of the callback `state`.
 */
export function hashOAuthState(rawState: string): string {
  return createHash('sha256').update(rawState, 'utf8').digest('hex');
}

/** RFC 7636 code verifier (43 chars from 32 random bytes; within the 43–128 range). */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** S256 challenge = base64url(SHA-256(verifier)). */
export function computeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
