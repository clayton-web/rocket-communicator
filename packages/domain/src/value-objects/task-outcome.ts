import type { TaskSummaryPoint } from './task-summary-point.js';
import type { UserId } from '../types/ids.js';
import type { UtcInstant } from '../types/timestamps.js';

export type TaskOutcomeType =
  | 'completed'
  | 'spoke_with_contact'
  | 'email_sent'
  | 'text_sent'
  | 'scheduled'
  | 'information_provided'
  | 'no_action_required'
  | 'other';

export interface FollowUpProposal {
  summaryPoints: TaskSummaryPoint[];
  proposedAssigneeUserId?: UserId;
  proposedDueAt?: UtcInstant;
  proposedPriority?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface TaskOutcome {
  outcomeType: TaskOutcomeType;
  completedAt: UtcInstant;
  completedByUserId: UserId;
  note?: string;
  summaryPoints?: TaskSummaryPoint[];
  followUpProposal?: FollowUpProposal;
}
