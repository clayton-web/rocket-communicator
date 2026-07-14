export {
  CAPABILITY_TOKEN_BYTES,
  CAPABILITY_TOKEN_HASH_HEX_LENGTH,
  capabilitySecretsEqual,
  generateCapabilityToken,
  hashCapabilityToken,
} from './token';

export {
  DOCUMENTED_DEFAULT_CAPABILITY_TTL_MS,
  MAX_CAPABILITY_TTL_MS,
  MIN_CAPABILITY_TTL_MS,
  MIN_CAPABILITY_TOKEN_PEPPER_LENGTH,
  assertValidCapabilityPepper,
  assertValidCapabilityTtlMs,
  getCapabilityTokenConfig,
  parseCapabilityTtlMs,
  type CapabilityTokenConfig,
} from './config';

export {
  CapabilityTokenError,
  capabilityTokenError,
  type CapabilityTokenErrorCode,
} from './errors';

export {
  RecipientCapabilityServiceError,
  recipientCapabilityServiceError,
  type RecipientCapabilityServiceErrorCode,
} from './recipient-errors';

export { assertNoRawCapabilityToken, redactCapabilitySecrets } from './redact';
export { buildCapabilityPath, buildCapabilityUrl } from './urls';

export {
  issueCapabilityForTask,
  issueCapabilityWithConfig,
  replaceCapabilityForTask,
  replaceCapabilityWithConfig,
  resolveCapabilityScopeFromAssignment,
  toSafeIssuedCapability,
  type IssueCapabilityCommand,
  type IssuedCapabilityResult,
  type ReplaceCapabilityCommand,
  type SafeIssuedCapability,
} from './issue';

export {
  omitTokenHash,
  toCapabilityActor,
  validateCapabilityToken,
  type CapabilityValidationMode,
  type ValidateCapabilityCommand,
  type ValidatedCapabilityContext,
} from './validate';

export {
  invalidateCapabilityOnAssignmentChangePersisted,
  persistCapabilityExpiryIfNeeded,
  returnToOwnerWithCapabilityInvalidation,
  revokeCapabilityForOwner,
} from './lifecycle';

export {
  mapTaskToDto,
  mapSuggestionToDto,
  mapWorkRequestResponse,
  type TaskDto,
  type TaskSuggestionDto,
  type SubmitWorkRequestResponseDto,
} from './map-to-dto';

export { getCapabilityTask, type GetCapabilityTaskCommand } from './queries';

export {
  markCapabilityTaskWaiting,
  resumeCapabilityTask,
  completeCapabilityTask,
  addCapabilityTaskNote,
  requestCapabilityClarification,
  returnCapabilityTaskToOwner,
  submitCapabilityWorkRequest,
  type RecipientCapabilityMutationBase,
  type RecipientCapabilityMutationResult,
} from './mutations';
