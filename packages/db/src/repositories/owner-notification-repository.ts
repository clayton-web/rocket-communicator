import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { Prisma } from '../client/create-prisma-client.js';
import { persistenceValidation, uniqueViolation } from '../errors/persistence-errors.js';
import { fromIso } from '../mappers/domain-mappers.js';
import {
  mapOwnerNotificationIntent,
  type OwnerNotificationActor,
  type OwnerNotificationEventTypeValue,
  type OwnerNotificationIntentRecord,
  type OwnerNotificationSubjectKindValue,
} from '../mappers/owner-notification-mappers.js';

type Client = DbClient | DbTransaction;

/**
 * A8.5a persistence for Owner Event Notification intent (D133).
 *
 * ## What this module deliberately does not do
 *
 * It does not decide **whether** an event is notifiable, read a feature flag, read a clock, resolve
 * a destination, or know that Gmail exists. Those are policy, and policy lives above persistence —
 * the same boundary the reminder tables keep, and for the same reason: a rule that lives in two
 * places eventually disagrees with itself. This module stores a fact it is handed and enforces the
 * invariants the database can enforce.
 *
 * It also does not claim, deliver, retry, or terminalize anything. A8.5a has no worker, so `pending`
 * is the only state anything here can produce.
 */

export interface CreateOwnerNotificationIntentInput extends OwnerNotificationActor {
  id: string;
  organizationId: string;
  eventType: OwnerNotificationEventTypeValue;
  subjectKind: OwnerNotificationSubjectKindValue;
  subjectId: string;
  occurrenceKey: string;
  /** The triggering mutation's own instant, ISO-8601. Not when the event was noticed. */
  occurredAt: string;
  /** The audit row written beside this intent. A reference, not a foreign key. */
  auditEventId?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
}

/**
 * Insert one notification intent.
 *
 * **Call this inside the transaction that commits the triggering mutation.** Written anywhere else,
 * the two facts can diverge: a mutation could commit without its intent, or an intent could outlive
 * a mutation that rolled back. Passing a `DbTransaction` is what makes that structural rather than a
 * convention somebody has to remember.
 *
 * A duplicate identity surfaces as `UNIQUE_VIOLATION` rather than being swallowed. The identity is
 * server-derived (D133), so a collision means two writers genuinely raced the same event occurrence
 * — the caller decides whether that is benign, and A8.5a's only caller sits inside a transaction
 * that optimistic concurrency has already made single-winner.
 */
export async function createOwnerNotificationIntent(
  db: Client,
  input: CreateOwnerNotificationIntentInput,
): Promise<OwnerNotificationIntentRecord> {
  if (input.subjectId.length === 0 || input.occurrenceKey.length === 0) {
    throw persistenceValidation(
      'Owner notification intent requires a non-empty subjectId and occurrenceKey.',
    );
  }

  try {
    const row = await db.ownerNotificationIntent.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        eventType: input.eventType,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        occurrenceKey: input.occurrenceKey,
        state: 'pending',
        occurredAt: fromIso(input.occurredAt)!,
        actorKind: input.actorKind,
        ownerId: input.ownerId,
        capabilityId: input.capabilityId,
        systemId: input.systemId,
        assignmentId: input.assignmentId,
        attributionLabel: input.attributionLabel,
        auditEventId: input.auditEventId ?? null,
        requestId: input.requestId ?? null,
        correlationId: input.correlationId ?? null,
      },
    });
    return mapOwnerNotificationIntent(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw uniqueViolation(
        'An Owner notification intent already exists for this event occurrence (D133).',
      );
    }
    throw error;
  }
}

/** Read one intent by its identity. Used by tests and by the A8.6 Owner surface. */
export async function findOwnerNotificationIntentByIdentity(
  db: Client,
  identity: {
    organizationId: string;
    eventType: OwnerNotificationEventTypeValue;
    subjectKind: OwnerNotificationSubjectKindValue;
    subjectId: string;
    occurrenceKey: string;
  },
): Promise<OwnerNotificationIntentRecord | null> {
  const row = await db.ownerNotificationIntent.findUnique({
    where: {
      organizationId_eventType_subjectKind_subjectId_occurrenceKey: identity,
    },
  });
  return row ? mapOwnerNotificationIntent(row) : null;
}

/** Every intent recorded about one subject, oldest first. Subject history for A8.6. */
export async function listOwnerNotificationIntentsForSubject(
  db: Client,
  organizationId: string,
  subjectKind: OwnerNotificationSubjectKindValue,
  subjectId: string,
): Promise<OwnerNotificationIntentRecord[]> {
  const rows = await db.ownerNotificationIntent.findMany({
    where: { organizationId, subjectKind, subjectId },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(mapOwnerNotificationIntent);
}
