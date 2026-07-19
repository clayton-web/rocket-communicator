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
 * True when Gmail-origin source identifiers are present enough to attempt a forward.
 * Missing ids do not change the selected path; they block send via GMAIL_SOURCE_UNAVAILABLE.
 */
export function hasUsableGmailSourceIdentifiers(
  sourceReference: SourceReference | undefined,
): boolean {
  if (!isGmailOriginSource(sourceReference) || !sourceReference) {
    return false;
  }
  const ids = sourceReference.externalIds ?? [];
  return ids.some(
    (id) => id.provider.trim().length > 0 && id.idType.trim().length > 0 && id.id.trim().length > 0,
  );
}
