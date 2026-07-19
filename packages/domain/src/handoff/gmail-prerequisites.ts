import type { HandoffDeliveryPath } from './types.js';
import { hasUsableGmailSourceIdentifiers } from './delivery-path.js';
import type { SourceReference } from '../value-objects/source-reference.js';
import { categoryForHandoffCode, handoffFail, handoffOk, type HandoffResult } from './failures.js';

/**
 * Supplied Gmail-connection facts for pure prerequisite evaluation (D093, D094).
 * Domain does not perform OAuth or API calls.
 */
export interface GmailConnectionFacts {
  /** Whether an Owner Gmail connection row exists in a usable connected state. */
  connected: boolean;
  /** Whether the connection can read mailbox content (gmail.readonly). */
  canRead: boolean;
  /** Whether the connection can send (gmail.send). */
  canSend: boolean;
  /** Explicit re-consent needed for send (missing/insufficient send scope). */
  requiresSendReconsent: boolean;
}

export interface GmailPrerequisiteInput {
  deliveryPath: HandoffDeliveryPath;
  connection: GmailConnectionFacts;
  sourceReference?: SourceReference;
}

export interface GmailPrerequisiteOk {
  deliveryPath: HandoffDeliveryPath;
}

/**
 * Both delivery paths require Owner Gmail because D094 sends all A7 mail via Owner Gmail.
 * - Missing connection → GMAIL_NOT_CONNECTED (retryable dependency)
 * - Missing send / requiresSendReconsent → GMAIL_SEND_SCOPE_REQUIRED
 * - gmail_forward additionally requires readable access + usable source identifiers
 * - assignment_email does not require a Gmail source message
 */
export function evaluateGmailHandoffPrerequisites(
  input: GmailPrerequisiteInput,
): HandoffResult<GmailPrerequisiteOk> {
  if (!input.connection.connected) {
    return handoffFail(
      'GMAIL_NOT_CONNECTED',
      categoryForHandoffCode('GMAIL_NOT_CONNECTED'),
      'Owner Gmail must be connected before handoff delivery.',
    );
  }

  if (!input.connection.canSend || input.connection.requiresSendReconsent) {
    return handoffFail(
      'GMAIL_SEND_SCOPE_REQUIRED',
      categoryForHandoffCode('GMAIL_SEND_SCOPE_REQUIRED'),
      'Owner Gmail send authorization is required for handoff delivery.',
    );
  }

  if (input.deliveryPath === 'gmail_forward') {
    if (!input.connection.canRead) {
      return handoffFail(
        'GMAIL_SOURCE_UNAVAILABLE',
        categoryForHandoffCode('GMAIL_SOURCE_UNAVAILABLE'),
        'Gmail source content is not readable for forward delivery.',
      );
    }
    if (!hasUsableGmailSourceIdentifiers(input.sourceReference)) {
      return handoffFail(
        'GMAIL_SOURCE_UNAVAILABLE',
        categoryForHandoffCode('GMAIL_SOURCE_UNAVAILABLE'),
        'Gmail source identifiers are missing or incomplete for forward delivery.',
      );
    }
  }

  return handoffOk({ deliveryPath: input.deliveryPath });
}
