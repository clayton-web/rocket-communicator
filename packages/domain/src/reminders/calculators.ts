import type { ReminderMetadata } from '../value-objects/metadata.js';
import type { TaskStatus } from '../entities/task.js';
import type { UtcInstant } from '../types/timestamps.js';

export function pauseRemindersForWaiting(waitingUntil: UtcInstant): ReminderMetadata {
  return {
    nextReminderAt: waitingUntil,
    paused: true,
    pausedReason: 'waiting',
  };
}

export function resumeReminders(nextReminderAt: UtcInstant | null): ReminderMetadata {
  return {
    nextReminderAt,
    paused: false,
    pausedReason: null,
  };
}

export function stopReminders(reason: 'completed' | 'dismissed'): ReminderMetadata {
  return {
    nextReminderAt: null,
    paused: true,
    pausedReason: reason,
  };
}

export function recalculateReminderAfterSnooze(nextReminderAt: UtcInstant): ReminderMetadata {
  return {
    nextReminderAt,
    paused: false,
    pausedReason: null,
  };
}

export function isReminderEligible(status: TaskStatus, reminder: ReminderMetadata): boolean {
  if (status === 'completed' || status === 'dismissed' || status === 'waiting') {
    return false;
  }
  return !reminder.paused;
}
