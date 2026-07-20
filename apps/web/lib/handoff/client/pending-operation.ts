/**
 * A7.8 privacy-safe sessionStorage model for one logical handoff operation.
 * Survives same-tab OAuth redirects and refresh. Browser expiry ≠ server cancellation.
 */

export const PENDING_HANDOFF_VERSION = 1 as const;
export const PENDING_HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;

export type PendingHandoffOutcomeCategory =
  | 'success'
  | 'replay_success'
  | 'in_progress'
  | 'retryable_failure'
  | 'permanent_failure'
  | 'preparation_failure'
  | 'ambiguous'
  | 'reconsent_required'
  | 'not_connected'
  | 'conflict'
  | 'stale'
  | 'inactive_recipient'
  | 'not_eligible'
  | 'unauthorized'
  | 'not_found'
  | 'validation'
  | 'unknown';

export interface PendingHandoffOperation {
  version: typeof PENDING_HANDOFF_VERSION;
  taskId: string;
  recipientId: string;
  idempotencyKey: string;
  originalIfMatch: string;
  acknowledgement: 'handoff_confirmed_v1';
  createdAt: string;
  lastOutcomeCategory?: PendingHandoffOutcomeCategory;
  reconsentPending?: boolean;
}

function storageKey(taskId: string): string {
  return `aicaa.handoff.pending.v1:${taskId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOperation(raw: unknown): PendingHandoffOperation | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.version !== PENDING_HANDOFF_VERSION) {
    return null;
  }
  if (
    typeof raw.taskId !== 'string' ||
    typeof raw.recipientId !== 'string' ||
    typeof raw.idempotencyKey !== 'string' ||
    typeof raw.originalIfMatch !== 'string' ||
    raw.acknowledgement !== 'handoff_confirmed_v1' ||
    typeof raw.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    version: PENDING_HANDOFF_VERSION,
    taskId: raw.taskId,
    recipientId: raw.recipientId,
    idempotencyKey: raw.idempotencyKey,
    originalIfMatch: raw.originalIfMatch,
    acknowledgement: 'handoff_confirmed_v1',
    createdAt: raw.createdAt,
    lastOutcomeCategory:
      typeof raw.lastOutcomeCategory === 'string'
        ? (raw.lastOutcomeCategory as PendingHandoffOutcomeCategory)
        : undefined,
    reconsentPending: raw.reconsentPending === true ? true : undefined,
  };
}

export function isPendingHandoffExpired(
  operation: PendingHandoffOperation,
  nowMs = Date.now(),
): boolean {
  const created = Date.parse(operation.createdAt);
  if (Number.isNaN(created)) {
    return true;
  }
  return nowMs - created > PENDING_HANDOFF_TTL_MS;
}

/** Read pending op; returns null if missing/invalid. Does not auto-delete on expiry. */
export function readPendingHandoffOperation(taskId: string): PendingHandoffOperation | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(storageKey(taskId));
    if (!raw) {
      return null;
    }
    return parseOperation(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writePendingHandoffOperation(operation: PendingHandoffOperation): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.setItem(storageKey(operation.taskId), JSON.stringify(operation));
  } catch {
    // Storage may be unavailable; in-memory callers should retain their own copy.
  }
}

export function clearPendingHandoffOperation(taskId: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.removeItem(storageKey(taskId));
  } catch {
    // ignore
  }
}

export function createPendingHandoffOperation(input: {
  taskId: string;
  recipientId: string;
  originalIfMatch: string;
}): PendingHandoffOperation {
  return {
    version: PENDING_HANDOFF_VERSION,
    taskId: input.taskId,
    recipientId: input.recipientId,
    idempotencyKey: crypto.randomUUID(),
    originalIfMatch: input.originalIfMatch,
    acknowledgement: 'handoff_confirmed_v1',
    createdAt: new Date().toISOString(),
  };
}

export function updatePendingHandoffOperation(
  taskId: string,
  patch: Partial<
    Pick<PendingHandoffOperation, 'lastOutcomeCategory' | 'reconsentPending' | 'recipientId'>
  >,
): PendingHandoffOperation | null {
  const current = readPendingHandoffOperation(taskId);
  if (!current) {
    return null;
  }
  const next: PendingHandoffOperation = {
    ...current,
    ...patch,
  };
  writePendingHandoffOperation(next);
  return next;
}
