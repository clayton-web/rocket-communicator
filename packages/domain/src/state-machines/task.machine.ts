import type { Actor } from '../types/actor.js';
import { isCapability, isOwner } from '../types/actor.js';
import { assertCan, assertOwner } from '../policies/capabilities.js';
import { assertMatchingPrecondition } from '../concurrency/etag.js';
import { invalidTransition, validationError } from '../errors/domain-errors.js';
import {
  type Task,
  type TaskStatus,
  isActionableTaskStatus,
  isTerminalTaskStatus,
} from '../entities/task.js';
import type { TaskSuggestion } from '../entities/task-suggestion.js';
import { buildCompletionRetention, buildDismissalRetention } from '../retention/calculators.js';
import {
  pauseRemindersForWaiting,
  resumeReminders,
  stopReminders,
  recalculateReminderAfterSnooze,
} from '../reminders/calculators.js';
import type {
  FollowUpProposal,
  TaskOutcome,
  TaskOutcomeType,
} from '../value-objects/task-outcome.js';
import type { TaskNote } from '../value-objects/task-note.js';
import type { TaskSummaryPoint } from '../value-objects/task-summary-point.js';
import { MAX_TEXT_VALUE_LENGTH } from '../value-objects/task-summary-point.js';
import type { SourceReference } from '../value-objects/source-reference.js';
import type { UtcInstant } from '../types/timestamps.js';
import type { OrganizationId, AssignmentId, TaskId, TaskSuggestionId } from '../types/ids.js';
import { assertFollowUpRequiresSuggestion } from '../policies/voice.policy.js';
import { validateSummaryPoints } from '../validation/summary-points.js';
import {
  formatCapabilityAuditContext,
  type ActionAttribution,
  type CapabilityAction,
  type CapabilityAuditOptions,
  type OwnerAuditContext,
} from '../value-objects/capability.js';

export const MAX_TYPED_MESSAGE_LENGTH = 2000;

export interface TaskMutationContext {
  actor: Actor;
  ifMatch?: string;
  now: UtcInstant;
  requestId?: string;
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

function assertTypedMessage(message: string, field: string): void {
  if (message.trim().length < 1) {
    throw validationError(`${field} must not be empty.`, [
      { field, message: 'Required typed text is empty.' },
    ]);
  }
  if (message.length > MAX_TYPED_MESSAGE_LENGTH) {
    throw validationError(`${field} exceeds ${MAX_TYPED_MESSAGE_LENGTH} characters.`, [
      { field, message: 'Text too long.' },
    ]);
  }
}

export function buildOwnerAuditContext(
  actor: { ownerId: string },
  recordedAt: UtcInstant,
  requestId?: string,
): OwnerAuditContext {
  return {
    ownerId: actor.ownerId,
    recordedAt,
    requestId,
  };
}

export function buildActionAttribution(
  actor: Actor,
  now: UtcInstant,
  options: {
    capabilityAction?: CapabilityAction;
    resourceVersion?: number;
    taskStatus?: string;
    requestId?: string;
    note?: string;
    outcome?: CapabilityAuditOptions['outcome'];
  } = {},
): ActionAttribution {
  if (isOwner(actor)) {
    return {
      kind: 'owner',
      owner: buildOwnerAuditContext(actor, now, options.requestId),
    };
  }
  if (isCapability(actor) && options.capabilityAction) {
    return {
      kind: 'capability',
      capability: formatCapabilityAuditContext(actor, options.capabilityAction, now, {
        outcome: options.outcome ?? 'succeeded',
        resourceVersion: options.resourceVersion,
        taskStatus: options.taskStatus,
        requestId: options.requestId,
        note: options.note,
      }),
    };
  }
  throw invalidTransition('Attribution requires an Owner or Capability actor.');
}

/**
 * Owner-only typed standalone Task creation (D038/D048; CreateTaskRequest).
 * Does not create an assignment or capability — assignment remains a separate attribute.
 */
export function createStandaloneTask(input: {
  actor: Actor;
  now: UtcInstant;
  id: TaskId;
  organizationId: OrganizationId;
  summaryPoints: TaskSummaryPoint[];
  dueAt?: UtcInstant | null;
  priority?: Task['priority'];
  sourceReference?: SourceReference;
}): Task {
  assertOwner(input.actor);
  assertCan(input.actor, 'create_standalone_task', undefined, input.now);
  if (input.actor.organizationId !== input.organizationId) {
    throw validationError('Task organizationId must match the Owner organization.');
  }
  validateSummaryPoints(input.summaryPoints);

  return {
    id: input.id,
    organizationId: input.organizationId,
    status: 'open',
    summaryPoints: input.summaryPoints,
    dueAt: input.dueAt ?? null,
    priority: input.priority,
    sourceReference: input.sourceReference,
    notes: [],
    reminder: { paused: false },
    retention: {},
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function startTask(task: Task, context: TaskMutationContext): Task {
  assertCan(context.actor, 'start_task', task, context.now);
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
  assertCan(context.actor, 'mark_task_waiting', task, context.now);
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
  assertCan(context.actor, 'mark_task_waiting', task, context.now);
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
  assertCan(context.actor, 'complete_task', task, context.now);
  ensureNotTerminal(task);
  withPrecondition(task, context.ifMatch);

  if (context.note !== undefined) {
    assertTypedMessage(context.note, 'note');
  }

  if (context.followUpProposal) {
    assertFollowUpRequiresSuggestion();
    validateFollowUpProposal(context.followUpProposal);
  }

  const nextVersion = task.version + 1;
  const outcome: TaskOutcome = {
    outcomeType: context.outcomeType,
    completedAt: context.now,
    attribution: buildActionAttribution(context.actor, context.now, {
      capabilityAction: 'complete_task',
      resourceVersion: nextVersion,
      taskStatus: 'completed',
      requestId: context.requestId,
      note: context.note,
    }),
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
  assertCan(context.actor, 'dismiss_task', task, context.now);
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

/**
 * Owner-only snooze: recalculates reminder timing without changing TaskStatus (D060).
 * Not available while waiting or terminal.
 */
export function snoozeTask(
  task: Task,
  context: TaskMutationContext,
  nextReminderAt: UtcInstant,
): Task {
  assertCan(context.actor, 'snooze_task', task, context.now);
  ensureNotTerminal(task);
  withPrecondition(task, context.ifMatch);
  if (task.status !== 'open' && task.status !== 'in_progress') {
    throw invalidTransition(`Task in status ${task.status} cannot be snoozed.`);
  }
  if (!isOwner(context.actor)) {
    throw invalidTransition('Only the Owner may snooze a task.');
  }
  return bumpVersion(
    {
      ...task,
      reminder: recalculateReminderAfterSnooze(nextReminderAt),
    },
    context.now,
  );
}

/** Typed note with attribution built from the actor (D052, D057, D058). */
export function addTaskNote(
  task: Task,
  context: TaskMutationContext & { noteId: string; body: string },
): Task {
  assertCan(context.actor, 'add_task_note', task, context.now);
  ensureNotTerminal(task);
  withPrecondition(task, context.ifMatch);
  assertTypedMessage(context.body, 'body');

  const nextVersion = task.version + 1;
  const note: TaskNote = {
    id: context.noteId,
    body: context.body,
    createdAt: context.now,
    attribution: buildActionAttribution(context.actor, context.now, {
      capabilityAction: 'add_task_note',
      resourceVersion: nextVersion,
      taskStatus: task.status,
      requestId: context.requestId,
      note: context.body,
    }),
  };

  return bumpVersion({ ...task, notes: [...task.notes, note] }, context.now);
}

/**
 * Identifiers the application/persistence layer must invalidate atomically with
 * return-to-Owner (D056). Domain does not revoke the capability entity here —
 * Phase 2 / application services own that orchestration invariant.
 */
export interface ReturnToOwnerInvalidationHint {
  taskId: TaskId;
  assignmentId: AssignmentId;
  /** Prior `assignment.activeCapabilityId`, when recorded. */
  capabilityId: string | null;
}

export interface ReturnTaskToOwnerResult {
  task: Task;
  /** Use with `invalidateCapabilityOnAssignmentChange` / `revokeCapability` in the same unit of work. */
  capabilityInvalidation: ReturnToOwnerInvalidationHint;
  attribution: ActionAttribution;
}

/**
 * Return assignment to the Owner; status unchanged (STATE_MACHINE).
 * Exposes `capabilityInvalidation` so Phase 2 can revoke the bound capability atomically.
 * Does not mutate capability entities or perform persistence.
 */
export function returnTaskToOwner(
  task: Task,
  context: TaskMutationContext & { noteId?: string; note?: string },
): ReturnTaskToOwnerResult {
  assertCan(context.actor, 'return_task_to_owner', task, context.now);
  ensureNotTerminal(task);
  withPrecondition(task, context.ifMatch);
  if (!task.assignment) {
    throw invalidTransition('Task must be assigned before returning to Owner.');
  }

  const capabilityInvalidation: ReturnToOwnerInvalidationHint = {
    taskId: task.id,
    assignmentId: task.assignment.id,
    capabilityId: task.assignment.activeCapabilityId ?? null,
  };

  const nextVersion = task.version + 1;
  const attribution = buildActionAttribution(context.actor, context.now, {
    capabilityAction: 'return_task_to_owner',
    resourceVersion: nextVersion,
    taskStatus: task.status,
    requestId: context.requestId,
    note: context.note,
  });

  const notes = [...task.notes];
  if (context.note !== undefined) {
    assertTypedMessage(context.note, 'note');
    if (!context.noteId) {
      throw validationError('noteId is required when returning with a note.');
    }
    notes.push({
      id: context.noteId,
      body: context.note,
      createdAt: context.now,
      attribution,
    });
  }

  return {
    task: bumpVersion(
      {
        ...task,
        assignment: undefined,
        notes,
      },
      context.now,
    ),
    capabilityInvalidation,
    attribution,
  };
}

/** @deprecated Use returnTaskToOwner */
export const returnTaskToPrimary = returnTaskToOwner;

/**
 * Typed clarification request; does not change TaskStatus (STATE_MACHINE, D058).
 * Persisted as an attributed note so the typed message survives without inventing fields.
 */
export function requestClarification(
  task: Task,
  context: TaskMutationContext & { noteId: string; message: string },
): Task {
  assertCan(context.actor, 'request_clarification', task, context.now);
  ensureNotTerminal(task);
  withPrecondition(task, context.ifMatch);
  assertTypedMessage(context.message, 'message');

  const nextVersion = task.version + 1;
  const note: TaskNote = {
    id: context.noteId,
    body: context.message,
    createdAt: context.now,
    attribution: buildActionAttribution(context.actor, context.now, {
      capabilityAction: 'request_clarification',
      resourceVersion: nextVersion,
      taskStatus: task.status,
      requestId: context.requestId,
      note: context.message,
    }),
  };

  return bumpVersion({ ...task, notes: [...task.notes, note] }, context.now);
}

/**
 * Recipient work request → pending Task Suggestion (D061). Does not create a Task.
 * Full typed message is recorded on the source task as an attributed note; the suggestion
 * request summary point carries a contract-safe preview (max summary-point value length).
 */
export function submitWorkRequest(
  task: Task,
  context: TaskMutationContext & {
    suggestionId: TaskSuggestionId;
    message: string;
    noteId: string;
    summaryPointId?: string;
  },
): { task: Task; suggestion: TaskSuggestion; attribution: ActionAttribution } {
  assertCan(context.actor, 'submit_work_request', task, context.now);
  ensureNotTerminal(task);
  withPrecondition(task, context.ifMatch);
  assertTypedMessage(context.message, 'message');

  const nextVersion = task.version + 1;
  const attribution = buildActionAttribution(context.actor, context.now, {
    capabilityAction: 'submit_work_request',
    resourceVersion: nextVersion,
    taskStatus: task.status,
    requestId: context.requestId,
    note: context.message,
  });

  const note: TaskNote = {
    id: context.noteId,
    body: context.message,
    createdAt: context.now,
    attribution,
  };

  const preview =
    context.message.length <= MAX_TEXT_VALUE_LENGTH
      ? context.message
      : context.message.slice(0, MAX_TEXT_VALUE_LENGTH);

  const summaryPoints: TaskSummaryPoint[] = [
    {
      id: context.summaryPointId ?? 'work_request',
      kind: 'request',
      label: 'Work request',
      order: 0,
      value: preview,
    },
  ];
  validateSummaryPoints(summaryPoints);

  const suggestion: TaskSuggestion = {
    id: context.suggestionId,
    organizationId: task.organizationId,
    status: 'pending',
    summaryPoints,
    voiceOriginated: false,
    retention: {},
    version: 1,
    createdAt: context.now,
    updatedAt: context.now,
  };

  const updatedTask = bumpVersion({ ...task, notes: [...task.notes, note] }, context.now);
  return { task: updatedTask, suggestion, attribution };
}

export const TERMINAL_TASK_STATUSES: TaskStatus[] = ['completed', 'dismissed'];
