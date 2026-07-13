import type { ActorContext } from '../types/actor.js';
import { assertCan } from '../policies/capabilities.js';
import { assertMatchingPrecondition } from '../concurrency/etag.js';
import { invalidTransition } from '../errors/domain-errors.js';
import {
  type Task,
  type TaskStatus,
  isActionableTaskStatus,
  isTerminalTaskStatus,
} from '../entities/task.js';
import { buildCompletionRetention, buildDismissalRetention } from '../retention/calculators.js';
import {
  pauseRemindersForWaiting,
  resumeReminders,
  stopReminders,
} from '../reminders/calculators.js';
import type {
  FollowUpProposal,
  TaskOutcome,
  TaskOutcomeType,
} from '../value-objects/task-outcome.js';
import type { TaskNote } from '../value-objects/task-note.js';
import type { UtcInstant } from '../types/timestamps.js';
import type { UserId } from '../types/ids.js';
import { assertFollowUpRequiresSuggestion } from '../policies/voice.policy.js';
import { validateSummaryPoints } from '../validation/summary-points.js';

export interface TaskMutationContext {
  actor: ActorContext;
  ifMatch?: string;
  now: UtcInstant;
}

function ensureNotTerminal(task: Task): void {
  if (isTerminalTaskStatus(task.status)) {
    throw invalidTransition(`Task in status ${task.status} cannot transition.`);
  }
}

function bumpVersion(task: Task, now: UtcInstant): Task {
  return {
    ...task,
    version: task.version + 1,
    updatedAt: now,
  };
}

function withPrecondition(task: Task, ifMatch: string | undefined): void {
  assertMatchingPrecondition(ifMatch, {
    kind: 'task',
    resourceId: task.id,
    version: task.version,
  });
}

function validateFollowUpProposal(proposal: FollowUpProposal): void {
  validateSummaryPoints(proposal.summaryPoints);
}

export function startTask(task: Task, context: TaskMutationContext): Task {
  assertCan(context.actor, 'start_task', task);
  ensureNotTerminal(task);
  withPrecondition(task, context.ifMatch);
  if (task.status !== 'open') {
    throw invalidTransition('Only open tasks can be started.');
  }
  return bumpVersion({ ...task, status: 'in_progress' }, context.now);
}

export function markTaskWaiting(
  task: Task,
  context: TaskMutationContext & { waitingUntil: UtcInstant },
): Task {
  assertCan(context.actor, 'mark_task_waiting', task);
  ensureNotTerminal(task);
  withPrecondition(task, context.ifMatch);
  if (!isActionableTaskStatus(task.status)) {
    throw invalidTransition('Only actionable tasks can enter waiting.');
  }
  return bumpVersion(
    {
      ...task,
      priorActionableStatus: task.status,
      status: 'waiting',
      waitingUntil: context.waitingUntil,
      reminder: pauseRemindersForWaiting(context.waitingUntil),
    },
    context.now,
  );
}

export function resumeTask(task: Task, context: TaskMutationContext): Task {
  assertCan(context.actor, 'mark_task_waiting', task);
  withPrecondition(task, context.ifMatch);
  if (task.status !== 'waiting') {
    throw invalidTransition('Only waiting tasks can be resumed.');
  }
  const resumedStatus = task.priorActionableStatus ?? 'open';
  return bumpVersion(
    {
      ...task,
      status: resumedStatus,
      priorActionableStatus: null,
      waitingUntil: null,
      reminder: resumeReminders(task.reminder.nextReminderAt ?? null),
    },
    context.now,
  );
}

export function completeTask(
  task: Task,
  context: TaskMutationContext & {
    outcomeType: TaskOutcomeType;
    note?: string;
    summaryPoints?: TaskOutcome['summaryPoints'];
    followUpProposal?: TaskOutcome['followUpProposal'];
  },
): Task {
  assertCan(context.actor, 'complete_task', task);
  ensureNotTerminal(task);
  withPrecondition(task, context.ifMatch);

  if (context.followUpProposal) {
    assertFollowUpRequiresSuggestion();
    validateFollowUpProposal(context.followUpProposal);
  }

  const outcome: TaskOutcome = {
    outcomeType: context.outcomeType,
    completedAt: context.now,
    completedByUserId: context.actor.userId,
    note: context.note,
    summaryPoints: context.summaryPoints,
    followUpProposal: context.followUpProposal,
  };

  return bumpVersion(
    {
      ...task,
      status: 'completed',
      outcome,
      retention: buildCompletionRetention(context.now),
      reminder: stopReminders('completed'),
    },
    context.now,
  );
}

export function dismissTask(task: Task, context: TaskMutationContext): Task {
  assertCan(context.actor, 'dismiss_task', task);
  ensureNotTerminal(task);
  withPrecondition(task, context.ifMatch);
  return bumpVersion(
    {
      ...task,
      status: 'dismissed',
      retention: buildDismissalRetention(context.now),
      reminder: stopReminders('dismissed'),
    },
    context.now,
  );
}

export function addTaskNote(task: Task, context: TaskMutationContext & { note: TaskNote }): Task {
  assertCan(context.actor, 'add_task_note', task);
  ensureNotTerminal(task);
  withPrecondition(task, context.ifMatch);
  return bumpVersion({ ...task, notes: [...task.notes, context.note] }, context.now);
}

export function returnTaskToPrimary(
  task: Task,
  context: TaskMutationContext & { primaryUserId: UserId },
): Task {
  assertCan(context.actor, 'return_task_to_primary', task);
  ensureNotTerminal(task);
  withPrecondition(task, context.ifMatch);
  if (!task.assignment) {
    throw invalidTransition('Task must be assigned before returning to primary.');
  }
  return bumpVersion(
    {
      ...task,
      assignment: {
        ...task.assignment,
        assigneeUserId: context.primaryUserId,
        assignedAt: context.now,
        assignedByUserId: context.actor.userId,
      },
    },
    context.now,
  );
}

export function requestClarification(task: Task, context: TaskMutationContext): Task {
  assertCan(context.actor, 'request_clarification', task);
  ensureNotTerminal(task);
  withPrecondition(task, context.ifMatch);
  return bumpVersion({ ...task }, context.now);
}

export const TERMINAL_TASK_STATUSES: TaskStatus[] = ['completed', 'dismissed'];
