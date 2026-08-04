import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  REMINDER_SCHEDULING_TIME_ZONE,
  asOrganizationId,
  asTaskId,
  type Task,
} from '@aicaa/domain';
import { createTask, listUndeliveredOwnerNotifications } from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';
import type { OwnerNotificationEventTypeValue } from '../src/mappers/owner-notification-mappers.js';

/**
 * A8.6c — the undelivered Owner notification read.
 *
 * The properties a page test cannot check: the read is bounded, ordered, windowed, filtered to the
 * four states that mean "the Owner was never told", blind to reminder-stop events, blind to other
 * organizations, and flat in the number of statements it issues however many rows come back.
 *
 * Subject resolution gets the most scrutiny, because it has two independent ways to be wrong. It
 * can be slow — one lookup per row — and it can be unsafe: an intent holds no foreign key to its
 * subject, so nothing in the database prevents one from naming another organization's row. Both
 * are tested against states no writer produces.
 */

const ORG_A = 'org_a86c_a';
const ORG_B = 'org_a86c_b';
const NOW = new Date('2026-09-01T12:00:00.000Z');
const WINDOW_START = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
const INSIDE_WINDOW = '2026-08-20T09:00:00.000Z';
const CREATED = '2026-08-01T12:00:00.000Z';

let sequence = 0;

function nextSuffix(): string {
  sequence += 1;
  return String(sequence).padStart(4, '0');
}

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
    createdAt: CREATED,
    updatedAt: CREATED,
  };
}

describe('A8.6c undelivered Owner notification read (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.prisma.ownerNotificationIntent.deleteMany();
  });

  async function seedTask(id: string, organizationId: string): Promise<string> {
    const existing = await db.prisma.task.findUnique({ where: { id } });
    if (existing === null) {
      await createTask(db.prisma, organizationId, taskFixture(id, organizationId));
    }
    return id;
  }

  /** A capability with the Recipient and assignment its foreign keys require. */
  async function seedCapability(input: {
    id: string;
    organizationId: string;
    taskId: string;
  }): Promise<string> {
    const recipientId = `rcp_${input.id}`;
    const assignmentId = `asg_${input.id}`;
    const email = `${recipientId}@example.com`;
    await db.prisma.recipient.create({
      data: {
        id: recipientId,
        organizationId: input.organizationId,
        displayName: 'Fixture Recipient',
        email,
        emailNormalized: email,
      },
    });
    await db.prisma.taskAssignment.create({
      data: {
        id: assignmentId,
        organizationId: input.organizationId,
        taskId: input.taskId,
        recipientId,
        intendedRecipientEmail: email,
        assignedAt: new Date(CREATED),
        assignedByOwnerId: 'owner_1',
        allowedCapabilityActions: [],
      },
    });
    await db.prisma.taskCapability.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        taskId: input.taskId,
        assignmentId,
        recipientId,
        intendedRecipientEmail: email,
        scope: {},
        status: 'expired',
        tokenHash: `hash_${input.id}`,
        issuedAt: new Date(CREATED),
        expiresAt: new Date('2026-08-15T00:00:00.000Z'),
      },
    });
    return input.id;
  }

  async function seedSchedule(input: {
    id: string;
    organizationId: string;
    taskId: string;
  }): Promise<string> {
    await db.prisma.taskReminderSchedule.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        taskId: input.taskId,
        dueLocalDate: '2026-08-20',
        schedulingTimeZone: REMINDER_SCHEDULING_TIME_ZONE,
        establishedAt: new Date(CREATED),
        status: 'active',
        advanceDisposition: 'skipped_window_elapsed',
        advanceOccurrenceLocalDate: '2026-08-19',
        advanceOccurrenceAt: new Date('2026-08-19T16:00:00.000Z'),
      },
    });
    return input.id;
  }

  /**
   * Insert one intent in any state.
   *
   * Written through Prisma rather than `createOwnerNotificationIntent`, which can only produce
   * `pending`. Every row this read is about is terminal, and reaching a terminal state
   * legitimately would mean running the whole A8.5b delivery workflow against a provider. The
   * CHECK constraints still apply, so a fixture that contradicts the state machine fails at insert
   * rather than being quietly tested.
   */
  async function seedIntent(input: {
    organizationId?: string;
    eventType?: OwnerNotificationEventTypeValue;
    state?: 'suppressed' | 'failed_permanent' | 'ambiguous' | 'requires_owner_attention' | 'sent';
    suppressionReason?: 'stale' | 'channel_unavailable';
    subjectKind?: 'task' | 'task_capability' | 'handoff_attempt' | 'task_reminder_schedule';
    subjectId: string;
    occurredAt?: string;
    actorKind?: 'owner' | 'capability' | 'system';
  }): Promise<string> {
    const suffix = nextSuffix();
    const id = `onint_a86c_${suffix}`;
    const state = input.state ?? 'failed_permanent';
    const actorKind = input.actorKind ?? 'capability';
    await db.prisma.ownerNotificationIntent.create({
      data: {
        id,
        organizationId: input.organizationId ?? ORG_A,
        eventType: input.eventType ?? 'task_completed_by_recipient',
        subjectKind: input.subjectKind ?? 'task',
        subjectId: input.subjectId,
        occurrenceKey: `occ_${suffix}`,
        state,
        suppressionReason: state === 'suppressed' ? (input.suppressionReason ?? 'stale') : null,
        occurredAt: new Date(input.occurredAt ?? INSIDE_WINDOW),
        settledAt: new Date(input.occurredAt ?? INSIDE_WINDOW),
        actorKind,
        ownerId: actorKind === 'owner' ? 'owner_1' : null,
        capabilityId: actorKind === 'capability' ? 'cap_ref' : null,
        systemId: actorKind === 'system' ? 'worker_1' : null,
      },
    });
    return id;
  }

  function read(organizationId = ORG_A, limit = 50, cutoff = WINDOW_START) {
    return listUndeliveredOwnerNotifications(db.prisma, {
      organizationId,
      occurredAtOrAfter: cutoff,
      limit,
    });
  }

  describe('bound', () => {
    it('rejects a limit that is not a positive integer', async () => {
      for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(read(ORG_A, limit)).rejects.toThrow(/between 1 and 50/);
      }
    });

    /** The ratified maximum is a ceiling, not a default. No caller may widen it. */
    it('rejects a limit above the ratified fifty', async () => {
      await expect(read(ORG_A, 51)).rejects.toThrow(/between 1 and 50/);
      await expect(read(ORG_A, Number.MAX_SAFE_INTEGER)).rejects.toThrow(/between 1 and 50/);
      await expect(read(ORG_A, 50)).resolves.toEqual([]);
    });

    it('rejects a cutoff that is not an interpretable instant', async () => {
      await expect(read(ORG_A, 50, 'not-a-date')).rejects.toThrow(/ISO-8601 window cutoff/);
    });

    it('returns no more rows than the limit allows', async () => {
      const taskId = await seedTask('task_a86c_bound', ORG_A);
      for (const day of ['10', '11', '12', '13']) {
        await seedIntent({ subjectId: taskId, occurredAt: `2026-08-${day}T09:00:00.000Z` });
      }
      expect(await read(ORG_A, 2)).toHaveLength(2);
    });
  });

  describe('the thirty-day window', () => {
    it('includes an event inside the window and excludes one older than it', async () => {
      const taskId = await seedTask('task_a86c_window', ORG_A);
      await seedIntent({ subjectId: taskId, occurredAt: '2026-08-25T09:00:00.000Z' });
      await seedIntent({ subjectId: taskId, occurredAt: '2026-07-01T09:00:00.000Z' });

      const rows = await read();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.occurredAt).toBe('2026-08-25T09:00:00.000Z');
    });

    /**
     * The window is the only way an item ever leaves this surface, so its edge is load-bearing: an
     * item that vanished a day early would look to the Owner like it had been resolved.
     */
    it('includes an event exactly on the cutoff', async () => {
      const taskId = await seedTask('task_a86c_edge', ORG_A);
      await seedIntent({ subjectId: taskId, occurredAt: WINDOW_START });
      expect(await read()).toHaveLength(1);
    });
  });

  describe('which states are visible', () => {
    it('returns the four states that mean the Owner was never told', async () => {
      const taskId = await seedTask('task_a86c_states', ORG_A);
      for (const state of [
        'suppressed',
        'failed_permanent',
        'ambiguous',
        'requires_owner_attention',
      ] as const) {
        await seedIntent({ subjectId: taskId, state });
      }
      expect((await read()).map((row) => row.state).sort()).toEqual([
        'ambiguous',
        'failed_permanent',
        'requires_owner_attention',
        'suppressed',
      ]);
    });

    /**
     * `sent` is the exclusion that keeps this from being an inbox: the Owner already has that
     * email. The in-progress states are excluded because delivery has not finished deciding, and
     * inviting the Owner to act on an unfinished decision is how a page contradicts a worker.
     */
    it('never returns a delivered, pending, claimed, or retryable notification', async () => {
      const taskId = await seedTask('task_a86c_hidden', ORG_A);
      await seedIntent({ subjectId: taskId, state: 'sent' });
      // Written directly: the non-terminal states forbid `settled_at`, which the helper always sets.
      const suffix = nextSuffix();
      await db.prisma.ownerNotificationIntent.create({
        data: {
          id: `onint_a86c_${suffix}`,
          organizationId: ORG_A,
          eventType: 'task_returned_to_owner',
          subjectKind: 'task',
          subjectId: taskId,
          occurrenceKey: `occ_${suffix}`,
          state: 'pending',
          occurredAt: new Date(INSIDE_WINDOW),
          actorKind: 'system',
          systemId: 'worker_1',
        },
      });

      expect(await read()).toEqual([]);
    });

    it('carries the suppression reason, which is why nothing was sent', async () => {
      const taskId = await seedTask('task_a86c_reason', ORG_A);
      await seedIntent({
        subjectId: taskId,
        state: 'suppressed',
        suppressionReason: 'channel_unavailable',
      });
      expect((await read())[0]!.suppressionReason).toBe('channel_unavailable');
    });
  });

  describe('reminder-stop events are excluded', () => {
    /**
     * Not de-duplication for tidiness. `/attention` section one is driven by a schedule flag that
     * clears when the Owner sets a new due date, while an intent is terminal forever, so an
     * unfiltered read would keep announcing a reminder stop the Owner had already repaired.
     */
    it('excludes all three reminder-stop event types', async () => {
      const taskId = await seedTask('task_a86c_stops', ORG_A);
      for (const eventType of [
        'reminder_schedule_stopped_ceiling_reached',
        'reminder_schedule_stopped_permanent_failure',
        'reminder_schedule_stopped_repeated_ambiguous',
      ] as const) {
        await seedIntent({ subjectId: taskId, eventType });
      }
      expect(await read()).toEqual([]);
    });

    /** `reminder.no_active_assignment` never raises the attention flag, so nothing else shows it. */
    it('includes reminder.no_active_assignment, which section one never shows', async () => {
      const taskId = await seedTask('task_a86c_noassign', ORG_A);
      await seedIntent({ subjectId: taskId, eventType: 'reminder_no_active_assignment' });
      expect((await read())[0]!.eventType).toBe('reminder_no_active_assignment');
    });
  });

  describe('ordering', () => {
    it('is most recent first, broken by identifier, and stable across reads', async () => {
      const taskId = await seedTask('task_a86c_order', ORG_A);
      const older = await seedIntent({ subjectId: taskId, occurredAt: '2026-08-10T09:00:00.000Z' });
      // Two events share an instant, so the tie-breaker is the only thing separating them.
      const tieA = await seedIntent({ subjectId: taskId, occurredAt: '2026-08-28T09:00:00.000Z' });
      const tieB = await seedIntent({ subjectId: taskId, occurredAt: '2026-08-28T09:00:00.000Z' });

      const ids = (await read()).map((row) => row.id);
      expect(ids).toHaveLength(3);
      expect(ids[2]).toBe(older);
      // Descending by identifier within the tie, which is what makes the order total.
      expect(ids.slice(0, 2)).toEqual([tieA, tieB].sort().reverse());
      // Repeating the read against an unchanged database returns the identical sequence.
      expect((await read()).map((row) => row.id)).toEqual(ids);
    });
  });

  describe('organization isolation', () => {
    it('never returns another organization’s notification', async () => {
      const mine = await seedTask('task_a86c_mine', ORG_A);
      const theirs = await seedTask('task_a86c_theirs', ORG_B);
      await seedIntent({ subjectId: mine, organizationId: ORG_A });
      await seedIntent({ subjectId: theirs, organizationId: ORG_B });

      expect((await read(ORG_A)).map((row) => row.taskId)).toEqual([mine]);
      expect((await read(ORG_B)).map((row) => row.taskId)).toEqual([theirs]);
    });

    /**
     * The leak this read has to be incapable of.
     *
     * An intent holds no foreign key to its subject — deliberately, so purging a Task cannot delete
     * a notification that is still owed — so nothing in the database prevents an intent in
     * organization A from naming organization B's Task. If the identifier were trusted, the Owner
     * of A would be handed a link into B's work. The row is still shown, because the event did
     * concern A and hiding it would be its own kind of lie, but it arrives with no Task attached.
     */
    it('shows an intent naming a foreign Task, but resolves no link for it', async () => {
      const foreign = await seedTask('task_a86c_foreign', ORG_B);
      await seedIntent({ subjectId: foreign, organizationId: ORG_A });

      const rows = await read(ORG_A);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.taskId).toBeNull();
      expect(rows[0]!.taskSummaryPoints).toBeNull();
    });

    it('resolves no link through a capability belonging to another organization', async () => {
      const foreign = await seedTask('task_a86c_capforeign', ORG_B);
      await seedCapability({ id: 'cap_a86c_foreign', organizationId: ORG_B, taskId: foreign });
      await seedIntent({
        organizationId: ORG_A,
        subjectKind: 'task_capability',
        subjectId: 'cap_a86c_foreign',
        eventType: 'capability_expired',
      });

      const rows = await read(ORG_A);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.taskId).toBeNull();
    });
  });

  describe('subject resolution', () => {
    it('resolves a Task subject to itself, with the Task’s summary points', async () => {
      const taskId = await seedTask('task_a86c_direct', ORG_A);
      await seedIntent({ subjectId: taskId });

      const row = (await read())[0]!;
      expect(row.taskId).toBe(taskId);
      expect(row.taskSummaryPoints).toEqual([
        expect.objectContaining({ value: `Summary for ${taskId}` }),
      ]);
    });

    it('resolves a capability subject to the Task it belongs to', async () => {
      const taskId = await seedTask('task_a86c_cap', ORG_A);
      await seedCapability({ id: 'cap_a86c_1', organizationId: ORG_A, taskId });
      await seedIntent({
        subjectKind: 'task_capability',
        subjectId: 'cap_a86c_1',
        eventType: 'capability_expired',
      });

      expect((await read())[0]!.taskId).toBe(taskId);
    });

    it('resolves a reminder schedule subject to its Task', async () => {
      const taskId = await seedTask('task_a86c_sched', ORG_A);
      await seedSchedule({ id: 'sched_a86c_1', organizationId: ORG_A, taskId });
      await seedIntent({
        subjectKind: 'task_reminder_schedule',
        subjectId: 'sched_a86c_1',
        eventType: 'reminder_no_active_assignment',
      });

      expect((await read())[0]!.taskId).toBe(taskId);
    });

    /**
     * A purged or never-existing subject. The event still happened and the Owner still was not
     * told, so the row survives without a Task rather than disappearing from the surface.
     */
    it('returns a row with no Task when the subject cannot be resolved', async () => {
      await seedIntent({
        subjectKind: 'task_capability',
        subjectId: 'cap_a86c_missing',
        eventType: 'capability_expired',
      });

      const rows = await read();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.taskId).toBeNull();
      expect(rows[0]!.eventType).toBe('capability_expired');
    });
  });

  describe('what the row does not carry', () => {
    /**
     * Absent rather than filtered later. The `select` names the projected columns, so a claim
     * holder, a lease, a provider reference, or a correlation identifier is never loaded into the
     * process at all — the difference between a field a template cannot reach and one it merely
     * does not use today.
     */
    it('omits every worker-coordination, provider, and correlation field', async () => {
      const taskId = await seedTask('task_a86c_shape', ORG_A);
      await seedIntent({ subjectId: taskId });

      const row = (await read())[0]! as unknown as Record<string, unknown>;
      expect(Object.keys(row).sort()).toEqual([
        'actorKind',
        'eventType',
        'id',
        'occurredAt',
        'settledAt',
        'state',
        'suppressionReason',
        'taskId',
        'taskSummaryPoints',
      ]);
    });
  });

  describe('round-trip count', () => {
    /**
     * Counted at the driver, which is the only place the number is real.
     *
     * `PrismaPGlite` issues one `client.query(...)` per SQL statement, so wrapping that method
     * counts statements rather than Prisma operations. Transaction control is excluded by name: a
     * read issues none, and counting it would make the assertion about Prisma's session management
     * rather than about this query.
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

    /**
     * The N+1 this read was most likely to have.
     *
     * `findOwnerNotificationSubjectTaskId` resolves one subject and would have been the obvious
     * thing to call per row. Grouping by subject kind instead makes the statement count a function
     * of how many kinds are present, never of how many notifications there are — so the number has
     * to stay flat while the row count triples.
     */
    it('stays flat as rows are added, across every resolvable subject kind', async () => {
      const organizationId = 'org_a86c_count';
      const first = await seedTask('task_a86c_count_0', organizationId);
      await seedIntent({ organizationId, subjectId: first });

      const withOne = await countStatements(() => read(organizationId));
      expect(await read(organizationId)).toHaveLength(1);

      for (let index = 1; index <= 10; index += 1) {
        const taskId = await seedTask(`task_a86c_count_${index}`, organizationId);
        await seedCapability({ id: `cap_a86c_count_${index}`, organizationId, taskId });
        await seedSchedule({ id: `sched_a86c_count_${index}`, organizationId, taskId });
        await seedIntent({ organizationId, subjectId: taskId });
        await seedIntent({
          organizationId,
          subjectKind: 'task_capability',
          subjectId: `cap_a86c_count_${index}`,
          eventType: 'capability_expired',
        });
        await seedIntent({
          organizationId,
          subjectKind: 'task_reminder_schedule',
          subjectId: `sched_a86c_count_${index}`,
          eventType: 'reminder_no_active_assignment',
        });
      }

      const withThirtyOne = await countStatements(() => read(organizationId));
      expect(await read(organizationId)).toHaveLength(31);

      /*
       * Three subject kinds are present where one was, so the count rises by the two kinds that
       * cost a statement and then stops. Adding ten more rows of kinds already present must not
       * move it at all — that is the property, rather than any particular number.
       */
      expect(withThirtyOne).toBe(withOne + 2);

      for (let index = 11; index <= 20; index += 1) {
        const taskId = await seedTask(`task_a86c_count_${index}`, organizationId);
        await seedCapability({ id: `cap_a86c_count_${index}`, organizationId, taskId });
        await seedIntent({ organizationId, subjectId: taskId });
        await seedIntent({
          organizationId,
          subjectKind: 'task_capability',
          subjectId: `cap_a86c_count_${index}`,
          eventType: 'capability_expired',
        });
      }

      const withFifty = await countStatements(() => read(organizationId));
      expect(await read(organizationId)).toHaveLength(50);
      expect(withFifty).toBe(withThirtyOne);

      // And small: one statement for the intents, one per resolvable subject kind, one for Tasks.
      expect(withFifty).toBeLessThanOrEqual(4);
    });
  });
});
