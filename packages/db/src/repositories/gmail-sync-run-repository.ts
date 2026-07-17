import type { GmailSyncOutcome, GmailSyncRun, GmailSyncTrigger } from '@aicaa/domain';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { fromIso, mapGmailSyncRun } from '../mappers/domain-mappers.js';
import {
  notFound,
  organizationMismatch,
  persistenceValidation,
} from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

export async function createGmailSyncRun(
  db: Client,
  input: {
    id: string;
    organizationId: string;
    accountId: string;
    trigger: GmailSyncTrigger;
    startedAt: string;
    historyIdBefore?: string | null;
    requestId?: string | null;
  },
): Promise<GmailSyncRun> {
  const row = await db.gmailSyncRun.create({
    data: {
      id: input.id,
      organizationId: input.organizationId,
      accountId: input.accountId,
      trigger: input.trigger,
      outcome: 'running',
      startedAt: fromIso(input.startedAt)!,
      finishedAt: null,
      historyIdBefore: input.historyIdBefore ?? null,
      historyIdAfter: null,
      messagesExamined: 0,
      eventsCreated: 0,
      eventsUpdated: 0,
      messagesSkipped: 0,
      retryable: false,
      errorCode: null,
      requestId: input.requestId ?? null,
    },
  });
  return mapGmailSyncRun(row);
}

export async function finishGmailSyncRun(
  db: Client,
  input: {
    organizationId: string;
    runId: string;
    outcome: GmailSyncOutcome;
    finishedAt: string;
    historyIdAfter?: string | null;
    messagesExamined?: number;
    eventsCreated?: number;
    eventsUpdated?: number;
    messagesSkipped?: number;
    retryable?: boolean;
    errorCode?: string | null;
  },
): Promise<GmailSyncRun> {
  const row = await db.gmailSyncRun.update({
    where: { id: input.runId },
    data: {
      outcome: input.outcome,
      finishedAt: fromIso(input.finishedAt)!,
      historyIdAfter: input.historyIdAfter ?? undefined,
      messagesExamined: input.messagesExamined,
      eventsCreated: input.eventsCreated,
      eventsUpdated: input.eventsUpdated,
      messagesSkipped: input.messagesSkipped,
      retryable: input.retryable ?? false,
      errorCode: input.errorCode ?? null,
    },
  });
  if (row.organizationId !== input.organizationId) {
    throw organizationMismatch('GmailSyncRun belongs to a different organization.');
  }
  return mapGmailSyncRun(row);
}

export async function getGmailSyncRunById(
  db: Client,
  organizationId: string,
  runId: string,
): Promise<GmailSyncRun> {
  const row = await db.gmailSyncRun.findFirst({
    where: { id: runId, organizationId },
  });
  if (!row) {
    throw notFound(`GmailSyncRun ${runId} not found for organization.`);
  }
  return mapGmailSyncRun(row);
}

export type ListGmailSyncRunsQuery = {
  organizationId: string;
  cursor?: string | null;
  limit?: number;
};

export type ListGmailSyncRunsResult = {
  items: GmailSyncRun[];
  nextCursor: string | null;
};

/**
 * Organization-scoped sync-run listing (OpenAPI listGmailSyncRuns).
 * Order: startedAt DESC, then id DESC. Cursor-paginated. Non-mutating.
 */
export async function listGmailSyncRuns(
  db: Client,
  query: ListGmailSyncRunsQuery,
): Promise<ListGmailSyncRunsResult> {
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const cursor = decodeGmailSyncRunCursor(query.cursor);

  const rows = await db.gmailSyncRun.findMany({
    where: {
      organizationId: query.organizationId,
      ...(cursor
        ? {
            OR: [
              { startedAt: { lt: cursor.startedAt } },
              {
                AND: [{ startedAt: cursor.startedAt }, { id: { lt: cursor.id } }],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const page = rows.slice(0, limit);
  const items = page.map(mapGmailSyncRun);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? encodeGmailSyncRunCursor({ startedAt: last.startedAt, id: last.id })
      : null;

  return { items, nextCursor };
}

/** @deprecated Prefer listGmailSyncRuns for CursorPage contract fidelity. */
export async function listRecentGmailSyncRuns(
  db: Client,
  organizationId: string,
  limit = 20,
): Promise<GmailSyncRun[]> {
  const page = await listGmailSyncRuns(db, { organizationId, limit });
  return page.items;
}

type GmailSyncRunCursor = { startedAt: Date; id: string };

function encodeGmailSyncRunCursor(value: GmailSyncRunCursor): string {
  const payload = `${value.startedAt.toISOString()}|${value.id}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function decodeGmailSyncRunCursor(raw: string | null | undefined): GmailSyncRunCursor | null {
  if (!raw) {
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw persistenceValidation('Gmail sync-run list cursor is invalid.');
  }
  const separator = decoded.lastIndexOf('|');
  if (separator <= 0) {
    throw persistenceValidation('Gmail sync-run list cursor is invalid.');
  }
  const startedAtRaw = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  const startedAt = new Date(startedAtRaw);
  if (!id || Number.isNaN(startedAt.getTime())) {
    throw persistenceValidation('Gmail sync-run list cursor is invalid.');
  }
  return { startedAt, id };
}
