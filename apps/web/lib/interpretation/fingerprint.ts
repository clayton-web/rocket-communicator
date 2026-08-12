import 'server-only';
import { createHash } from 'node:crypto';

export interface InterpretationFingerprintInputs {
  organizationId: string;
  sourceKind: string;
  rawInput: string;
  capturedAt: string | null;
  timezone: string | null;
}

/**
 * Canonical form of an interpretation request, built from the fields that decide what would be
 * interpreted. Field values are JSON-encoded so captured text containing newlines or `=` cannot
 * impersonate another field, and keys are emitted in a fixed order so equal requests canonicalize
 * identically regardless of object construction order.
 *
 * This mirrors `canonicalizeHandoffFingerprint` (D094) but stays in the application layer: the only
 * field that is not an identifier is the Owner's raw capture text, which must not travel further
 * than the interpretation service and its provider call.
 */
export function canonicalizeInterpretationRequest(inputs: InterpretationFingerprintInputs): string {
  return [
    `capturedAt=${JSON.stringify(inputs.capturedAt)}`,
    `organizationId=${JSON.stringify(inputs.organizationId)}`,
    `rawInput=${JSON.stringify(inputs.rawInput)}`,
    `sourceKind=${JSON.stringify(inputs.sourceKind)}`,
    `timezone=${JSON.stringify(inputs.timezone)}`,
  ].join('\n');
}

/**
 * Deterministic SHA-256 (hex) request fingerprint for InterpretationRun idempotency (D161).
 *
 * The digest is one-way, so binding an idempotency key to the request it was used for does not
 * retain the raw capture text. The canonical raw input is never logged and never persisted.
 */
export function computeInterpretationRequestFingerprint(
  inputs: InterpretationFingerprintInputs,
): string {
  return createHash('sha256')
    .update(canonicalizeInterpretationRequest(inputs), 'utf8')
    .digest('hex');
}

/**
 * Deterministic, bounded dedupe digest for a manual-capture source reference (D169).
 *
 * `SourceReference.dedupeKey` is a published contract field — `maxLength: 128`, documented as an
 * opaque hashed key — so the caller's transport idempotency key cannot be written into it verbatim:
 * a 128-character key plus any kind prefix overflows the contract, and durable canonical state would
 * be republishing a value the caller chose for retry transport. Hashing keeps the field opaque and
 * fixed-width regardless of the key's length.
 *
 * Organization and source kind are part of the digest because an idempotency key only means
 * anything inside them: two organizations that happen to choose the same key describe two different
 * captures and must not deduplicate onto one source.
 */
export function computeManualCaptureSourceDedupeDigest(inputs: {
  organizationId: string;
  sourceKind: string;
  idempotencyKey: string;
}): string {
  const canonical = [
    `idempotencyKey=${JSON.stringify(inputs.idempotencyKey)}`,
    `organizationId=${JSON.stringify(inputs.organizationId)}`,
    `sourceKind=${JSON.stringify(inputs.sourceKind)}`,
  ].join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
