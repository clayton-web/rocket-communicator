import type { GmailSyncOutcome, GmailSyncRun, GmailSyncTrigger } from '@aicaa/domain';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { fromIso, mapGmailSyncRun } from '../mappers/domain-mappers.js';
import { notFound, organizationMismatch } from '../errors/persistence-errors.js';

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

export async function listRecentGmailSyncRuns(
  db: Client,
  organizationId: string,
  limit = 20,
): Promise<GmailSyncRun[]> {
  const rows = await db.gmailSyncRun.findMany({
    where: { organizationId },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(limit, 1), 100),
  });
  return rows.map(mapGmailSyncRun);
}
