import type { CommunicationEvent } from '@aicaa/domain';
import type { components } from '@aicaa/contracts/schema';

export type GmailIntakeItemDto = components['schemas']['GmailIntakeItem'];

/**
 * Map an eligible A5 CommunicationEvent onto the public Gmail intake item (D179 / S7).
 *
 * Field-by-field so A6 processing state, labels, recipients, attachments, account ids, and
 * excerpt bodies cannot silently become published API. The id is the CommunicationEvent id used
 * by a later Review-with-Rocket request.
 */
export function mapGmailIntakeItem(event: CommunicationEvent): GmailIntakeItemDto {
  return {
    id: event.id,
    fromAddress: event.fromAddress,
    subject: event.subject,
    snippet: event.snippet,
    receivedAt: event.receivedAt,
  };
}
