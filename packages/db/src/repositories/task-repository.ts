import type { Task, TaskAssignment, TaskNote } from '@aicaa/domain';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import { fromIso, mapAssignment, mapNote, mapTask, toIso } from '../mappers/domain-mappers.js';
import {
  notFound,
  optimisticConcurrency,
  organizationMismatch,
  persistenceValidation,
  uniqueViolation,
} from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function loadTaskBundle(db: Client, organizationId: string, taskId: string) {
  const row = await db.task.findFirst({
    where: { id: taskId, organizationId },
    include: {
      // Domain Task.assignment is only the active assignment (clearedAt IS NULL).
      assignments: { where: { clearedAt: null }, take: 1 },
      notes: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!row) {
    throw notFound(`Task ${taskId} not found for organization.`);
  }
  return row;
}

export async function getTaskById(
  db: Client,
  organizationId: string,
  taskId: string,
): Promise<Task> {
  const row = await loadTaskBundle(db, organizationId, taskId);
  return mapTask(row, row.assignments[0] ?? null, row.notes);
}

export interface ListTasksQuery {
  organizationId: string;
  /** Opaque cursor from a prior page (`nextCursor`). */
  cursor?: string | null;
  /** Page size (1–100). Defaults to 25 to match OpenAPI Limit. */
  limit?: number;
}

export interface ListTasksResult {
  items: Task[];
  nextCursor: string | null;
}

/**
 * Organization-scoped task listing.
 * Order (OpenAPI listTasks): `updatedAt` DESC, then `id` DESC.
 * Includes all statuses (including `dismissed`); no status filter is contracted.
 * GET-only — no writes.
 */
export async function listTasks(db: Client, query: ListTasksQuery): Promise<ListTasksResult> {
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const cursor = decodeTaskListCursor(query.cursor);

  const rows = await db.task.findMany({
    where: {
      organizationId: query.organizationId,
      ...(cursor
        ? {
            OR: [
              { updatedAt: { lt: cursor.updatedAt } },
              {
                AND: [{ updatedAt: cursor.updatedAt }, { id: { lt: cursor.id } }],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: {
      assignments: { where: { clearedAt: null }, take: 1 },
      notes: { orderBy: { createdAt: 'asc' } },
    },
  });

  const page = rows.slice(0, limit);
  const items = page.map((row) => mapTask(row, row.assignments[0] ?? null, row.notes));
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? encodeTaskListCursor({ updatedAt: last.updatedAt, id: last.id })
      : null;

  return { items, nextCursor };
}

type TaskListCursor = { updatedAt: Date; id: string };

function encodeTaskListCursor(value: TaskListCursor): string {
  const payload = `${value.updatedAt.toISOString()}|${value.id}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function decodeTaskListCursor(raw: string | null | undefined): TaskListCursor | null {
  if (!raw) {
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw persistenceValidation('Task list cursor is invalid.');
  }
  const separator = decoded.lastIndexOf('|');
  if (separator <= 0) {
    throw persistenceValidation('Task list cursor is invalid.');
  }
  const updatedAtIso = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  const updatedAt = new Date(updatedAtIso);
  if (!id || Number.isNaN(updatedAt.getTime())) {
    throw persistenceValidation('Task list cursor is invalid.');
  }
  return { updatedAt, id };
}

/**
 * All assignment rows for a task (active + historical), oldest first.
 * Historical rows remain immutable; capabilities stay bound to their original assignmentId.
 */
export async function listTaskAssignments(
  db: Client,
  organizationId: string,
  taskId: string,
): Promise<Array<TaskAssignment & { clearedAt: string | null }>> {
  const rows = await db.taskAssignment.findMany({
    where: { taskId, organizationId },
    orderBy: { assignedAt: 'asc' },
  });
  return rows.map((row) => ({
    ...mapAssignment(row),
    clearedAt: row.clearedAt ? toIso(row.clearedAt) : null,
  }));
}

export async function createTask(
  db: Client,
  organizationId: string,
  task: Task,
  assignment?: TaskAssignment,
): Promise<Task> {
  if (task.organizationId !== organizationId) {
    throw organizationMismatch('Task organizationId must match the persistence scope.');
  }

  await db.task.create({
    data: {
      id: task.id,
      organizationId,
      status: task.status,
      priorActionableStatus: task.priorActionableStatus ?? null,
      summaryPoints: asJson(task.summaryPoints),
      sourceReference: task.sourceReference ? asJson(task.sourceReference) : undefined,
      dueAt: fromIso(task.dueAt),
      waitingUntil: fromIso(task.waitingUntil),
      priority: task.priority ?? null,
      outcome: task.outcome ? asJson(task.outcome) : undefined,
      reminder: asJson(task.reminder),
      retention: asJson(task.retention),
      version: task.version,
      createdAt: fromIso(task.createdAt) ?? new Date(),
      updatedAt: fromIso(task.updatedAt) ?? new Date(),
      assignments: assignment
        ? {
            create: {
              id: assignment.id,
              organizationId,
              recipientId: assignment.recipientId,
              intendedRecipientEmail: assignment.intendedRecipientEmail,
              assignedAt: fromIso(assignment.assignedAt)!,
              assignedByOwnerId: assignment.assignedByOwnerId,
              assignmentApprovedAt: fromIso(assignment.assignmentApprovedAt ?? null),
              allowedCapabilityActions: asJson(assignment.allowedCapabilityActions),
              capabilityStatus: assignment.capabilityStatus ?? null,
              deliveryStatus: assignment.deliveryStatus ?? null,
              activeCapabilityId: assignment.activeCapabilityId ?? null,
              clearedAt: null,
            },
          }
        : undefined,
      notes: {
        create: task.notes.map((note) => ({
          id: note.id,
          organizationId,
          body: note.body,
          attribution: asJson(note.attribution),
          createdAt: fromIso(note.createdAt)!,
        })),
      },
    },
  });

  return getTaskById(db, organizationId, task.id);
}

/**
 * Persist a full task snapshot only when the expected version matches (optimistic concurrency).
 */
export async function updateTaskWithExpectedVersion(
  db: Client,
  organizationId: string,
  expectedVersion: number,
  task: Task,
): Promise<Task> {
  if (task.organizationId !== organizationId) {
    throw organizationMismatch('Task organizationId must match the persistence scope.');
  }

  const result = await db.task.updateMany({
    where: { id: task.id, organizationId, version: expectedVersion },
    data: {
      status: task.status,
      priorActionableStatus: task.priorActionableStatus ?? null,
      summaryPoints: asJson(task.summaryPoints),
      sourceReference: task.sourceReference ? asJson(task.sourceReference) : undefined,
      dueAt: fromIso(task.dueAt),
      waitingUntil: fromIso(task.waitingUntil),
      priority: task.priority ?? null,
      outcome: task.outcome ? asJson(task.outcome) : undefined,
      reminder: asJson(task.reminder),
      retention: asJson(task.retention),
      version: task.version,
      updatedAt: fromIso(task.updatedAt) ?? new Date(),
    },
  });

  if (result.count !== 1) {
    throw optimisticConcurrency(`Task ${task.id} version ${expectedVersion} was not current.`);
  }

  return getTaskById(db, organizationId, task.id);
}

export async function appendTaskNote(
  db: Client,
  organizationId: string,
  taskId: string,
  note: TaskNote,
): Promise<TaskNote> {
  const task = await db.task.findFirst({
    where: { id: taskId, organizationId },
    select: { id: true },
  });
  if (!task) {
    throw notFound(`Task ${taskId} not found for organization.`);
  }

  const row = await db.taskNote.create({
    data: {
      id: note.id,
      organizationId,
      taskId,
      body: note.body,
      attribution: asJson(note.attribution),
      createdAt: fromIso(note.createdAt)!,
    },
  });
  return mapNote(row);
}

/**
 * Create a new active assignment row. Never overwrites historical assignment rows.
 * Rejected by partial unique index if another active assignment (`clearedAt` IS NULL) exists.
 */
export async function createActiveAssignment(
  db: Client,
  organizationId: string,
  taskId: string,
  assignment: TaskAssignment,
): Promise<TaskAssignment> {
  const task = await db.task.findFirst({
    where: { id: taskId, organizationId },
    select: { id: true },
  });
  if (!task) {
    throw notFound(`Task ${taskId} not found for organization.`);
  }

  try {
    const row = await db.taskAssignment.create({
      data: {
        id: assignment.id,
        organizationId,
        taskId,
        recipientId: assignment.recipientId,
        intendedRecipientEmail: assignment.intendedRecipientEmail,
        assignedAt: fromIso(assignment.assignedAt)!,
        assignedByOwnerId: assignment.assignedByOwnerId,
        assignmentApprovedAt: fromIso(assignment.assignmentApprovedAt ?? null),
        allowedCapabilityActions: asJson(assignment.allowedCapabilityActions),
        capabilityStatus: assignment.capabilityStatus ?? null,
        deliveryStatus: assignment.deliveryStatus ?? null,
        activeCapabilityId: assignment.activeCapabilityId ?? null,
        clearedAt: null,
      },
    });
    return mapAssignment(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw uniqueViolation(`Task ${taskId} already has an active assignment.`);
    }
    throw error;
  }
}

/**
 * Update capability binding fields on the active assignment only.
 * Does not create, delete, or repurpose assignment rows.
 */
export async function updateActiveAssignmentCapabilityBinding(
  db: Client,
  organizationId: string,
  taskId: string,
  binding: {
    activeCapabilityId: string | null;
    capabilityStatus: 'active' | 'revoked' | 'expired' | null;
    allowedCapabilityActions?: unknown;
    deliveryStatus?: 'pending' | 'sent' | 'failed' | null;
  },
): Promise<void> {
  const data: {
    activeCapabilityId: string | null;
    capabilityStatus: 'active' | 'revoked' | 'expired' | null;
    allowedCapabilityActions?: Prisma.InputJsonValue;
    deliveryStatus?: 'pending' | 'sent' | 'failed' | null;
  } = {
    activeCapabilityId: binding.activeCapabilityId,
    capabilityStatus: binding.capabilityStatus,
  };
  if (binding.allowedCapabilityActions !== undefined) {
    data.allowedCapabilityActions = asJson(binding.allowedCapabilityActions);
  }
  if (binding.deliveryStatus !== undefined) {
    data.deliveryStatus = binding.deliveryStatus;
  }

  const result = await db.taskAssignment.updateMany({
    where: { taskId, organizationId, clearedAt: null },
    data,
  });
  if (result.count !== 1) {
    throw notFound(`Active assignment for task ${taskId} not found.`);
  }
}

/**
 * Sync denormalized Assignment.deliveryStatus with authoritative HandoffAttempt status.
 * Conditional on current deliveryStatus so concurrent terminal transitions cannot mix state.
 */
export async function updateActiveAssignmentDeliveryStatus(
  db: Client,
  organizationId: string,
  taskId: string,
  deliveryStatus: 'pending' | 'sent' | 'failed',
  options?: {
    /** When set, only transition from this prior status (atomic CAS). */
    fromStatus?: 'pending' | 'sent' | 'failed';
  },
): Promise<{ updated: boolean }> {
  const result = await db.taskAssignment.updateMany({
    where: {
      taskId,
      organizationId,
      clearedAt: null,
      ...(options?.fromStatus ? { deliveryStatus: options.fromStatus } : {}),
    },
    data: { deliveryStatus },
  });
  if (result.count === 1) {
    return { updated: true };
  }
  if (options?.fromStatus) {
    return { updated: false };
  }
  throw notFound(`Active assignment for task ${taskId} not found.`);
}

/**
 * Clear the single active assignment for a task. Historical rows are never deleted.
 */
export async function clearAssignment(
  db: Client,
  organizationId: string,
  taskId: string,
  clearedAt: string,
): Promise<void> {
  const result = await db.taskAssignment.updateMany({
    where: { taskId, organizationId, clearedAt: null },
    data: {
      clearedAt: fromIso(clearedAt)!,
      activeCapabilityId: null,
      capabilityStatus: 'revoked',
    },
  });
  if (result.count !== 1) {
    throw notFound(`Active assignment for task ${taskId} not found.`);
  }
}

export { toIso };
