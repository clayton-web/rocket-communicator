export type {
  OrganizationId,
  OwnerId,
  RecipientId,
  AssignmentId,
  CapabilityId,
  TaskId,
  TaskSuggestionId,
  SummaryPointId,
  SourceReferenceId,
  UserId,
} from './types/ids.js';
export {
  asOrganizationId,
  asOwnerId,
  asUserId,
  asRecipientId,
  asAssignmentId,
  asCapabilityId,
  asTaskId,
  asTaskSuggestionId,
} from './types/ids.js';
export type {
  Actor,
  OwnerActor,
  CapabilityActor,
  SystemActor,
  AuthenticatedRole,
} from './types/actor.js';
export { isOwner, isCapability, isSystem, ownerActor } from './types/actor.js';
export type { UtcInstant } from './types/timestamps.js';
export { toUtcInstant, parseUtcInstant, addMilliseconds, MS_PER_DAY } from './types/timestamps.js';

export type { Recipient } from './entities/recipient.js';
export type { TaskSuggestion, TaskSuggestionStatus } from './entities/task-suggestion.js';
export { isTerminalSuggestionStatus } from './entities/task-suggestion.js';
export type { Task, TaskStatus, ActionableTaskStatus } from './entities/task.js';
export {
  isTerminalTaskStatus,
  isActionableTaskStatus,
  isAssignedToRecipient,
  isAssignedTo,
} from './entities/task.js';

export type {
  TaskSummaryPoint,
  SummaryPointKind,
  Sensitivity,
} from './value-objects/task-summary-point.js';
export { MAX_SUMMARY_POINTS, MAX_TEXT_VALUE_LENGTH } from './value-objects/task-summary-point.js';
export type { SourceReference, SourceType } from './value-objects/source-reference.js';
export type { TaskAssignment } from './value-objects/task-assignment.js';
export type {
  CapabilityAction,
  CapabilityStatus,
  CapabilityScope,
  AssignmentDeliveryStatus,
  TaskCapability,
  CapabilityAuditContext,
  OwnerAuditContext,
  ActionAttribution,
  CapabilityAuditOptions,
} from './value-objects/capability.js';
export {
  capabilityAttributionLabel,
  formatCapabilityAuditContext,
  computeCapabilityExpiresAt,
  DEFAULT_CAPABILITY_TTL_MS,
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
} from './value-objects/capability.js';
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

export {
  can,
  canOwner,
  canCapability,
  assertCan,
  assertOwner,
  assertGetDoesNotMutate,
  isCapabilityActiveForTask,
  type OwnerAction,
} from './policies/capabilities.js';
export {
  assertCapabilityActive,
  assertCapabilityBelongsToTask,
  assertCapabilityActionInScope,
  assertTaskAllowsCapabilityMutation,
  assertCapabilityPermitsAction,
  isCapabilityActive,
} from './policies/capability.policy.js';
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
  createStandaloneTask,
  startTask,
  markTaskWaiting,
  resumeTask,
  completeTask,
  dismissTask,
  snoozeTask,
  addTaskNote,
  returnTaskToOwner,
  returnTaskToPrimary,
  requestClarification,
  submitWorkRequest,
  buildActionAttribution,
  buildOwnerAuditContext,
  MAX_TYPED_MESSAGE_LENGTH,
  TERMINAL_TASK_STATUSES,
  type ReturnTaskToOwnerResult,
  type ReturnToOwnerInvalidationHint,
} from './state-machines/task.machine.js';

export {
  issueTaskCapability,
  revokeCapability,
  markCapabilityExpired,
  invalidateCapabilityOnAssignmentChange,
} from './state-machines/capability.lifecycle.js';

export type { DomainEvent, DomainEventType } from './events/domain-events.js';

export { API_DOMAIN_STATUS_MAP } from './mapping/enum-parity.js';
