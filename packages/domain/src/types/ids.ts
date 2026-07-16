export type OrganizationId = string & { readonly __brand: 'OrganizationId' };
export type OwnerId = string & { readonly __brand: 'OwnerId' };
export type RecipientId = string & { readonly __brand: 'RecipientId' };
export type AssignmentId = string & { readonly __brand: 'AssignmentId' };
export type CapabilityId = string & { readonly __brand: 'CapabilityId' };
export type TaskId = string & { readonly __brand: 'TaskId' };
export type TaskSuggestionId = string & { readonly __brand: 'TaskSuggestionId' };
export type SummaryPointId = string & { readonly __brand: 'SummaryPointId' };
export type SourceReferenceId = string & { readonly __brand: 'SourceReferenceId' };
export type CommunicationAccountId = string & { readonly __brand: 'CommunicationAccountId' };
export type CommunicationEventId = string & { readonly __brand: 'CommunicationEventId' };
export type GmailSyncRunId = string & { readonly __brand: 'GmailSyncRunId' };
export type TemporaryCommunicationExcerptId = string & {
  readonly __brand: 'TemporaryCommunicationExcerptId';
};

/** @deprecated Use OwnerId. Retained for transitional mapping only. */
export type UserId = OwnerId;

export function asOrganizationId(value: string): OrganizationId {
  return value as OrganizationId;
}

export function asOwnerId(value: string): OwnerId {
  return value as OwnerId;
}

/** @deprecated Use asOwnerId */
export function asUserId(value: string): OwnerId {
  return asOwnerId(value);
}

export function asRecipientId(value: string): RecipientId {
  return value as RecipientId;
}

export function asAssignmentId(value: string): AssignmentId {
  return value as AssignmentId;
}

export function asCapabilityId(value: string): CapabilityId {
  return value as CapabilityId;
}

export function asTaskId(value: string): TaskId {
  return value as TaskId;
}

export function asTaskSuggestionId(value: string): TaskSuggestionId {
  return value as TaskSuggestionId;
}

export function asCommunicationAccountId(value: string): CommunicationAccountId {
  return value as CommunicationAccountId;
}

export function asCommunicationEventId(value: string): CommunicationEventId {
  return value as CommunicationEventId;
}

export function asGmailSyncRunId(value: string): GmailSyncRunId {
  return value as GmailSyncRunId;
}

export function asTemporaryCommunicationExcerptId(value: string): TemporaryCommunicationExcerptId {
  return value as TemporaryCommunicationExcerptId;
}
