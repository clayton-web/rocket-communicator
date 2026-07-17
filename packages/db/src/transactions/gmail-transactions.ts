import {
  isGmailInboxEligible,
  type CommunicationAccount,
  type CommunicationEvent,
  type ParsedGmailMessageFixture,
} from '../../../domain/dist/index.js';
import type { DbClient } from '../client/create-prisma-client.js';
import {
  fromIso,
  mapCommunicationAccount,
  type AuditEventRecord,
} from '../mappers/domain-mappers.js';
import {
  getCommunicationEventByProviderMessageId,
  getTemporaryCommunicationExcerptByEventId,
  purgeTemporaryCommunicationExcerpt,
  upsertCommunicationEvent,
  upsertTemporaryCommunicationExcerpt,
} from '../repositories/communication-event-repository.js';
import { persistEncryptedGmailCredential } from '../repositories/gmail-credential-repository.js';
import { disconnectCommunicationAccount } from '../repositories/communication-account-repository.js';
import { createAuditEvent, type CreateAuditEventInput } from '../repositories/audit-repository.js';
import { organizationMismatch, persistenceValidation } from '../errors/persistence-errors.js';

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
      const inboxEligible = isGmailInboxEligible(message.labelIds);
      if (!inboxEligible) {
        // Do not create a durable event for an ineligible message. If Gmail truth says a
        // previously-ingested message left Inbox, retain its durable identity, update its
        // current labels/metadata, and promptly purge any TemporaryCommunicationExcerpt.
        const existing = await getCommunicationEventByProviderMessageId(
          tx,
          input.organizationId,
          message.providerMessageId,
        );
        if (!existing) {
          messagesSkipped += 1;
          continue;
        }

        const { event, created } = await upsertCommunicationEvent(tx, {
          organizationId: input.organizationId,
          accountId: input.accountId,
          ingestRunId: input.ingestRunId,
          message: { ...message, eventId: existing.id },
        });
        if (created) {
          eventsCreated += 1;
        } else {
          eventsUpdated += 1;
        }
        events.push(event);

        const excerpt = await getTemporaryCommunicationExcerptByEventId(
          tx,
          input.organizationId,
          event.id,
        );
        if (excerpt && excerpt.purgedAt == null) {
          await purgeTemporaryCommunicationExcerpt(
            tx,
            input.organizationId,
            event.id,
            input.syncedAt,
          );
        }
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

export type PersistGmailConnectionResult = {
  account: CommunicationAccount;
  audit: AuditEventRecord;
};

/**
 * Atomic Owner Gmail connect / reconnect unit of work (A5.3).
 * Upserts the single per-organization account to `connected`, replaces the encrypted
 * credential (ciphertext only), and records a truthful Owner audit event in one transaction.
 * No history backfill: a brand-new account starts with `historyState = unset`; reconnects
 * preserve any existing cursor for the later sync chunk (D076). Never persists plaintext tokens.
 */
export async function persistGmailConnectionTransaction(input: {
  db: DbClient;
  organizationId: string;
  accountId: string;
  emailAddress: string;
  externalAccountId: string;
  connectedAt: string;
  credential: {
    id: string;
    encryptedRefreshToken: string;
    encryptedAccessToken?: string | null;
    accessTokenExpiresAt?: string | null;
    grantedScopes: string;
    tokenType?: string | null;
    encryptionKeyVersion: string;
  };
  audit: CreateAuditEventInput;
}): Promise<PersistGmailConnectionResult> {
  return input.db.$transaction(async (tx) => {
    const existing = await tx.communicationAccount.findUnique({
      where: {
        organizationId_provider: {
          organizationId: input.organizationId,
          provider: 'gmail',
        },
      },
    });
    if (existing && existing.id !== input.accountId) {
      throw organizationMismatch(
        'Organization already has a Gmail CommunicationAccount with a different id.',
      );
    }

    const connectedAt = fromIso(input.connectedAt)!;
    const accountRow = await tx.communicationAccount.upsert({
      where: { id: input.accountId },
      create: {
        id: input.accountId,
        organizationId: input.organizationId,
        provider: 'gmail',
        emailAddress: input.emailAddress,
        externalAccountId: input.externalAccountId,
        status: 'connected',
        historyId: null,
        historyState: 'unset',
        connectedAt,
        disconnectedAt: null,
        lastSyncAt: null,
        lastSuccessAt: null,
        lastErrorCode: null,
        lastErrorAt: null,
        syncLockUntil: null,
      },
      update: {
        emailAddress: input.emailAddress,
        externalAccountId: input.externalAccountId,
        status: 'connected',
        connectedAt,
        disconnectedAt: null,
        lastErrorCode: null,
        lastErrorAt: null,
        syncLockUntil: null,
      },
    });
    if (accountRow.organizationId !== input.organizationId) {
      throw organizationMismatch('CommunicationAccount belongs to a different organization.');
    }

    await persistEncryptedGmailCredential(tx, {
      id: input.credential.id,
      accountId: input.accountId,
      organizationId: input.organizationId,
      encryptedRefreshToken: input.credential.encryptedRefreshToken,
      encryptedAccessToken: input.credential.encryptedAccessToken ?? null,
      accessTokenExpiresAt: input.credential.accessTokenExpiresAt ?? null,
      grantedScopes: input.credential.grantedScopes,
      tokenType: input.credential.tokenType ?? null,
      encryptionKeyVersion: input.credential.encryptionKeyVersion,
    });

    const audit = await createAuditEvent(tx, input.audit);

    return { account: mapCommunicationAccount(accountRow), audit };
  });
}

export type PersistGmailDisconnectResult = {
  account: CommunicationAccount;
  audit: AuditEventRecord;
};

/**
 * Atomic Owner Gmail disconnect unit of work (A5.3).
 * Deletes the encrypted credential, marks the account `disconnected`, clears the sync lock,
 * and records a truthful Owner audit event. Durable CommunicationEvents are retained (D077);
 * retention cleanup belongs to later policy/workers.
 */
export async function persistGmailDisconnectTransaction(input: {
  db: DbClient;
  organizationId: string;
  accountId: string;
  disconnectedAt: string;
  audit: CreateAuditEventInput;
}): Promise<PersistGmailDisconnectResult> {
  return input.db.$transaction(async (tx) => {
    const account = await disconnectCommunicationAccount(
      tx,
      input.organizationId,
      input.accountId,
      input.disconnectedAt,
    );
    const audit = await createAuditEvent(tx, input.audit);
    return { account, audit };
  });
}
