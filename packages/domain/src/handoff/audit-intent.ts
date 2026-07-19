import type { HandoffAuditIntent, HandoffAuditIntentType } from './types.js';

const FORBIDDEN_AUDIT_KEYS = [
  'token',
  'secret',
  'mime',
  'body',
  'oauth',
  'password',
  'rawProviderError',
  'attachmentBytes',
  'messageBody',
] as const;

/**
 * Ensure audit intents stay privacy-safe for later persistence.
 * Rejects objects that embed known sensitive key names or oversized free text.
 */
export function assertHandoffAuditIntentIsPrivacySafe(intent: HandoffAuditIntent): void {
  const json = JSON.stringify(intent);
  for (const key of FORBIDDEN_AUDIT_KEYS) {
    if (json.toLowerCase().includes(`"${key.toLowerCase()}"`)) {
      throw new Error(`Handoff audit intent must not include sensitive field: ${key}`);
    }
  }
  // Opaque provider message ids are allowed as short identifiers only.
  if (intent.providerMessageId && intent.providerMessageId.length > 256) {
    throw new Error('providerMessageId in audit intent exceeds safe length.');
  }
}

export function isHandoffAuditIntentType(value: string): value is HandoffAuditIntentType {
  return (
    value === 'handoff_confirmed' ||
    value === 'handoff_attempt_created' ||
    value === 'delivery_accepted' ||
    value === 'delivery_failed' ||
    value === 'retry_requested' ||
    value === 'explicit_reforward_requested' ||
    value === 'reassignment_requested' ||
    value === 'capability_superseded' ||
    value === 'recipient_deactivated'
  );
}
