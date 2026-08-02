import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  claimReminderOccurrence,
  createTask,
  finalizeReminderOccurrence,
  listDueAdvanceReminderSchedulesGlobally,
  listDueReminderSchedulesGlobally,
  markProviderCallStarted,
  persistEstablishedReminderSchedule,
  stopReminderSchedule,
  suspendReminderScheduleForWaiting,
  upsertRecipient,
  type PersistedReminderSchedule,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

/**
 * A8.4b.3 — the advance due scan and the disposition its outcomes settle to.
 *
 * The worker suite in `apps/web` proves the policy end to end. This one proves the two persistence
 * facts that policy rests on and that no higher layer can check: which rows the scan is willing to
 * return, and which advance disposition each terminal outcome writes.
 *
 * The scan's predicate is the whole of the "not yet handled" test — there is no anti-join against
 * occurrence history — so every way a schedule can stop being a candidate has to be a way it leaves
 * this query. That is what the first block enumerates.
 */

const org = 'org_a84b3';
const zone = REMINDER_SCHEDULING_TIME_ZONE;
const ESTABLISHED = '2026-08-01T12:00:00.000Z';
/** Due 2026-08-05 puts the advance occurrence at 2026-08-04 09:00 Vancouver. */
const DUE = '2026-08-05';
const ADVANCE_MORNING = '2026-08-04T16:05:00.000Z';

const migrationsRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'prisma',
  'migrations',
);
const MIGRATION_THIRTEEN = '20260803090000_a8_4b3_advance_due_scan_index';

function recipientFixture(id: string): Recipient {
  return {
    id: asRecipientId(id),
    displayName: 'Alex Recipient',
    email: `${id}@example.com`,
    active: true,
  };
}

function taskFixture(id: string, at: string): Task {
  return {
    id: asTaskId(id),
    organizationId: asOrganizationId(org),
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

describe('A8.4b.3 advance due scan (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  async function seed(
    key: string,
    options: { dueLocalDate?: string } = {},
  ): Promise<{ taskId: string; schedule: PersistedReminderSchedule; advanceAt: string }> {
    const taskId = `task_${key}`;
    await upsertRecipient(db.prisma, {
      organizationId: org,
      recipient: recipientFixture(`rcp_${taskId}`),
    });
    const task = taskFixture(taskId, ESTABLISHED);
    await createTask(db.prisma, org, task, task.assignment);

    const dueLocalDate = parseLocalDate(options.dueLocalDate ?? DUE);
    const advance = decideAdvanceReminder({ dueLocalDate, establishedAt: ESTABLISHED });
    const nextOverdue = selectNextOverdueOccurrence({ dueLocalDate, now: ESTABLISHED });
    const { schedule } = await persistEstablishedReminderSchedule({
      db: db.prisma,
      schedule: {
        id: `sched_${key}`,
        organizationId: org,
        taskId,
        dueLocalDate,
        schedulingTimeZone: zone,
        establishedAt: ESTABLISHED,
        advanceDisposition: 'scheduled',
        advanceOccurrence: {
          occurrenceLocalDate: advance.occurrenceLocalDate,
          occurrenceAt: advance.occurrenceAt,
        },
        nextOverdueOccurrence: {
          occurrenceLocalDate: nextOverdue.occurrenceLocalDate,
          occurrenceAt: nextOverdue.occurrenceAt,
        },
      },
    });
    return { taskId, schedule, advanceAt: advance.occurrenceAt };
  }

  async function scan(at: string, limit = 50): Promise<string[]> {
    const rows = await listDueAdvanceReminderSchedulesGlobally(db.prisma, {
      dueAtOrBefore: at,
      limit,
    });
    return rows.map((row) => row.id);
  }

  describe('which rows it is willing to return', () => {
    it('returns an active schedule whose advance occurrence has arrived', async () => {
      const seeded = await seed('scan_due');
      expect(await scan(ADVANCE_MORNING)).toContain(seeded.schedule.id);
    });

    it('does not return one whose advance occurrence is still ahead', async () => {
      const seeded = await seed('scan_early');
      // 2026-08-04 08:55 Vancouver, five minutes before the occurrence.
      expect(await scan('2026-08-04T15:55:00.000Z')).not.toContain(seeded.schedule.id);
    });

    it('does not return one whose disposition has already settled', async () => {
      const seeded = await seed('scan_settled');
      for (const disposition of [
        'delivered',
        'skipped_window_elapsed',
        'skipped_waiting_elapsed',
        'skipped_not_eligible',
        'failed_permanent',
        'ambiguous',
      ] as const) {
        await db.prisma.taskReminderSchedule.update({
          where: { id: seeded.schedule.id },
          data: { advanceDisposition: disposition },
        });
        expect(await scan(ADVANCE_MORNING), disposition).not.toContain(seeded.schedule.id);
      }
    });

    it('does not return a Waiting schedule', async () => {
      const seeded = await seed('scan_waiting');
      await suspendReminderScheduleForWaiting(db.prisma, {
        organizationId: org,
        scheduleId: seeded.schedule.id,
        suspendedAt: '2026-08-02T12:00:00.000Z',
      });
      expect(await scan(ADVANCE_MORNING)).not.toContain(seeded.schedule.id);
    });

    it('does not return a stopped schedule', async () => {
      const seeded = await seed('scan_stopped');
      await stopReminderSchedule(db.prisma, {
        organizationId: org,
        scheduleId: seeded.schedule.id,
        reason: 'due_date_removed',
        stoppedAt: '2026-08-02T12:00:00.000Z',
      });
      expect(await scan(ADVANCE_MORNING)).not.toContain(seeded.schedule.id);
    });

    it('carries the row\u2019s own organization and the generation\u2019s due date', async () => {
      const seeded = await seed('scan_shape');
      const [row] = (
        await listDueAdvanceReminderSchedulesGlobally(db.prisma, {
          dueAtOrBefore: ADVANCE_MORNING,
          limit: 50,
        })
      ).filter((candidate) => candidate.id === seeded.schedule.id);

      expect(row?.organizationId).toBe(org);
      expect(row?.taskId).toBe(seeded.taskId);
      expect(row?.dueLocalDate).toBe(DUE);
      expect(row?.advanceOccurrenceLocalDate).toBe('2026-08-04');
      expect(row?.advanceOccurrenceAt).toBe(seeded.advanceAt);
      expect(row?.schedulingTimeZone).toBe(zone);
    });
  });

  describe('bounding and ordering', () => {
    it('orders by occurrence instant so the reminder owed longest goes first', async () => {
      const early = await seed('order_early', { dueLocalDate: '2026-09-02' });
      const late = await seed('order_late', { dueLocalDate: '2026-09-04' });

      const ids = await scan('2026-09-04T16:05:00.000Z');
      expect(ids.indexOf(early.schedule.id)).toBeLessThan(ids.indexOf(late.schedule.id));
    });

    it('bounds the batch', async () => {
      await seed('bound_a', { dueLocalDate: '2026-10-02' });
      await seed('bound_b', { dueLocalDate: '2026-10-03' });
      expect(await scan('2026-10-03T16:05:00.000Z', 1)).toHaveLength(1);
    });

    it('refuses an unusable limit, the same way the overdue scan does', async () => {
      await expect(scan(ADVANCE_MORNING, 0)).rejects.toThrow(/between 1 and 500/);
      await expect(scan(ADVANCE_MORNING, 501)).rejects.toThrow(/between 1 and 500/);
    });

    /** The two scans are independent: neither predicate can hide a candidate from the other. */
    it('is disjoint from the overdue scan for a schedule owing both', async () => {
      const seeded = await seed('both_kinds');
      const at = '2026-08-06T16:05:00.000Z'; // First overdue morning; advance long past.

      const advance = await scan(at);
      const overdue = (
        await listDueReminderSchedulesGlobally(db.prisma, { dueAtOrBefore: at, limit: 50 })
      ).map((row) => row.id);

      expect(advance).toContain(seeded.schedule.id);
      expect(overdue).toContain(seeded.schedule.id);
    });
  });

  describe('what a terminal outcome settles the advance disposition to', () => {
    /** Claim the advance occurrence and finalize it, exactly as the worker does. */
    async function processAdvance(
      key: string,
      outcome: 'success' | 'skipped' | 'permanent_failure' | 'ambiguous' | 'retryable_failure',
      skipReason: 'advance_window_elapsed' | 'task_not_eligible' | null = null,
    ): Promise<PersistedReminderSchedule> {
      const seeded = await seed(key);
      const claim = await claimReminderOccurrence(db.prisma, {
        id: `att_${key}`,
        organizationId: org,
        scheduleId: seeded.schedule.id,
        generation: seeded.schedule.generation,
        occurrenceKind: 'advance',
        occurrenceLocalDate: parseLocalDate('2026-08-04') as LocalDate,
        occurrenceAt: seeded.advanceAt,
        claimedBy: 'test',
        claimedAt: ADVANCE_MORNING,
        claimExpiresAt: '2026-08-04T16:10:00.000Z',
        now: ADVANCE_MORNING,
        maxAttempts: 3,
      });
      expect(claim.claimed).toBe(true);

      if (outcome !== 'skipped') {
        // The `acceptance_implies_started` constraint: anything that reached a provider must have
        // said so first, which is the durable marker recovery reads after a crash.
        await markProviderCallStarted(db.prisma, {
          organizationId: org,
          attemptId: `att_${key}`,
          claimSequence: claim.claimed ? claim.claimSequence : 0,
          startedAt: ADVANCE_MORNING,
        });
      }

      await finalizeReminderOccurrence({
        db: db.prisma,
        organizationId: org,
        attemptId: `att_${key}`,
        scheduleId: seeded.schedule.id,
        claimSequence: claim.claimed ? claim.claimSequence : 0,
        outcome,
        completedAt: ADVANCE_MORNING,
        expectedGeneration: seeded.schedule.generation,
        skipReason,
        failureCode: outcome === 'success' || outcome === 'skipped' ? null : 'TEST',
        providerAcceptedAt: outcome === 'success' ? ADVANCE_MORNING : null,
        providerMessageRef: outcome === 'success' ? 'ref' : null,
        nextOverdueOccurrence: selectNextOverdueOccurrence({
          dueLocalDate: parseLocalDate(DUE),
          now: ADVANCE_MORNING,
        }),
      });

      return db.prisma.taskReminderSchedule
        .findUniqueOrThrow({ where: { id: seeded.schedule.id } })
        .then((row) => row as unknown as PersistedReminderSchedule);
    }

    it('settles a delivered advance to delivered', async () => {
      expect((await processAdvance('settle_ok', 'success')).advanceDisposition).toBe('delivered');
    });

    /**
     * The distinction A8.4b.3 added. Both are skips, and an Owner asking what happened to a
     * reminder needs to be told an outage apart from a Task that stopped needing one.
     */
    it('settles a missed morning to skipped_window_elapsed', async () => {
      const schedule = await processAdvance('settle_window', 'skipped', 'advance_window_elapsed');
      expect(schedule.advanceDisposition).toBe('skipped_window_elapsed');
    });

    it('settles any other skip to skipped_not_eligible', async () => {
      const schedule = await processAdvance('settle_inelig', 'skipped', 'task_not_eligible');
      expect(schedule.advanceDisposition).toBe('skipped_not_eligible');
    });

    it('settles a permanent failure without stopping the overdue series', async () => {
      const schedule = await processAdvance('settle_perm', 'permanent_failure');
      expect(schedule.advanceDisposition).toBe('failed_permanent');
      expect(schedule.status).toBe('active');
      expect(schedule.stopReason).toBeNull();
    });

    it('settles an ambiguous advance without reaching D129', async () => {
      const schedule = await processAdvance('settle_amb', 'ambiguous');
      expect(schedule.advanceDisposition).toBe('ambiguous');
      expect(schedule.status).toBe('active');
      expect(schedule.stopReason).toBeNull();
    });

    it('leaves the disposition scheduled after a retryable failure', async () => {
      const schedule = await processAdvance('settle_retry', 'retryable_failure');
      // Still owed, so still a candidate: the next invocation finds it in the scan again.
      expect(schedule.advanceDisposition).toBe('scheduled');
    });
  });
});

describe('A8.4b.3 advance due-scan index migration: the file itself', () => {
  const sql = fs.readFileSync(
    path.join(migrationsRoot, MIGRATION_THIRTEEN, 'migration.sql'),
    'utf8',
  );

  it('is recorded after the A8.4b.2 stop-reason migration', () => {
    const directories = fs
      .readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(directories).toContain(MIGRATION_THIRTEEN);
    expect(directories.indexOf(MIGRATION_THIRTEEN)).toBeGreaterThan(
      directories.indexOf('20260802210000_a8_4b2_repeated_ambiguous_stop_reason'),
    );
  });

  it('creates one partial index and nothing else', () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "task_reminder_schedules_advance_due_scan_idx"/,
    );
    expect(sql).toMatch(/WHERE "status" = 'active' AND "advance_disposition" = 'scheduled'/);
    // Additive: no column, constraint, enum value, or row is touched.
    const statements = sql.replace(/--[^\n]*/g, '');
    expect(statements).not.toMatch(/ALTER TABLE|ALTER TYPE|UPDATE |DELETE |DROP /);
  });

  it('orders the index to match the scan', () => {
    expect(sql).toMatch(/ON "task_reminder_schedules"\("advance_occurrence_at", "id"\)/);
  });
});
