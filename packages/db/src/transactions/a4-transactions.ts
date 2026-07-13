import type { ActionAttribution, Task, TaskNote, TaskSuggestion } from '@aicaa/domain';
import type { DbClient } from '../client/create-prisma-client.js';
import { createAuditEvent, type CreateAuditEventInput } from '../repositories/audit-repository.js';
import { revokeCapabilityRecord } from '../repositories/capability-repository.js';
import { createTaskSuggestion } from '../repositories/suggestion-repository.js';
import {
  appendTaskNote,
  clearAssignment,
  getTaskById,
  updateTaskWithExpectedVersion,
} from '../repositories/task-repository.js';
import type { AuditEventRecord } from '../mappers/domain-mappers.js';

/**
 * Atomic return-to-Owner unit of work (Phase 2 invariant for Phase 3 orchestration):
 * update task (no assignment), optional note, revoke capability, audit event.
 */
export async function persistReturnToOwner(input: {
  db: DbClient;
  organizationId: string;
  expectedVersion: number;
  task: Task;
  note?: TaskNote;
  capabilityId: string | null;
  revokedAt: string;
  audit: CreateAuditEventInput;
}): Promise<{ task: Task; audit: AuditEventRecord }> {
  return input.db.$transaction(async (tx) => {
    const task = await updateTaskWithExpectedVersion(
      tx,
      input.organizationId,
      input.expectedVersion,
      input.task,
    );
    await clearAssignment(tx, input.organizationId, input.task.id, input.revokedAt);

    if (input.note) {
      await appendTaskNote(tx, input.organizationId, input.task.id, input.note);
    }

    if (input.capabilityId) {
      await revokeCapabilityRecord(
        tx,
        input.organizationId,
        input.capabilityId,
        input.revokedAt,
        'assignment_returned_to_owner',
      );
    }

    const audit = await createAuditEvent(tx, input.audit);
    const reloaded = await getTaskById(tx, input.organizationId, input.task.id);
    return { task: reloaded, audit };
  });
}

/**
 * Atomic capability action: task transition (+ optional note) + audit.
 * Token validation remains Phase 3 / application layer.
 */
export async function persistCapabilityAction(input: {
  db: DbClient;
  organizationId: string;
  expectedVersion: number;
  task: Task;
  note?: TaskNote;
  audit: CreateAuditEventInput;
}): Promise<{ task: Task; audit: AuditEventRecord }> {
  return input.db.$transaction(async (tx) => {
    await updateTaskWithExpectedVersion(
      tx,
      input.organizationId,
      input.expectedVersion,
      input.task,
    );
    if (input.note) {
      await appendTaskNote(tx, input.organizationId, input.task.id, input.note);
    }
    const audit = await createAuditEvent(tx, input.audit);
    const task = await getTaskById(tx, input.organizationId, input.task.id);
    return { task, audit };
  });
}

/**
 * Owner session mutation unit of work (task + optional new note + audit).
 * Same persistence shape as capability-driven mutations; named for Owner task services.
 */
export async function persistOwnerTaskMutation(
  input: Parameters<typeof persistCapabilityAction>[0],
): Promise<{ task: Task; audit: AuditEventRecord }> {
  return persistCapabilityAction(input);
}

/**
 * Atomic work-request: attributed note + pending suggestion + audit (D061).
 */
export async function persistWorkRequest(input: {
  db: DbClient;
  organizationId: string;
  expectedVersion: number;
  task: Task;
  note: TaskNote;
  suggestion: TaskSuggestion;
  audit: CreateAuditEventInput;
}): Promise<{ task: Task; suggestion: TaskSuggestion; audit: AuditEventRecord }> {
  return input.db.$transaction(async (tx) => {
    await updateTaskWithExpectedVersion(
      tx,
      input.organizationId,
      input.expectedVersion,
      input.task,
    );
    await appendTaskNote(tx, input.organizationId, input.task.id, input.note);
    const suggestion = await createTaskSuggestion(
      tx,
      input.organizationId,
      input.suggestion,
      input.task.id,
    );
    const audit = await createAuditEvent(tx, input.audit);
    const task = await getTaskById(tx, input.organizationId, input.task.id);
    return { task, suggestion, audit };
  });
}

export type { ActionAttribution };
