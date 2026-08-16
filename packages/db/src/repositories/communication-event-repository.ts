import {
  assertExcerptWithinCap,
  buildGmailDedupeKey,
  isGmailInboxEligible,
  measureExcerptByteLength,
  truncateGmailSnippet,
  truncateGmailSubject,
  type CommunicationEvent,
  type ParsedGmailMessageFixture,
  type TemporaryCommunicationExcerpt,
} from '../../../domain/dist/index.js';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import {
  fromIso,
  mapCommunicationEvent,
  mapTemporaryCommunicationExcerpt,
} from '../mappers/domain-mappers.js';
import {
  notFound,
  organizationMismatch,
  persistenceValidation,
  uniqueViolation,
} from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function getCommunicationEventById(
  db: Client,
  organizationId: string,
  eventId: string,
): Promise<CommunicationEvent> {
  const row = await db.communicationEvent.findFirst({
    where: { id: eventId, organizationId },
  });
  if (!row) {
    throw notFound(`CommunicationEvent ${eventId} not found for organization.`);
  }
  return mapCommunicationEvent(row);
}

export async function getCommunicationEventByProviderMessageId(
  db: Client,
  organizationId: string,
  providerMessageId: string,
): Promise<CommunicationEvent | null> {
  const row = await db.communicationEvent.findUnique({
    where: {
      organizationId_providerMessageId: {
        organizationId,
        providerMessageId,
      },
    },
  });
  return row ? mapCommunicationEvent(row) : null;
}

export async function upsertCommunicationEvent(
  db: Client,
  input: {
    organizationId: string;
    accountId: string;
    ingestRunId?: string | null;
    message: ParsedGmailMessageFixture;
  },
): Promise<{ event: CommunicationEvent; created: boolean }> {
  const dedupeKey = buildGmailDedupeKey(input.message.providerMessageId);
  const subject = truncateGmailSubject(input.message.subject);
  const snippet = truncateGmailSnippet(input.message.snippet);
  const attachmentMetadata = input.message.attachmentMetadata ?? [];
  const receivedAt = input.message.receivedAt ?? input.message.internalDate;

  const existing = await db.communicationEvent.findUnique({
    where: {
      organizationId_providerMessageId: {
        organizationId: input.organizationId,
        providerMessageId: input.message.providerMessageId,
      },
    },
  });

  if (existing) {
    if (existing.organizationId !== input.organizationId) {
      throw organizationMismatch('CommunicationEvent belongs to a different organization.');
    }
    const row = await db.communicationEvent.update({
      where: { id: existing.id },
      data: {
        providerThreadId: input.message.providerThreadId,
        fromAddress: input.message.fromAddress,
        toAddresses: asJson(input.message.toAddresses),
        subject,
        snippet,
        labelIds: asJson(input.message.labelIds),
        hasAttachments: input.message.hasAttachments,
        attachmentMetadata: asJson(attachmentMetadata),
        ingestRunId: input.ingestRunId ?? existing.ingestRunId,
        status: 'active',
      },
    });
    return { event: mapCommunicationEvent(row), created: false };
  }

  if (!isGmailInboxEligible(input.message.labelIds)) {
    throw persistenceValidation('New CommunicationEvent requires INBOX label eligibility (D068).');
  }

  const row = await db.communicationEvent.create({
    data: {
      id: input.message.eventId,
      organizationId: input.organizationId,
      accountId: input.accountId,
      sourceType: 'gmail',
      providerMessageId: input.message.providerMessageId,
      providerThreadId: input.message.providerThreadId,
      dedupeKey,
      internalDate: fromIso(input.message.internalDate)!,
      receivedAt: fromIso(receivedAt)!,
      fromAddress: input.message.fromAddress,
      toAddresses: asJson(input.message.toAddresses),
      subject,
      snippet,
      labelIds: asJson(input.message.labelIds),
      hasAttachments: input.message.hasAttachments,
      attachmentMetadata: asJson(attachmentMetadata),
      status: 'active',
      ingestRunId: input.ingestRunId ?? null,
      purgeAt: null,
    },
  });

  return { event: mapCommunicationEvent(row), created: true };
}


export const GOOGLE_MESSAGES_SOURCE_TYPE = 'google_messages' as const;
export const GOOGLE_MESSAGES_PROVIDER_MESSAGE_PREFIX = 'gm:' as const;

export function buildGoogleMessagesProviderMessageId(sourceOccurrenceId: string): string {
  return `${GOOGLE_MESSAGES_PROVIDER_MESSAGE_PREFIX}${sourceOccurrenceId}`;
}

/**
 * Create or reuse the canonical CommunicationEvent for an Owner-initiated Google Messages
 * Review (D181). No CommunicationAccount is created. Gmail-shaped preview fields stay empty so
 * selected text lives only on TemporaryCommunicationExcerpt.
 */
export async function upsertGoogleMessagesReviewEvent(
  db: Client,
  input: {
    organizationId: string;
    eventId: string;
    sourceOccurrenceId: string;
    dedupeKey: string;
    observedAt: string;
  },
): Promise<{ event: CommunicationEvent; created: boolean }> {
  const providerMessageId = buildGoogleMessagesProviderMessageId(input.sourceOccurrenceId);
  const existing = await db.communicationEvent.findUnique({
    where: {
      organizationId_providerMessageId: {
        organizationId: input.organizationId,
        providerMessageId,
      },
    },
  });

  if (existing) {
    if (existing.organizationId !== input.organizationId) {
      throw organizationMismatch('CommunicationEvent belongs to a different organization.');
    }
    if (existing.sourceType !== GOOGLE_MESSAGES_SOURCE_TYPE) {
      throw persistenceValidation(
        'CommunicationEvent source type does not match a Google Messages occurrence.',
      );
    }
    if (existing.accountId != null) {
      throw persistenceValidation(
        'Google Messages CommunicationEvent must not reference a CommunicationAccount.',
      );
    }
    return { event: mapCommunicationEvent(existing), created: false };
  }

  const observedAt = fromIso(input.observedAt);
  if (!observedAt) {
    throw persistenceValidation('Google Messages observedAt is invalid.');
  }

  try {
    const row = await db.communicationEvent.create({
      data: {
        id: input.eventId,
        organizationId: input.organizationId,
        accountId: null,
        sourceType: GOOGLE_MESSAGES_SOURCE_TYPE,
        providerMessageId,
        providerThreadId: providerMessageId,
        dedupeKey: input.dedupeKey,
        internalDate: observedAt,
        receivedAt: observedAt,
        fromAddress: '',
        toAddresses: asJson([]),
        subject: null,
        snippet: null,
        labelIds: asJson([]),
        hasAttachments: false,
        attachmentMetadata: asJson([]),
        status: 'active',
        ingestRunId: null,
        purgeAt: null,
      },
    });

    return { event: mapCommunicationEvent(row), created: true };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    const raced = await db.communicationEvent.findUnique({
      where: {
        organizationId_providerMessageId: {
          organizationId: input.organizationId,
          providerMessageId,
        },
      },
    });
    if (!raced || raced.sourceType !== GOOGLE_MESSAGES_SOURCE_TYPE || raced.accountId != null) {
      throw uniqueViolation(
        'Google Messages CommunicationEvent already exists for this occurrence.',
      );
    }
    return { event: mapCommunicationEvent(raced), created: false };
  }
}

export async function upsertTemporaryCommunicationExcerpt(
  db: Client,
  input: {
    organizationId: string;
    communicationEventId: string;
    excerptId: string;
    content: string;
    purgeAt: string;
  },
): Promise<TemporaryCommunicationExcerpt> {
  assertExcerptWithinCap(input.content);
  const byteLength = measureExcerptByteLength(input.content);

  const row = await db.temporaryCommunicationExcerpt.upsert({
    where: { communicationEventId: input.communicationEventId },
    create: {
      id: input.excerptId,
      organizationId: input.organizationId,
      communicationEventId: input.communicationEventId,
      content: input.content,
      byteLength,
      purgeAt: fromIso(input.purgeAt)!,
      purgedAt: null,
    },
    update: {
      content: input.content,
      byteLength,
      purgeAt: fromIso(input.purgeAt)!,
      purgedAt: null,
    },
  });

  if (row.organizationId !== input.organizationId) {
    throw organizationMismatch(
      'TemporaryCommunicationExcerpt belongs to a different organization.',
    );
  }

  return mapTemporaryCommunicationExcerpt(row);
}

export async function purgeTemporaryCommunicationExcerpt(
  db: Client,
  organizationId: string,
  communicationEventId: string,
  purgedAt: string,
): Promise<TemporaryCommunicationExcerpt> {
  const row = await db.temporaryCommunicationExcerpt.update({
    where: { communicationEventId },
    data: {
      content: '',
      byteLength: 0,
      purgedAt: fromIso(purgedAt)!,
    },
  });
  if (row.organizationId !== organizationId) {
    throw organizationMismatch(
      'TemporaryCommunicationExcerpt belongs to a different organization.',
    );
  }
  return mapTemporaryCommunicationExcerpt(row);
}

export async function getTemporaryCommunicationExcerptByEventId(
  db: Client,
  organizationId: string,
  communicationEventId: string,
): Promise<TemporaryCommunicationExcerpt | null> {
  const row = await db.temporaryCommunicationExcerpt.findFirst({
    where: { communicationEventId, organizationId },
  });
  return row ? mapTemporaryCommunicationExcerpt(row) : null;
}

/**
 * Replace TemporaryCommunicationExcerpt.purgeAt when the excerpt still exists and is not purged.
 * No-op (returns false) when missing or already purged — never restores content (D082).
 */
export async function updateExcerptPurgeAtIfPresent(
  db: Client,
  organizationId: string,
  communicationEventId: string,
  purgeAt: string,
): Promise<boolean> {
  const result = await db.temporaryCommunicationExcerpt.updateMany({
    where: {
      communicationEventId,
      organizationId,
      purgedAt: null,
    },
    data: {
      purgeAt: fromIso(purgeAt)!,
    },
  });
  return result.count === 1;
}
