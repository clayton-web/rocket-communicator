// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asOrganizationId,
  asOwnerId,
  asTaskId,
  ownerActor,
  parseLocalDate,
  type Task,
} from '@aicaa/domain';
import * as aicaaDb from '@aicaa/db/runtime';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { resetDbRuntimeForTests, setDbRuntimeForTests } from '@/lib/db/runtime-db';
import { createOwnerTask, getOwnerTask } from '@/lib/tasks';
import { mapTaskToDto } from '@/lib/tasks/map-to-dto';

const NOW = '2026-07-13T12:00:00.000Z';
const ORG = 'org_s6_1_due_read';
const OWNER = ownerActor(asOwnerId('owner_s6_1_due_read'), asOrganizationId(ORG));

const summaryPoints = [
  {
    id: 'p1',
    kind: 'next_action' as const,
    label: 'Act',
    order: 0,
    value: 'Follow through',
  },
];

function domainTask(overrides: Partial<Task> = {}): Task {
  return {
    id: asTaskId('task_s6_1_map'),
    organizationId: asOrganizationId(ORG),
    status: 'open',
    summaryPoints,
    notes: [],
    reminder: { paused: false },
    retention: {},
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('S6.1 Task dueLocalDate read mapping', () => {
  it('exposes canonical dueLocalDate and derives urgency without assignment or evidence', () => {
    const dto = mapTaskToDto(domainTask({ dueLocalDate: parseLocalDate('2026-07-12') }), NOW);
    expect(dto.dueLocalDate).toBe('2026-07-12');
    expect(dto.derivedUrgency).toBe('overdue');
    expect(dto.assignment).toBeUndefined();
    expect(dto.dueAt).toBeNull();
  });

  it('has no due-date urgency when dueLocalDate is absent', () => {
    const dto = mapTaskToDto(domainTask({ dueLocalDate: null }), NOW);
    expect(dto.dueLocalDate).toBeNull();
    expect(dto.derivedUrgency).toBeNull();
  });

  it('does not let vestigial dueAt drive canonical urgency', () => {
    const dto = mapTaskToDto(
      domainTask({
        dueAt: '2020-01-01T00:00:00.000Z',
        dueLocalDate: null,
      }),
      NOW,
    );
    expect(dto.dueAt).toBe('2020-01-01T00:00:00.000Z');
    expect(dto.dueLocalDate).toBeNull();
    expect(dto.derivedUrgency).toBeNull();
  });

  it('keeps dueAt as compatibility debt when a canonical local date is present', () => {
    const dto = mapTaskToDto(
      domainTask({
        dueAt: '2020-01-01T00:00:00.000Z',
        dueLocalDate: parseLocalDate('2026-08-01'),
      }),
      NOW,
    );
    expect(dto.dueAt).toBe('2020-01-01T00:00:00.000Z');
    expect(dto.dueLocalDate).toBe('2026-08-01');
    expect(dto.derivedUrgency).toBeNull();
  });
});

describe('S6.1 Task read path (canonical dueLocalDate)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    setDbRuntimeForTests(aicaaDb);
  });

  afterAll(async () => {
    await db.close();
    resetDbRuntimeForTests();
  });

  beforeEach(async () => {
    await db.prisma.auditEvent.deleteMany();
    await db.prisma.taskNote.deleteMany();
    await db.prisma.taskAssignment.deleteMany();
    await db.prisma.task.deleteMany();
  });

  it('returns dueLocalDate on GET without a reminder lookup, assignment, or evidence', async () => {
    await createOwnerTask({
      db: db.prisma,
      owner: OWNER,
      now: NOW,
      summaryPoints,
      taskId: 'task_s6_1_get',
    });
    await db.prisma.task.update({
      where: { id: 'task_s6_1_get' },
      data: { dueLocalDate: '2026-07-12' },
    });

    const dto = await getOwnerTask({
      db: db.prisma,
      owner: OWNER,
      taskId: 'task_s6_1_get',
      now: NOW,
    });
    expect(dto.dueLocalDate).toBe('2026-07-12');
    expect(dto.derivedUrgency).toBe('overdue');
    expect(dto.assignment).toBeUndefined();
    expect(dto.dueAt).toBeNull();
  });

  it('does not treat a written dueAt as the canonical due date', async () => {
    const created = await createOwnerTask({
      db: db.prisma,
      owner: OWNER,
      now: NOW,
      summaryPoints,
      taskId: 'task_s6_1_due_at_only',
      dueAt: '2020-01-01T00:00:00.000Z',
    });
    expect(created.task.dueAt).toBe('2020-01-01T00:00:00.000Z');
    expect(created.task.dueLocalDate).toBeNull();
    expect(created.task.derivedUrgency).toBeNull();

    const dto = await getOwnerTask({
      db: db.prisma,
      owner: OWNER,
      taskId: 'task_s6_1_due_at_only',
      now: NOW,
    });
    expect(dto.dueAt).toBe('2020-01-01T00:00:00.000Z');
    expect(dto.dueLocalDate).toBeNull();
    expect(dto.derivedUrgency).toBeNull();
  });
});
