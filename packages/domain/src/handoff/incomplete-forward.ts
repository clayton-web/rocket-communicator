import { categoryForHandoffCode, handoffFail, handoffOk, type HandoffResult } from './failures.js';
import type { HandoffDeliveryPath } from './types.js';

/**
 * Preflight facts supplied after attempting to assemble a Gmail forward (D088 / D042).
 * Domain does not fetch Gmail; it only decides from supplied results.
 */
export interface GmailForwardPreflightFacts {
  originalMessageAvailable: boolean;
  /** False when any required attachment cannot be fetched or assembled. */
  allRequiredAttachmentsAvailable: boolean;
}

export interface IncompleteForwardDecision {
  /** Always false when incomplete — send is prohibited. */
  maySend: boolean;
  /** Retry of the same failed/incomplete attempt remains appropriate. */
  retryEligible: boolean;
  /** Never fall back to attachment-less assignment_email for a gmail_forward path. */
  allowDeliveryPathFallback: false;
}

/**
 * D088 incomplete-forward policy: prohibit send; do not treat failure as path switch permission.
 */
export function evaluateIncompleteForwardPreflight(
  deliveryPath: HandoffDeliveryPath,
  facts: GmailForwardPreflightFacts,
): HandoffResult<IncompleteForwardDecision> {
  if (deliveryPath !== 'gmail_forward') {
    return handoffOk({
      maySend: true,
      retryEligible: true,
      allowDeliveryPathFallback: false,
    });
  }

  const complete = facts.originalMessageAvailable && facts.allRequiredAttachmentsAvailable;

  if (complete) {
    return handoffOk({
      maySend: true,
      retryEligible: true,
      allowDeliveryPathFallback: false,
    });
  }

  return handoffFail(
    'HANDOFF_INCOMPLETE_FORWARD_PROHIBITED',
    categoryForHandoffCode('HANDOFF_INCOMPLETE_FORWARD_PROHIBITED'),
    'Gmail forward cannot be sent because required original message content or attachments are unavailable.',
  );
}

/**
 * Explicit guard: a Gmail-forward failure must not authorize switching to assignment_email.
 */
export function assertNoDeliveryPathFallbackOnForwardFailure(
  selectedPath: HandoffDeliveryPath,
  proposedFallbackPath: HandoffDeliveryPath | undefined,
): HandoffResult<void> {
  if (
    selectedPath === 'gmail_forward' &&
    proposedFallbackPath !== undefined &&
    proposedFallbackPath !== 'gmail_forward'
  ) {
    return handoffFail(
      'HANDOFF_INCOMPLETE_FORWARD_PROHIBITED',
      categoryForHandoffCode('HANDOFF_INCOMPLETE_FORWARD_PROHIBITED'),
      'Incomplete or failed Gmail forward must not fall back to assignment email.',
    );
  }
  return handoffOk(undefined);
}
