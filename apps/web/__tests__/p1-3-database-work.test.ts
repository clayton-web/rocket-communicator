// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asAssignmentId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  ownerActor,
  type Task,
  type TaskNote,
} from '@aicaa/domain';
import * as aicaaDb from '@aicaa/db/runtime';
import {
  TASK_DETAIL_NOTE_LIMIT,
  appendTaskNote,
  createActiveAssignment,
  createTask,
  getTaskById,
  getTaskForCapabilityAuthorization,
  listTasks,
  persistCapabilityAction,
  upsertRecipient,
  type DbClient,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { resetDbRuntimeForTests, setDbRuntimeForTests } from '@/lib/db/runtime-db';
import { listOwnerTasks } from '@/lib/tasks';

/**
 * P1.3 bounded-database-work evidence.
 *
 * Query-shape and call-count proof, not timings. Task-level counting uses a Prisma client
 * extension that is created inside the test only — no production middleware, logger, or
 * telemetry is introduced.
 */

const org = 'org_p13';
const now = '2026-07-20T12:00:00.000Z';
const owner = ownerActor(asOwnerId('owner_p13'), asOrganizationId(org));

let database: TestDatabase;
let db: DbClient;

function baseTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id: asTaskId(id),
    organizationId: asOrganizationId(org),
    status: 'open',
    summaryPoints: [{ kind: 'action', text: 'Do the thing' }],
    dueAt: null,
    waitingUntil: null,
    notes: [],
    reminder: { cadence: 'none' },
    retention: { policy: 'standard' },
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Task;
}

function note(id: string, body: string, createdAt: string): TaskNote {
  return {
    id,
    body,
    createdAt,
    attribution: {
      kind: 'owner',
      owner: { ownerId: 'owner_p13', recordedAt: createdAt, requestId: `req_${id}` },
    },
  } as TaskNote;
}

/**
 * Count Prisma client operations for one unit of work.
 *
 * `fullDetailLoads` counts only reads that pull the note relation, which is what
 * distinguishes an authoritative Task bundle load from a cheap existence check.
 */
function instrument(client: DbClient) {
  const operations: string[] = [];
  const fullDetailLoads: string[] = [];
  const extended = client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          operations.push(`${model}.${operation}`);
          const include = (args as { include?: Record<string, unknown> } | undefined)?.include;
          if (model === 'Task' && include?.notes) {
            fullDetailLoads.push(`${model}.${operation}`);
          }
          return query(args);
        },
      },
    },
  });
  return { client: extended as unknown as DbClient, operations, fullDetailLoads };
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.prisma as unknown as DbClient;
  setDbRuntimeForTests(aicaaDb);
  await upsertRecipient(db, {
    organizationId: org,
    recipient: {
      id: asRecipientId('rcp_p13'),
      displayName: 'Recipient',
      email: 'recipient@example.com',
      active: true,
    },
  });
});

afterAll(async () => {
  resetDbRuntimeForTests();
  await database.close();
});

describe('Owner Task list note behaviour', () => {
  beforeEach(async () => {
    await database.prisma.taskNote.deleteMany({ where: { organizationId: org } });
    await database.prisma.taskAssignment.deleteMany({ where: { organizationId: org } });
    await database.prisma.task.deleteMany({ where: { organizationId: org } });
  });

  it('returns an empty notes array in list results while detail still returns notes', async () => {
    await createTask(db, org, baseTask('task_list_1'));
    await appendTaskNote(db, org, 'task_list_1', note('note_a', 'First', now));
    await appendTaskNote(
      db,
      org,
      'task_list_1',
      note('note_b', 'Second', '2026-07-20T12:05:00.000Z'),
    );

    const listed = await listTasks(db, { organizationId: org, limit: 10 });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.notes).toEqual([]);

    const detail = await getTaskById(db, org, 'task_list_1');
    expect(detail.notes.map((entry) => entry.body)).toEqual(['First', 'Second']);
  });

  it('issues no TaskNote query for the list and exactly one Task query', async () => {
    await createTask(db, org, baseTask('task_list_2'));
    await appendTaskNote(db, org, 'task_list_2', note('note_c', 'Only', now));

    const { client, operations } = instrument(db);
    await listTasks(client, { organizationId: org, limit: 10 });

    expect(operations.filter((entry) => entry.startsWith('TaskNote.'))).toEqual([]);
    expect(operations.filter((entry) => entry.startsWith('Task.'))).toEqual(['Task.findMany']);
  });

  it('exposes notes: [] through the Owner list service DTO', async () => {
    await createTask(db, org, baseTask('task_list_3'));
    await appendTaskNote(db, org, 'task_list_3', note('note_d', 'Hidden from list', now));

    const page = await listOwnerTasks({ db, owner, now, limit: 10 });

    expect(page.items[0]?.notes).toEqual([]);
  });
});

describe('Task detail note bound', () => {
  beforeEach(async () => {
    await database.prisma.taskNote.deleteMany({ where: { organizationId: org } });
    await database.prisma.task.deleteMany({ where: { organizationId: org } });
  });

  it('matches the contract maximum', () => {
    expect(TASK_DETAIL_NOTE_LIMIT).toBe(100);
  });

  it('returns notes oldest-first and unbounded behaviour is unchanged below the limit', async () => {
    await createTask(db, org, baseTask('task_bound_1'));
    for (let index = 0; index < 5; index += 1) {
      await appendTaskNote(
        db,
        org,
        'task_bound_1',
        note(`note_small_${index}`, `Body ${index}`, `2026-07-20T12:0${index}:00.000Z`),
      );
    }

    const detail = await getTaskById(db, org, 'task_bound_1');

    expect(detail.notes).toHaveLength(5);
    expect(detail.notes.map((entry) => entry.body)).toEqual([
      'Body 0',
      'Body 1',
      'Body 2',
      'Body 3',
      'Body 4',
    ]);
  });

  it('caps an over-long history at the newest notes, still oldest-first', async () => {
    await createTask(db, org, baseTask('task_bound_2'));
    const total = TASK_DETAIL_NOTE_LIMIT + 10;
    for (let index = 0; index < total; index += 1) {
      const minute = String(index).padStart(2, '0');
      await appendTaskNote(
        db,
        org,
        'task_bound_2',
        note(
          `note_big_${minute}`,
          `Body ${minute}`,
          `2026-07-20T${12 + Math.floor(index / 60)}:${String(index % 60).padStart(2, '0')}:00.000Z`,
        ),
      );
    }

    const detail = await getTaskById(db, org, 'task_bound_2');

    expect(detail.notes).toHaveLength(TASK_DETAIL_NOTE_LIMIT);
    // Oldest ten dropped; the array remains ascending by createdAt.
    expect(detail.notes[0]?.body).toBe('Body 10');
    expect(detail.notes.at(-1)?.body).toBe(`Body ${total - 1}`);
    const timestamps = detail.notes.map((entry) => entry.createdAt);
    expect([...timestamps].sort()).toEqual(timestamps);
  });

  /** Seed `count` notes one minute apart, oldest first, named by their index. */
  async function seedSequentialNotes(taskId: string, count: number): Promise<void> {
    await createTask(db, org, baseTask(taskId));
    const start = Date.parse('2026-01-01T00:00:00.000Z');
    for (let index = 0; index < count; index += 1) {
      const padded = String(index).padStart(4, '0');
      await appendTaskNote(
        db,
        org,
        taskId,
        note(`n_${padded}`, `Body ${padded}`, new Date(start + index * 60_000).toISOString()),
      );
    }
  }

  it.each([
    [0, []],
    [1, ['Body 0000']],
  ])('returns the whole history for a Task with %i notes', async (count, expected) => {
    await seedSequentialNotes(`task_edge_${count}`, count);

    const detail = await getTaskById(db, org, `task_edge_${count}`);

    expect(detail.notes.map((entry) => entry.body)).toEqual(expected);
  });

  it('returns every note at exactly the limit', async () => {
    await seedSequentialNotes('task_edge_at_limit', TASK_DETAIL_NOTE_LIMIT);

    const detail = await getTaskById(db, org, 'task_edge_at_limit');

    expect(detail.notes).toHaveLength(TASK_DETAIL_NOTE_LIMIT);
    expect(detail.notes[0]?.body).toBe('Body 0000');
    expect(detail.notes.at(-1)?.body).toBe(
      `Body ${String(TASK_DETAIL_NOTE_LIMIT - 1).padStart(4, '0')}`,
    );
  });

  it.each([TASK_DETAIL_NOTE_LIMIT + 1, 220])(
    'drops only the oldest notes for a history of %i',
    async (total) => {
      const taskId = `task_edge_over_${total}`;
      await seedSequentialNotes(taskId, total);

      const detail = await getTaskById(db, org, taskId);
      const dropped = total - TASK_DETAIL_NOTE_LIMIT;

      expect(detail.notes).toHaveLength(TASK_DETAIL_NOTE_LIMIT);
      // The window is the newest 100: the most recent action is always present, and the
      // oldest surviving note sits exactly at the truncation boundary.
      expect(detail.notes[0]?.body).toBe(`Body ${String(dropped).padStart(4, '0')}`);
      expect(detail.notes.at(-1)?.body).toBe(`Body ${String(total - 1).padStart(4, '0')}`);
    },
  );

  it('keeps a terminal outcome note and drops the oldest when history overflows', async () => {
    const taskId = 'task_edge_significant';
    await createTask(db, org, baseTask(taskId));
    const start = Date.parse('2026-02-01T00:00:00.000Z');
    // Oldest note is the intake record; newest is the completion outcome. Only one of the
    // two can survive truncation, and the newest-100 window keeps the completion.
    await appendTaskNote(
      db,
      org,
      taskId,
      note('n_intake', 'Task intake', new Date(start).toISOString()),
    );
    for (let index = 1; index <= TASK_DETAIL_NOTE_LIMIT; index += 1) {
      await appendTaskNote(
        db,
        org,
        taskId,
        note(
          `n_mid_${String(index).padStart(4, '0')}`,
          `Filler ${index}`,
          new Date(start + index * 60_000).toISOString(),
        ),
      );
    }
    await appendTaskNote(
      db,
      org,
      taskId,
      note('n_outcome', 'Completed by Recipient', new Date(start + 9_000_000).toISOString()),
    );

    const bodies = (await getTaskById(db, org, taskId)).notes.map((entry) => entry.body);

    expect(bodies).toHaveLength(TASK_DETAIL_NOTE_LIMIT);
    expect(bodies.at(-1)).toBe('Completed by Recipient');
    expect(bodies).not.toContain('Task intake');
  });

  it('breaks identical timestamps by id so the window and ordering are deterministic', async () => {
    const taskId = 'task_edge_ties';
    await createTask(db, org, baseTask(taskId));
    const sameInstant = '2026-03-01T00:00:00.000Z';
    const total = TASK_DETAIL_NOTE_LIMIT + 5;
    for (let index = 0; index < total; index += 1) {
      const padded = String(index).padStart(4, '0');
      await appendTaskNote(db, org, taskId, note(`tie_${padded}`, `Tie ${padded}`, sameInstant));
    }

    const first = (await getTaskById(db, org, taskId)).notes;
    const second = (await getTaskById(db, org, taskId)).notes;

    expect(first).toHaveLength(TASK_DETAIL_NOTE_LIMIT);
    // Selection falls back to id descending, then reverses, so the surviving window is the
    // highest ids in ascending id order and repeated reads agree.
    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
    const ids = first.map((entry) => entry.id);
    expect([...ids].sort()).toEqual(ids);
    expect(ids[0]).toBe(`tie_${String(total - TASK_DETAIL_NOTE_LIMIT).padStart(4, '0')}`);
    expect(ids.at(-1)).toBe(`tie_${String(total - 1).padStart(4, '0')}`);
  });
});

describe('Capability authorization projection', () => {
  beforeEach(async () => {
    await database.prisma.taskNote.deleteMany({ where: { organizationId: org } });
    await database.prisma.taskAssignment.deleteMany({ where: { organizationId: org } });
    await database.prisma.task.deleteMany({ where: { organizationId: org } });

    await createTask(db, org, baseTask('task_auth_1'));
    await createActiveAssignment(db, org, 'task_auth_1', {
      id: asAssignmentId('asg_p13'),
      recipientId: asRecipientId('rcp_p13'),
      intendedRecipientEmail: 'recipient@example.com',
      assignedAt: now,
      assignedByOwnerId: asOwnerId('owner_p13'),
      allowedCapabilityActions: ['view_assigned_task', 'complete_task'],
    });
    await appendTaskNote(db, org, 'task_auth_1', note('note_auth', 'Sensitive note', now));
  });

  it('loads no note relation and carries every field the policy gates read', async () => {
    const { client, operations } = instrument(db);
    const view = await getTaskForCapabilityAuthorization(client, org, 'task_auth_1');

    expect(operations.filter((entry) => entry.startsWith('TaskNote.'))).toEqual([]);
    expect(view.notes).toEqual([]);

    // Fields traced from assertCapabilityBelongsToTask / assertTaskAllowsCapabilityMutation
    // and the A7 delivery gate.
    expect(view.id).toBe('task_auth_1');
    expect(view.organizationId).toBe(org);
    expect(view.status).toBe('open');
    expect(view.version).toBe(1);
    expect(view.assignment?.id).toBe('asg_p13');
    expect(view.assignment?.deliveryStatus).toBeUndefined();
    expect(view.waitingUntil).toBeNull();
  });

  it('is organization-scoped like the full bundle', async () => {
    await expect(
      getTaskForCapabilityAuthorization(db, 'org_other', 'task_auth_1'),
    ).rejects.toThrow();
  });
});

describe('Mutation transaction reload count', () => {
  beforeEach(async () => {
    await database.prisma.auditEvent.deleteMany({ where: { organizationId: org } });
    await database.prisma.taskNote.deleteMany({ where: { organizationId: org } });
    await database.prisma.taskAssignment.deleteMany({ where: { organizationId: org } });
    await database.prisma.task.deleteMany({ where: { organizationId: org } });
    await createTask(db, org, baseTask('task_mut_1'));
    await appendTaskNote(db, org, 'task_mut_1', note('note_existing', 'Existing', now));
  });

  afterEach(async () => {
    await database.prisma.auditEvent.deleteMany({ where: { organizationId: org } });
  });

  it('performs exactly one authoritative full reload and appends the new note once', async () => {
    const { client, operations, fullDetailLoads } = instrument(db);
    const appended = note('note_new', 'Appended once', '2026-07-20T12:30:00.000Z');

    const result = await persistCapabilityAction({
      db: client,
      organizationId: org,
      expectedVersion: 1,
      task: baseTask('task_mut_1', {
        status: 'completed',
        version: 2,
        updatedAt: '2026-07-20T12:30:00.000Z',
      }),
      note: appended,
      audit: {
        id: 'aud_p13',
        organizationId: org,
        actorKind: 'capability',
        capabilityId: 'cap_p13',
        taskId: 'task_mut_1',
        action: 'complete_task',
        outcome: 'succeeded',
        resourceVersion: 2,
        recordedAt: '2026-07-20T12:30:00.000Z',
      },
    });

    // The CAS write no longer drags a discarded reload behind it. Before P1.3 this
    // transaction issued two full-detail bundle loads; only the authoritative one remains.
    expect(operations.filter((entry) => entry === 'Task.updateMany')).toHaveLength(1);
    expect(fullDetailLoads).toEqual(['Task.findFirst']);
    // The one remaining plain Task read is appendTaskNote's id-only existence check.
    expect(operations.filter((entry) => entry === 'Task.findFirst')).toHaveLength(2);

    // Response content must be unchanged by the reduction.
    expect(result.task.version).toBe(2);
    expect(result.task.status).toBe('completed');
    expect(result.task.notes.map((entry) => entry.body)).toEqual(['Existing', 'Appended once']);
    expect(result.task.notes.filter((entry) => entry.id === 'note_new')).toHaveLength(1);
    expect(result.audit.action).toBe('complete_task');
    expect(result.audit.resourceVersion).toBe(2);
  });

  it('still rejects a stale expected version', async () => {
    await expect(
      persistCapabilityAction({
        db,
        organizationId: org,
        expectedVersion: 99,
        task: baseTask('task_mut_1', { version: 100 }),
        audit: {
          id: 'aud_p13_stale',
          organizationId: org,
          actorKind: 'capability',
          capabilityId: 'cap_p13',
          taskId: 'task_mut_1',
          action: 'complete_task',
          outcome: 'succeeded',
          recordedAt: now,
        },
      }),
    ).rejects.toThrow();

    // The failed transaction must not have written an audit row.
    const audits = await database.prisma.auditEvent.count({ where: { organizationId: org } });
    expect(audits).toBe(0);
  });
});
