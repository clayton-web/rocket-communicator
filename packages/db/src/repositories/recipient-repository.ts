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

export interface ListActiveRecipientsQuery {
  organizationId: string;
  /** Opaque cursor from a prior page (`nextCursor`). */
  cursor?: string | null;
  /** Page size (1–100). Defaults to 25 to match the OpenAPI Limit parameter. */
  limit?: number;
}

export interface ListActiveRecipientsResult {
  items: Recipient[];
  nextCursor: string | null;
}

/**
 * Ordering key for active-Recipient pagination (A7.6).
 * Normalization is: Unicode NFC, trim, locale-independent lowercase, and internal
 * whitespace runs collapsed to a single ASCII space. The Recipient id is the stable
 * tie-breaker for duplicate display names. This value is derived only from the public
 * `displayName`; it contains no organization identifier or database internals.
 */
function normalizeDisplayNameForOrdering(displayName: string): string {
  return displayName.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

type RecipientListCursor = { n: string; i: string };

function encodeRecipientListCursor(value: RecipientListCursor): string {
  return Buffer.from(JSON.stringify({ n: value.n, i: value.i }), 'utf8').toString('base64url');
}

function decodeRecipientListCursor(raw: string | null | undefined): RecipientListCursor | null {
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw persistenceValidation('Recipient list cursor is invalid.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw persistenceValidation('Recipient list cursor is invalid.');
  }
  const { n, i } = parsed as Record<string, unknown>;
  if (typeof n !== 'string' || typeof i !== 'string' || i.length === 0) {
    throw persistenceValidation('Recipient list cursor is invalid.');
  }
  return { n, i };
}

/**
 * Organization-scoped, active-only Recipient listing with deterministic keyset pagination.
 * Order: normalized display name ascending, then Recipient id ascending (stable tie-break).
 * Inactive Recipients are always excluded (D087). GET-only — no writes.
 *
 * The active set for a single Owner organization is a small, bounded list, so ordering and
 * cursor filtering are performed in memory to honor the normalized-display-name ordering that
 * the database collation cannot express without a schema change (none is permitted in A7.6).
 */
export async function listActiveRecipientsPage(
  db: Client,
  query: ListActiveRecipientsQuery,
): Promise<ListActiveRecipientsResult> {
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const cursor = decodeRecipientListCursor(query.cursor);

  const rows = await db.recipient.findMany({
    where: { organizationId: query.organizationId, active: true },
  });

  const ordered = rows
    .map((row) => ({
      recipient: mapRecipient(row),
      sortKey: normalizeDisplayNameForOrdering(row.displayName),
      id: row.id,
    }))
    .sort((a, b) => {
      if (a.sortKey !== b.sortKey) {
        return a.sortKey < b.sortKey ? -1 : 1;
      }
      if (a.id === b.id) {
        return 0;
      }
      return a.id < b.id ? -1 : 1;
    });

  const startIndex = cursor
    ? ordered.findIndex(
        (entry) => entry.sortKey > cursor.n || (entry.sortKey === cursor.n && entry.id > cursor.i),
      )
    : 0;
  const effectiveStart = startIndex === -1 ? ordered.length : startIndex;
  const pageEntries = ordered.slice(effectiveStart, effectiveStart + limit);
  const last = pageEntries[pageEntries.length - 1];
  const hasMore = effectiveStart + limit < ordered.length;
  const nextCursor =
    hasMore && last ? encodeRecipientListCursor({ n: last.sortKey, i: last.id }) : null;

  return { items: pageEntries.map((entry) => entry.recipient), nextCursor };
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
  // NOT_FOUND for missing or cross-organization ids (no existence leak).
  const existing = await getRecipientById(db, input.organizationId, input.recipientId);
  if (!existing.active) {
    throw domainConflict('Inactive Recipients cannot be updated; create a new active Recipient.');
  }
  const email = input.email?.trim() ?? existing.email;
  const emailNormalized = normalizeEmailOrThrow(email);

  // Organization-scoped conditional write requiring active:true. A stale update cannot mutate
  // or reactivate an inactive Recipient, and it cannot race a concurrent deactivation.
  let result: Prisma.BatchPayload;
  try {
    result = await db.recipient.updateMany({
      where: { id: input.recipientId, organizationId: input.organizationId, active: true },
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
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw uniqueViolation(
        'An active Recipient with this email already exists in the organization.',
      );
    }
    throw error;
  }

  if (result.count !== 1) {
    // Lost the active-row guard to a concurrent deactivation between read and write.
    throw domainConflict('Inactive Recipients cannot be updated; create a new active Recipient.');
  }

  return getRecipientById(db, input.organizationId, input.recipientId);
}

/**
 * Mark inactive without deleting. Does not alter Assignment/capability historical identity.
 */
export async function deactivateRecipient(
  db: Client,
  organizationId: string,
  recipientId: string,
): Promise<Recipient> {
  // Atomic, organization-scoped, active-only transition. The single conditional write is the
  // state change, so repeated deactivation is replay-safe.
  const result = await db.recipient.updateMany({
    where: { id: recipientId, organizationId, active: true },
    data: { active: false },
  });
  if (result.count === 1) {
    return getRecipientById(db, organizationId, recipientId);
  }

  // count === 0: disambiguate NOT_FOUND (missing / cross-organization) from already-inactive
  // (DOMAIN_CONFLICT) without leaking cross-organization existence.
  const existing = await db.recipient.findFirst({
    where: { id: recipientId, organizationId },
  });
  if (!existing) {
    throw notFound(`Recipient ${recipientId} not found for organization.`);
  }
  throw domainConflict('Recipient is already inactive.');
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
