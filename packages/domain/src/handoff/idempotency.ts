import type { HandoffAttempt, HandoffIdempotencyOutcomeKind, HandoffMode } from './types.js';
import { categoryForHandoffCode, handoffFail, handoffOk, type HandoffResult } from './failures.js';

export interface IdempotencyEvaluationInput {
  idempotencyKey: string;
  requestFingerprint: string;
  /** Existing attempt for this org+task+key, if any (looked up by application). */
  existingAttempt?: HandoffAttempt | null;
}

export interface IdempotencyEvaluation {
  kind: HandoffIdempotencyOutcomeKind;
  mode: HandoffMode;
  existingAttempt?: HandoffAttempt;
}

/**
 * Pure idempotency evaluation (D094).
 *
 * Distinguishes:
 * 1. New request
 * 2. Valid replay of in-progress (pending)
 * 3. Valid retry of failed
 * 4. Valid replay of completed success (sent)
 * 5. Conflicting reuse of a key (fingerprint mismatch)
 * 6. Security-sensitive inputs changed → treated as conflict on same key
 *    (application may start a new attempt only with a new key / explicit re-forward mode)
 *
 * If-Match / Task version are intentionally not part of the fingerprint.
 */
export function evaluateHandoffIdempotency(
  input: IdempotencyEvaluationInput,
): HandoffResult<IdempotencyEvaluation> {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
    return handoffFail(
      'PRECONDITION_REQUIRED',
      categoryForHandoffCode('PRECONDITION_REQUIRED'),
      'Idempotency-Key is required for handoff.',
    );
  }

  const existing = input.existingAttempt ?? null;
  if (!existing) {
    return handoffOk({
      kind: 'new_request',
      mode: 'new_attempt',
    });
  }

  if (existing.idempotencyKey !== input.idempotencyKey) {
    // Caller should only pass attempt for matching key; treat as new if mismatched key.
    return handoffOk({
      kind: 'new_request',
      mode: 'new_attempt',
    });
  }

  if (existing.requestFingerprint !== input.requestFingerprint) {
    return handoffFail(
      'IDEMPOTENCY_KEY_CONFLICT',
      categoryForHandoffCode('IDEMPOTENCY_KEY_CONFLICT'),
      'Idempotency-Key was reused with a conflicting handoff payload.',
    );
  }

  switch (existing.status) {
    case 'pending':
      return handoffOk({
        kind: 'replay_in_progress',
        mode: 'replay_pending',
        existingAttempt: existing,
      });
    case 'failed':
      return handoffOk({
        kind: 'retry_failed',
        mode: 'retry_failed',
        existingAttempt: existing,
      });
    case 'sent':
      return handoffOk({
        kind: 'replay_success',
        mode: 'replay_sent',
        existingAttempt: existing,
      });
    default: {
      const _exhaustive: never = existing.status;
      return _exhaustive;
    }
  }
}

/**
 * When Recipient or acknowledgement (security-sensitive inputs) change under the same key,
 * fingerprint mismatch already yields IDEMPOTENCY_KEY_CONFLICT.
 * For intentional new work after success, callers must use a new idempotency key and
 * explicit re-forward / reassignment mode — never silently convert a retry into a re-forward.
 */
export function classifySecurityInputChangeOnSameKey(input: {
  sameIdempotencyKey: boolean;
  fingerprintMatches: boolean;
}): HandoffIdempotencyOutcomeKind | 'ok' {
  if (!input.sameIdempotencyKey) {
    return 'ok';
  }
  if (!input.fingerprintMatches) {
    return 'key_conflict';
  }
  return 'ok';
}
