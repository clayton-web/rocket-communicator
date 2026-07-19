import type { Recipient } from '@aicaa/domain';
// Runtime (value) imports of @aicaa/domain must use the relative dist path so the compiled
// output is NFT-traceable and resolvable in the Next standalone / Lambda layout (see
// a4-transactions.ts, domain-mappers.ts). Bare '@aicaa/domain' is reserved for erased type-only imports.
import { normalizeRecipientEmail } from '../../../domain/dist/index.js';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../generated/client/index.js';
import { mapRecipient } from '../mappers/domain-mappers.js';
import {
  domainConflict,
  notFound,
  organizationMismatch,
  persistenceValidation,
  uniqueViolation,
} from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalizeEmailOrThrow(email: string): string {
  const normalized = normalizeRecipientEmail(email);
  if (!normalized || !normalized.includes('@')) {
    throw persistenceValidation('Recipient email is invalid.');
  }
  return normalized;
}

export async function createRecipient(
  db: Client,
  input: {
    organizationId: string;
    recipient: Recipient;
  },
): Promise<Recipient> {
  if (!input.recipient.active) {
    throw persistenceValidation('New Recipients must be created active.');
  }
  const emailNormalized = normalizeEmailOrThrow(input.recipient.email);
  try {
    const row = await db.recipient.create({
      data: {
        id: input.recipient.id,
        organizationId: input.organizationId,
        displayName: input.recipient.displayName.trim(),
        email: input.recipient.email.trim(),
        emailNormalized,
        relationshipLabel: input.recipient.relationshipLabel ?? null,
        active: true,
        reminderPreferences: input.recipient.reminderPreferences
          ? asJson(input.recipient.reminderPreferences)
          : undefined,
        assignmentCategories: input.recipient.assignmentCategories
          ? asJson(input.recipient.assignmentCategories)
          : undefined,
      },
    });
    return mapRecipient(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw uniqueViolation(
        'An active Recipient with this email already exists in the organization.',
      );
    }
    throw error;
  }
}

/**
 * Legacy upsert retained for A4/A5 tests. Prefer createRecipient / updateRecipient / deactivateRecipient.
 * Still enforces active-email uniqueness via the partial unique index.
 */
export async function upsertRecipient(
  db: Client,
  input: {
    organizationId: string;
    recipient: Recipient;
  },
): Promise<Recipient> {
  const emailNormalized = normalizeEmailOrThrow(input.recipient.email);
  try {
    const row = await db.recipient.upsert({
      where: { id: input.recipient.id },
      create: {
        id: input.recipient.id,
        organizationId: input.organizationId,
        displayName: input.recipient.displayName,
        email: input.recipient.email.trim(),
        emailNormalized,
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
        email: input.recipient.email.trim(),
        emailNormalized,
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
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw uniqueViolation(
        'An active Recipient with this email already exists in the organization.',
      );
    }
    throw error;
  }
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

export async function listActiveRecipients(
  db: Client,
  organizationId: string,
): Promise<Recipient[]> {
  const rows = await db.recipient.findMany({
    where: { organizationId, active: true },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
  });
  return rows.map(mapRecipient);
}

export async function updateRecipient(
  db: Client,
  input: {
    organizationId: string;
    recipientId: string;
    displayName?: string;
    email?: string;
    relationshipLabel?: string | null;
  },
): Promise<Recipient> {
  const existing = await getRecipientById(db, input.organizationId, input.recipientId);
  if (!existing.active) {
    throw domainConflict('Inactive Recipients cannot be updated; create a new active Recipient.');
  }
  const email = input.email?.trim() ?? existing.email;
  const emailNormalized = normalizeEmailOrThrow(email);
  try {
    const row = await db.recipient.update({
      where: { id: input.recipientId },
      data: {
        displayName: input.displayName?.trim() ?? existing.displayName,
        email,
        emailNormalized,
        relationshipLabel:
          input.relationshipLabel === undefined
            ? (existing.relationshipLabel ?? null)
            : input.relationshipLabel,
      },
    });
    return mapRecipient(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw uniqueViolation(
        'An active Recipient with this email already exists in the organization.',
      );
    }
    throw error;
  }
}

/**
 * Mark inactive without deleting. Does not alter Assignment/capability historical identity.
 */
export async function deactivateRecipient(
  db: Client,
  organizationId: string,
  recipientId: string,
): Promise<Recipient> {
  const existing = await getRecipientById(db, organizationId, recipientId);
  if (!existing.active) {
    throw domainConflict('Recipient is already inactive.');
  }
  const row = await db.recipient.update({
    where: { id: recipientId },
    data: { active: false },
  });
  return mapRecipient(row);
}

/** Require an active same-org Recipient for handoff selection. */
export async function requireActiveRecipientForHandoff(
  db: Client,
  organizationId: string,
  recipientId: string,
): Promise<Recipient> {
  const recipient = await getRecipientById(db, organizationId, recipientId);
  if (!recipient.active) {
    throw persistenceValidation('Inactive Recipients cannot receive a new handoff.');
  }
  return recipient;
}
