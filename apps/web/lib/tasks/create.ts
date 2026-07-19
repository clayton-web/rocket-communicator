import {
  asOrganizationId,
  asTaskId,
  createStandaloneTask,
  type OwnerActor,
  type SourceReference,
  type TaskSummaryPoint,
  type UtcInstant,
} from '@aicaa/domain';
import type { AuditEventRecord, DbClient } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import {
  buildOwnerAudit,
  mapDomainOrPersistenceError,
  newEntityId,
  requireOwnerActor,
} from './internal';
import { mapTaskToDto, type TaskDto } from './map-to-dto';
import { taskServiceError } from './errors';
import { RECIPIENT_HANDOFF_REJECTION_MESSAGE } from './validate-body';

export interface CreateOwnerTaskCommand {
  db: DbClient;
  owner: OwnerActor;
  now: UtcInstant;
  summaryPoints: TaskSummaryPoint[];
  /**
   * D091 / A7.6: legacy field retained only as a defensive guard. Any supplied value is rejected;
   * assignment occurs solely through the dedicated handoff workflow. Never creates an Assignment.
   */
  recipientId?: string;
  dueAt?: UtcInstant;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  sourceReference?: SourceReference;
  taskId?: string;
  assignmentId?: string;
  requestId?: string;
  correlationId?: string | null;
  auditId?: string;
}

export interface CreateOwnerTaskResult {
  task: TaskDto;
  audit: AuditEventRecord;
}

/**
 * Owner typed standalone task creation (CreateTaskRequest).
 * D091 / A7.6: always creates an unassigned Task. A supplied `recipientId` is rejected as a
 * defensive invariant; there is no create-with-assignment path. Assignment happens only through
 * the dedicated handoff workflow.
 */
export async function createOwnerTask(
  command: CreateOwnerTaskCommand,
): Promise<CreateOwnerTaskResult> {
  const owner = requireOwnerActor(command.owner);

  // Defensive invariant: an internal caller must not create an Assignment via legacy recipient
  // assignment data. This is never reached from the HTTP route (the parser rejects it first).
  if (command.recipientId !== undefined) {
    throw taskServiceError('RECIPIENT_HANDOFF_NOT_AVAILABLE', RECIPIENT_HANDOFF_REJECTION_MESSAGE);
  }

  try {
    const dbRuntime = await loadDbRuntime();
    const taskId = asTaskId(command.taskId ?? newEntityId('task'));
    const domainTask = createStandaloneTask({
      actor: owner,
      now: command.now,
      id: taskId,
      organizationId: asOrganizationId(owner.organizationId),
      summaryPoints: command.summaryPoints,
      dueAt: command.dueAt,
      priority: command.priority,
      sourceReference: command.sourceReference,
    });

    const persisted = await command.db.$transaction(async (tx) => {
      const task = await dbRuntime.createTask(tx, owner.organizationId, domainTask);
      const audit = await dbRuntime.createAuditEvent(
        tx,
        buildOwnerAudit({
          id: command.auditId ?? newEntityId('audit'),
          owner,
          action: 'create_task',
          taskId: task.id,
          now: command.now,
          resourceVersion: task.version,
          taskStatus: task.status,
          requestId: command.requestId,
          correlationId: command.correlationId,
        }),
      );
      return { task, audit };
    });

    return {
      task: mapTaskToDto(persisted.task, command.now),
      audit: persisted.audit,
    };
  } catch (error) {
    mapDomainOrPersistenceError(error);
  }
}
