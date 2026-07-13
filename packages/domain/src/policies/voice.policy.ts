import { forbiddenError } from '../errors/domain-errors.js';

export function assertVoiceCannotCreateTask(): void {
  throw forbiddenError('Voice interactions cannot create tasks directly.');
}

export function assertFollowUpRequiresSuggestion(): void {
  // Follow-up proposals are always modeled as Task Suggestions until approved.
}
