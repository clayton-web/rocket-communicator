import {
  deriveTaskUrgency,
  formatETag,
  type ActionAttribution,
  type Task,
  type TaskAssignment,
  type TaskNote,
  type TaskOutcome,
  type UtcInstant,
} from '@aicaa/domain';
import type { components } from '@aicaa/contracts/schema';

export type TaskDto = components['schemas']['Task'];
export type TaskAssignmentDto = components['schemas']['TaskAssignment'];
export type TaskNoteDto = components['schemas']['TaskNote'];
export type TaskOutcomeDto = components['schemas']['TaskOutcome'];
export type ActionAttributionDto = components['schemas']['ActionAttribution'];

/**
 * Map a domain Task to the OpenAPI Task DTO.
 * Never passes through Prisma records. Adds `etag` and read-time `derivedUrgency`.
 */
export function mapTaskToDto(task: Task, now: UtcInstant = task.updatedAt): TaskDto {
  return {
    id: task.id,
    organizationId: task.organizationId,
    status: task.status,
    priorActionableStatus: task.priorActionableStatus ?? null,
    summaryPoints: task.summaryPoints as TaskDto['summaryPoints'],
    assignment: task.assignment ? mapAssignmentToDto(task.assignment) : undefined,
    sourceReference: task.sourceReference as TaskDto['sourceReference'],
    dueAt: task.dueAt ?? null,
    waitingUntil: task.waitingUntil ?? null,
    priority: task.priority,
    derivedUrgency: deriveTaskUrgency(task.status, task.dueAt ?? null, now),
    outcome: task.outcome ? mapOutcomeToDto(task.outcome) : undefined,
    notes: task.notes.map(mapNoteToDto),
    reminder: task.reminder as TaskDto['reminder'],
    retention: task.retention as TaskDto['retention'],
    version: task.version,
    etag: formatETag('task', task.id, task.version),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function mapAssignmentToDto(assignment: TaskAssignment): TaskAssignmentDto {
  return {
    id: assignment.id,
    recipientId: assignment.recipientId,
    intendedRecipientEmail: assignment.intendedRecipientEmail,
    assignedAt: assignment.assignedAt,
    assignedByOwnerId: assignment.assignedByOwnerId,
    assignmentApprovedAt: assignment.assignmentApprovedAt,
    allowedCapabilityActions:
      assignment.allowedCapabilityActions as TaskAssignmentDto['allowedCapabilityActions'],
    capabilityStatus: assignment.capabilityStatus,
    deliveryStatus: assignment.deliveryStatus,
    activeCapabilityId: assignment.activeCapabilityId ?? null,
  };
}

export function mapNoteToDto(note: TaskNote): TaskNoteDto {
  return {
    id: note.id,
    body: note.body,
    createdAt: note.createdAt,
    attribution: mapAttributionToDto(note.attribution),
  };
}

export function mapOutcomeToDto(outcome: TaskOutcome): TaskOutcomeDto {
  return {
    outcomeType: outcome.outcomeType,
    completedAt: outcome.completedAt,
    attribution: mapAttributionToDto(outcome.attribution),
    note: outcome.note,
    summaryPoints: outcome.summaryPoints as TaskOutcomeDto['summaryPoints'],
    followUpProposal: outcome.followUpProposal as TaskOutcomeDto['followUpProposal'],
  };
}

export function mapAttributionToDto(attribution: ActionAttribution): ActionAttributionDto {
  if (attribution.kind === 'owner') {
    return {
      kind: 'owner',
      owner: {
        ownerId: attribution.owner.ownerId,
        recordedAt: attribution.owner.recordedAt,
        requestId: attribution.owner.requestId,
        correlationId: attribution.owner.correlationId ?? null,
      },
    };
  }

  return {
    kind: 'capability',
    capability: {
      capabilityId: attribution.capability.capabilityId,
      assignmentId: attribution.capability.assignmentId,
      taskId: attribution.capability.taskId,
      intendedRecipientEmail: attribution.capability.intendedRecipientEmail,
      action: attribution.capability.action,
      recordedAt: attribution.capability.recordedAt,
      outcome: attribution.capability.outcome,
      resourceVersion: attribution.capability.resourceVersion,
      taskStatus: attribution.capability.taskStatus,
      note: attribution.capability.note,
      requestId: attribution.capability.requestId,
      correlationId: attribution.capability.correlationId ?? null,
      attributionLabel: attribution.capability.attributionLabel,
    },
  };
}
