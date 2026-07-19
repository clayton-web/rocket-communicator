import type { HandoffFingerprintHasher, HandoffFingerprintInputs } from './types.js';

/**
 * Deterministic canonical fingerprint representation (D094).
 *
 * Includes only stable security-relevant inputs:
 * - organizationId, taskId, recipientId, acknowledgement
 *
 * Excluded intentionally:
 * - timestamps, Task version / If-Match (concurrency is evaluated separately),
 * - generated capability token, provider message id, delivery status,
 * - display names, summary text, MIME, OAuth tokens
 */
export function canonicalizeHandoffFingerprint(inputs: HandoffFingerprintInputs): string {
  return [
    `acknowledgement=${inputs.acknowledgement}`,
    `organizationId=${inputs.organizationId}`,
    `recipientId=${inputs.recipientId}`,
    `taskId=${inputs.taskId}`,
  ].join('\n');
}

/**
 * Compute a fingerprint hash using an injectable hasher (no DB / env crypto in domain).
 */
export function computeHandoffRequestFingerprint(
  inputs: HandoffFingerprintInputs,
  hash: HandoffFingerprintHasher,
): string {
  return hash(canonicalizeHandoffFingerprint(inputs));
}

/** Test/dev helper: returns the canonical string unchanged (not for production secrets). */
export function identityHandoffFingerprintHasher(canonicalUtf8: string): string {
  return canonicalUtf8;
}
