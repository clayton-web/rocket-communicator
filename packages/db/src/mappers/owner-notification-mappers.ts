import type {
  OwnerNotificationAttempt as PrismaOwnerNotificationAttempt,
  OwnerNotificationIntent as PrismaOwnerNotificationIntent,
} from '../generated/client/index.js';
import { toIso } from './domain-mappers.js';

/**
 * A8.5a row mappers for the Owner Event Notification tables (D133–D135).
 *
 * These stay here rather than in `domain-mappers.ts` for the reason the reminder mappers do: an
 * Owner notification is an operational record of what the system owes and what it tried, not a
 * business record the domain reasons about. Nothing in `@aicaa/domain` models one, so there is no
 * domain type to map onto and no branded identifier to mint.
 *
 * Instants cross this boundary as ISO strings, matching every other repository record, so callers
 * never handle a `Date` whose timezone is implicit.
 */

export type OwnerNotificationEventTypeValue = PrismaOwnerNotificationIntent['eventType'];
export type OwnerNotificationSubjectKindValue = PrismaOwnerNotificationIntent['subjectKind'];
export type OwnerNotificationStateValue = PrismaOwnerNotificationIntent['state'];
export type OwnerNotificationSuppressionReasonValue = NonNullable<
  PrismaOwnerNotificationIntent['suppressionReason']
>;
export type OwnerNotificationAttemptOutcomeValue = PrismaOwnerNotificationAttempt['outcome'];

/**
 * Truthful attribution of the event that caused a notification, copied from the audit row written
 * in the same transaction (D133).
 *
 * This is the **triggering** actor, never the audience and never the delivery mechanism. A Recipient
 * completing a Task stays `capability`-attributed: the Owner is who finds out, not who acted.
 */
export type OwnerNotificationActor = {
  actorKind: 'owner' | 'capability' | 'system';
  ownerId: string | null;
  capabilityId: string | null;
  systemId: string | null;
  assignmentId: string | null;
  attributionLabel: string | null;
};

export type OwnerNotificationIntentRecord = OwnerNotificationActor & {
  id: string;
  organizationId: string;
  eventType: OwnerNotificationEventTypeValue;
  subjectKind: OwnerNotificationSubjectKindValue;
  subjectId: string;
  occurrenceKey: string;
  state: OwnerNotificationStateValue;
  suppressionReason: OwnerNotificationSuppressionReasonValue | null;
  failureCode: string | null;
  attemptCount: number;
  claimedBy: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  claimSequence: number;
  occurredAt: string;
  settledAt: string | null;
  auditEventId: string | null;
  requestId: string | null;
  correlationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OwnerNotificationAttemptRecord = {
  id: string;
  organizationId: string;
  intentId: string;
  attemptNumber: number;
  outcome: OwnerNotificationAttemptOutcomeValue;
  failureCode: string | null;
  providerCallStartedAt: string | null;
  providerAcceptedAt: string | null;
  providerMessageRef: string | null;
  createdAt: string;
  updatedAt: string;
};

export function mapOwnerNotificationIntent(
  row: PrismaOwnerNotificationIntent,
): OwnerNotificationIntentRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    eventType: row.eventType,
    subjectKind: row.subjectKind,
    subjectId: row.subjectId,
    occurrenceKey: row.occurrenceKey,
    state: row.state,
    suppressionReason: row.suppressionReason,
    failureCode: row.failureCode,
    attemptCount: row.attemptCount,
    claimedBy: row.claimedBy,
    claimedAt: row.claimedAt ? toIso(row.claimedAt) : null,
    claimExpiresAt: row.claimExpiresAt ? toIso(row.claimExpiresAt) : null,
    claimSequence: row.claimSequence,
    occurredAt: toIso(row.occurredAt),
    settledAt: row.settledAt ? toIso(row.settledAt) : null,
    actorKind: row.actorKind,
    ownerId: row.ownerId,
    capabilityId: row.capabilityId,
    systemId: row.systemId,
    assignmentId: row.assignmentId,
    attributionLabel: row.attributionLabel,
    auditEventId: row.auditEventId,
    requestId: row.requestId,
    correlationId: row.correlationId,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function mapOwnerNotificationAttempt(
  row: PrismaOwnerNotificationAttempt,
): OwnerNotificationAttemptRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    intentId: row.intentId,
    attemptNumber: row.attemptNumber,
    outcome: row.outcome,
    failureCode: row.failureCode,
    providerCallStartedAt: row.providerCallStartedAt ? toIso(row.providerCallStartedAt) : null,
    providerAcceptedAt: row.providerAcceptedAt ? toIso(row.providerAcceptedAt) : null,
    providerMessageRef: row.providerMessageRef,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}
