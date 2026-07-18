import type {
  CommunicationEventId,
  OrganizationId,
  TaskId,
  TaskSuggestionId,
} from '../types/ids.js';
import type { UtcInstant } from '../types/timestamps.js';
import type { RetentionMetadata } from '../value-objects/metadata.js';
import type { SourceReference } from '../value-objects/source-reference.js';
import type { TaskSummaryPoint } from '../value-objects/task-summary-point.js';

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
  /**
   * Authoritative Gmail-origin link (D081). Null for work-request / non-event suggestions.
   * At most one suggestion per CommunicationEvent when non-null.
   */
  sourceCommunicationEventId?: CommunicationEventId | null;
  /**
   * Task created by Owner approve of this suggestion (D080/D082).
   * Used for durable Task → excerpt terminal retention lookup.
   */
  approvedTaskId?: TaskId | null;
  mergedIntoTaskId?: TaskId | null;
  retention: RetentionMetadata;
  version: number;
  createdAt: UtcInstant;
  updatedAt: UtcInstant;
}

export function isTerminalSuggestionStatus(status: TaskSuggestionStatus): boolean {
  return status === 'approved' || status === 'dismissed' || status === 'merged';
}
