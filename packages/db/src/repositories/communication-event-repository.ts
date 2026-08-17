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
import { listGmailExcludedSenderAddresses } from './gmail-sender-exclusion-repository.js';

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

export async function listCommunicationEventsByProviderMessageIds(
  db: Client,
  organizationId: string,
  providerMessageIds: string[],
): Promise<CommunicationEvent[]> {
  const uniqueIds = [...new Set(providerMessageIds)];
  if (uniqueIds.length === 0) {
    return [];
  }
  const rows = await db.communicationEvent.findMany({
    where: {
      organizationId,
      providerMessageId: { in: uniqueIds },
    },
  });
  return rows.map(mapCommunicationEvent);
}

export async function listTemporaryCommunicationExcerptsByEventIds(
  db: Client,
  organizationId: string,
  communicationEventIds: string[],
): Promise<TemporaryCommunicationExcerpt[]> {
  const uniqueIds = [...new Set(communicationEventIds)];
  if (uniqueIds.length === 0) {
    return [];
  }
  const rows = await db.temporaryCommunicationExcerpt.findMany({
    where: {
      organizationId,
      communicationEventId: { in: uniqueIds },
    },
  });
  return rows.map(mapTemporaryCommunicationExcerpt);
}

export async function upsertCommunicationEvent(
  db: Client,
  input: {
    organizationId: string;
    accountId: string;
    ingestRunId?: string | null;
    message: ParsedGmailMessageFixture;
    /**
     * When provided, skip the per-call event lookup.
     * `null` means the caller already established that no row exists.
     * Create still relies on the unique constraint if a concurrent insert wins.
     */
    existingEvent?: CommunicationEvent | null;
  },
): Promise<{ event: CommunicationEvent; created: boolean }> {
  const dedupeKey = buildGmailDedupeKey(input.message.providerMessageId);
  const subject = truncateGmailSubject(input.message.subject);
  const snippet = truncateGmailSnippet(input.message.snippet);
  const attachmentMetadata = input.message.attachmentMetadata ?? [];
  const receivedAt = input.message.receivedAt ?? input.message.internalDate;

  const existing =
    input.existingEvent !== undefined
      ? input.existingEvent
      : await getCommunicationEventByProviderMessageId(
          db,
          input.organizationId,
          input.message.providerMessageId,
        );

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

/**
 * Create or refresh a TemporaryCommunicationExcerpt without becoming a retention writer.
 *
 * Create writes content, byte length, the initial concrete `purgeAt` (D078 / D181 birth deadline),
 * and `purgedAt = null`. Existing-row refresh may update content and byte length only, and only
 * while `purgedAt` is still null. Re-ingest therefore cannot shorten an active D082 hold, refresh
 * an approved ceiling, clear `purgedAt`, or restore body content after purge. A purged update is a
 * no-op for excerpt state so the enclosing CommunicationEvent transaction can still succeed.
 *
 * `purgeAt` / `purgedAt` on an existing row belong to D082 lifecycle code and the purge primitive,
 * not to this ingest path. The existing-row write omits those columns entirely rather than
 * computing `max(existing, incoming)`, which would still refresh a ceiling and can lose a
 * concurrent D082 update.
 *
 * Implemented as `createMany({ skipDuplicates: true })` plus a conditional `updateMany`, not
 * create-and-catch-P2002: a unique violation inside `$transaction` aborts the PostgreSQL
 * transaction (25P02), which would fail Gmail history-page commits on purged re-ingest.
 */
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

  await db.temporaryCommunicationExcerpt.createMany({
    data: [
      {
        id: input.excerptId,
        organizationId: input.organizationId,
        communicationEventId: input.communicationEventId,
        content: input.content,
        byteLength,
        purgeAt: fromIso(input.purgeAt)!,
        purgedAt: null,
      },
    ],
    skipDuplicates: true,
  });

  await db.temporaryCommunicationExcerpt.updateMany({
    where: {
      communicationEventId: input.communicationEventId,
      organizationId: input.organizationId,
      purgedAt: null,
    },
    data: {
      content: input.content,
      byteLength,
    },
  });

  const row = await db.temporaryCommunicationExcerpt.findUnique({
    where: { communicationEventId: input.communicationEventId },
  });
  if (!row) {
    throw uniqueViolation('TemporaryCommunicationExcerpt already exists for a different identity.');
  }
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

export type ListEligibleGmailIntakeEventsQuery = {
  organizationId: string;
  /** Instant used for TemporaryCommunicationExcerpt.purgeAt comparison. */
  now: string;
  cursor?: string | null;
  limit?: number;
};

export type ListEligibleGmailIntakeEventsResult = {
  items: CommunicationEvent[];
  nextCursor: string | null;
};

const GMAIL_INTAKE_SCAN_BATCH = 50;
/** Max active Gmail candidates examined per request before returning a continuation cursor. */
export const GMAIL_INTAKE_MAX_SCAN = 250;

type GmailIntakeCursor = { receivedAt: Date; id: string };

function encodeGmailIntakeCursor(value: GmailIntakeCursor): string {
  const payload = `${value.receivedAt.toISOString()}|${value.id}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function decodeGmailIntakeCursor(raw: string | null | undefined): GmailIntakeCursor | null {
  if (!raw) {
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw persistenceValidation('Gmail intake list cursor is invalid.');
  }
  const separator = decoded.lastIndexOf('|');
  if (separator <= 0) {
    throw persistenceValidation('Gmail intake list cursor is invalid.');
  }
  const receivedAtRaw = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  const receivedAt = new Date(receivedAtRaw);
  if (!id || Number.isNaN(receivedAt.getTime())) {
    throw persistenceValidation('Gmail intake list cursor is invalid.');
  }
  return { receivedAt, id };
}

function gmailIntakeCursorWhere(cursor: GmailIntakeCursor): Prisma.CommunicationEventWhereInput {
  return {
    OR: [
      { receivedAt: { lt: cursor.receivedAt } },
      {
        AND: [{ receivedAt: cursor.receivedAt }, { id: { lt: cursor.id } }],
      },
    ],
  };
}

/**
 * Organization-scoped Gmail intake listing for Owner Review with Rocket (D179 / S7).
 *
 * Returns only currently reviewable Gmail occurrences: active Gmail events that still satisfy
 * Inbox eligibility (D068) and still have an unpurged, unexpired TemporaryCommunicationExcerpt.
 * Not a general CommunicationEvent browser: non-Gmail source kinds, purged events, and
 * ineligible/expired rows are omitted rather than described.
 *
 * Order: receivedAt DESC, then id DESC. Cursor-paginated. Non-mutating. Does not return excerpt
 * bodies — those stay on TemporaryCommunicationExcerpt until a later Owner Review action.
 *
 * Inbox eligibility is applied in memory because `labelIds` is stored as JSON and the D068
 * predicate (INBOX required; DRAFT/SPAM/TRASH excluded) is not a simple column filter.
 * Organization-scoped Gmail sender exclusions (D180) are applied in the same scan so excluded
 * senders never occupy a returned page. The scan is bounded. When that budget is reached before
 * the keyset is exhausted, `nextCursor` continues from the last *scanned* candidate — even if
 * the page has zero eligible items — so older eligible mail behind a run of ineligible candidates
 * remains reachable.
 */
export async function listEligibleGmailIntakeEvents(
  db: Client,
  query: ListEligibleGmailIntakeEventsQuery,
): Promise<ListEligibleGmailIntakeEventsResult> {
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  let cursor = decodeGmailIntakeCursor(query.cursor);
  const now = fromIso(query.now);
  if (!now) {
    throw persistenceValidation('Gmail intake list now instant is invalid.');
  }

  const eligible: CommunicationEvent[] = [];
  let scanned = 0;
  let exhausted = false;
  let lastScanned: GmailIntakeCursor | null = null;
  const excludedSenders = new Set(await listGmailExcludedSenderAddresses(db, query.organizationId));

  while (eligible.length < limit + 1 && scanned < GMAIL_INTAKE_MAX_SCAN) {
    const rows = await db.communicationEvent.findMany({
      where: {
        organizationId: query.organizationId,
        sourceType: 'gmail',
        status: 'active',
        ...(cursor ? gmailIntakeCursorWhere(cursor) : {}),
        excerpt: {
          purgedAt: null,
          content: { not: '' },
          purgeAt: { gt: now },
        },
      },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: GMAIL_INTAKE_SCAN_BATCH,
    });

    if (rows.length === 0) {
      exhausted = true;
      break;
    }

    scanned += rows.length;
    for (const row of rows) {
      const event = mapCommunicationEvent(row);
      if (isGmailInboxEligible(event.labelIds) && !excludedSenders.has(event.fromAddress)) {
        eligible.push(event);
        if (eligible.length >= limit + 1) {
          break;
        }
      }
    }

    const last = rows[rows.length - 1]!;
    lastScanned = { receivedAt: last.receivedAt, id: last.id };
    cursor = lastScanned;
    if (rows.length < GMAIL_INTAKE_SCAN_BATCH) {
      exhausted = true;
      break;
    }
  }

  const page = eligible.slice(0, limit);
  const lastReturned = page[page.length - 1];
  const nextCursor =
    eligible.length > limit && lastReturned
      ? encodeGmailIntakeCursor({
          receivedAt: fromIso(lastReturned.receivedAt)!,
          id: lastReturned.id,
        })
      : exhausted
        ? null
        : lastScanned
          ? encodeGmailIntakeCursor(lastScanned)
          : null;

  return { items: page, nextCursor };
}

/*
 * Excerpt retention deadlines are written by `applyD082ExcerptRetention` alone.
 *
 * A bare "set this excerpt's purgeAt from this one event" primitive used to live here, and it was
 * the shape of the D082 defect: it assumed one event backed one suggestion, so a Review excerpt
 * shared by sibling proposals got whichever sibling transitioned last. Resolving the maximum
 * entitlement is not optional, so the only writer is the resolver that does it.
 */
