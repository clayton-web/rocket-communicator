import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import {
  fromIso,
  mapResponsibilitySelection,
  type PersistedResponsibilitySelection,
} from '../mappers/domain-mappers.js';
import { persistenceValidation, uniqueViolation } from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

export type ResponsibilitySelectionPartyKindValue = 'owner' | 'recipient';

/**
 * One acceptance-time Owner responsibility selection (D168).
 *
 * `partyKind` carries the whole affirmative answer. `recipientId` is required when and only when
 * `partyKind = 'recipient'`; a null `recipientId` is never itself evidence of an Owner selection.
 */
export type CreateResponsibilitySelectionInput = {
  id: string;
  organizationId: string;
  suggestionId: string;
  taskId: string;
  partyKind: ResponsibilitySelectionPartyKindValue;
  recipientId?: string | null;
  /** Authenticated Owner whose approval action made the selection. */
  selectedByOwnerId: string;
  selectedAt: string;
};

/**
 * Reject a selection whose kind and Recipient disagree, before it reaches the database.
 *
 * The migration CHECK constraint is the authority; this exists so callers get a structured
 * `VALIDATION` failure with a useful message instead of a raw constraint violation, and so an
 * inconsistent selection cannot be smuggled in through a caller that skipped its own validation.
 */
function assertConsistentSelection(input: CreateResponsibilitySelectionInput): string | null {
  const recipientId =
    input.recipientId != null && input.recipientId !== '' ? input.recipientId : null;
  if (input.partyKind === 'owner' && recipientId !== null) {
    throw persistenceValidation(
      'Owner responsibility selection must not carry a recipientId (D168).',
    );
  }
  if (input.partyKind === 'recipient' && recipientId === null) {
    throw persistenceValidation(
      'Recipient responsibility selection requires a recipientId (D168).',
    );
  }
  return recipientId;
}

/**
 * Persist one acceptance-time responsibility-selection evidence row (D168).
 *
 * Create-only, append-only historical evidence. Callers must not update, delete, or upsert rows:
 * this records the Owner's **initial** decision at acceptance, not current responsibility, and
 * never becomes a responsibility history stream or a current-responsibility projection.
 *
 * **Caller obligations.** Organization-scoped Recipient validation belongs to the caller and must
 * happen inside the same transaction (see `persistApproveTaskSuggestion`). Recording a Recipient
 * selection creates no TaskAssignment, TaskCapability, or HandoffAttempt and sends nothing.
 *
 * **Current producer:** `persistApproveTaskSuggestion`, inside the existing approve transaction,
 * when the Owner supplies a responsibility selection. There is no later best-effort write path.
 */
export async function createResponsibilitySelection(
  db: Client,
  input: CreateResponsibilitySelectionInput,
): Promise<PersistedResponsibilitySelection> {
  const recipientId = assertConsistentSelection(input);
  try {
    const row = await db.taskSuggestionResponsibilitySelection.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        suggestionId: input.suggestionId,
        taskId: input.taskId,
        partyKind: input.partyKind,
        recipientId,
        selectedByOwnerId: input.selectedByOwnerId,
        selectedAt: fromIso(input.selectedAt)!,
      },
    });
    return mapResponsibilitySelection(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw uniqueViolation(
        `A responsibility selection already exists for suggestion ${input.suggestionId}.`,
      );
    }
    throw error;
  }
}

/**
 * The recorded acceptance-time selection for one organization-scoped suggestion, if any.
 *
 * Null means **no responsibility-selection evidence has been recorded** — never that the Owner
 * selected Me, and never that responsibility is unknown to the rest of the system (D155, D164).
 */
export async function getResponsibilitySelectionBySuggestionId(
  db: Client,
  organizationId: string,
  suggestionId: string,
): Promise<PersistedResponsibilitySelection | null> {
  const row = await db.taskSuggestionResponsibilitySelection.findFirst({
    where: { organizationId, suggestionId },
  });
  return row ? mapResponsibilitySelection(row) : null;
}

/**
 * The recorded acceptance-time selection for one organization-scoped Task, if any.
 *
 * This is the Owner's initial choice at acceptance. It must not be read as the Task's current
 * responsibility, assignee, or custody: current external assignment truth lives in TaskAssignment.
 */
export async function getResponsibilitySelectionByTaskId(
  db: Client,
  organizationId: string,
  taskId: string,
): Promise<PersistedResponsibilitySelection | null> {
  const row = await db.taskSuggestionResponsibilitySelection.findFirst({
    where: { organizationId, taskId },
  });
  return row ? mapResponsibilitySelection(row) : null;
}
