import type { Recipient } from '@aicaa/domain';
import type { components } from '@aicaa/contracts/schema';

export type RecipientDto = components['schemas']['Recipient'];

/**
 * Map a domain Recipient to the public response shape (A7.6).
 * Internal persistence fields (organizationId, emailNormalized, DB metadata) are not part of the
 * domain Recipient and are never surfaced. `createdAt`/`updatedAt` are intentionally omitted in
 * A7.6 (optional in the contract; not required for this slice).
 */
export function mapRecipientToDto(recipient: Recipient): RecipientDto {
  const dto: RecipientDto = {
    id: recipient.id,
    displayName: recipient.displayName,
    email: recipient.email,
    active: recipient.active,
  };
  if (recipient.relationshipLabel !== undefined) {
    dto.relationshipLabel = recipient.relationshipLabel;
  }
  if (recipient.reminderPreferences?.emailEnabled !== undefined) {
    dto.reminderPreferences = { emailEnabled: recipient.reminderPreferences.emailEnabled };
  }
  if (recipient.assignmentCategories !== undefined) {
    dto.assignmentCategories = [...recipient.assignmentCategories];
  }
  return dto;
}
