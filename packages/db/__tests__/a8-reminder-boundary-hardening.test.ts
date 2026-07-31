import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  REMINDER_SCHEDULING_TIME_ZONE,
  asAssignmentId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  decideAdvanceReminder,
  parseLocalDate,
  selectNextOverdueOccurrence,
  type LocalDate,
  type Recipient,
  type Task,
} from '@aicaa/domain';
import {
  PersistenceError,
  claimReminderOccurrence,
  createReminderSchedule,
  createTask,
  getTaskDueLocalDate,
  openNextReminderGeneration,
  persistCanonicalDueLocalDate,
  persistDueDateRemoval,
  persistEstablishedReminderSchedule,
  recordReminderDeliveryOutcome,
  recordSkippedReminderOccurrence,
  resumeReminderScheduleFromWaiting,
  setNextOverdueOccurrence,
  suspendReminderScheduleForWaiting,
  upsertRecipient,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

/**
 * A8.3a audit remediation: organization coherence, symmetric local-date validation, and error
 * fidelity (audit findings F3, F9, F16).
 *
 * The audit demonstrated three ways a caller could get past the persistence boundary: attach a
 * schedule to a Task in another organization, store a date that does not exist on any calendar, and
 * be told a skip was recorded when the occurrence had in fact already succeeded. Each test below is
 * the reproduction the audit ran, inverted into a guarantee.
 */

const orgA = 'org_hardening_a';
const orgB = 'org_hardening_b';
const zone = REMINDER_SCHEDULING_TIME_ZONE;

/** Values that satisfy the column CHECK's shape rule but name no real day, plus shape failures. */
const IMPOSSIBLE_LOCAL_DATES = [
  '2026-02-30', // February never has 30 days
  '2025-02-29', // 2025 is not a leap year
  '2026-04-31', // April has 30
  '2026-7-01', // noncanonical: unpadded month
  '2026-07-1', // noncanonical: unpadded day
  '20260701', // noncanonical: no separators
  '0000-01-01', // year below the domain's supported range
  '99999-01-01', // year above the domain's supported range
];

function recipientFixture(id: string): Recipient {
  return {
    id: asRecipientId(id),
    displayName: 'Alex Recipient',
    email: `${id}@example.com`,
    active: true,
  };
}

function taskFixture(id: string, organizationId: string, at: string): Task {
  return {
    id: asTaskId(id),
    organizationId: asOrganizationId(organizationId),
    status: 'open',
    summaryPoints: [{ id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Follow up' }],
    notes: [],
    reminder: { paused: false },
    retention: {},
    version: 1,
    createdAt: at,
    updatedAt: at,
    assignment: {
      id: asAssignmentId(`asg_${id}`),
      recipientId: asRecipientId(`rcp_${id}`),
      intendedRecipientEmail: `rcp_${id}@example.com`,
      assignedAt: at,
      assignedByOwnerId: asOwnerId('owner_1'),
      allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
    },
  };
}

function errorCode(error: unknown): string {
  expect(error).toBeInstanceOf(PersistenceError);
  return (error as PersistenceError).code;
}

/** Run `operation`, requiring it to reject, and return the thrown persistence error code. */
async function rejectionCode(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
  } catch (error) {
    return errorCode(error);
  }
  throw new Error('Expected the operation to be refused, but it succeeded.');
}

describe('A8.3a reminder persistence boundary hardening (PGlite)', () => {
  let db: TestDatabase;
  const at = '2026-08-01T12:00:00.000Z';

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  async function seedTask(id: string, organizationId: string) {
    await upsertRecipient(db.prisma, {
      organizationId,
      recipient: recipientFixture(`rcp_${id}`),
    });
    const task = taskFixture(id, organizationId, at);
    await createTask(db.prisma, organizationId, task, task.assignment);

    const dueLocalDate = parseLocalDate('2026-08-10');
    return {
      organizationId,
      taskId: id,
      dueLocalDate,
      advance: decideAdvanceReminder({ dueLocalDate, establishedAt: at }),
      nextOverdue: selectNextOverdueOccurrence({ dueLocalDate, now: at }),
    };
  }

  function scheduleInput(
    seed: Awaited<ReturnType<typeof seedTask>>,
    overrides: { id: string; organizationId?: string; dueLocalDate?: LocalDate },
  ) {
    return {
      id: overrides.id,
      organizationId: overrides.organizationId ?? seed.organizationId,
      taskId: seed.taskId,
      dueLocalDate: overrides.dueLocalDate ?? seed.dueLocalDate,
      schedulingTimeZone: zone,
      establishedAt: at,
      advanceDisposition: 'scheduled' as const,
      advanceOccurrence: {
        occurrenceLocalDate: seed.advance.occurrenceLocalDate,
        occurrenceAt: seed.advance.occurrenceAt,
      },
      nextOverdueOccurrence: {
        occurrenceLocalDate: seed.nextOverdue.occurrenceLocalDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
      },
    };
  }

  describe('organization coherence (F3)', () => {
    it('refuses a schedule for a Task owned by another organization', async () => {
      const seed = await seedTask('task_xorg_create', orgB);

      const code = await rejectionCode(() =>
        createReminderSchedule(
          db.prisma,
          scheduleInput(seed, {
            id: 'sched_xorg_create',
            organizationId: orgA,
          }),
        ),
      );

      expect(code).toBe('ORGANIZATION_MISMATCH');
      const rows = await db.pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM task_reminder_schedules WHERE id = 'sched_xorg_create'`,
      );
      expect(rows.rows[0]?.n).toBe(0);
    });

    it('stores the Task\u2019s organization, not the caller\u2019s claim', async () => {
      const seed = await seedTask('task_authoritative_org', orgB);
      const schedule = await createReminderSchedule(
        db.prisma,
        scheduleInput(seed, { id: 'sched_authoritative_org' }),
      );
      expect(schedule.organizationId).toBe(orgB);
    });

    it('refuses establishment through the transaction path across organizations', async () => {
      const seed = await seedTask('task_xorg_establish', orgB);

      const code = await rejectionCode(() =>
        persistEstablishedReminderSchedule({
          db: db.prisma,
          schedule: scheduleInput(seed, {
            id: 'sched_xorg_establish',
            organizationId: orgA,
          }),
        }),
      );

      expect(code).toBe('ORGANIZATION_MISMATCH');
      // The whole transaction is refused: the Task's canonical due date is untouched.
      expect(await getTaskDueLocalDate(db.prisma, orgB, 'task_xorg_establish')).toBeNull();
    });

    it('refuses a cross-organization due-date write', async () => {
      const seed = await seedTask('task_xorg_due', orgB);

      const code = await rejectionCode(() =>
        persistCanonicalDueLocalDate({
          db: db.prisma,
          organizationId: orgA,
          taskId: seed.taskId,
          dueLocalDate: seed.dueLocalDate,
        }),
      );

      expect(code).toBe('ORGANIZATION_MISMATCH');
      expect(await getTaskDueLocalDate(db.prisma, orgB, 'task_xorg_due')).toBeNull();
    });

    it('refuses a cross-organization due-date removal', async () => {
      const seed = await seedTask('task_xorg_removal', orgB);
      const schedule = await persistEstablishedReminderSchedule({
        db: db.prisma,
        schedule: scheduleInput(seed, { id: 'sched_xorg_removal' }),
      });
      expect(await getTaskDueLocalDate(db.prisma, orgB, seed.taskId)).toBe('2026-08-10');

      const code = await rejectionCode(() =>
        persistDueDateRemoval({
          db: db.prisma,
          organizationId: orgA,
          taskId: seed.taskId,
          scheduleId: schedule.schedule.id,
          stoppedAt: '2026-08-12T16:00:00.000Z',
        }),
      );

      expect(code).toBe('ORGANIZATION_MISMATCH');
      // Neither half of the transaction happened: the due date and the schedule both survive.
      expect(await getTaskDueLocalDate(db.prisma, orgB, seed.taskId)).toBe('2026-08-10');
      const still = await db.pglite.query<{ status: string }>(
        `SELECT status::text AS status FROM task_reminder_schedules WHERE id = 'sched_xorg_removal'`,
      );
      expect(still.rows[0]?.status).toBe('active');
    });

    it('refuses a cross-organization generation change', async () => {
      const seed = await seedTask('task_xorg_gen', orgB);
      await createReminderSchedule(db.prisma, scheduleInput(seed, { id: 'sched_xorg_gen' }));

      const code = await rejectionCode(() =>
        openNextReminderGeneration(db.prisma, {
          organizationId: orgA,
          taskId: seed.taskId,
          expectedGeneration: 1,
          dueLocalDate: parseLocalDate('2026-09-01'),
          schedulingTimeZone: zone,
          establishedAt: '2026-08-05T12:00:00.000Z',
          advanceDisposition: 'scheduled',
          advanceOccurrence: {
            occurrenceLocalDate: parseLocalDate('2026-08-31'),
            occurrenceAt: '2026-08-31T16:00:00.000Z',
          },
          nextOverdueOccurrence: null,
        }),
      );

      expect(code).toBe('ORGANIZATION_MISMATCH');
      const row = await db.pglite.query<{ generation: number }>(
        `SELECT generation FROM task_reminder_schedules WHERE id = 'sched_xorg_gen'`,
      );
      expect(row.rows[0]?.generation).toBe(1);
    });

    it('refuses a delivery attempt claimed under the wrong organization', async () => {
      const seed = await seedTask('task_xorg_attempt', orgB);
      const schedule = await createReminderSchedule(
        db.prisma,
        scheduleInput(seed, { id: 'sched_xorg_attempt' }),
      );

      const code = await rejectionCode(() =>
        claimReminderOccurrence(db.prisma, {
          id: 'att_xorg',
          organizationId: orgA,
          scheduleId: schedule.id,
          generation: 1,
          occurrenceKind: 'overdue',
          occurrenceLocalDate: seed.nextOverdue.occurrenceLocalDate,
          occurrenceAt: seed.nextOverdue.occurrenceAt,
          claimedBy: 'worker_a',
          claimedAt: '2026-08-11T16:00:00.000Z',
        }),
      );

      expect(code).toBe('ORGANIZATION_MISMATCH');
      const rows = await db.pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM reminder_delivery_attempts WHERE id = 'att_xorg'`,
      );
      expect(rows.rows[0]?.n).toBe(0);
    });

    it('derives the attempt\u2019s Task from its schedule so it cannot be redirected', async () => {
      const seed = await seedTask('task_derived', orgB);
      const schedule = await createReminderSchedule(
        db.prisma,
        scheduleInput(seed, { id: 'sched_derived' }),
      );

      const claim = await claimReminderOccurrence(db.prisma, {
        id: 'att_derived',
        organizationId: orgB,
        scheduleId: schedule.id,
        generation: 1,
        occurrenceKind: 'overdue',
        occurrenceLocalDate: seed.nextOverdue.occurrenceLocalDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
        claimedBy: 'worker_a',
        claimedAt: '2026-08-11T16:00:00.000Z',
      });

      expect(claim.attempt.taskId).toBe(seed.taskId);
      expect(claim.attempt.organizationId).toBe(orgB);
    });

    it('reports a genuinely missing Task as not-found rather than a mismatch', async () => {
      const code = await rejectionCode(() =>
        persistCanonicalDueLocalDate({
          db: db.prisma,
          organizationId: orgA,
          taskId: 'task_does_not_exist',
          dueLocalDate: parseLocalDate('2026-08-10'),
        }),
      );
      expect(code).toBe('NOT_FOUND');
    });
  });

  describe('symmetric local-date validation (F9)', () => {
    /** The brand is erased at build time, so this is exactly what a JavaScript caller can pass. */
    const forge = (value: string) => value as LocalDate;

    it('refuses an impossible schedule due date on write', async () => {
      const seed = await seedTask('task_bad_due', orgA);
      for (const value of IMPOSSIBLE_LOCAL_DATES) {
        const code = await rejectionCode(() =>
          createReminderSchedule(
            db.prisma,
            scheduleInput(seed, { id: `sched_bad_due_${value}`, dueLocalDate: forge(value) }),
          ),
        );
        expect(code, `expected ${value} to be refused`).toBe('VALIDATION');
      }

      const rows = await db.pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM task_reminder_schedules WHERE task_id = 'task_bad_due'`,
      );
      expect(rows.rows[0]?.n).toBe(0);
    });

    it('refuses an impossible advance occurrence date on write', async () => {
      const seed = await seedTask('task_bad_advance', orgA);
      const input = scheduleInput(seed, { id: 'sched_bad_advance' });

      const code = await rejectionCode(() =>
        createReminderSchedule(db.prisma, {
          ...input,
          advanceOccurrence: {
            occurrenceLocalDate: forge('2026-02-30'),
            occurrenceAt: seed.advance.occurrenceAt,
          },
        }),
      );
      expect(code).toBe('VALIDATION');
    });

    it('refuses an impossible next-overdue occurrence date on write', async () => {
      const seed = await seedTask('task_bad_next', orgA);
      const input = scheduleInput(seed, { id: 'sched_bad_next' });

      const code = await rejectionCode(() =>
        createReminderSchedule(db.prisma, {
          ...input,
          nextOverdueOccurrence: {
            occurrenceLocalDate: forge('2025-02-29'),
            occurrenceAt: seed.nextOverdue.occurrenceAt,
          },
        }),
      );
      expect(code).toBe('VALIDATION');
    });

    it('refuses an impossible date when arming the next occurrence or resuming', async () => {
      const seed = await seedTask('task_bad_arm', orgA);
      const schedule = await createReminderSchedule(
        db.prisma,
        scheduleInput(seed, { id: 'sched_bad_arm' }),
      );

      expect(
        await rejectionCode(() =>
          setNextOverdueOccurrence(db.prisma, {
            organizationId: orgA,
            scheduleId: schedule.id,
            expectedGeneration: 1,
            nextOverdueOccurrence: {
              occurrenceLocalDate: forge('2026-04-31'),
              occurrenceAt: '2026-04-30T16:00:00.000Z',
            },
          }),
        ),
      ).toBe('VALIDATION');

      await suspendReminderScheduleForWaiting(db.prisma, {
        organizationId: orgA,
        scheduleId: schedule.id,
        suspendedAt: '2026-08-11T16:00:00.000Z',
      });

      expect(
        await rejectionCode(() =>
          resumeReminderScheduleFromWaiting(db.prisma, {
            organizationId: orgA,
            scheduleId: schedule.id,
            nextOverdueOccurrence: {
              occurrenceLocalDate: forge('2026-02-30'),
              occurrenceAt: '2026-03-01T16:00:00.000Z',
            },
          }),
        ),
      ).toBe('VALIDATION');
    });

    it('refuses an impossible generation-change due date on write', async () => {
      const seed = await seedTask('task_bad_gen', orgA);
      await createReminderSchedule(db.prisma, scheduleInput(seed, { id: 'sched_bad_gen' }));

      const code = await rejectionCode(() =>
        openNextReminderGeneration(db.prisma, {
          organizationId: orgA,
          taskId: seed.taskId,
          expectedGeneration: 1,
          dueLocalDate: forge('2026-02-30'),
          schedulingTimeZone: zone,
          establishedAt: '2026-08-05T12:00:00.000Z',
          advanceDisposition: 'scheduled',
          advanceOccurrence: {
            occurrenceLocalDate: parseLocalDate('2026-08-31'),
            occurrenceAt: '2026-08-31T16:00:00.000Z',
          },
          nextOverdueOccurrence: null,
        }),
      );
      expect(code).toBe('VALIDATION');
    });

    it('refuses an impossible canonical Task due date on write', async () => {
      const seed = await seedTask('task_bad_canonical', orgA);
      const code = await rejectionCode(() =>
        persistCanonicalDueLocalDate({
          db: db.prisma,
          organizationId: orgA,
          taskId: seed.taskId,
          dueLocalDate: forge('2026-02-30'),
        }),
      );
      expect(code).toBe('VALIDATION');
      expect(await getTaskDueLocalDate(db.prisma, orgA, seed.taskId)).toBeNull();
    });

    it('refuses an impossible occurrence date on a claim or a skip', async () => {
      const seed = await seedTask('task_bad_occurrence', orgA);
      const schedule = await createReminderSchedule(
        db.prisma,
        scheduleInput(seed, { id: 'sched_bad_occurrence' }),
      );

      expect(
        await rejectionCode(() =>
          claimReminderOccurrence(db.prisma, {
            id: 'att_bad_claim',
            organizationId: orgA,
            scheduleId: schedule.id,
            generation: 1,
            occurrenceKind: 'overdue',
            occurrenceLocalDate: forge('2026-02-30'),
            occurrenceAt: '2026-03-01T16:00:00.000Z',
            claimedBy: 'worker_a',
            claimedAt: '2026-03-01T16:00:00.000Z',
          }),
        ),
      ).toBe('VALIDATION');

      expect(
        await rejectionCode(() =>
          recordSkippedReminderOccurrence(db.prisma, {
            id: 'att_bad_skip',
            organizationId: orgA,
            scheduleId: schedule.id,
            generation: 1,
            occurrenceKind: 'overdue',
            occurrenceLocalDate: forge('2025-02-29'),
            occurrenceAt: '2025-03-01T16:00:00.000Z',
            skipReason: 'no_active_assignment',
            recordedAt: '2025-03-01T16:00:00.000Z',
          }),
        ),
      ).toBe('VALIDATION');

      const rows = await db.pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM reminder_delivery_attempts
         WHERE id IN ('att_bad_claim', 'att_bad_skip')`,
      );
      expect(rows.rows[0]?.n).toBe(0);
    });

    it('never leaves an unreadable row behind after a rejected write', async () => {
      // The audit's failure mode: a stored date that only fails when someone reads it back.
      const poisoned = await db.pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM task_reminder_schedules
         WHERE due_local_date IN ('2026-02-30', '2025-02-29', '2026-04-31')
            OR advance_occurrence_local_date IN ('2026-02-30', '2025-02-29', '2026-04-31')
            OR next_overdue_occurrence_local_date IN ('2026-02-30', '2025-02-29', '2026-04-31')`,
      );
      expect(poisoned.rows[0]?.n).toBe(0);
    });
  });

  describe('persistence error fidelity (F16)', () => {
    async function seedClaimable(suffix: string) {
      const seed = await seedTask(`task_fid_${suffix}`, orgA);
      const schedule = await createReminderSchedule(
        db.prisma,
        scheduleInput(seed, { id: `sched_fid_${suffix}` }),
      );
      return { seed, schedule };
    }

    it('reports a reused attempt id as an id collision, not an occurrence collision', async () => {
      const { seed, schedule } = await seedClaimable('pk');
      const base = {
        organizationId: orgA,
        scheduleId: schedule.id,
        generation: 1,
        occurrenceKind: 'overdue' as const,
        claimedBy: 'worker_a',
        claimedAt: '2026-08-11T16:00:00.000Z',
      };

      await claimReminderOccurrence(db.prisma, {
        ...base,
        id: 'att_reused_id',
        occurrenceLocalDate: seed.nextOverdue.occurrenceLocalDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
      });

      // Same id, a different day — so the identity index is free and only the primary key collides.
      let thrown: unknown;
      try {
        await claimReminderOccurrence(db.prisma, {
          ...base,
          id: 'att_reused_id',
          occurrenceLocalDate: parseLocalDate('2026-08-12'),
          occurrenceAt: '2026-08-12T16:00:00.000Z',
        });
      } catch (error) {
        thrown = error;
      }

      expect(errorCode(thrown)).toBe('UNIQUE_VIOLATION');
      expect((thrown as Error).message).toContain('att_reused_id');
      expect((thrown as Error).message).toContain('already used by a different occurrence');
      expect((thrown as Error).message).not.toContain('occurrence identity is already taken');
    });

    it('still reports an occurrence-identity collision as a lost claim, not an error', async () => {
      const { seed, schedule } = await seedClaimable('identity');
      const base = {
        organizationId: orgA,
        scheduleId: schedule.id,
        generation: 1,
        occurrenceKind: 'overdue' as const,
        occurrenceLocalDate: seed.nextOverdue.occurrenceLocalDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
        claimedAt: '2026-08-11T16:00:00.000Z',
      };

      const first = await claimReminderOccurrence(db.prisma, {
        ...base,
        id: 'att_identity_1',
        claimedBy: 'worker_a',
      });
      const second = await claimReminderOccurrence(db.prisma, {
        ...base,
        id: 'att_identity_2',
        claimedBy: 'worker_b',
      });

      expect(first.claimed).toBe(true);
      expect(second.claimed).toBe(false);
      expect(second.attempt.id).toBe('att_identity_1');
    });

    it('records a repeated identical skip idempotently', async () => {
      const { seed, schedule } = await seedClaimable('skip_idem');
      const skip = {
        organizationId: orgA,
        scheduleId: schedule.id,
        generation: 1,
        occurrenceKind: 'overdue' as const,
        occurrenceLocalDate: seed.nextOverdue.occurrenceLocalDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
        skipReason: 'no_active_assignment' as const,
        recordedAt: '2026-08-11T16:00:00.000Z',
      };

      const first = await recordSkippedReminderOccurrence(db.prisma, {
        ...skip,
        id: 'att_skip_idem_1',
      });
      const again = await recordSkippedReminderOccurrence(db.prisma, {
        ...skip,
        id: 'att_skip_idem_2',
      });

      expect(again.id).toBe(first.id);
      expect(again.outcome).toBe('skipped');
      expect(again.skipReason).toBe('no_active_assignment');

      const rows = await db.pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM reminder_delivery_attempts WHERE schedule_id = '${schedule.id}'`,
      );
      expect(rows.rows[0]?.n).toBe(1);
    });

    it('refuses a skip that disagrees with an already-recorded skip reason', async () => {
      const { seed, schedule } = await seedClaimable('skip_reason');
      const skip = {
        organizationId: orgA,
        scheduleId: schedule.id,
        generation: 1,
        occurrenceKind: 'overdue' as const,
        occurrenceLocalDate: seed.nextOverdue.occurrenceLocalDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
        recordedAt: '2026-08-11T16:00:00.000Z',
      };

      await recordSkippedReminderOccurrence(db.prisma, {
        ...skip,
        id: 'att_skip_reason_1',
        skipReason: 'no_active_assignment',
      });

      const code = await rejectionCode(() =>
        recordSkippedReminderOccurrence(db.prisma, {
          ...skip,
          id: 'att_skip_reason_2',
          skipReason: 'task_not_eligible',
        }),
      );
      expect(code).toBe('DOMAIN_CONFLICT');
    });

    it.each([
      ['success', 'success'],
      ['permanent_failure', 'permanent_failure'],
      ['ambiguous', 'ambiguous'],
    ] as const)(
      'never reinterprets an existing %s occurrence as a recorded skip',
      async (label, outcome) => {
        const { seed, schedule } = await seedClaimable(`skip_vs_${label}`);
        const occurrence = {
          organizationId: orgA,
          scheduleId: schedule.id,
          generation: 1,
          occurrenceKind: 'overdue' as const,
          occurrenceLocalDate: seed.nextOverdue.occurrenceLocalDate,
          occurrenceAt: seed.nextOverdue.occurrenceAt,
        };

        const claim = await claimReminderOccurrence(db.prisma, {
          ...occurrence,
          id: `att_${label}_claim`,
          claimedBy: 'worker_a',
          claimedAt: '2026-08-11T16:00:00.000Z',
        });
        await recordReminderDeliveryOutcome(db.prisma, {
          organizationId: orgA,
          attemptId: claim.attempt.id,
          outcome,
          completedAt: '2026-08-11T16:00:05.000Z',
          failureCode: outcome === 'success' ? null : 'provider_unavailable',
        });

        const code = await rejectionCode(() =>
          recordSkippedReminderOccurrence(db.prisma, {
            ...occurrence,
            id: `att_${label}_skip`,
            skipReason: 'no_active_assignment',
            recordedAt: '2026-08-11T16:10:00.000Z',
          }),
        );

        expect(code).toBe('DOMAIN_CONFLICT');
        const row = await db.pglite.query<{ outcome: string }>(
          `SELECT outcome::text AS outcome FROM reminder_delivery_attempts
           WHERE id = 'att_${label}_claim'`,
        );
        expect(row.rows[0]?.outcome).toBe(outcome);
      },
    );

    it('never reinterprets an occurrence still under claim as a recorded skip', async () => {
      const { seed, schedule } = await seedClaimable('skip_vs_claimed');
      const occurrence = {
        organizationId: orgA,
        scheduleId: schedule.id,
        generation: 1,
        occurrenceKind: 'overdue' as const,
        occurrenceLocalDate: seed.nextOverdue.occurrenceLocalDate,
        occurrenceAt: seed.nextOverdue.occurrenceAt,
      };

      await claimReminderOccurrence(db.prisma, {
        ...occurrence,
        id: 'att_claimed_only',
        claimedBy: 'worker_a',
        claimedAt: '2026-08-11T16:00:00.000Z',
      });

      const code = await rejectionCode(() =>
        recordSkippedReminderOccurrence(db.prisma, {
          ...occurrence,
          id: 'att_claimed_skip',
          skipReason: 'no_active_assignment',
          recordedAt: '2026-08-11T16:10:00.000Z',
        }),
      );
      expect(code).toBe('DOMAIN_CONFLICT');
    });
  });
});
