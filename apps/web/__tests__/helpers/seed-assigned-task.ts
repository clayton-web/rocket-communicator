import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  asAssignmentId,
  asOwnerId,
  asRecipientId,
  type OwnerActor,
  type TaskSummaryPoint,
} from '@aicaa/domain';
import { createActiveAssignment, type DbClient } from '@aicaa/db';
import { createOwnerTask, type CreateOwnerTaskResult } from '@/lib/tasks';

/**
 * Seed an assigned Task fixture without the create-with-assignment task-service path, which was
 * removed in A7.6 (D091). Creates an unassigned Task through the real service, then attaches an
 * active assignment through the persistence layer.
 */
export async function seedAssignedTaskViaService(input: {
  db: DbClient;
  org: string;
  owner: OwnerActor;
  now: string;
  summaryPoints: TaskSummaryPoint[];
  taskId: string;
  assignmentId: string;
  recipientId: string;
  recipientEmail: string;
  auditId?: string;
}): Promise<CreateOwnerTaskResult> {
  const created = await createOwnerTask({
    db: input.db,
    owner: input.owner,
    now: input.now,
    summaryPoints: input.summaryPoints,
    taskId: input.taskId,
    auditId: input.auditId,
  });

  await createActiveAssignment(input.db, input.org, input.taskId, {
    id: asAssignmentId(input.assignmentId),
    recipientId: asRecipientId(input.recipientId),
    intendedRecipientEmail: input.recipientEmail,
    assignedAt: input.now,
    assignedByOwnerId: asOwnerId(input.owner.ownerId),
    assignmentApprovedAt: input.now,
    allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
  });

  return created;
}
