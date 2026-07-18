import type { Actor } from '../types/actor.js';
import { assertCan } from '../policies/capabilities.js';
import { assertMatchingPrecondition } from '../concurrency/etag.js';
import { invalidTransition, validationError } from '../errors/domain-errors.js';
import {
  type TaskSuggestion,
  type TaskSuggestionStatus,
  isTerminalSuggestionStatus,
} from '../entities/task-suggestion.js';
import type { Task } from '../entities/task.js';
import { validateSummaryPoints } from '../validation/summary-points.js';
import { buildDismissalRetention } from '../retention/calculators.js';
import type { TaskSummaryPoint } from '../value-objects/task-summary-point.js';
import type { UtcInstant } from '../types/timestamps.js';
import type { TaskId } from '../types/ids.js';

export interface SuggestionMutationContext {
  actor: Actor;
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
  assertCan(context.actor, 'approve_task_suggestion', undefined, context.now);
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
    proposedRecipientId?: string | null;
    proposedDueAt?: UtcInstant | null;
    proposedPriority?: TaskSuggestion['proposedPriority'];
  },
): TaskSuggestion {
  assertCan(context.actor, 'edit_task_suggestion', undefined, context.now);
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
      proposedRecipientId:
        context.proposedRecipientId === undefined
          ? suggestion.proposedRecipientId
          : (context.proposedRecipientId ?? undefined),
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
  assertCan(context.actor, 'dismiss_task_suggestion', undefined, context.now);
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

/**
 * Merge pending suggestion into an existing Task (D083).
 * Requires suggestion If-Match and target Task ETag (`targetTaskIfMatch`).
 * When `appendSummaryPoints` is true (default), appends suggestion points to the Task.
 */
export function mergeTaskSuggestion(
  suggestion: TaskSuggestion,
  targetTask: Task,
  context: SuggestionMutationContext & {
    targetTaskId: TaskId;
    targetTaskIfMatch?: string;
    appendSummaryPoints?: boolean;
  },
): { suggestion: TaskSuggestion; task: Task } {
  assertCan(context.actor, 'merge_task_suggestion', undefined, context.now);
  ensurePending(suggestion);
  assertMatchingPrecondition(context.ifMatch, {
    kind: 'task-suggestion',
    resourceId: suggestion.id,
    version: suggestion.version,
  });
  if (targetTask.id !== context.targetTaskId) {
    throw validationError('Merge targetTaskId must match the loaded Task.');
  }
  if (targetTask.organizationId !== suggestion.organizationId) {
    throw validationError('Merge target Task must belong to the same organization.');
  }
  assertMatchingPrecondition(context.targetTaskIfMatch, {
    kind: 'task',
    resourceId: targetTask.id,
    version: targetTask.version,
  });

  const append = context.appendSummaryPoints !== false;
  const nextSummaryPoints = append
    ? [...targetTask.summaryPoints, ...suggestion.summaryPoints].map((point, index) => ({
        ...point,
        order: index,
      }))
    : targetTask.summaryPoints;
  if (append) {
    validateSummaryPoints(nextSummaryPoints);
  }

  const mergedSuggestion = bumpVersion(
    {
      ...suggestion,
      status: 'merged',
      mergedIntoTaskId: context.targetTaskId,
    },
    context.now,
  );

  const mergedTask: Task = {
    ...targetTask,
    summaryPoints: nextSummaryPoints,
    version: targetTask.version + 1,
    updatedAt: context.now,
  };

  return { suggestion: mergedSuggestion, task: mergedTask };
}

export const TERMINAL_SUGGESTION_STATUSES: TaskSuggestionStatus[] = [
  'approved',
  'dismissed',
  'merged',
];
