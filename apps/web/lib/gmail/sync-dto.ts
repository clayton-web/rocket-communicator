import 'server-only';
import type { GmailSyncRun } from '@aicaa/domain';
import type { components } from '@aicaa/contracts/schema';

export type GmailSyncRunDto = components['schemas']['GmailSyncRun'];

/**
 * Safe Owner-facing sync-run DTO. Omits historyId, organizationId, and accountId.
 * Never includes tokens or message content (those fields are absent on the domain object).
 */
export function mapSyncRunToDto(run: GmailSyncRun): GmailSyncRunDto {
  return {
    id: run.id,
    trigger: run.trigger,
    outcome: run.outcome,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? undefined,
    messagesExamined: run.messagesExamined,
    eventsCreated: run.eventsCreated,
    eventsUpdated: run.eventsUpdated,
    messagesSkipped: run.messagesSkipped,
    retryable: run.retryable,
    errorCode: run.errorCode ?? undefined,
    requestId: run.requestId ?? undefined,
  };
}
