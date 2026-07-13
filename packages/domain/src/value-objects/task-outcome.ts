import type { OwnerId } from '../types/ids.js';
import type { UtcInstant } from '../types/timestamps.js';
import type { ActionAttribution } from './capability.js';
import type { TaskSummaryPoint } from './task-summary-point.js';

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
  proposedRecipientId?: string;
  proposedDueAt?: UtcInstant;
  proposedPriority?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface TaskOutcome {
  outcomeType: TaskOutcomeType;
  completedAt: UtcInstant;
  attribution: ActionAttribution;
  note?: string;
  summaryPoints?: TaskSummaryPoint[];
  followUpProposal?: FollowUpProposal;
}
