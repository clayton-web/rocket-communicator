import type { Recipient } from '@aicaa/domain';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import { mapRecipient } from '../mappers/domain-mappers.js';
import { notFound, organizationMismatch } from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function upsertRecipient(
  db: Client,
  input: {
    organizationId: string;
    recipient: Recipient;
  },
): Promise<Recipient> {
  const row = await db.recipient.upsert({
    where: { id: input.recipient.id },
    create: {
      id: input.recipient.id,
      organizationId: input.organizationId,
      displayName: input.recipient.displayName,
      email: input.recipient.email,
      relationshipLabel: input.recipient.relationshipLabel ?? null,
      active: input.recipient.active,
      reminderPreferences: input.recipient.reminderPreferences
        ? asJson(input.recipient.reminderPreferences)
        : undefined,
      assignmentCategories: input.recipient.assignmentCategories
        ? asJson(input.recipient.assignmentCategories)
        : undefined,
    },
    update: {
      displayName: input.recipient.displayName,
      email: input.recipient.email,
      relationshipLabel: input.recipient.relationshipLabel ?? null,
      active: input.recipient.active,
      reminderPreferences: input.recipient.reminderPreferences
        ? asJson(input.recipient.reminderPreferences)
        : undefined,
      assignmentCategories: input.recipient.assignmentCategories
        ? asJson(input.recipient.assignmentCategories)
        : undefined,
    },
  });

  if (row.organizationId !== input.organizationId) {
    throw organizationMismatch('Recipient belongs to a different organization.');
  }

  return mapRecipient(row);
}

export async function getRecipientById(
  db: Client,
  organizationId: string,
  recipientId: string,
): Promise<Recipient> {
  const row = await db.recipient.findFirst({
    where: { id: recipientId, organizationId },
  });
  if (!row) {
    throw notFound(`Recipient ${recipientId} not found for organization.`);
  }
  return mapRecipient(row);
}
