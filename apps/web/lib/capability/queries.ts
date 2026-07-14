import type { UtcInstant } from '@aicaa/domain';
import type { DbClient } from '@aicaa/db';
import { mapRecipientServiceError, validateRecipientCapability } from './internal';
import { mapTaskToDto, type TaskDto } from './map-to-dto';

export interface GetCapabilityTaskCommand {
  db: DbClient;
  rawToken: string;
  pepper: string;
  taskId: string;
  now: UtcInstant;
}

/**
 * Non-mutating Recipient task view (OpenAPI getCapabilityTask).
 * Does not write audit, expiry, capability status, or task version.
 */
export async function getCapabilityTask(command: GetCapabilityTaskCommand): Promise<TaskDto> {
  try {
    const ctx = await validateRecipientCapability({
      db: command.db,
      rawToken: command.rawToken,
      pepper: command.pepper,
      now: command.now,
      taskId: command.taskId,
      action: 'view_assigned_task',
      mode: 'get',
    });
    return mapTaskToDto(ctx.task, command.now);
  } catch (error) {
    mapRecipientServiceError(error);
  }
}
