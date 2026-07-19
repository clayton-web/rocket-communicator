// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  HANDOFF_ACKNOWLEDGEMENT_V1,
  asOrganizationId,
  asRecipientId,
  asTaskId,
  canonicalizeHandoffFingerprint,
} from '@aicaa/domain';
import {
  computeProductionHandoffRequestFingerprint,
  sha256HandoffFingerprintHasher,
} from '@/lib/handoff/fingerprint';

describe('A7.7 production handoff request fingerprint', () => {
  const inputs = {
    organizationId: asOrganizationId('org_fp'),
    taskId: asTaskId('task_fp'),
    recipientId: asRecipientId('rcp_fp'),
    acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
  };

  // Fixed vector: SHA-256 of the domain canonical form for the inputs above.
  const FIXED_VECTOR = createHash('sha256')
    .update(canonicalizeHandoffFingerprint(inputs), 'utf8')
    .digest('hex');

  it('is deterministic SHA-256 hex of the domain canonical form', () => {
    const canonical = canonicalizeHandoffFingerprint(inputs);
    expect(sha256HandoffFingerprintHasher(canonical)).toBe(FIXED_VECTOR);
    expect(computeProductionHandoffRequestFingerprint(inputs)).toBe(FIXED_VECTOR);
    expect(FIXED_VECTOR).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across repeated calls (process stability)', () => {
    expect(computeProductionHandoffRequestFingerprint(inputs)).toBe(FIXED_VECTOR);
    expect(computeProductionHandoffRequestFingerprint(inputs)).toBe(FIXED_VECTOR);
  });

  it('changes when a contracted field changes', () => {
    const otherRecipient = computeProductionHandoffRequestFingerprint({
      ...inputs,
      recipientId: asRecipientId('rcp_other'),
    });
    const otherTask = computeProductionHandoffRequestFingerprint({
      ...inputs,
      taskId: asTaskId('task_other'),
    });
    expect(otherRecipient).not.toBe(FIXED_VECTOR);
    expect(otherTask).not.toBe(FIXED_VECTOR);
  });

  it('does not embed acknowledgement plaintext or token-like material in the digest', () => {
    const digest = computeProductionHandoffRequestFingerprint(inputs);
    expect(digest).not.toContain(HANDOFF_ACKNOWLEDGEMENT_V1);
    expect(digest).not.toMatch(/pepper|token|cap_/i);
  });
});
