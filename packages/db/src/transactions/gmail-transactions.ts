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
  listCommunicationEventsByProviderMessageIds,
  listTemporaryCommunicationExcerptsByEventIds,
  purgeTemporaryCommunicationExcerpt,
  upsertCommunicationEvent,
  upsertTemporaryCommunicationExcerpt,
} from '../repositories/communication-event-repository.js';
import { persistEncryptedGmailCredential } from '../repositories/gmail-credential-repository.js';
import { disconnectCommunicationAccount } from '../repositories/communication-account-repository.js';
import { createAuditEvent, type CreateAuditEventInput } from '../repositories/audit-repository.js';
import {
  createOwnerNotificationIntent,
  type OwnerNotificationSystemCapture,
} from '../repositories/owner-notification-repository.js';
import { organizationMismatch, persistenceValidation } from '../errors/persistence-errors.js';
import { attachPrismaTransactionDurationMs } from './prisma-transaction-duration.js';

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
  const transactionStartedAt = performance.now();
  try {
    return await input.db.$transaction(async (tx) => {
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

      const existingEvents = await listCommunicationEventsByProviderMessageIds(
        tx,
        input.organizationId,
        input.messages.map((message) => message.providerMessageId),
      );
      const eventsByProviderMessageId = new Map(
        existingEvents.map((event) => [event.providerMessageId, event]),
      );

      const ineligibleExistingEventIds = [
        ...new Set(
          input.messages.flatMap((message) => {
            if (isGmailInboxEligible(message.labelIds)) {
              return [];
            }
            const existing = eventsByProviderMessageId.get(message.providerMessageId);
            return existing ? [existing.id] : [];
          }),
        ),
      ];
      const existingExcerpts = await listTemporaryCommunicationExcerptsByEventIds(
        tx,
        input.organizationId,
        ineligibleExistingEventIds,
      );
      const excerptsByEventId = new Map(
        existingExcerpts.map((excerpt) => [excerpt.communicationEventId, excerpt]),
      );

      for (const message of input.messages) {
        const inboxEligible = isGmailInboxEligible(message.labelIds);
        const existing = eventsByProviderMessageId.get(message.providerMessageId) ?? null;
        if (!inboxEligible) {
          // Do not create a durable event for an ineligible message. If Gmail truth says a
          // previously-ingested message left Inbox, retain its durable identity, update its
          // current labels/metadata, and promptly purge any TemporaryCommunicationExcerpt.
          if (!existing) {
            messagesSkipped += 1;
            continue;
          }

          const { event, created } = await upsertCommunicationEvent(tx, {
            organizationId: input.organizationId,
            accountId: input.accountId,
            ingestRunId: input.ingestRunId,
            message: { ...message, eventId: existing.id },
            existingEvent: existing,
          });
          if (created) {
            eventsCreated += 1;
          } else {
            eventsUpdated += 1;
          }
          events.push(event);
          eventsByProviderMessageId.set(event.providerMessageId, event);

          const excerpt = excerptsByEventId.get(event.id);
          if (excerpt && excerpt.purgedAt == null) {
            const purged = await purgeTemporaryCommunicationExcerpt(
              tx,
              input.organizationId,
              event.id,
              input.syncedAt,
            );
            excerptsByEventId.set(event.id, purged);
          }
          continue;
        }

        const { event, created } = await upsertCommunicationEvent(tx, {
          organizationId: input.organizationId,
          accountId: input.accountId,
          ingestRunId: input.ingestRunId,
          message,
          existingEvent: existing,
        });
        if (created) {
          eventsCreated += 1;
        } else {
          eventsUpdated += 1;
        }
        events.push(event);
        eventsByProviderMessageId.set(event.providerMessageId, event);

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
  } catch (error) {
    attachPrismaTransactionDurationMs(error, performance.now() - transactionStartedAt);
    throw error;
  }
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

/** The two ways the connected channel stops being usable without the Owner asking for it. */
export type GmailChannelUnavailableTransition = 'needs_reauth' | 'resync_required';

export type PersistGmailChannelUnavailableResult = {
  account: CommunicationAccount;
  /** False when the account had already left `connected`, in which case nothing at all was written. */
  transitioned: boolean;
  audit?: AuditEventRecord;
};

/**
 * Atomic "the Gmail channel became unusable" unit of work (A8.5d, D133).
 *
 * Both transitions this covers stop the same two things: A6 stops ingesting mail and A7 stops
 * sending it, because every outbound path resolves an account that is not `connected` as
 * `not_connected`. That is why `resync_required` is captured alongside `needs_reauth` rather than
 * treated as a lesser operational state — the Owner's assistant has gone quiet either way, and the
 * taxonomy's trigger is "connected account leaves the connected state".
 *
 * ## Why the status write is compare-and-set
 *
 * The repository's `markCommunicationAccountNeedsReauth` writes unconditionally, which was fine when
 * a failing sync was its only caller and the sync engine had already refused to run on a degraded
 * account. It is not fine as the trigger for a notification: "the channel went down" is an event
 * about a *transition*, and an unconditional write cannot tell a transition from a re-observation.
 * Requiring `status = 'connected'` makes "one notification per outage" a property of the row rather
 * than of the guard sequence in the caller, and a second observer writes nothing and is told so.
 *
 * ## Why the notification is system-attributed even when the audit beside it is not
 *
 * The audit row is whatever the caller already wrote for this branch, unchanged: an Owner who
 * pressed "sync now" gets an Owner-attributed row, and the cron gets a system-attributed one. That
 * is truthful about the *request*. It is not truthful about the *event*: an Owner pressing sync is
 * how a lapsed Google grant gets noticed, not how it lapsed. So the intent is `system` regardless,
 * because the alternative renders as "Who acted: you, from your own account" on an email telling the
 * Owner their mail connection died — an untruth D133's attribution rule exists to prevent.
 */
export async function persistGmailChannelUnavailableTransaction(input: {
  db: DbClient;
  organizationId: string;
  accountId: string;
  transition: GmailChannelUnavailableTransition;
  errorCode: string;
  at: string;
  audit: CreateAuditEventInput;
  ownerNotification?: OwnerNotificationSystemCapture;
}): Promise<PersistGmailChannelUnavailableResult> {
  return input.db.$transaction(async (tx) => {
    const changed = await tx.communicationAccount.updateMany({
      where: { id: input.accountId, organizationId: input.organizationId, status: 'connected' },
      data: {
        status: input.transition,
        ...(input.transition === 'resync_required' ? { historyState: 'resync_required' } : {}),
        lastErrorCode: input.errorCode,
        lastErrorAt: fromIso(input.at)!,
      },
    });

    const row = await tx.communicationAccount.findFirst({
      where: { id: input.accountId, organizationId: input.organizationId },
    });
    if (!row) {
      throw organizationMismatch('Communication account does not belong to this organization.');
    }
    const account = mapCommunicationAccount(row);

    if (changed.count !== 1) {
      return { account, transitioned: false };
    }

    const audit = await createAuditEvent(tx, input.audit);

    if (input.ownerNotification) {
      await createOwnerNotificationIntent(tx, {
        id: input.ownerNotification.id,
        organizationId: input.organizationId,
        eventType: 'gmail_disconnected',
        subjectKind: 'communication_account',
        subjectId: input.accountId,
        // Which state it entered, and when it entered it. An account that lapses, is reconnected,
        // and lapses again is entitled to a second message; the same lapse observed twice is not,
        // and cannot be, because the compare-and-set above already refused the second observer.
        occurrenceKey: `${input.transition}:${input.at}`,
        occurredAt: input.at,
        actorKind: 'system',
        ownerId: null,
        capabilityId: null,
        systemId: input.ownerNotification.systemId,
        assignmentId: null,
        attributionLabel: null,
        auditEventId: audit.id,
        requestId: input.audit.requestId ?? null,
        correlationId: input.audit.correlationId ?? null,
      });
    }

    return { account, transitioned: true, audit };
  });
}
