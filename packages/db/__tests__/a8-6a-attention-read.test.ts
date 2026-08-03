import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  REMINDER_SCHEDULING_TIME_ZONE,
  asOrganizationId,
  asTaskId,
  type Task,
} from '@aicaa/domain';
import { createTask, listReminderSchedulesRequiringOwnerAttention } from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

/**
 * A8.6a — the Owner attention read.
 *
 * Four properties this read has to have, none of which a page test can check: it is bounded, it is
 * ordered, it cannot see another organization's schedule, and it cannot link an item to another
 * organization's Task. The last is the one worth the most scrutiny, because the state it defends
 * against is one the write path is supposed to make impossible.
 *
 * Also measures the round-trip count directly. "No N+1" is a claim about how many statements reach
 * the database, and the only honest way to hold it is to count them and watch the number stay flat
 * as rows are added.
 */

const ORG_A = 'org_a86a_a';
const ORG_B = 'org_a86a_b';
const ESTABLISHED = '2026-08-01T12:00:00.000Z';

function taskFixture(id: string, organizationId: string): Task {
  return {
    id: asTaskId(id),
    organizationId: asOrganizationId(organizationId),
    status: 'open',
    summaryPoints: [
      { id: `${id}_p1`, kind: 'next_action', label: 'Act', order: 0, value: `Summary for ${id}` },
    ],
    notes: [],
    reminder: { paused: false },
    retention: {},
    version: 1,
    createdAt: ESTABLISHED,
    updatedAt: ESTABLISHED,
  };
}

describe('A8.6a Owner attention read (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  /**
   * Seed a Task and a schedule with exactly the fields under test.
   *
   * Written through Prisma rather than the establishment repository so a single test can place a
   * schedule in any combination of status, stop reason, attention flag, and — critically — an
   * organization that disagrees with its Task's. That last state has no legitimate writer, which is
   * the whole reason the read has to be tested against it.
   */
  async function seed(input: {
    key: string;
    taskOrganizationId: string;
    scheduleOrganizationId?: string;
    dueLocalDate?: string | null;
    scheduleDueLocalDate?: string;
    requiresOwnerAttention?: boolean;
    stopReason?: 'overdue_ceiling_reached' | 'permanent_delivery_failure' | null;
  }): Promise<{ taskId: string }> {
    const taskId = `task_${input.key}`;
    await createTask(
      db.prisma,
      input.taskOrganizationId,
      taskFixture(taskId, input.taskOrganizationId),
    );
    if (input.dueLocalDate) {
      // `Task.dueLocalDate` has no domain field and is written only by the reminder establishment
      // transaction (D103), so a read fixture sets it directly rather than staging that whole path.
      await db.prisma.task.update({
        where: { id: taskId },
        data: { dueLocalDate: input.dueLocalDate },
      });
    }

    await db.prisma.taskReminderSchedule.create({
      data: {
        id: `sched_${input.key}`,
        organizationId: input.scheduleOrganizationId ?? input.taskOrganizationId,
        taskId,
        dueLocalDate: input.scheduleDueLocalDate ?? input.dueLocalDate ?? '2026-08-05',
        schedulingTimeZone: REMINDER_SCHEDULING_TIME_ZONE,
        establishedAt: new Date(ESTABLISHED),
        status: input.stopReason ? 'stopped' : 'active',
        stopReason: input.stopReason ?? null,
        stoppedAt: input.stopReason ? new Date(ESTABLISHED) : null,
        requiresOwnerAttention: input.requiresOwnerAttention ?? false,
        advanceDisposition: 'skipped_window_elapsed',
        advanceOccurrenceLocalDate: '2026-08-04',
        advanceOccurrenceAt: new Date('2026-08-04T16:00:00.000Z'),
      },
    });
    return { taskId };
  }

  function read(organizationId: string, limit = 50) {
    return listReminderSchedulesRequiringOwnerAttention(db.prisma, { organizationId, limit });
  }

  describe('bound', () => {
    it('rejects a limit that is not a positive integer', async () => {
      for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(read(ORG_A, limit)).rejects.toThrow(/between 1 and 200/);
      }
    });

    it('rejects a limit above the ceiling, so a caller cannot ask for everything', async () => {
      await expect(read(ORG_A, 201)).rejects.toThrow(/between 1 and 200/);
      await expect(read(ORG_A, Number.MAX_SAFE_INTEGER)).rejects.toThrow(/between 1 and 200/);
    });

    it('returns no more rows than the limit allows', async () => {
      for (const index of [1, 2, 3, 4] as const) {
        await seed({
          key: `bound_${index}`,
          taskOrganizationId: ORG_A,
          dueLocalDate: `2026-09-0${index}`,
          requiresOwnerAttention: true,
          stopReason: 'overdue_ceiling_reached',
        });
      }
      expect(await read(ORG_A, 2)).toHaveLength(2);
      expect((await read(ORG_A, 1))[0]!.taskId).toBe('task_bound_1');
    });
  });

  describe('ordering', () => {
    it('is total and stable: earliest due date first, then Task id', async () => {
      // Two schedules share a due date, so the tie-breaker is the only thing separating them.
      await seed({
        key: 'order_b',
        taskOrganizationId: ORG_A,
        scheduleDueLocalDate: '2026-10-10',
        requiresOwnerAttention: true,
        stopReason: 'permanent_delivery_failure',
      });
      await seed({
        key: 'order_a',
        taskOrganizationId: ORG_A,
        scheduleDueLocalDate: '2026-10-10',
        requiresOwnerAttention: true,
        stopReason: 'permanent_delivery_failure',
      });
      await seed({
        key: 'order_early',
        taskOrganizationId: ORG_A,
        scheduleDueLocalDate: '2026-10-01',
        requiresOwnerAttention: true,
        stopReason: 'permanent_delivery_failure',
      });

      const ordered = (await read(ORG_A))
        .map((row) => row.taskId)
        .filter((id) => id.startsWith('task_order_'));
      expect(ordered).toEqual(['task_order_early', 'task_order_a', 'task_order_b']);

      // Repeating the read against an unchanged database returns the identical sequence.
      const again = (await read(ORG_A))
        .map((row) => row.taskId)
        .filter((id) => id.startsWith('task_order_'));
      expect(again).toEqual(ordered);
    });
  });

  describe('what it will and will not return', () => {
    it('returns only schedules flagged for attention', async () => {
      await seed({
        key: 'unflagged',
        taskOrganizationId: ORG_A,
        requiresOwnerAttention: false,
        stopReason: 'overdue_ceiling_reached',
      });
      const ids = (await read(ORG_A)).map((row) => row.taskId);
      expect(ids).not.toContain('task_unflagged');
    });

    it('never returns another organization’s schedule', async () => {
      await seed({
        key: 'other_org',
        taskOrganizationId: ORG_B,
        requiresOwnerAttention: true,
        stopReason: 'overdue_ceiling_reached',
      });

      expect((await read(ORG_A)).map((row) => row.taskId)).not.toContain('task_other_org');
      expect((await read(ORG_B)).map((row) => row.taskId)).toContain('task_other_org');
    });

    /**
     * The coherence guarantee, tested against a row no writer produces.
     *
     * A schedule claiming organization A whose Task belongs to organization B satisfies the
     * schedule-level filter on its own. If the Task were resolved separately and trusted, the Owner
     * of A would be handed a link to B's work. The relation filter makes the row unmatchable
     * instead, so it drops out entirely — hidden rather than leaked.
     */
    it('drops a schedule whose Task belongs to another organization', async () => {
      await seed({
        key: 'incoherent',
        taskOrganizationId: ORG_B,
        scheduleOrganizationId: ORG_A,
        requiresOwnerAttention: true,
        stopReason: 'permanent_delivery_failure',
      });

      expect((await read(ORG_A)).map((row) => row.taskId)).not.toContain('task_incoherent');
      // Nor does it surface under the Task's organization, whose schedule it is not.
      expect((await read(ORG_B)).map((row) => row.taskId)).not.toContain('task_incoherent');
    });

    it('carries the Task’s canonical due date, which may differ from the generation snapshot', async () => {
      await seed({
        key: 'due_dates',
        taskOrganizationId: ORG_A,
        dueLocalDate: '2026-11-20',
        scheduleDueLocalDate: '2026-11-01',
        requiresOwnerAttention: true,
        stopReason: 'overdue_ceiling_reached',
      });
      const row = (await read(ORG_A)).find((candidate) => candidate.taskId === 'task_due_dates');
      expect(row?.taskDueLocalDate).toBe('2026-11-20');
    });

    it('reports a null due date for a Task whose due date was removed', async () => {
      await seed({
        key: 'no_due',
        taskOrganizationId: ORG_A,
        dueLocalDate: null,
        requiresOwnerAttention: true,
        stopReason: 'permanent_delivery_failure',
      });
      const row = (await read(ORG_A)).find((candidate) => candidate.taskId === 'task_no_due');
      expect(row?.taskDueLocalDate).toBeNull();
    });
  });

  describe('round-trip count', () => {
    /**
     * Counted at the driver, which is the only place the number is real.
     *
     * `PrismaPGlite` issues one `client.query(...)` per SQL statement, so wrapping that method
     * counts statements rather than Prisma operations — the distinction that matters, since a
     * nested relation `select` is one Prisma call whether it compiles to one statement or two.
     * Transaction control statements are excluded by name: a read issues none, and counting them
     * would make the assertion about Prisma's session management rather than about this query.
     */
    async function countStatements(run: () => Promise<unknown>): Promise<number> {
      const pglite = db.pglite as unknown as { query: (...args: unknown[]) => Promise<unknown> };
      const original = pglite.query.bind(db.pglite);
      const statements: string[] = [];
      pglite.query = async (...args: unknown[]) => {
        if (typeof args[0] === 'string') {
          statements.push(args[0]);
        }
        return original(...args);
      };
      try {
        await run();
      } finally {
        pglite.query = original;
      }
      return statements.filter((sql) => !/^\s*(BEGIN|COMMIT|ROLLBACK|SET|DEALLOCATE)/i.test(sql))
        .length;
    }

    it('stays constant as attention items are added, rather than growing per row', async () => {
      const organizationId = 'org_a86a_count';
      await seed({
        key: 'count_1',
        taskOrganizationId: organizationId,
        scheduleDueLocalDate: '2026-12-01',
        requiresOwnerAttention: true,
        stopReason: 'overdue_ceiling_reached',
      });

      const withOne = await countStatements(() => read(organizationId));
      expect(await read(organizationId)).toHaveLength(1);

      for (const index of [2, 3, 4, 5, 6] as const) {
        await seed({
          key: `count_${index}`,
          taskOrganizationId: organizationId,
          scheduleDueLocalDate: `2026-12-0${index}`,
          requiresOwnerAttention: true,
          stopReason: 'overdue_ceiling_reached',
        });
      }

      const withSix = await countStatements(() => read(organizationId));
      expect(await read(organizationId)).toHaveLength(6);

      // Flat, not merely sub-linear: six times the rows for the same number of statements.
      expect(withSix).toBe(withOne);

      /*
       * And small. Measured at two on Prisma 6.19: one statement for the schedules, with the
       * organization coherence filter compiled into it, and one batched load for their Tasks.
       *
       * Bracketed rather than pinned because one or two is a difference in relation-loading
       * strategy, which Prisma may change without this query changing. Flatness above is the
       * property worth defending — a per-row lookup fails that assertion no matter which strategy
       * produced it — and this bound only catches a shape regression that flatness would miss.
       */
      expect(withOne).toBeLessThanOrEqual(2);
      expect(withOne).toBeGreaterThanOrEqual(1);
    });
  });
});
