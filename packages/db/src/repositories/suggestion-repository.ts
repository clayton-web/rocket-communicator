import type { TaskSuggestion } from '@aicaa/domain';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import { fromIso, mapSuggestion } from '../mappers/domain-mappers.js';
import { notFound, organizationMismatch } from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function createTaskSuggestion(
  db: Client,
  organizationId: string,
  suggestion: TaskSuggestion,
  originTaskId?: string,
): Promise<TaskSuggestion> {
  if (suggestion.organizationId !== organizationId) {
    throw organizationMismatch('Suggestion organizationId must match the persistence scope.');
  }

  const row = await db.taskSuggestion.create({
    data: {
      id: suggestion.id,
      organizationId,
      status: suggestion.status,
      summaryPoints: asJson(suggestion.summaryPoints),
      sourceReference: suggestion.sourceReference ? asJson(suggestion.sourceReference) : undefined,
      proposedRecipientId: suggestion.proposedRecipientId ?? null,
      proposedDueAt: fromIso(suggestion.proposedDueAt ?? null),
      proposedPriority: suggestion.proposedPriority ?? null,
      voiceOriginated: suggestion.voiceOriginated,
      originTaskId: originTaskId ?? null,
      mergedIntoTaskId: suggestion.mergedIntoTaskId ?? null,
      retention: asJson(suggestion.retention),
      version: suggestion.version,
      createdAt: fromIso(suggestion.createdAt) ?? new Date(),
      updatedAt: fromIso(suggestion.updatedAt) ?? new Date(),
    },
  });

  return mapSuggestion(row);
}

export async function getTaskSuggestionById(
  db: Client,
  organizationId: string,
  suggestionId: string,
): Promise<TaskSuggestion> {
  const row = await db.taskSuggestion.findFirst({
    where: { id: suggestionId, organizationId },
  });
  if (!row) {
    throw notFound(`Task suggestion ${suggestionId} not found for organization.`);
  }
  return mapSuggestion(row);
}
