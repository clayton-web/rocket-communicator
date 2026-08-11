import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import {
  fromIso,
  mapTaskSuggestionRevision,
  type PersistedTaskSuggestionRevision,
} from '../mappers/domain-mappers.js';
import { uniqueViolation } from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

export type TaskSuggestionRevisionAuthorKindValue = 'ai' | 'owner';

export type CreateTaskSuggestionRevisionInput = {
  id: string;
  organizationId: string;
  suggestionId: string;
  revisionNumber: number;
  authorKind: TaskSuggestionRevisionAuthorKindValue;
  summaryPoints: unknown;
  proposedDueAt?: string | null;
  proposedPriority?: 'low' | 'normal' | 'high' | 'urgent' | null;
  proposedRecipientId?: string | null;
};

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * Persist one TaskSuggestion revision-evidence row (D155).
 *
 * Create-only. Revisions are dormant append-only evidence; callers must not update, delete, or
 * upsert existing rows. Unique `(suggestionId, revisionNumber)` is numbering protection only —
 * not immutability protection.
 *
 * **Current producer:** A6 `persistSuggestionFromClaimedEvent` writes revision 0 (`authorKind =
 * ai`) atomically with a newly created Gmail-extraction TaskSuggestion. Duplicate/reclaim paths,
 * work-request, Owner-edit, approve/dismiss/merge, and interpretation must not call this for
 * backfill or additional producers until separately authorized.
 */
export async function createTaskSuggestionRevision(
  db: Client,
  input: CreateTaskSuggestionRevisionInput,
): Promise<PersistedTaskSuggestionRevision> {
  try {
    const row = await db.taskSuggestionRevision.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        suggestionId: input.suggestionId,
        revisionNumber: input.revisionNumber,
        authorKind: input.authorKind,
        summaryPoints: asJson(input.summaryPoints),
        proposedDueAt: fromIso(input.proposedDueAt ?? null),
        proposedPriority: input.proposedPriority ?? null,
        proposedRecipientId: input.proposedRecipientId ?? null,
      },
    });
    return mapTaskSuggestionRevision(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw uniqueViolation(
        `TaskSuggestion revision ${input.revisionNumber} already exists for suggestion ${input.suggestionId}.`,
      );
    }
    throw error;
  }
}

/**
 * List recorded revisions for one organization-scoped suggestion, ascending by revision number.
 *
 * Empty result means "no revision evidence has been recorded" — not absence of a proposal.
 */
export async function listTaskSuggestionRevisions(
  db: Client,
  organizationId: string,
  suggestionId: string,
): Promise<PersistedTaskSuggestionRevision[]> {
  const rows = await db.taskSuggestionRevision.findMany({
    where: { organizationId, suggestionId },
    orderBy: { revisionNumber: 'asc' },
  });
  return rows.map(mapTaskSuggestionRevision);
}

/**
 * Latest recorded revision for one organization-scoped suggestion, if any.
 *
 * Useful for upcoming producer numbering. Null means no revision evidence has been recorded.
 */
export async function getLatestTaskSuggestionRevision(
  db: Client,
  organizationId: string,
  suggestionId: string,
): Promise<PersistedTaskSuggestionRevision | null> {
  const row = await db.taskSuggestionRevision.findFirst({
    where: { organizationId, suggestionId },
    orderBy: { revisionNumber: 'desc' },
  });
  return row ? mapTaskSuggestionRevision(row) : null;
}
