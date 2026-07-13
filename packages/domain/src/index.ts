export type {
  OrganizationId,
  UserId,
  TaskId,
  TaskSuggestionId,
  SummaryPointId,
  SourceReferenceId,
} from './types/ids.js';
export { asOrganizationId, asUserId, asTaskId, asTaskSuggestionId } from './types/ids.js';
export type { ActorContext, UserRole } from './types/actor.js';
export { isPrimary, isAdministrator } from './types/actor.js';
export type { UtcInstant } from './types/timestamps.js';
export { toUtcInstant, parseUtcInstant, addMilliseconds, MS_PER_DAY } from './types/timestamps.js';

export type { TaskSuggestion, TaskSuggestionStatus } from './entities/task-suggestion.js';
export { isTerminalSuggestionStatus } from './entities/task-suggestion.js';
export type { Task, TaskStatus, ActionableTaskStatus } from './entities/task.js';
export { isTerminalTaskStatus, isActionableTaskStatus, isAssignedTo } from './entities/task.js';

export type {
  TaskSummaryPoint,
  SummaryPointKind,
  Sensitivity,
} from './value-objects/task-summary-point.js';
export { MAX_SUMMARY_POINTS } from './value-objects/task-summary-point.js';
export type { SourceReference, SourceType } from './value-objects/source-reference.js';
export type { TaskAssignment } from './value-objects/task-assignment.js';
export type {
  TaskOutcome,
  TaskOutcomeType,
  FollowUpProposal,
} from './value-objects/task-outcome.js';
export type { TaskNote } from './value-objects/task-note.js';
export type { ReminderMetadata, RetentionMetadata } from './value-objects/metadata.js';

export {
  DomainError,
  type DomainErrorCode,
  validationError,
  forbiddenError,
  invalidTransition,
  preconditionRequired,
  preconditionFailed,
  domainConflict,
} from './errors/domain-errors.js';

export {
  formatETag,
  parseETag,
  assertMatchingPrecondition,
  type ResourceKind,
} from './concurrency/etag.js';

export {
  computeExcerptPurgeAt,
  computeVisibleUntil,
  computeContentScrubAt,
  computeSuccessfulAudioDeletionAt,
  computeFailedAudioDeleteAt,
  buildCompletionRetention,
  buildDismissalRetention,
} from './retention/calculators.js';

export {
  deriveTaskUrgency,
  DEFAULT_DUE_SOON_WINDOW_MS,
  type DerivedTaskUrgency,
} from './derived/urgency.js';

export {
  pauseRemindersForWaiting,
  resumeReminders,
  stopReminders,
  recalculateReminderAfterSnooze,
  isReminderEligible,
} from './reminders/calculators.js';

export { validateSummaryPoints } from './validation/summary-points.js';

export { can, assertCan, assertPrimary, type CapabilityAction } from './policies/capabilities.js';
export {
  assertVoiceCannotCreateTask,
  assertFollowUpRequiresSuggestion,
} from './policies/voice.policy.js';

export {
  approveTaskSuggestion,
  editTaskSuggestion,
  dismissTaskSuggestion,
  mergeTaskSuggestion,
  TERMINAL_SUGGESTION_STATUSES,
} from './state-machines/task-suggestion.machine.js';

export {
  startTask,
  markTaskWaiting,
  resumeTask,
  completeTask,
  dismissTask,
  addTaskNote,
  returnTaskToPrimary,
  requestClarification,
  TERMINAL_TASK_STATUSES,
} from './state-machines/task.machine.js';

export type { DomainEvent, DomainEventType } from './events/domain-events.js';

export { API_DOMAIN_STATUS_MAP } from './mapping/enum-parity.js';
