// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PENDING_HANDOFF_TTL_MS,
  clearPendingHandoffOperation,
  createPendingHandoffOperation,
  isPendingHandoffExpired,
  readPendingHandoffOperation,
  writePendingHandoffOperation,
} from '@/lib/handoff/client/pending-operation';

describe('A7.8 pending handoff operation (sessionStorage)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('persists only contracted privacy-safe fields', () => {
    const op = createPendingHandoffOperation({
      taskId: 'task_1',
      recipientId: 'rcpt_1',
      originalIfMatch: '"task-task_1-v1"',
    });
    writePendingHandoffOperation(op);
    const raw = window.sessionStorage.getItem('aicaa.handoff.pending.v1:task_1')!;
    expect(raw).not.toMatch(/@/);
    expect(raw).not.toContain('summary');
    expect(raw).not.toContain('capability');
    const loaded = readPendingHandoffOperation('task_1');
    expect(loaded?.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(loaded?.originalIfMatch).toBe('"task-task_1-v1"');
    expect(loaded?.acknowledgement).toBe('handoff_confirmed_v1');
  });

  it('does not treat browser expiry as server cancellation', () => {
    const op = createPendingHandoffOperation({
      taskId: 'task_2',
      recipientId: 'rcpt_1',
      originalIfMatch: '"task-task_2-v1"',
    });
    op.createdAt = new Date(Date.now() - PENDING_HANDOFF_TTL_MS - 1000).toISOString();
    writePendingHandoffOperation(op);
    const loaded = readPendingHandoffOperation('task_2');
    expect(loaded).not.toBeNull();
    expect(isPendingHandoffExpired(loaded!)).toBe(true);
    // Still readable — callers decide whether to clear after Task refetch.
    expect(readPendingHandoffOperation('task_2')?.idempotencyKey).toBe(op.idempotencyKey);
  });

  it('clears only the Task-scoped key', () => {
    writePendingHandoffOperation(
      createPendingHandoffOperation({
        taskId: 'task_a',
        recipientId: 'r1',
        originalIfMatch: '"task-task_a-v1"',
      }),
    );
    writePendingHandoffOperation(
      createPendingHandoffOperation({
        taskId: 'task_b',
        recipientId: 'r1',
        originalIfMatch: '"task-task_b-v1"',
      }),
    );
    clearPendingHandoffOperation('task_a');
    expect(readPendingHandoffOperation('task_a')).toBeNull();
    expect(readPendingHandoffOperation('task_b')).not.toBeNull();
  });
});
