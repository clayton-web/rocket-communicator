import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { fromIso, mapAuditEvent, type AuditEventRecord } from '../mappers/domain-mappers.js';

type Client = DbClient | DbTransaction;

export type CreateAuditEventInput = Omit<AuditEventRecord, 'recordedAt'> & {
  recordedAt: string;
};

export async function createAuditEvent(
  db: Client,
  input: CreateAuditEventInput,
): Promise<AuditEventRecord> {
  const row = await db.auditEvent.create({
    data: {
      id: input.id,
      organizationId: input.organizationId,
      actorKind: input.actorKind,
      ownerId: input.ownerId ?? null,
      capabilityId: input.capabilityId ?? null,
      assignmentId: input.assignmentId ?? null,
      taskId: input.taskId ?? null,
      suggestionId: input.suggestionId ?? null,
      intendedRecipientEmail: input.intendedRecipientEmail ?? null,
      action: input.action,
      outcome: input.outcome,
      resourceVersion: input.resourceVersion ?? null,
      taskStatus: input.taskStatus ?? null,
      note: input.note ?? null,
      requestId: input.requestId ?? null,
      correlationId: input.correlationId ?? null,
      attributionLabel: input.attributionLabel ?? null,
      recordedAt: fromIso(input.recordedAt)!,
    },
  });
  return mapAuditEvent(row);
}

export async function listAuditEventsForTask(
  db: Client,
  organizationId: string,
  taskId: string,
): Promise<AuditEventRecord[]> {
  const rows = await db.auditEvent.findMany({
    where: { organizationId, taskId },
    orderBy: { recordedAt: 'asc' },
  });
  return rows.map(mapAuditEvent);
}
