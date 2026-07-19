import 'server-only';
import {
  categoryForHandoffCode,
  evaluateGmailHandoffPrerequisites,
  handoffFail,
  handoffOk,
  type GmailConnectionFacts,
  type HandoffDeliveryPath,
  type HandoffResult,
  type SourceReference,
} from '@aicaa/domain';
import { deriveGmailConnectionFacts } from './scopes';

/**
 * A7.4 server-side send-capability prerequisite check.
 *
 * Distinguishes the three states the Owner UI / orchestration must act on:
 *   - not connected                → GMAIL_NOT_CONNECTED    (retryable_dependency)
 *   - connected, gmail.send missing → GMAIL_SEND_SCOPE_REQUIRED (authorization) + requiresSendReconsent
 *   - connected + gmail.send        → ok
 *
 * The decision is pure and delegates to the domain policy (`evaluateGmailHandoffPrerequisites`) so
 * transport never re-implements handoff rules. It maps a raw absence of scope to the approved
 * typed A7 prerequisite failure — never a raw Google error.
 */
export type GmailSendCapabilityState = 'send_available' | 'not_connected' | 'send_scope_required';

export interface GmailSendCapabilityResult {
  state: GmailSendCapabilityState;
  facts: GmailConnectionFacts;
  /** Typed prerequisite result; `ok:false` carries the approved A7 failure code. */
  prerequisite: HandoffResult<{ deliveryPath: HandoffDeliveryPath }>;
}

/**
 * Evaluate send capability from already-derived connection facts. Uses `assignment_email` as the
 * neutral delivery path so this reflects pure send readiness independent of a Gmail source.
 */
export function evaluateGmailSendCapability(
  facts: GmailConnectionFacts,
): GmailSendCapabilityResult {
  const prerequisite = evaluateGmailHandoffPrerequisites({
    deliveryPath: 'assignment_email',
    connection: facts,
  });

  let state: GmailSendCapabilityState;
  if (!facts.connected) {
    state = 'not_connected';
  } else if (!facts.canSend || facts.requiresSendReconsent) {
    state = 'send_scope_required';
  } else {
    state = 'send_available';
  }

  return { state, facts, prerequisite };
}

/**
 * Evaluate send capability directly from the stored connection state + raw granted-scope string.
 * Convenience wrapper used by callers that have loaded the account + credential row.
 */
export function evaluateGmailSendCapabilityFromStored(input: {
  connected: boolean;
  grantedScopes: string | null | undefined;
}): GmailSendCapabilityResult {
  return evaluateGmailSendCapability(deriveGmailConnectionFacts(input));
}

/**
 * Full forward/assignment prerequisite evaluation for a specific delivery path, including source
 * identifiers for `gmail_forward`. Thin passthrough kept in the transport layer so orchestration
 * has a single import surface. Returns the approved typed failure for missing source/read/send.
 */
export function evaluateGmailDeliveryPrerequisites(input: {
  deliveryPath: HandoffDeliveryPath;
  facts: GmailConnectionFacts;
  sourceReference?: SourceReference;
}): HandoffResult<{ deliveryPath: HandoffDeliveryPath }> {
  return evaluateGmailHandoffPrerequisites({
    deliveryPath: input.deliveryPath,
    connection: input.facts,
    sourceReference: input.sourceReference,
  });
}

/** Explicit not-connected failure helper (kept for callers that only have an absence of a row). */
export function gmailNotConnectedFailure(): HandoffResult<never> {
  return handoffFail(
    'GMAIL_NOT_CONNECTED',
    categoryForHandoffCode('GMAIL_NOT_CONNECTED'),
    'Owner Gmail must be connected before handoff delivery.',
  );
}

/** Neutral ok helper mirroring domain result algebra for callers that build their own results. */
export function gmailSendReady(
  deliveryPath: HandoffDeliveryPath,
): HandoffResult<{ deliveryPath: HandoffDeliveryPath }> {
  return handoffOk({ deliveryPath });
}
