export type OrganizationId = string & { readonly __brand: 'OrganizationId' };
export type UserId = string & { readonly __brand: 'UserId' };
export type TaskId = string & { readonly __brand: 'TaskId' };
export type TaskSuggestionId = string & { readonly __brand: 'TaskSuggestionId' };
export type SummaryPointId = string & { readonly __brand: 'SummaryPointId' };
export type SourceReferenceId = string & { readonly __brand: 'SourceReferenceId' };

export function asOrganizationId(value: string): OrganizationId {
  return value as OrganizationId;
}

export function asUserId(value: string): UserId {
  return value as UserId;
}

export function asTaskId(value: string): TaskId {
  return value as TaskId;
}

export function asTaskSuggestionId(value: string): TaskSuggestionId {
  return value as TaskSuggestionId;
}
