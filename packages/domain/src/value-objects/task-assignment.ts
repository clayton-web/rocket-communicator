import type { UserId } from '../types/ids.js';
import type { UtcInstant } from '../types/timestamps.js';

export interface TaskAssignment {
  assigneeUserId: UserId;
  assignedAt: UtcInstant;
  assignedByUserId: UserId;
  assignmentApprovedAt?: UtcInstant;
}
