import type { OwnerActor, UtcInstant } from '@aicaa/domain';
import type { DbClient } from '@aicaa/db';
import {
  loadOwnerTask,
  listTasksFromDb,
  mapDomainOrPersistenceError,
  requireOwnerActor,
} from './internal';
import { mapTaskToDto, type TaskDto } from './map-to-dto';
import { taskServiceError } from './errors';

export interface ListOwnerTasksCommand {
  db: DbClient;
  owner: OwnerActor;
  now: UtcInstant;
  cursor?: string | null;
  limit?: number;
}

export interface ListOwnerTasksResult {
  items: TaskDto[];
  nextCursor: string | null;
}

/**
 * Organization-scoped task listing (OpenAPI listTasks).
 * Ordering: `updatedAt` DESC, then `id` DESC (contracted).
 * Includes dismissed tasks (contracted; no status filter). Non-mutating.
 */
export async function listOwnerTasks(
  command: ListOwnerTasksCommand,
): Promise<ListOwnerTasksResult> {
  const owner = requireOwnerActor(command.owner);
  try {
    const page = await listTasksFromDb(command.db, {
      organizationId: owner.organizationId,
      cursor: command.cursor,
      limit: command.limit,
    });
    return {
      items: page.items.map((task) => mapTaskToDto(task, command.now)),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}

export interface GetOwnerTaskCommand {
  db: DbClient;
  owner: OwnerActor;
  taskId: string;
  now: UtcInstant;
}

/** Organization-scoped get. Foreign-org tasks surface as not found. Non-mutating. */
export async function getOwnerTask(command: GetOwnerTaskCommand): Promise<TaskDto> {
  const owner = requireOwnerActor(command.owner);
  if (!command.taskId?.trim()) {
    throw taskServiceError('VALIDATION_ERROR', 'taskId is required.', [
      { field: 'taskId', message: 'Required.' },
    ]);
  }
  const task = await loadOwnerTask(command.db, owner, command.taskId);
  return mapTaskToDto(task, command.now);
}
