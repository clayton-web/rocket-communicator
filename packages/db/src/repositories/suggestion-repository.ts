import type { TaskSuggestion } from '@aicaa/domain';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import { fromIso, mapSuggestion } from '../mappers/domain-mappers.js';
import {
  notFound,
  optimisticConcurrency,
  organizationMismatch,
  persistenceValidation,
  uniqueViolation,
} from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
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

  try {
    const row = await db.taskSuggestion.create({
      data: {
        id: suggestion.id,
        organizationId,
        status: suggestion.status,
        summaryPoints: asJson(suggestion.summaryPoints),
        sourceReference: suggestion.sourceReference
          ? asJson(suggestion.sourceReference)
          : undefined,
        proposedRecipientId: suggestion.proposedRecipientId ?? null,
        proposedDueAt: fromIso(suggestion.proposedDueAt ?? null),
        proposedPriority: suggestion.proposedPriority ?? null,
        voiceOriginated: suggestion.voiceOriginated,
        originTaskId: originTaskId ?? null,
        sourceCommunicationEventId: suggestion.sourceCommunicationEventId ?? null,
        approvedTaskId: suggestion.approvedTaskId ?? null,
        mergedIntoTaskId: suggestion.mergedIntoTaskId ?? null,
        retention: asJson(suggestion.retention),
        version: suggestion.version,
        createdAt: fromIso(suggestion.createdAt) ?? new Date(),
        updatedAt: fromIso(suggestion.updatedAt) ?? new Date(),
      },
    });

    return mapSuggestion(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw uniqueViolation(
        `TaskSuggestion already exists for sourceCommunicationEventId ${suggestion.sourceCommunicationEventId}.`,
      );
    }
    throw error;
  }
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

export async function getTaskSuggestionBySourceEventId(
  db: Client,
  organizationId: string,
  sourceCommunicationEventId: string,
): Promise<TaskSuggestion | null> {
  const row = await db.taskSuggestion.findFirst({
    where: { sourceCommunicationEventId, organizationId },
  });
  return row ? mapSuggestion(row) : null;
}

export interface ListTaskSuggestionsQuery {
  organizationId: string;
  /** Opaque cursor from a prior page (`nextCursor`). */
  cursor?: string | null;
  /** Page size (1–100). Defaults to 25 to match OpenAPI Limit. */
  limit?: number;
  /** Optional status filter (contract lists all when omitted). */
  status?: TaskSuggestion['status'];
}

export interface ListTaskSuggestionsResult {
  items: TaskSuggestion[];
  nextCursor: string | null;
}

/**
 * Organization-scoped suggestion listing.
 * Order: `updatedAt` DESC, then `id` DESC (matches listTasks / OpenAPI CursorPage).
 */
export async function listTaskSuggestions(
  db: Client,
  query: ListTaskSuggestionsQuery,
): Promise<ListTaskSuggestionsResult> {
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const cursor = decodeSuggestionListCursor(query.cursor);

  const rows = await db.taskSuggestion.findMany({
    where: {
      organizationId: query.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(cursor
        ? {
            OR: [
              { updatedAt: { lt: cursor.updatedAt } },
              {
                AND: [{ updatedAt: cursor.updatedAt }, { id: { lt: cursor.id } }],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const page = rows.slice(0, limit);
  const items = page.map(mapSuggestion);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? encodeSuggestionListCursor({ updatedAt: last.updatedAt, id: last.id })
      : null;

  return { items, nextCursor };
}

type SuggestionListCursor = { updatedAt: Date; id: string };

function encodeSuggestionListCursor(value: SuggestionListCursor): string {
  const payload = `${value.updatedAt.toISOString()}|${value.id}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function decodeSuggestionListCursor(raw: string | null | undefined): SuggestionListCursor | null {
  if (!raw) {
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw persistenceValidation('Task suggestion list cursor is invalid.');
  }
  const separator = decoded.lastIndexOf('|');
  if (separator <= 0) {
    throw persistenceValidation('Task suggestion list cursor is invalid.');
  }
  const updatedAtIso = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  const updatedAt = new Date(updatedAtIso);
  if (!id || Number.isNaN(updatedAt.getTime())) {
    throw persistenceValidation('Task suggestion list cursor is invalid.');
  }
  return { updatedAt, id };
}

/**
 * Persist a full suggestion snapshot only when the expected version matches.
 */
export async function updateTaskSuggestionWithExpectedVersion(
  db: Client,
  organizationId: string,
  expectedVersion: number,
  suggestion: TaskSuggestion,
): Promise<TaskSuggestion> {
  if (suggestion.organizationId !== organizationId) {
    throw organizationMismatch('Suggestion organizationId must match the persistence scope.');
  }

  const result = await db.taskSuggestion.updateMany({
    where: { id: suggestion.id, organizationId, version: expectedVersion },
    data: {
      status: suggestion.status,
      summaryPoints: asJson(suggestion.summaryPoints),
      sourceReference: suggestion.sourceReference
        ? asJson(suggestion.sourceReference)
        : Prisma.JsonNull,
      proposedRecipientId: suggestion.proposedRecipientId ?? null,
      proposedDueAt: fromIso(suggestion.proposedDueAt ?? null),
      proposedPriority: suggestion.proposedPriority ?? null,
      voiceOriginated: suggestion.voiceOriginated,
      sourceCommunicationEventId: suggestion.sourceCommunicationEventId ?? null,
      approvedTaskId: suggestion.approvedTaskId ?? null,
      mergedIntoTaskId: suggestion.mergedIntoTaskId ?? null,
      retention: asJson(suggestion.retention),
      version: suggestion.version,
      updatedAt: fromIso(suggestion.updatedAt) ?? new Date(),
    },
  });

  if (result.count !== 1) {
    throw optimisticConcurrency(
      `Task suggestion ${suggestion.id} version ${expectedVersion} was not current.`,
    );
  }

  return getTaskSuggestionById(db, organizationId, suggestion.id);
}
