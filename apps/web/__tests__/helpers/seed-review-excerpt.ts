import {
  createOrUpdatePendingCommunicationAccount,
  persistConnectedCommunicationAccount,
  upsertCommunicationEvent,
  upsertGoogleMessagesReviewEvent,
  upsertTemporaryCommunicationExcerpt,
  type DbClient,
} from '@aicaa/db';
import { asCommunicationEventId, type ParsedGmailMessageFixture } from '@aicaa/domain';

/**
 * Real CommunicationEvent + TemporaryCommunicationExcerpt rows for Review tests.
 *
 * Review provenance is not fabricatable any more: `TaskSuggestion.sourceExcerptId` is a foreign key
 * to a real excerpt, so a test that invents an excerpt id no longer describes anything a Review can
 * actually produce. Seeding the rows is also what lets a retention assertion be about a concrete
 * `purgeAt` rather than about whether some update happened.
 */

export async function seedGmailAccount(
  db: DbClient,
  input: { organizationId: string; accountId: string; emailAddress: string; connectedAt: string },
): Promise<void> {
  const external = `google-${input.accountId}`;
  await createOrUpdatePendingCommunicationAccount(db, {
    organizationId: input.organizationId,
    accountId: input.accountId,
    emailAddress: input.emailAddress,
    externalAccountId: external,
  });
  await persistConnectedCommunicationAccount(db, {
    organizationId: input.organizationId,
    accountId: input.accountId,
    emailAddress: input.emailAddress,
    externalAccountId: external,
    connectedAt: input.connectedAt,
    historyId: 'hist_seed',
  });
}

export type SeededExcerpt = { eventId: string; excerptId: string; purgeAt: string };

/** An A5-ingested Gmail occurrence with its capped excerpt at the D078 ingest deadline. */
export async function seedGmailEventWithExcerpt(
  db: DbClient,
  input: {
    organizationId: string;
    accountId: string;
    eventId: string;
    providerMessageId: string;
    excerptId: string;
    content: string;
    /** The D078 ingest deadline: `syncedAt + 7 days`. */
    purgeAt: string;
    internalDate: string;
    fromAddress?: string;
    subject?: string;
  },
): Promise<SeededExcerpt> {
  const message: ParsedGmailMessageFixture = {
    eventId: asCommunicationEventId(input.eventId),
    providerMessageId: input.providerMessageId,
    providerThreadId: `thread_${input.providerMessageId}`,
    internalDate: input.internalDate,
    fromAddress: input.fromAddress ?? 'sender@example.com',
    toAddresses: ['owner@acme.example'],
    subject: input.subject ?? 'Action needed',
    snippet: 'Please review',
    labelIds: ['INBOX'],
    hasAttachments: false,
    attachmentMetadata: [],
  };

  await upsertCommunicationEvent(db, {
    organizationId: input.organizationId,
    accountId: input.accountId,
    message,
  });
  const excerpt = await upsertTemporaryCommunicationExcerpt(db, {
    organizationId: input.organizationId,
    communicationEventId: input.eventId,
    excerptId: input.excerptId,
    content: input.content,
    purgeAt: input.purgeAt,
  });

  return { eventId: input.eventId, excerptId: excerpt.id, purgeAt: excerpt.purgeAt };
}

/**
 * A Google Messages Review occurrence and its excerpt at the Review + 7-day initial deadline.
 *
 * No CommunicationAccount: Messages events carry a null `accountId` by design (D181).
 */
export async function seedMessagesEventWithExcerpt(
  db: DbClient,
  input: {
    organizationId: string;
    eventId: string;
    sourceOccurrenceId: string;
    dedupeKey: string;
    excerptId: string;
    content: string;
    /** The Review-time initial deadline: `reviewedAt + 7 days`. */
    purgeAt: string;
    observedAt: string;
  },
): Promise<SeededExcerpt> {
  await upsertGoogleMessagesReviewEvent(db, {
    organizationId: input.organizationId,
    eventId: input.eventId,
    sourceOccurrenceId: input.sourceOccurrenceId,
    dedupeKey: input.dedupeKey,
    observedAt: input.observedAt,
  });
  const excerpt = await upsertTemporaryCommunicationExcerpt(db, {
    organizationId: input.organizationId,
    communicationEventId: input.eventId,
    excerptId: input.excerptId,
    content: input.content,
    purgeAt: input.purgeAt,
  });

  return { eventId: input.eventId, excerptId: excerpt.id, purgeAt: excerpt.purgeAt };
}
