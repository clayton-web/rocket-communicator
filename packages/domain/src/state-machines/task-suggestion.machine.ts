import type { ActorContext } from '../types/actor.js';
import { assertCan } from '../policies/capabilities.js';
import { assertMatchingPrecondition } from '../concurrency/etag.js';
import { invalidTransition } from '../errors/domain-errors.js';
import {
  type TaskSuggestion,
  type TaskSuggestionStatus,
  isTerminalSuggestionStatus,
} from '../entities/task-suggestion.js';
import { validateSummaryPoints } from '../validation/summary-points.js';
import { buildDismissalRetention } from '../retention/calculators.js';
import type { TaskSummaryPoint } from '../value-objects/task-summary-point.js';
import type { UtcInstant } from '../types/timestamps.js';
import type { TaskId } from '../types/ids.js';

export interface SuggestionMutationContext {
  actor: ActorContext;
  ifMatch?: string;
  now: UtcInstant;
}

function ensurePending(suggestion: TaskSuggestion): void {
  if (isTerminalSuggestionStatus(suggestion.status)) {
    throw invalidTransition(`Task suggestion in status ${suggestion.status} cannot transition.`);
  }
}

function bumpVersion(suggestion: TaskSuggestion, now: UtcInstant): TaskSuggestion {
  return {
    ...suggestion,
    version: suggestion.version + 1,
    updatedAt: now,
  };
}

export function approveTaskSuggestion(
  suggestion: TaskSuggestion,
  context: SuggestionMutationContext,
): TaskSuggestion {
  assertCan(context.actor, 'approve_task_suggestion');
  ensurePending(suggestion);
  assertMatchingPrecondition(context.ifMatch, {
    kind: 'task-suggestion',
    resourceId: suggestion.id,
    version: suggestion.version,
  });
  return bumpVersion(
    {
      ...suggestion,
      status: 'approved',
    },
    context.now,
  );
}

export function editTaskSuggestion(
  suggestion: TaskSuggestion,
  context: SuggestionMutationContext & {
    summaryPoints?: TaskSummaryPoint[];
    proposedAssigneeUserId?: string | null;
    proposedDueAt?: UtcInstant | null;
    proposedPriority?: TaskSuggestion['proposedPriority'];
  },
): TaskSuggestion {
  assertCan(context.actor, 'edit_task_suggestion');
  ensurePending(suggestion);
  assertMatchingPrecondition(context.ifMatch, {
    kind: 'task-suggestion',
    resourceId: suggestion.id,
    version: suggestion.version,
  });
  const summaryPoints = context.summaryPoints ?? suggestion.summaryPoints;
  validateSummaryPoints(summaryPoints);
  return bumpVersion(
    {
      ...suggestion,
      summaryPoints,
      proposedAssigneeUserId:
        context.proposedAssigneeUserId === undefined
          ? suggestion.proposedAssigneeUserId
          : (context.proposedAssigneeUserId ?? undefined),
      proposedDueAt:
        context.proposedDueAt === undefined
          ? suggestion.proposedDueAt
          : (context.proposedDueAt ?? undefined),
      proposedPriority: context.proposedPriority ?? suggestion.proposedPriority,
    },
    context.now,
  );
}

export function dismissTaskSuggestion(
  suggestion: TaskSuggestion,
  context: SuggestionMutationContext,
): TaskSuggestion {
  assertCan(context.actor, 'dismiss_task_suggestion');
  ensurePending(suggestion);
  assertMatchingPrecondition(context.ifMatch, {
    kind: 'task-suggestion',
    resourceId: suggestion.id,
    version: suggestion.version,
  });
  return bumpVersion(
    {
      ...suggestion,
      status: 'dismissed',
      retention: buildDismissalRetention(context.now),
    },
    context.now,
  );
}

export function mergeTaskSuggestion(
  suggestion: TaskSuggestion,
  context: SuggestionMutationContext & { targetTaskId: TaskId },
): TaskSuggestion {
  assertCan(context.actor, 'merge_task_suggestion');
  ensurePending(suggestion);
  assertMatchingPrecondition(context.ifMatch, {
    kind: 'task-suggestion',
    resourceId: suggestion.id,
    version: suggestion.version,
  });
  return bumpVersion(
    {
      ...suggestion,
      status: 'merged',
      mergedIntoTaskId: context.targetTaskId,
    },
    context.now,
  );
}

export const TERMINAL_SUGGESTION_STATUSES: TaskSuggestionStatus[] = [
  'approved',
  'dismissed',
  'merged',
];
