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
