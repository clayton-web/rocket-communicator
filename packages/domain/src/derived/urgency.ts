import { parseUtcInstant } from '../types/timestamps.js';
import type { TaskStatus } from '../entities/task.js';
import type { UtcInstant } from '../types/timestamps.js';

export type DerivedTaskUrgency = 'due_soon' | 'overdue';

export const DEFAULT_DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

export function deriveTaskUrgency(
  status: TaskStatus,
  dueAt: UtcInstant | null | undefined,
  now: UtcInstant,
  dueSoonWindowMs: number = DEFAULT_DUE_SOON_WINDOW_MS,
): DerivedTaskUrgency | null {
  if (status === 'completed' || status === 'dismissed' || status === 'waiting') {
    return null;
  }
  if (!dueAt) {
    return null;
  }
  const dueMs = parseUtcInstant(dueAt).getTime();
  const nowMs = parseUtcInstant(now).getTime();
  if (dueMs < nowMs) {
    return 'overdue';
  }
  if (dueMs - nowMs <= dueSoonWindowMs) {
    return 'due_soon';
  }
  return null;
}
