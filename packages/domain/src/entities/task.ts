import type { OrganizationId, RecipientId, TaskId } from '../types/ids.js';
import type { UtcInstant } from '../types/timestamps.js';
import type { ReminderMetadata, RetentionMetadata } from '../value-objects/metadata.js';
import type { SourceReference } from '../value-objects/source-reference.js';
import type { TaskAssignment } from '../value-objects/task-assignment.js';
import type { TaskNote } from '../value-objects/task-note.js';
import type { TaskOutcome } from '../value-objects/task-outcome.js';
import type { TaskSummaryPoint } from '../value-objects/task-summary-point.js';

export type TaskStatus = 'open' | 'in_progress' | 'waiting' | 'completed' | 'dismissed';

export type ActionableTaskStatus = 'open' | 'in_progress';

export interface Task {
  id: TaskId;
  organizationId: OrganizationId;
  status: TaskStatus;
  priorActionableStatus?: ActionableTaskStatus | null;
  summaryPoints: TaskSummaryPoint[];
  assignment?: TaskAssignment;
  sourceReference?: SourceReference;
  dueAt?: UtcInstant | null;
  waitingUntil?: UtcInstant | null;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  outcome?: TaskOutcome;
  notes: TaskNote[];
  reminder: ReminderMetadata;
  retention: RetentionMetadata;
  version: number;
  createdAt: UtcInstant;
  updatedAt: UtcInstant;
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'dismissed';
}

export function isActionableTaskStatus(status: TaskStatus): status is ActionableTaskStatus {
  return status === 'open' || status === 'in_progress';
}

export function isAssignedToRecipient(task: Task, recipientId: RecipientId): boolean {
  return task.assignment?.recipientId === recipientId;
}

/** @deprecated Use isAssignedToRecipient */
export function isAssignedTo(task: Task, recipientId: string): boolean {
  return task.assignment?.recipientId === recipientId;
}
