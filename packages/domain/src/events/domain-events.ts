import type { UtcInstant } from '../types/timestamps.js';
import type { UserId } from '../types/ids.js';

export type DomainEventType =
  | 'suggestion.approved'
  | 'suggestion.dismissed'
  | 'suggestion.merged'
  | 'suggestion.edited'
  | 'task.created'
  | 'task.started'
  | 'task.waiting'
  | 'task.resumed'
  | 'task.completed'
  | 'task.dismissed'
  | 'task.note.added'
  | 'task.returned_to_primary'
  | 'clarification.requested'
  | 'followup.suggestion.created'
  | 'reminder.schedule.updated'
  | 'retention.schedule.updated';

export interface DomainEvent {
  type: DomainEventType;
  occurredAt: UtcInstant;
  actorUserId: UserId;
  entityId: string;
  correlationId?: string;
  payload?: Record<string, unknown>;
}
