import 'server-only';
import { createHash } from 'node:crypto';
import { computeHandoffRequestFingerprint, type HandoffFingerprintInputs } from '@aicaa/domain';

/**
 * Production request-fingerprint hasher (A7.7 / D094).
 *
 * Deterministic SHA-256 (hex) of the domain canonical fingerprint string. The canonical string is
 * built by {@link canonicalizeHandoffFingerprint} from ONLY the stable contracted security inputs
 * (organizationId, taskId, recipientId, acknowledgement). This hasher therefore is:
 *
 *  - deterministic and stable across processes/deployments (pure SHA-256, no salt/pepper/env);
 *  - non-reversible in ordinary use (one-way digest);
 *  - free of raw token material, timestamps, and the current Task version.
 *
 * The capability-token pepper is intentionally NOT used: the fingerprint is an idempotency-scoping
 * value, not a capability secret, and must stay stable regardless of pepper rotation. The canonical
 * raw input is never logged.
 */
export function sha256HandoffFingerprintHasher(canonicalUtf8: string): string {
  return createHash('sha256').update(canonicalUtf8, 'utf8').digest('hex');
}

/** Compute the production handoff request fingerprint (SHA-256 over the domain canonical form). */
export function computeProductionHandoffRequestFingerprint(
  inputs: HandoffFingerprintInputs,
): string {
  return computeHandoffRequestFingerprint(inputs, sha256HandoffFingerprintHasher);
}
