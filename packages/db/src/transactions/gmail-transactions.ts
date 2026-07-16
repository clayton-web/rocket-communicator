import {
  isGmailInboxEligible,
  type CommunicationAccount,
  type CommunicationEvent,
  type ParsedGmailMessageFixture,
} from '../../../domain/dist/index.js';
import type { DbClient } from '../client/create-prisma-client.js';
import { fromIso, mapCommunicationAccount } from '../mappers/domain-mappers.js';
import {
  upsertCommunicationEvent,
  upsertTemporaryCommunicationExcerpt,
} from '../repositories/communication-event-repository.js';
import { persistenceValidation } from '../errors/persistence-errors.js';

export type PersistGmailHistoryPageResult = {
  account: CommunicationAccount;
  eventsCreated: number;
  eventsUpdated: number;
  messagesSkipped: number;
  events: CommunicationEvent[];
};

/**
 * Durable history-page unit of work (D075):
 * event upserts (+ optional excerpts) and history cursor advancement commit together.
 * Failure before commit leaves the prior historyId intact (no silent gap / silent reset).
 */
export async function persistGmailHistoryPageTransaction(input: {
  db: DbClient;
  organizationId: string;
  accountId: string;
  historyIdBefore: string | null;
  historyIdAfter: string;
  ingestRunId: string;
  syncedAt: string;
  messages: ParsedGmailMessageFixture[];
  defaultExcerptPurgeAt?: string;
}): Promise<PersistGmailHistoryPageResult> {
  return input.db.$transaction(async (tx) => {
    const account = await tx.communicationAccount.findFirst({
      where: { id: input.accountId, organizationId: input.organizationId },
    });
    if (!account) {
      throw persistenceValidation('CommunicationAccount not found for history page commit.');
    }
    if (account.historyId !== input.historyIdBefore) {
      throw persistenceValidation(
        'historyIdBefore does not match persisted cursor; refusing silent advance (D075/D076).',
      );
    }

    let eventsCreated = 0;
    let eventsUpdated = 0;
    let messagesSkipped = 0;
    const events: CommunicationEvent[] = [];

    for (const message of input.messages) {
      if (!isGmailInboxEligible(message.labelIds)) {
        messagesSkipped += 1;
        continue;
      }

      const { event, created } = await upsertCommunicationEvent(tx, {
        organizationId: input.organizationId,
        accountId: input.accountId,
        ingestRunId: input.ingestRunId,
        message,
      });
      if (created) {
        eventsCreated += 1;
      } else {
        eventsUpdated += 1;
      }
      events.push(event);

      if (message.excerptContent && message.excerptId && message.excerptPurgeAt) {
        await upsertTemporaryCommunicationExcerpt(tx, {
          organizationId: input.organizationId,
          communicationEventId: event.id,
          excerptId: message.excerptId,
          content: message.excerptContent,
          purgeAt: message.excerptPurgeAt,
        });
      } else if (message.excerptContent && message.excerptId && input.defaultExcerptPurgeAt) {
        await upsertTemporaryCommunicationExcerpt(tx, {
          organizationId: input.organizationId,
          communicationEventId: event.id,
          excerptId: message.excerptId,
          content: message.excerptContent,
          purgeAt: input.defaultExcerptPurgeAt,
        });
      }
    }

    const updated = await tx.communicationAccount.update({
      where: { id: input.accountId },
      data: {
        historyId: input.historyIdAfter,
        historyState: 'valid',
        lastSyncAt: fromIso(input.syncedAt)!,
        lastSuccessAt: fromIso(input.syncedAt)!,
        lastErrorCode: null,
        lastErrorAt: null,
        status: account.status === 'resync_required' ? 'connected' : account.status,
      },
    });

    return {
      account: mapCommunicationAccount(updated),
      eventsCreated,
      eventsUpdated,
      messagesSkipped,
      events,
    };
  });
}
