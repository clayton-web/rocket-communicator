import { describe, expect, it } from 'vitest';
import {
  asCommunicationEventId,
  asTemporaryCommunicationExcerptId,
  type ParsedGmailMessageFixture,
} from '@aicaa/domain';
import type { DbClient } from '../src/client/create-prisma-client.js';
import { persistGmailHistoryPageTransaction } from '../src/transactions/gmail-transactions.js';

const org = 'org_tx_query_shape';
const accountId = 'acct_tx_query_shape';
const now = '2026-08-17T00:00:00.000Z';
const purgeAt = '2026-08-24T00:00:00.000Z';

type QueryCall = {
  model: 'communicationAccount' | 'communicationEvent' | 'temporaryCommunicationExcerpt';
  method: string;
  args?: unknown;
};

function inboxMessage(
  overrides: Partial<ParsedGmailMessageFixture> &
    Pick<ParsedGmailMessageFixture, 'eventId' | 'providerMessageId'>,
): ParsedGmailMessageFixture {
  return {
    providerThreadId: `thread_${overrides.providerMessageId}`,
    internalDate: now,
    fromAddress: 'sender@example.com',
    toAddresses: ['owner@example.com'],
    subject: 'Hello',
    snippet: 'Body preview',
    labelIds: ['INBOX'],
    hasAttachments: false,
    attachmentMetadata: [],
    ...overrides,
  };
}

function accountRow(historyId: string | null) {
  return {
    id: accountId,
    organizationId: org,
    provider: 'gmail' as const,
    emailAddress: 'owner@example.com',
    externalAccountId: 'google-sub-query-shape',
    status: 'connected' as const,
    historyId,
    historyState: 'valid' as const,
    connectedAt: new Date(now),
    disconnectedAt: null,
    lastSyncAt: null,
    lastSuccessAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
    syncLockUntil: null,
    syncLockOwner: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
}

function eventRow(input: {
  id: string;
  providerMessageId: string;
  labelIds?: string[];
  subject?: string | null;
}) {
  return {
    id: input.id,
    organizationId: org,
    accountId,
    sourceType: 'gmail',
    providerMessageId: input.providerMessageId,
    providerThreadId: `thread_${input.providerMessageId}`,
    dedupeKey: `gmail:${input.providerMessageId}`,
    internalDate: new Date(now),
    receivedAt: new Date(now),
    fromAddress: 'sender@example.com',
    toAddresses: ['owner@example.com'],
    subject: input.subject ?? 'Hello',
    snippet: 'Body preview',
    labelIds: input.labelIds ?? ['INBOX'],
    hasAttachments: false,
    attachmentMetadata: [],
    status: 'active' as const,
    ingestRunId: 'run_seed',
    purgeAt: null,
    suggestionProcessingStatus: 'unprocessed' as const,
    suggestionProcessedAt: null,
    suggestionProcessingAttempts: 0,
    suggestionLastErrorCode: null,
    suggestionClaimUntil: null,
    suggestionClaimOwner: null,
    suggestionPolicyVersion: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
}

function excerptRow(input: { id: string; communicationEventId: string; purgedAt?: Date | null }) {
  return {
    id: input.id,
    organizationId: org,
    communicationEventId: input.communicationEventId,
    content: 'temporary excerpt',
    byteLength: 18,
    purgeAt: new Date(purgeAt),
    purgedAt: input.purgedAt ?? null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
}

function createRecordingTransaction(seed: {
  account: ReturnType<typeof accountRow>;
  events?: ReturnType<typeof eventRow>[];
  excerpts?: ReturnType<typeof excerptRow>[];
}) {
  const calls: QueryCall[] = [];
  const events = new Map((seed.events ?? []).map((row) => [row.id, { ...row }]));
  const excerpts = new Map(
    (seed.excerpts ?? []).map((row) => [row.communicationEventId, { ...row }]),
  );
  let account = { ...seed.account };

  const record = (call: QueryCall) => {
    calls.push(call);
  };

  const tx = {
    communicationAccount: {
      findFirst: async (args: { where: { id: string; organizationId: string } }) => {
        record({ model: 'communicationAccount', method: 'findFirst', args });
        if (args.where.id === account.id && args.where.organizationId === account.organizationId) {
          return { ...account };
        }
        return null;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        record({ model: 'communicationAccount', method: 'update', args });
        account = { ...account, ...args.data } as typeof account;
        return { ...account };
      },
    },
    communicationEvent: {
      findMany: async (args: {
        where: { organizationId: string; providerMessageId: { in: string[] } };
      }) => {
        record({ model: 'communicationEvent', method: 'findMany', args });
        const ids = new Set(args.where.providerMessageId.in);
        return [...events.values()].filter(
          (row) =>
            row.organizationId === args.where.organizationId && ids.has(row.providerMessageId),
        );
      },
      findUnique: async (args: unknown) => {
        record({ model: 'communicationEvent', method: 'findUnique', args });
        return null;
      },
      findFirst: async (args: unknown) => {
        record({ model: 'communicationEvent', method: 'findFirst', args });
        return null;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        record({ model: 'communicationEvent', method: 'create', args });
        const row = eventRow({
          id: String(args.data.id),
          providerMessageId: String(args.data.providerMessageId),
          labelIds: args.data.labelIds as string[] | undefined,
          subject: (args.data.subject as string | null | undefined) ?? null,
        });
        const created = {
          ...row,
          ...args.data,
          accountId: (args.data.accountId as string | null | undefined) ?? row.accountId,
        };
        events.set(created.id, created as ReturnType<typeof eventRow>);
        return created;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        record({ model: 'communicationEvent', method: 'update', args });
        const current = events.get(args.where.id);
        if (!current) {
          throw new Error(`communicationEvent ${args.where.id} not found`);
        }
        const updated = { ...current, ...args.data, updatedAt: new Date(now) };
        events.set(updated.id, updated as ReturnType<typeof eventRow>);
        return updated;
      },
    },
    temporaryCommunicationExcerpt: {
      findMany: async (args: {
        where: { organizationId: string; communicationEventId: { in: string[] } };
      }) => {
        record({ model: 'temporaryCommunicationExcerpt', method: 'findMany', args });
        const ids = new Set(args.where.communicationEventId.in);
        return [...excerpts.values()].filter(
          (row) =>
            row.organizationId === args.where.organizationId && ids.has(row.communicationEventId),
        );
      },
      findFirst: async (args: unknown) => {
        record({ model: 'temporaryCommunicationExcerpt', method: 'findFirst', args });
        return null;
      },
      findUnique: async (args: { where: { communicationEventId: string } }) => {
        record({ model: 'temporaryCommunicationExcerpt', method: 'findUnique', args });
        const row = excerpts.get(args.where.communicationEventId);
        return row ? { ...row } : null;
      },
      createMany: async (args: {
        data: Array<Record<string, unknown>>;
        skipDuplicates?: boolean;
      }) => {
        record({ model: 'temporaryCommunicationExcerpt', method: 'createMany', args });
        for (const data of args.data) {
          const communicationEventId = String(data.communicationEventId);
          if (excerpts.has(communicationEventId)) {
            continue;
          }
          excerpts.set(
            communicationEventId,
            excerptRow({
              id: String(data.id),
              communicationEventId,
            }),
          );
        }
        return { count: args.data.length };
      },
      updateMany: async (args: {
        where: { communicationEventId: string; organizationId: string; purgedAt: null };
        data: Record<string, unknown>;
      }) => {
        record({ model: 'temporaryCommunicationExcerpt', method: 'updateMany', args });
        const current = excerpts.get(args.where.communicationEventId);
        if (
          !current ||
          current.organizationId !== args.where.organizationId ||
          current.purgedAt != null
        ) {
          return { count: 0 };
        }
        excerpts.set(current.communicationEventId, { ...current, ...args.data });
        return { count: 1 };
      },
      update: async (args: {
        where: { communicationEventId: string };
        data: Record<string, unknown>;
      }) => {
        record({ model: 'temporaryCommunicationExcerpt', method: 'update', args });
        const current = excerpts.get(args.where.communicationEventId);
        if (!current) {
          throw new Error(`excerpt ${args.where.communicationEventId} not found`);
        }
        const updated = { ...current, ...args.data };
        excerpts.set(updated.communicationEventId, updated);
        return updated;
      },
    },
  };

  return { tx, calls };
}

function persistWith(tx: unknown, messages: ParsedGmailMessageFixture[]) {
  return persistGmailHistoryPageTransaction({
    db: {
      $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx),
    } as DbClient,
    organizationId: org,
    accountId,
    historyIdBefore: '1000',
    historyIdAfter: '1100',
    ingestRunId: 'run_tx_query_shape',
    syncedAt: now,
    messages,
  });
}

function callsOf(calls: QueryCall[], model: QueryCall['model'], method: string): QueryCall[] {
  return calls.filter((call) => call.model === model && call.method === method);
}

describe('persistGmailHistoryPageTransaction query shape', () => {
  it('prefetches existing events once for an eligible multi-message page', async () => {
    const { tx, calls } = createRecordingTransaction({ account: accountRow('1000') });
    const page = await persistWith(tx, [
      inboxMessage({
        eventId: asCommunicationEventId('evt_a'),
        providerMessageId: 'msg_a',
        excerptId: asTemporaryCommunicationExcerptId('ex_a'),
        excerptContent: 'excerpt a',
        excerptPurgeAt: purgeAt,
      }),
      inboxMessage({
        eventId: asCommunicationEventId('evt_b'),
        providerMessageId: 'msg_b',
        excerptId: asTemporaryCommunicationExcerptId('ex_b'),
        excerptContent: 'excerpt b',
        excerptPurgeAt: purgeAt,
      }),
    ]);

    expect(page.eventsCreated).toBe(2);
    expect(page.account.historyId).toBe('1100');

    const eventFinds = callsOf(calls, 'communicationEvent', 'findMany');
    expect(eventFinds).toHaveLength(1);
    const eventFindWhere = (
      eventFinds[0]?.args as {
        where: { organizationId: string; providerMessageId: { in: string[] } };
      }
    ).where;
    expect(eventFindWhere.organizationId).toBe(org);
    expect(new Set(eventFindWhere.providerMessageId.in)).toEqual(new Set(['msg_a', 'msg_b']));
    expect(callsOf(calls, 'communicationEvent', 'findUnique')).toHaveLength(0);
    expect(callsOf(calls, 'communicationEvent', 'findFirst')).toHaveLength(0);
    expect(callsOf(calls, 'communicationEvent', 'create')).toHaveLength(2);
    expect(callsOf(calls, 'temporaryCommunicationExcerpt', 'createMany')).toHaveLength(2);
    expect(callsOf(calls, 'communicationAccount', 'update')).toHaveLength(1);
  });

  it('does not look up an ineligible existing event a second time', async () => {
    const existing = eventRow({ id: 'evt_left', providerMessageId: 'msg_left' });
    const { tx, calls } = createRecordingTransaction({
      account: accountRow('1000'),
      events: [existing],
      excerpts: [excerptRow({ id: 'ex_left', communicationEventId: existing.id })],
    });

    const page = await persistWith(tx, [
      inboxMessage({
        eventId: asCommunicationEventId('evt_left_ignored'),
        providerMessageId: 'msg_left',
        labelIds: ['SENT'],
      }),
    ]);

    expect(page.eventsCreated).toBe(0);
    expect(page.eventsUpdated).toBe(1);
    expect(page.messagesSkipped).toBe(0);
    expect(page.account.historyId).toBe('1100');

    expect(callsOf(calls, 'communicationEvent', 'findMany')).toHaveLength(1);
    expect(callsOf(calls, 'communicationEvent', 'findUnique')).toHaveLength(0);
    expect(callsOf(calls, 'communicationEvent', 'findFirst')).toHaveLength(0);
    expect(callsOf(calls, 'communicationEvent', 'update')).toHaveLength(1);
    expect(callsOf(calls, 'communicationEvent', 'create')).toHaveLength(0);

    const excerptFinds = callsOf(calls, 'temporaryCommunicationExcerpt', 'findMany');
    expect(excerptFinds).toHaveLength(1);
    expect(excerptFinds[0]?.args).toEqual({
      where: {
        organizationId: org,
        communicationEventId: { in: [existing.id] },
      },
    });
    expect(callsOf(calls, 'temporaryCommunicationExcerpt', 'findFirst')).toHaveLength(0);
    expect(callsOf(calls, 'temporaryCommunicationExcerpt', 'findUnique')).toHaveLength(0);
    expect(callsOf(calls, 'temporaryCommunicationExcerpt', 'update')).toHaveLength(1);
  });

  it('skips batch reads on an empty page and still performs the cursor CAS write', async () => {
    const { tx, calls } = createRecordingTransaction({ account: accountRow('1000') });
    const page = await persistWith(tx, []);

    expect(page.eventsCreated).toBe(0);
    expect(page.account.historyId).toBe('1100');
    expect(callsOf(calls, 'communicationEvent', 'findMany')).toHaveLength(0);
    expect(callsOf(calls, 'temporaryCommunicationExcerpt', 'findMany')).toHaveLength(0);
    expect(callsOf(calls, 'communicationAccount', 'findFirst')).toHaveLength(1);
    expect(callsOf(calls, 'communicationAccount', 'update')).toHaveLength(1);
  });
});
