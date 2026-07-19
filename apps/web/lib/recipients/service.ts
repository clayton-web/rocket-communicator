import 'server-only';
import { randomBytes } from 'node:crypto';
import { asRecipientId, type OwnerActor, type Recipient, type UtcInstant } from '@aicaa/domain';
import type { AuditEventRecord, DbClient } from '@aicaa/db';
import type { components } from '@aicaa/contracts/schema';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { readPersistenceErrorCode, safeReadString } from '@/lib/errors/safe-error-shapes';
import { buildRecipientAudit } from './audit';
import { RecipientManagementError, recipientManagementError } from './errors';
import { mapRecipientToDto, type RecipientDto } from './map-to-dto';
import type { ParsedUpdateRecipient } from './validate';

type ListRecipientsResponse = components['schemas']['ListRecipientsResponse'];

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

/** Translate persistence failures into privacy-safe Recipient management errors. */
function mapRecipientPersistenceError(error: unknown): never {
  if (error instanceof RecipientManagementError) {
    throw error;
  }
  const code = readPersistenceErrorCode(error);
  switch (code) {
    case 'NOT_FOUND':
    case 'ORGANIZATION_MISMATCH':
      throw recipientManagementError('NOT_FOUND', 'Recipient not found.');
    case 'UNIQUE_VIOLATION':
      throw recipientManagementError(
        'DOMAIN_CONFLICT',
        'An active Recipient with this email already exists.',
      );
    case 'DOMAIN_CONFLICT':
      throw recipientManagementError(
        'DOMAIN_CONFLICT',
        safeReadString(error, 'message') ??
          'The request conflicts with the current Recipient state.',
      );
    case 'VALIDATION':
      throw recipientManagementError(
        'VALIDATION_ERROR',
        safeReadString(error, 'message') ?? 'Request validation failed.',
      );
    default:
      throw error;
  }
}

export interface ListOwnerRecipientsCommand {
  db: DbClient;
  owner: OwnerActor;
  cursor?: string | null;
  limit?: number;
}

export async function listOwnerRecipients(
  command: ListOwnerRecipientsCommand,
): Promise<ListRecipientsResponse> {
  try {
    const runtime = await loadDbRuntime();
    const page = await runtime.listActiveRecipientsPage(command.db, {
      organizationId: command.owner.organizationId,
      cursor: command.cursor,
      limit: command.limit,
    });
    return {
      items: page.items.map(mapRecipientToDto),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    mapRecipientPersistenceError(error);
  }
}

export interface CreateOwnerRecipientCommand {
  db: DbClient;
  owner: OwnerActor;
  now: UtcInstant;
  displayName: string;
  email: string;
  relationshipLabel?: string;
  requestId?: string;
  correlationId?: string | null;
}

export interface RecipientMutationResult {
  recipient: RecipientDto;
  audit: AuditEventRecord;
}

export async function createOwnerRecipient(
  command: CreateOwnerRecipientCommand,
): Promise<RecipientMutationResult> {
  try {
    const runtime = await loadDbRuntime();
    const recipientId = newId('rcp');
    const domainRecipient: Recipient = {
      id: asRecipientId(recipientId),
      displayName: command.displayName,
      email: command.email,
      active: true,
      relationshipLabel: command.relationshipLabel,
    };

    const persisted = await command.db.$transaction(async (tx) => {
      const created = await runtime.createRecipient(tx, {
        organizationId: command.owner.organizationId,
        recipient: domainRecipient,
      });
      const audit = await runtime.createAuditEvent(
        tx,
        buildRecipientAudit({
          id: newId('audit'),
          owner: command.owner,
          action: 'create_recipient',
          now: command.now,
          recipientId: created.id,
          requestId: command.requestId,
          correlationId: command.correlationId,
        }),
      );
      return { created, audit };
    });

    return { recipient: mapRecipientToDto(persisted.created), audit: persisted.audit };
  } catch (error) {
    mapRecipientPersistenceError(error);
  }
}

export interface UpdateOwnerRecipientCommand {
  db: DbClient;
  owner: OwnerActor;
  now: UtcInstant;
  recipientId: string;
  update: ParsedUpdateRecipient;
  requestId?: string;
  correlationId?: string | null;
}

export async function updateOwnerRecipient(
  command: UpdateOwnerRecipientCommand,
): Promise<RecipientMutationResult> {
  try {
    const runtime = await loadDbRuntime();
    const persisted = await command.db.$transaction(async (tx) => {
      const updated = await runtime.updateRecipient(tx, {
        organizationId: command.owner.organizationId,
        recipientId: command.recipientId,
        displayName: command.update.displayName,
        email: command.update.email,
        relationshipLabel: command.update.relationshipLabel,
      });
      const audit = await runtime.createAuditEvent(
        tx,
        buildRecipientAudit({
          id: newId('audit'),
          owner: command.owner,
          action: 'update_recipient',
          now: command.now,
          recipientId: updated.id,
          changedFields: command.update.providedFields,
          requestId: command.requestId,
          correlationId: command.correlationId,
        }),
      );
      return { updated, audit };
    });

    return { recipient: mapRecipientToDto(persisted.updated), audit: persisted.audit };
  } catch (error) {
    mapRecipientPersistenceError(error);
  }
}

export interface DeactivateOwnerRecipientCommand {
  db: DbClient;
  owner: OwnerActor;
  now: UtcInstant;
  recipientId: string;
  requestId?: string;
  correlationId?: string | null;
}

export async function deactivateOwnerRecipient(
  command: DeactivateOwnerRecipientCommand,
): Promise<RecipientMutationResult> {
  try {
    const runtime = await loadDbRuntime();
    const persisted = await command.db.$transaction(async (tx) => {
      const deactivated = await runtime.deactivateRecipient(
        tx,
        command.owner.organizationId,
        command.recipientId,
      );
      const audit = await runtime.createAuditEvent(
        tx,
        buildRecipientAudit({
          id: newId('audit'),
          owner: command.owner,
          action: 'deactivate_recipient',
          now: command.now,
          recipientId: deactivated.id,
          requestId: command.requestId,
          correlationId: command.correlationId,
        }),
      );
      return { deactivated, audit };
    });

    return { recipient: mapRecipientToDto(persisted.deactivated), audit: persisted.audit };
  } catch (error) {
    mapRecipientPersistenceError(error);
  }
}
