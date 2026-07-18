import type { OwnerActor, UtcInstant } from '@aicaa/domain';
import type { DbClient } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { mapDomainOrPersistenceError, requireOwnerActor } from '@/lib/tasks/internal';
import { taskServiceError } from '@/lib/tasks/errors';
import { mapSuggestionToDto, type TaskSuggestionDto } from '@/lib/capability/map-to-dto';

export interface ListOwnerSuggestionsCommand {
  db: DbClient;
  owner: OwnerActor;
  cursor?: string | null;
  limit?: number;
}

export interface ListOwnerSuggestionsResult {
  items: TaskSuggestionDto[];
  nextCursor: string | null;
}

export async function listOwnerSuggestions(
  command: ListOwnerSuggestionsCommand,
): Promise<ListOwnerSuggestionsResult> {
  const owner = requireOwnerActor(command.owner);
  try {
    const { listTaskSuggestions } = await loadDbRuntime();
    const page = await listTaskSuggestions(command.db, {
      organizationId: owner.organizationId,
      cursor: command.cursor,
      limit: command.limit,
    });
    return {
      items: page.items.map(mapSuggestionToDto),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}

export interface GetOwnerSuggestionCommand {
  db: DbClient;
  owner: OwnerActor;
  suggestionId: string;
  now: UtcInstant;
}

export async function getOwnerSuggestion(
  command: GetOwnerSuggestionCommand,
): Promise<TaskSuggestionDto> {
  const owner = requireOwnerActor(command.owner);
  if (!command.suggestionId?.trim()) {
    throw taskServiceError('VALIDATION_ERROR', 'suggestionId is required.', [
      { field: 'suggestionId', message: 'Required.' },
    ]);
  }
  try {
    const { getTaskSuggestionById } = await loadDbRuntime();
    const suggestion = await getTaskSuggestionById(
      command.db,
      owner.organizationId,
      command.suggestionId,
    );
    return mapSuggestionToDto(suggestion);
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}
