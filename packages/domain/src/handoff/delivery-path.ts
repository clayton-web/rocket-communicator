import type { SourceReference } from '../value-objects/source-reference.js';
import type { HandoffDeliveryPath } from './types.js';
import { categoryForHandoffCode, handoffFail, type HandoffResult } from './failures.js';

/**
 * Whether Task source metadata indicates a Gmail-origin communication (D090, D094).
 * Ambiguous / incomplete Gmail metadata still selects `gmail_forward`; source usability
 * is evaluated separately via Gmail prerequisite / incomplete-forward policies.
 */
export function isGmailOriginSource(sourceReference: SourceReference | undefined): boolean {
  return sourceReference?.sourceType === 'gmail';
}

/**
 * Server-selected delivery path. Clients must not supply or override this choice.
 *
 * Rules:
 * - `sourceType === 'gmail'` → `gmail_forward` (even if external message ids are incomplete)
 * - otherwise (manual, voice, other providers, missing source) → `assignment_email`
 */
export function selectHandoffDeliveryPath(
  sourceReference: SourceReference | undefined,
): HandoffDeliveryPath {
  return isGmailOriginSource(sourceReference) ? 'gmail_forward' : 'assignment_email';
}

/**
 * Reject any client-supplied delivery path field (defence in depth).
 * Legitimate requests omit the field entirely.
 */
export function rejectClientDeliveryPathOverride(clientDeliveryPath: unknown): HandoffResult<void> {
  if (clientDeliveryPath !== undefined) {
    return handoffFail(
      'VALIDATION_ERROR',
      categoryForHandoffCode('VALIDATION_ERROR'),
      'Delivery path is server-selected and must not be supplied by the client.',
      [{ field: 'deliveryPath', message: 'Must not be supplied' }],
    );
  }
  return { ok: true, value: undefined };
}

/**
 * Exact Gmail message identifier types the trusted A7 forward path may resolve.
 *
 * `message_id` is the canonical A5/A7 contract written by suggestion processing.
 * `message` is the Review-era synonym written by D179 `buildGmailSourceReference`.
 * Both store `CommunicationEvent.providerMessageId`, which is Gmail's
 * `users.messages.get` id (`raw.id`). `thread` is conversation identity only and is
 * never an exact-message identifier.
 */
const EXACT_GMAIL_MESSAGE_ID_TYPES = new Set(['message_id', 'message']);

function isExactGmailMessageIdentifier(identifier: {
  provider: string;
  idType: string;
  id: string;
}): boolean {
  return (
    identifier.provider === 'gmail' &&
    EXACT_GMAIL_MESSAGE_ID_TYPES.has(identifier.idType) &&
    identifier.id.trim().length > 0
  );
}

/**
 * Exact Gmail provider message id from a trusted Task/source reference, if present.
 *
 * Prefers canonical `message_id` when both synonyms exist. Never falls back to a
 * thread id or another message in the thread.
 */
export function findExactGmailMessageId(
  sourceReference: SourceReference | undefined,
): string | undefined {
  if (!isGmailOriginSource(sourceReference) || !sourceReference) {
    return undefined;
  }
  const ids = sourceReference.externalIds ?? [];
  const canonical = ids.find(
    (identifier) => identifier.idType === 'message_id' && isExactGmailMessageIdentifier(identifier),
  );
  if (canonical) {
    return canonical.id.trim();
  }
  const reviewEra = ids.find(
    (identifier) => identifier.idType === 'message' && isExactGmailMessageIdentifier(identifier),
  );
  return reviewEra?.id.trim();
}

/**
 * True when Gmail-origin source identifiers are present enough to attempt a forward.
 *
 * Agrees with the trusted forward-source resolver: a non-empty exact message
 * identifier (`message_id` or Review-era `message`) is required. A thread id alone
 * is not usable. Missing ids do not change the selected path; they block send via
 * GMAIL_SOURCE_UNAVAILABLE.
 */
export function hasUsableGmailSourceIdentifiers(
  sourceReference: SourceReference | undefined,
): boolean {
  return findExactGmailMessageId(sourceReference) != null;
}
