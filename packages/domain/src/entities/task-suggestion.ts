import type { OrganizationId, TaskSuggestionId } from '../types/ids.js';
import type { UtcInstant } from '../types/timestamps.js';
import type { RetentionMetadata } from '../value-objects/metadata.js';
import type { SourceReference } from '../value-objects/source-reference.js';
import type { TaskSummaryPoint } from '../value-objects/task-summary-point.js';
import type { TaskId } from '../types/ids.js';

export type TaskSuggestionStatus = 'pending' | 'approved' | 'dismissed' | 'merged';

export interface TaskSuggestion {
  id: TaskSuggestionId;
  organizationId: OrganizationId;
  status: TaskSuggestionStatus;
  summaryPoints: TaskSummaryPoint[];
  sourceReference?: SourceReference;
  proposedRecipientId?: string;
  proposedDueAt?: UtcInstant;
  proposedPriority?: 'low' | 'normal' | 'high' | 'urgent';
  voiceOriginated: boolean;
  mergedIntoTaskId?: TaskId | null;
  retention: RetentionMetadata;
  version: number;
  createdAt: UtcInstant;
  updatedAt: UtcInstant;
}

export function isTerminalSuggestionStatus(status: TaskSuggestionStatus): boolean {
  return status === 'approved' || status === 'dismissed' || status === 'merged';
}
