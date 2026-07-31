/**
 * A8.3b audit remediation F1: which Task states may carry reminder scheduling (D107).
 *
 * The audit found the Owner API establishing *active* schedules on completed, dismissed, and Waiting
 * Tasks, so a future worker would have found claimable occurrences for work that was finished or
 * explicitly paused. These tests pin the policy in the domain, where the worker and the A8.4a
 * lifecycle wiring will read it, rather than leaving it as route behaviour.
 */
import { describe, expect, it } from 'vitest';
import {
  decideReminderScheduling,
  formatETag,
  mayReadReminderState,
  mayRemoveReminderDueDate,
  parseETag,
  taskStatusAllowsActiveReminders,
  taskStatusStopsReminders,
  type TaskStatus,
} from '../src/index.js';

/** Every member of `TaskStatus`. A new status must be added here and decided below. */
const ALL_STATUSES: readonly TaskStatus[] = [
  'open',
  'in_progress',
  'waiting',
  'completed',
  'dismissed',
];

describe('decideReminderScheduling', () => {
  it('schedules actively for an actionable task', () => {
    expect(decideReminderScheduling('open')).toEqual({ kind: 'schedule_active' });
    expect(decideReminderScheduling('in_progress')).toEqual({ kind: 'schedule_active' });
  });

  it('suspends rather than schedules for a waiting task (D107)', () => {
    expect(decideReminderScheduling('waiting')).toEqual({ kind: 'schedule_suspended' });
  });

  it('refuses a terminal task', () => {
    expect(decideReminderScheduling('completed')).toEqual({
      kind: 'refused',
      reason: 'task_terminal',
    });
    expect(decideReminderScheduling('dismissed')).toEqual({
      kind: 'refused',
      reason: 'task_terminal',
    });
  });

  it('decides every task status exactly once', () => {
    for (const status of ALL_STATUSES) {
      const decision = decideReminderScheduling(status);
      expect(['schedule_active', 'schedule_suspended', 'refused']).toContain(decision.kind);
    }
  });

  it('fails closed for a status it has no decision for', () => {
    // A future `TaskStatus` must not inherit `schedule_active` by omission: the cost of guessing is
    // a reminder sent about work nobody expected.
    const unknown = 'reopened' as TaskStatus;

    expect(decideReminderScheduling(unknown)).toEqual({
      kind: 'refused',
      reason: 'task_status_not_authorized',
    });
  });

  it('never returns schedule_active for a status that stops reminders', () => {
    for (const status of ALL_STATUSES) {
      if (taskStatusStopsReminders(status)) {
        expect(decideReminderScheduling(status).kind).toBe('refused');
      }
    }
  });

  it('agrees with the actionable-status predicate about which states are live', () => {
    for (const status of ALL_STATUSES) {
      expect(decideReminderScheduling(status).kind === 'schedule_active').toBe(
        taskStatusAllowsActiveReminders(status),
      );
    }
  });
});

describe('reading and removing reminder state', () => {
  it('permits reading for every status, so history stays truthful', () => {
    expect(mayReadReminderState()).toBe(true);
  });

  it('permits removal for every status, so an active schedule is never stranded', () => {
    expect(mayRemoveReminderDueDate()).toBe(true);
  });
});

describe('task-reminder ETag kind', () => {
  it('round-trips without colliding with the task kind', () => {
    const token = formatETag('task-reminder', 'task_01JXYZ', 4);

    expect(token).toBe('"task-reminder-task_01JXYZ-v4"');
    expect(parseETag(token)).toEqual({
      kind: 'task-reminder',
      resourceId: 'task_01JXYZ',
      version: 4,
    });
  });

  it('does not parse a reminder token as a task token', () => {
    // The alternation is ordered longest-prefix-first; without that, this would parse as kind
    // `task` with resourceId `reminder-task_01JXYZ`.
    expect(parseETag('"task-reminder-task_01JXYZ-v4"')?.kind).toBe('task-reminder');
    expect(parseETag('"task-task_01JXYZ-v4"')?.kind).toBe('task');
    expect(parseETag('"task-suggestion-sug_1-v4"')?.kind).toBe('task-suggestion');
  });

  it('accepts version zero, the token for a task with no schedule yet', () => {
    expect(parseETag(formatETag('task-reminder', 'task_1', 0))).toEqual({
      kind: 'task-reminder',
      resourceId: 'task_1',
      version: 0,
    });
  });

  it('rejects weak and malformed reminder tokens', () => {
    expect(parseETag('W/"task-reminder-task_1-v1"')).toBeNull();
    expect(parseETag('"task-reminder-task_1-v"')).toBeNull();
    expect(parseETag('task-reminder-task_1-v1')).toBeNull();
    expect(parseETag('*')).toBeNull();
  });
});
