import type { TemporaryCommunicationExcerpt } from '../../../domain/dist/index.js';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { organizationMismatch, uniqueViolation } from '../errors/persistence-errors.js';
import { fromIso, mapTemporaryCommunicationExcerpt } from '../mappers/domain-mappers.js';
import type { GmailHistoryPageExcerptIntent } from '../transactions/gmail-history-page-excerpt-intent.js';

type Client = DbClient | DbTransaction;

/**
 * Organization-scoped page prefetch for Gmail history excerpt persistence.
 *
 * Looks up existing rows by communication-event identity and by incoming excerpt id so the
 * page can classify create/update/no-op and detect an excerpt-id collision without a
 * per-message read.
 */
export async function listTemporaryCommunicationExcerptsForGmailHistoryPage(
  db: Client,
  organizationId: string,
  input: {
    communicationEventIds: readonly string[];
    excerptIds: readonly string[];
  },
): Promise<TemporaryCommunicationExcerpt[]> {
  const communicationEventIds = [...new Set(input.communicationEventIds)];
  const excerptIds = [...new Set(input.excerptIds)];
  if (communicationEventIds.length === 0 && excerptIds.length === 0) {
    return [];
  }

  const eventClause =
    communicationEventIds.length > 0
      ? { communicationEventId: { in: communicationEventIds } }
      : undefined;
  const excerptClause = excerptIds.length > 0 ? { id: { in: excerptIds } } : undefined;
  const rows = await db.temporaryCommunicationExcerpt.findMany({
    where: {
      organizationId,
      ...(eventClause && excerptClause
        ? { OR: [eventClause, excerptClause] }
        : (eventClause ?? excerptClause)!),
    },
  });
  return rows.map(mapTemporaryCommunicationExcerpt);
}

/**
 * Persist eligible Gmail history-page excerpts after event writes.
 *
 * New rows use one `createMany({ skipDuplicates: true })`. Existing unpurged rows are
 * updated per event (content/byteLength only). Already-purged rows are left untouched.
 *
 * `createMany.count` is not asserted against the prefetch-time new-row count: a concurrent
 * insert can make those differ without being a collision. If some inserts were skipped, one
 * organization-scoped follow-up `findMany` distinguishes a same-event race (row exists, OK)
 * from an excerpt-id collision (no row for this event, fail closed). That follow-up is not
 * taken on the common path where every prefetch-new row was inserted.
 */
export async function persistGmailHistoryPageTemporaryExcerpts(
  db: Client,
  organizationId: string,
  intents: readonly GmailHistoryPageExcerptIntent[],
  prefetched: readonly TemporaryCommunicationExcerpt[],
): Promise<void> {
  if (intents.length === 0) {
    return;
  }

  const byEventId = new Map(prefetched.map((excerpt) => [excerpt.communicationEventId, excerpt]));
  const byExcerptId = new Map(prefetched.map((excerpt) => [excerpt.id, excerpt]));

  const newIntents: GmailHistoryPageExcerptIntent[] = [];
  const updateIntents: GmailHistoryPageExcerptIntent[] = [];

  for (const intent of intents) {
    const existingForEvent = byEventId.get(intent.communicationEventId);
    const existingForId = byExcerptId.get(intent.excerptId);

    if (existingForEvent && existingForEvent.organizationId !== organizationId) {
      throw organizationMismatch(
        'TemporaryCommunicationExcerpt belongs to a different organization.',
      );
    }
    if (existingForId && existingForId.organizationId !== organizationId) {
      throw organizationMismatch(
        'TemporaryCommunicationExcerpt belongs to a different organization.',
      );
    }

    if (
      !existingForEvent &&
      existingForId &&
      existingForId.communicationEventId !== intent.communicationEventId
    ) {
      throw uniqueViolation(
        'TemporaryCommunicationExcerpt already exists for a different identity.',
      );
    }

    if (!existingForEvent) {
      newIntents.push(intent);
      continue;
    }
    if (existingForEvent.purgedAt == null) {
      updateIntents.push(intent);
    }
  }

  if (newIntents.length > 0) {
    const created = await db.temporaryCommunicationExcerpt.createMany({
      data: newIntents.map((intent) => ({
        id: intent.excerptId,
        organizationId,
        communicationEventId: intent.communicationEventId,
        content: intent.content,
        byteLength: intent.byteLength,
        purgeAt: fromIso(intent.purgeAt)!,
        purgedAt: null,
      })),
      skipDuplicates: true,
    });

    if (created.count !== newIntents.length) {
      const rows = await listTemporaryCommunicationExcerptsForGmailHistoryPage(db, organizationId, {
        communicationEventIds: newIntents.map((intent) => intent.communicationEventId),
        excerptIds: [],
      });
      const foundByEventId = new Map(rows.map((row) => [row.communicationEventId, row]));
      for (const intent of newIntents) {
        const row = foundByEventId.get(intent.communicationEventId);
        if (!row) {
          throw uniqueViolation(
            'TemporaryCommunicationExcerpt already exists for a different identity.',
          );
        }
        if (row.organizationId !== organizationId) {
          throw organizationMismatch(
            'TemporaryCommunicationExcerpt belongs to a different organization.',
          );
        }
      }
    }
  }

  for (const intent of updateIntents) {
    await db.temporaryCommunicationExcerpt.updateMany({
      where: {
        communicationEventId: intent.communicationEventId,
        organizationId,
        purgedAt: null,
      },
      data: {
        content: intent.content,
        byteLength: intent.byteLength,
      },
    });
  }
}
