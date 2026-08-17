import {
  assertExcerptWithinCap,
  isGmailInboxEligible,
  measureExcerptByteLength,
  type CommunicationEventId,
  type ParsedGmailMessageFixture,
  type TemporaryCommunicationExcerptId,
} from '../../../domain/dist/index.js';

export type GmailHistoryPageExcerptIntent = {
  communicationEventId: CommunicationEventId;
  excerptId: TemporaryCommunicationExcerptId;
  content: string;
  byteLength: number;
  purgeAt: string;
};

/**
 * Page-level excerpt intent for Gmail history persistence.
 *
 * Duplicate provider-message occurrences keep the first event/excerpt identity and the last
 * content/byteLength. Initial `purgeAt` is taken from the first occurrence so a same-page
 * duplicate cannot refresh the birth deadline. Oversize content still fails before writes.
 */
export function buildGmailHistoryPageExcerptIntents(input: {
  messages: readonly ParsedGmailMessageFixture[];
  existingEventIdByProviderMessageId: ReadonlyMap<string, CommunicationEventId>;
  defaultExcerptPurgeAt?: string;
}): GmailHistoryPageExcerptIntent[] {
  const firstEventIdByProviderMessageId = new Map<string, CommunicationEventId>();
  const intentsByEventId = new Map<CommunicationEventId, GmailHistoryPageExcerptIntent>();

  for (const message of input.messages) {
    if (!isGmailInboxEligible(message.labelIds)) {
      continue;
    }
    if (!message.excerptContent || !message.excerptId) {
      continue;
    }
    const purgeAt = message.excerptPurgeAt ?? input.defaultExcerptPurgeAt;
    if (!purgeAt) {
      continue;
    }

    assertExcerptWithinCap(message.excerptContent);
    const byteLength = measureExcerptByteLength(message.excerptContent);

    let communicationEventId = firstEventIdByProviderMessageId.get(message.providerMessageId);
    if (!communicationEventId) {
      communicationEventId =
        input.existingEventIdByProviderMessageId.get(message.providerMessageId) ?? message.eventId;
      firstEventIdByProviderMessageId.set(message.providerMessageId, communicationEventId);
    }

    const existingIntent = intentsByEventId.get(communicationEventId);
    if (existingIntent) {
      existingIntent.content = message.excerptContent;
      existingIntent.byteLength = byteLength;
      continue;
    }

    intentsByEventId.set(communicationEventId, {
      communicationEventId,
      excerptId: message.excerptId,
      content: message.excerptContent,
      byteLength,
      purgeAt,
    });
  }

  return [...intentsByEventId.values()];
}
