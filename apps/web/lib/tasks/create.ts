import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  asAssignmentId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  createStandaloneTask,
  type OwnerActor,
  type SourceReference,
  type TaskAssignment,
  type TaskSummaryPoint,
  type UtcInstant,
} from '@aicaa/domain';
import {
  createAuditEvent,
  createTask,
  getRecipientById,
  type AuditEventRecord,
  type DbClient,
} from '@aicaa/db';
import {
  buildOwnerAudit,
  mapDomainOrPersistenceError,
  newEntityId,
  requireOwnerActor,
} from './internal';
import { mapTaskToDto, type TaskDto } from './map-to-dto';
import { taskServiceError } from './errors';

export interface CreateOwnerTaskCommand {
  db: DbClient;
  owner: OwnerActor;
  now: UtcInstant;
  summaryPoints: TaskSummaryPoint[];
  /** When set, create an active assignment for an existing Recipient in the Owner org. */
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
 * Optional `recipientId` creates an assignment from an existing Recipient record.
 */
export async function createOwnerTask(
  command: CreateOwnerTaskCommand,
): Promise<CreateOwnerTaskResult> {
  const owner = requireOwnerActor(command.owner);

  try {
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

    let assignment: TaskAssignment | undefined;
    if (command.recipientId) {
      const recipient = await getRecipientById(
        command.db,
        owner.organizationId,
        command.recipientId,
      );
      if (!recipient.active) {
        throw taskServiceError('ASSIGNMENT_PRECONDITION', 'Recipient is not active.', [
          { field: 'recipientId', message: 'Inactive recipients cannot be assigned.' },
        ]);
      }
      assignment = {
        id: asAssignmentId(command.assignmentId ?? newEntityId('asg')),
        recipientId: asRecipientId(recipient.id),
        intendedRecipientEmail: recipient.email,
        assignedAt: command.now,
        assignedByOwnerId: asOwnerId(owner.ownerId),
        assignmentApprovedAt: command.now,
        allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
      };
    }

    const persisted = await command.db.$transaction(async (tx) => {
      const task = await createTask(tx, owner.organizationId, domainTask, assignment);
      const audit = await createAuditEvent(
        tx,
        buildOwnerAudit({
          id: command.auditId ?? newEntityId('audit'),
          owner,
          action: 'create_task',
          taskId: task.id,
          now: command.now,
          resourceVersion: task.version,
          taskStatus: task.status,
          assignmentId: assignment?.id,
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
