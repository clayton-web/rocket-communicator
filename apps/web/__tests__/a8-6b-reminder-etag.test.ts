import { describe, expect, it } from 'vitest';
import { NO_SCHEDULE_REMINDER_VERSION as PERSISTENCE_VALUE } from '@aicaa/db';
import { parseETag } from '@aicaa/domain';
import { NO_SCHEDULE_REMINDER_VERSION, reminderETag } from '@/lib/reminders/etag';
import { noDueDateState } from '@/lib/reminders/state';

/**
 * The no-schedule reminder token, guarded after A8.6b found it malformed in the running server.
 *
 * `lib/reminders/etag.ts` used to import this constant from `@aicaa/db`. That package is a
 * `serverExternalPackages` entry, so Next leaves it as a runtime external and the statically
 * imported *value* arrived `undefined` — every Task without a schedule advertised
 * `"task-reminder-<id>-vundefined"`, and every mutation presenting that token was refused with a
 * `412` describing a concurrency conflict that had not happened. Nothing threw, so nothing caught it
 * until a browser test tried to set a first due date.
 *
 * These tests exist because the constant is now declared in the web app. They assert it still equals
 * the persistence value, and — more importantly — that the token it produces is one the route's own
 * parser accepts. A drift check alone would have passed against `undefined`.
 */
describe('A8.6b no-schedule reminder ETag', () => {
  it('matches the value persistence starts a schedule from', () => {
    expect(NO_SCHEDULE_REMINDER_VERSION).toBe(PERSISTENCE_VALUE);
  });

  it('is a number, which is the failure that was actually shipped', () => {
    expect(typeof NO_SCHEDULE_REMINDER_VERSION).toBe('number');
    expect(Number.isInteger(NO_SCHEDULE_REMINDER_VERSION)).toBe(true);
  });

  it('produces a token the concurrency parser accepts', () => {
    const token = reminderETag('task_abc123', NO_SCHEDULE_REMINDER_VERSION);

    expect(token).toBe('"task-reminder-task_abc123-v0"');
    expect(parseETag(token)).toEqual({
      kind: 'task-reminder',
      resourceId: 'task_abc123',
      version: 0,
    });
  });

  it('gives a Task with no due date a parseable token, not "vundefined"', () => {
    const state = noDueDateState('task_abc123');

    expect(state.etag).not.toContain('undefined');
    expect(parseETag(state.etag)?.version).toBe(0);
  });

  /*
   * Task identifiers contain hyphens and underscores, and the token embeds one between two hyphens.
   * The parser is greedy for the id, but a fresh identifier alphabet is exactly the kind of change
   * that would break it quietly.
   */
  it('round-trips identifiers containing hyphens and underscores', () => {
    for (const taskId of [
      'task_Bd-GJuW6g5_sVcWk',
      'task_SCM0bwa1-90w0F9L',
      'task_HtNw-v-w5gmHUhQ_',
    ]) {
      const parsed = parseETag(reminderETag(taskId, NO_SCHEDULE_REMINDER_VERSION));
      expect(parsed?.resourceId, taskId).toBe(taskId);
      expect(parsed?.version, taskId).toBe(0);
    }
  });
});
