import type { UtcInstant } from '../types/timestamps.js';
import type { ActionAttribution } from '../value-objects/capability.js';

export type DomainEventType =
  | 'suggestion.approved'
  | 'suggestion.dismissed'
  | 'suggestion.merged'
  | 'suggestion.edited'
  | 'suggestion.created_from_work_request'
  | 'task.created'
  | 'task.started'
  | 'task.waiting'
  | 'task.resumed'
  | 'task.completed'
  | 'task.dismissed'
  | 'task.snoozed'
  | 'task.note.added'
  | 'task.returned_to_owner'
  | 'capability.issued'
  | 'capability.revoked'
  | 'capability.expired'
  | 'clarification.requested'
  | 'followup.suggestion.created'
  | 'reminder.schedule.updated'
  | 'retention.schedule.updated';

/** Truthful attribution for domain events (D051, D052, D057). */
export interface DomainEvent {
  type: DomainEventType;
  occurredAt: UtcInstant;
  attribution: ActionAttribution;
  entityId: string;
  correlationId?: string;
  requestId?: string;
  payload?: Record<string, unknown>;
}
