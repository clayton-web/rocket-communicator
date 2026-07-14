import { formatETag, type TaskSuggestion, type UtcInstant } from '@aicaa/domain';
import type { components } from '@aicaa/contracts/schema';
import {
  mapTaskToDto,
  mapAssignmentToDto,
  mapNoteToDto,
  mapOutcomeToDto,
  mapAttributionToDto,
  type TaskDto,
  type TaskAssignmentDto,
  type TaskNoteDto,
} from '@/lib/tasks/map-to-dto';

export type TaskSuggestionDto = components['schemas']['TaskSuggestion'];
export type SubmitWorkRequestResponseDto = components['schemas']['SubmitWorkRequestResponse'];

export {
  mapTaskToDto,
  mapAssignmentToDto,
  mapNoteToDto,
  mapOutcomeToDto,
  mapAttributionToDto,
  type TaskDto,
  type TaskAssignmentDto,
  type TaskNoteDto,
};

/**
 * Map a domain TaskSuggestion to the OpenAPI TaskSuggestion DTO.
 * Never exposes Prisma fields or capability secrets.
 */
export function mapSuggestionToDto(suggestion: TaskSuggestion): TaskSuggestionDto {
  return {
    id: suggestion.id,
    organizationId: suggestion.organizationId,
    status: suggestion.status,
    summaryPoints: suggestion.summaryPoints as TaskSuggestionDto['summaryPoints'],
    sourceReference: suggestion.sourceReference as TaskSuggestionDto['sourceReference'],
    proposedRecipientId: suggestion.proposedRecipientId ?? null,
    proposedDueAt: suggestion.proposedDueAt ?? null,
    proposedPriority: suggestion.proposedPriority,
    voiceOriginated: suggestion.voiceOriginated,
    mergedIntoTaskId: suggestion.mergedIntoTaskId ?? null,
    retention: suggestion.retention as TaskSuggestionDto['retention'],
    version: suggestion.version,
    etag: formatETag('task-suggestion', suggestion.id, suggestion.version),
    createdAt: suggestion.createdAt,
    updatedAt: suggestion.updatedAt,
  };
}

export function mapWorkRequestResponse(input: {
  suggestion: TaskSuggestion;
  task: Parameters<typeof mapTaskToDto>[0];
  now: UtcInstant;
}): SubmitWorkRequestResponseDto {
  return {
    suggestion: mapSuggestionToDto(input.suggestion),
    task: mapTaskToDto(input.task, input.now),
  };
}
