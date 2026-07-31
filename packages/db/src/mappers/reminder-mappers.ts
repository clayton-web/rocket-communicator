import type { LocalDate, ReminderOccurrenceOutcome } from '@aicaa/domain';
import { parseLocalDate } from '../../../domain/dist/index.js';
import type {
  ReminderAdvanceDisposition,
  ReminderDeliveryAttempt as PrismaReminderDeliveryAttempt,
  ReminderDeliveryOutcome,
  ReminderOccurrenceKind,
  ReminderScheduleStatus,
  ReminderScheduleStopReason,
  ReminderSkipReason,
  TaskReminderSchedule as PrismaTaskReminderSchedule,
} from '../generated/client/index.js';
import { toIso } from './domain-mappers.js';

/**
 * A8.3a reminder row mapping (D103, D109).
 *
 * The runtime import is the relative `../../../domain/dist/index.js` convention, not the bare
 * specifier: `packages/db/__tests__/a7-domain-import-convention.test.ts` forbids bare runtime
 * `@aicaa/domain` imports because the traced serverless layout cannot resolve them.
 *
 * Only `parseLocalDate` is imported, and only to *validate and brand* stored text. No scheduling
 * function is called here: mapping a row must never decide when a reminder fires (D103).
 */

export type {
  ReminderAdvanceDisposition,
  ReminderDeliveryOutcome,
  ReminderOccurrenceKind,
  ReminderScheduleStatus,
  ReminderScheduleStopReason,
  ReminderSkipReason,
};

/**
 * A persisted Task Reminder Schedule, with instants as ISO strings and local dates branded.
 *
 * Deliberately not a domain type: the domain has no schedule aggregate, and inventing one in
 * `packages/db` would put scheduling state where D103 says scheduling logic must not live.
 */
export interface PersistedReminderSchedule {
  readonly id: string;
  readonly organizationId: string;
  readonly taskId: string;
  readonly dueLocalDate: LocalDate;
  readonly schedulingTimeZone: string;
  readonly generation: number;
  readonly status: ReminderScheduleStatus;
  readonly stopReason: ReminderScheduleStopReason | null;
  readonly stoppedAt: string | null;
  readonly suspendedAt: string | null;
  readonly requiresOwnerAttention: boolean;
  readonly advanceDisposition: ReminderAdvanceDisposition;
  readonly advanceOccurrenceLocalDate: LocalDate;
  readonly advanceOccurrenceAt: string;
  readonly nextOverdueOccurrenceLocalDate: LocalDate | null;
  readonly nextOverdueOccurrenceAt: string | null;
  readonly overdueDeliveredCount: number;
  readonly claimedBy: string | null;
  readonly claimedAt: string | null;
  readonly claimExpiresAt: string | null;
  readonly establishedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PersistedReminderDeliveryAttempt {
  readonly id: string;
  readonly organizationId: string;
  readonly scheduleId: string;
  readonly taskId: string;
  readonly generation: number;
  readonly occurrenceKind: ReminderOccurrenceKind;
  readonly occurrenceLocalDate: LocalDate;
  readonly occurrenceAt: string;
  readonly outcome: ReminderDeliveryOutcome;
  readonly skipReason: ReminderSkipReason | null;
  readonly failureCode: string | null;
  readonly attemptCount: number;
  readonly claimedAt: string | null;
  readonly claimedBy: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Validate and brand a stored local date.
 *
 * The column CHECK guarantees canonical `YYYY-MM-DD` shape but cannot guarantee the date exists —
 * Postgres requires CHECK expressions to be IMMUTABLE and the text-to-date cast is not. So the
 * calendar truth of a value is asserted here, on the way out of the database, using the same domain
 * parser that guards the way in. A row that somehow held `2026-02-30` fails loudly rather than
 * flowing into scheduling as a real date.
 */
function brandLocalDate(value: string): LocalDate {
  return parseLocalDate(value);
}

export function mapReminderSchedule(row: PrismaTaskReminderSchedule): PersistedReminderSchedule {
  return {
    id: row.id,
    organizationId: row.organizationId,
    taskId: row.taskId,
    dueLocalDate: brandLocalDate(row.dueLocalDate),
    schedulingTimeZone: row.schedulingTimeZone,
    generation: row.generation,
    status: row.status,
    stopReason: row.stopReason,
    stoppedAt: row.stoppedAt ? toIso(row.stoppedAt) : null,
    suspendedAt: row.suspendedAt ? toIso(row.suspendedAt) : null,
    requiresOwnerAttention: row.requiresOwnerAttention,
    advanceDisposition: row.advanceDisposition,
    advanceOccurrenceLocalDate: brandLocalDate(row.advanceOccurrenceLocalDate),
    advanceOccurrenceAt: toIso(row.advanceOccurrenceAt),
    nextOverdueOccurrenceLocalDate:
      row.nextOverdueOccurrenceLocalDate === null
        ? null
        : brandLocalDate(row.nextOverdueOccurrenceLocalDate),
    nextOverdueOccurrenceAt: row.nextOverdueOccurrenceAt
      ? toIso(row.nextOverdueOccurrenceAt)
      : null,
    overdueDeliveredCount: row.overdueDeliveredCount,
    claimedBy: row.claimedBy,
    claimedAt: row.claimedAt ? toIso(row.claimedAt) : null,
    claimExpiresAt: row.claimExpiresAt ? toIso(row.claimExpiresAt) : null,
    establishedAt: toIso(row.establishedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function mapReminderDeliveryAttempt(
  row: PrismaReminderDeliveryAttempt,
): PersistedReminderDeliveryAttempt {
  return {
    id: row.id,
    organizationId: row.organizationId,
    scheduleId: row.scheduleId,
    taskId: row.taskId,
    generation: row.generation,
    occurrenceKind: row.occurrenceKind,
    occurrenceLocalDate: brandLocalDate(row.occurrenceLocalDate),
    occurrenceAt: toIso(row.occurrenceAt),
    outcome: row.outcome,
    skipReason: row.skipReason,
    failureCode: row.failureCode,
    attemptCount: row.attemptCount,
    claimedAt: row.claimedAt ? toIso(row.claimedAt) : null,
    claimedBy: row.claimedBy,
    completedAt: row.completedAt ? toIso(row.completedAt) : null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * Project a persisted attempt onto the A8.2 domain outcome shape.
 *
 * The database enums were defined to mirror `ReminderOccurrenceOutcome` field-for-field precisely so
 * this is a copy rather than a translation table. That matters: a translation table is a second
 * place where "does this count toward the ceiling?" could be answered, and D106's counting rule must
 * have exactly one answer — `countSuccessfulOverdueDeliveries` in the domain.
 */
export function toReminderOccurrenceOutcome(
  attempt: Pick<PersistedReminderDeliveryAttempt, 'occurrenceKind' | 'outcome'>,
): ReminderOccurrenceOutcome {
  return { occurrence: attempt.occurrenceKind, outcome: attempt.outcome };
}
