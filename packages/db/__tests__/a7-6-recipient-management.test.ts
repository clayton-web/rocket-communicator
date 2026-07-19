import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  asAssignmentId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  type Recipient,
  type Task,
  type TaskAssignment,
} from '@aicaa/domain';
import {
  createRecipient,
  createTask,
  deactivateRecipient,
  getRecipientById,
  listActiveRecipientsPage,
  listTaskAssignments,
  requireActiveRecipientForHandoff,
  updateRecipient,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const orgA = 'org_a';
const orgB = 'org_b';
const now = '2026-07-18T12:00:00.000Z';

function recipient(overrides: Partial<Recipient> & { id: string }): Recipient {
  return {
    id: asRecipientId(overrides.id),
    displayName: overrides.displayName ?? 'Recipient',
    email: overrides.email ?? `${overrides.id}@example.com`,
    active: overrides.active ?? true,
    relationshipLabel: overrides.relationshipLabel,
  };
}

async function seed(db: TestDatabase, organizationId: string, r: Recipient): Promise<Recipient> {
  return createRecipient(db.prisma, { organizationId, recipient: r });
}

describe('A7.6 Recipient management persistence (PGlite)', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  describe('creation', () => {
    it('creates an organization-scoped active Recipient', async () => {
      const created = await seed(db, orgA, recipient({ id: 'rcp_1', displayName: 'Alex' }));
      expect(created.active).toBe(true);
      const loaded = await getRecipientById(db.prisma, orgA, 'rcp_1');
      expect(loaded.displayName).toBe('Alex');
    });

    it('rejects a duplicate active normalized email in the same organization', async () => {
      await seed(db, orgA, recipient({ id: 'rcp_1', email: 'dup@example.com' }));
      await expect(
        seed(db, orgA, recipient({ id: 'rcp_2', email: 'DUP@Example.com' })),
      ).rejects.toMatchObject({ code: 'UNIQUE_VIOLATION' });
    });

    it('allows the same normalized email in different organizations', async () => {
      await seed(db, orgA, recipient({ id: 'rcp_1', email: 'shared@example.com' }));
      const other = await seed(db, orgB, recipient({ id: 'rcp_2', email: 'shared@example.com' }));
      expect(other.id).toBe('rcp_2');
    });

    it('allows a new active Recipient to reuse a deactivated Recipient email', async () => {
      await seed(db, orgA, recipient({ id: 'rcp_1', email: 'reuse@example.com' }));
      await deactivateRecipient(db.prisma, orgA, 'rcp_1');
      const revived = await seed(db, orgA, recipient({ id: 'rcp_2', email: 'reuse@example.com' }));
      expect(revived.id).toBe('rcp_2');
      expect(revived.active).toBe(true);
    });

    it('prevents a second concurrent active duplicate via the partial unique index', async () => {
      // PGlite runs in-process; the unique index remains the final authority under races.
      const results = await Promise.allSettled([
        seed(db, orgA, recipient({ id: 'rcp_1', email: 'race@example.com' })),
        seed(db, orgA, recipient({ id: 'rcp_2', email: 'race@example.com' })),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: 'UNIQUE_VIOLATION',
      });
    });
  });

  describe('update (organization-scoped, active-only)', () => {
    it('updates mutable fields and returns the new current values', async () => {
      await seed(
        db,
        orgA,
        recipient({ id: 'rcp_1', displayName: 'Old', email: 'old@example.com' }),
      );
      const updated = await updateRecipient(db.prisma, {
        organizationId: orgA,
        recipientId: 'rcp_1',
        displayName: 'New',
        email: 'new@example.com',
      });
      expect(updated.displayName).toBe('New');
      expect(updated.email).toBe('new@example.com');
    });

    it('returns NOT_FOUND for a missing or cross-organization id', async () => {
      await seed(db, orgA, recipient({ id: 'rcp_1' }));
      await expect(
        updateRecipient(db.prisma, {
          organizationId: orgB,
          recipientId: 'rcp_1',
          displayName: 'X',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        updateRecipient(db.prisma, { organizationId: orgA, recipientId: 'nope', displayName: 'X' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects updating an inactive Recipient with DOMAIN_CONFLICT', async () => {
      await seed(db, orgA, recipient({ id: 'rcp_1' }));
      await deactivateRecipient(db.prisma, orgA, 'rcp_1');
      await expect(
        updateRecipient(db.prisma, {
          organizationId: orgA,
          recipientId: 'rcp_1',
          displayName: 'X',
        }),
      ).rejects.toMatchObject({ code: 'DOMAIN_CONFLICT' });
    });

    it('rejects an email update that duplicates another active Recipient', async () => {
      await seed(db, orgA, recipient({ id: 'rcp_1', email: 'a@example.com' }));
      await seed(db, orgA, recipient({ id: 'rcp_2', email: 'b@example.com' }));
      await expect(
        updateRecipient(db.prisma, {
          organizationId: orgA,
          recipientId: 'rcp_2',
          email: 'A@example.com',
        }),
      ).rejects.toMatchObject({ code: 'UNIQUE_VIOLATION' });
    });

    it('does not rewrite an existing Assignment intended-email snapshot on email change', async () => {
      await seed(db, orgA, recipient({ id: 'rcp_1', email: 'before@example.com' }));
      const assignment: TaskAssignment = {
        id: asAssignmentId('asg_1'),
        recipientId: asRecipientId('rcp_1'),
        intendedRecipientEmail: 'before@example.com',
        assignedAt: now,
        assignedByOwnerId: asOwnerId('owner_1'),
        allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
      };
      const task: Task = {
        id: asTaskId('task_1'),
        organizationId: asOrganizationId(orgA),
        status: 'open',
        summaryPoints: [{ id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Do it' }],
        notes: [],
        reminder: { paused: false },
        retention: {},
        version: 1,
        createdAt: now,
        updatedAt: now,
        assignment,
      };
      await createTask(db.prisma, orgA, task, assignment);

      await updateRecipient(db.prisma, {
        organizationId: orgA,
        recipientId: 'rcp_1',
        email: 'after@example.com',
      });

      const current = await getRecipientById(db.prisma, orgA, 'rcp_1');
      expect(current.email).toBe('after@example.com');

      const assignments = await listTaskAssignments(db.prisma, orgA, 'task_1');
      expect(assignments[0]?.intendedRecipientEmail).toBe('before@example.com');
    });
  });

  describe('deactivation (atomic, replay-safe)', () => {
    it('marks an active Recipient inactive', async () => {
      await seed(db, orgA, recipient({ id: 'rcp_1' }));
      const deactivated = await deactivateRecipient(db.prisma, orgA, 'rcp_1');
      expect(deactivated.active).toBe(false);
    });

    it('returns DOMAIN_CONFLICT on repeated deactivation', async () => {
      await seed(db, orgA, recipient({ id: 'rcp_1' }));
      await deactivateRecipient(db.prisma, orgA, 'rcp_1');
      await expect(deactivateRecipient(db.prisma, orgA, 'rcp_1')).rejects.toMatchObject({
        code: 'DOMAIN_CONFLICT',
      });
    });

    it('returns NOT_FOUND for a missing or cross-organization id', async () => {
      await seed(db, orgA, recipient({ id: 'rcp_1' }));
      await expect(deactivateRecipient(db.prisma, orgB, 'rcp_1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(deactivateRecipient(db.prisma, orgA, 'nope')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('prevents a stale update from mutating or reactivating a deactivated Recipient', async () => {
      await seed(db, orgA, recipient({ id: 'rcp_1', displayName: 'Original' }));
      await deactivateRecipient(db.prisma, orgA, 'rcp_1');
      await expect(
        updateRecipient(db.prisma, {
          organizationId: orgA,
          recipientId: 'rcp_1',
          displayName: 'Stale',
        }),
      ).rejects.toMatchObject({ code: 'DOMAIN_CONFLICT' });
      const loaded = await getRecipientById(db.prisma, orgA, 'rcp_1');
      expect(loaded.active).toBe(false);
      expect(loaded.displayName).toBe('Original');
    });

    it('rejects a deactivated Recipient for a new handoff (eligibility gate)', async () => {
      await seed(db, orgA, recipient({ id: 'rcp_1' }));
      await expect(
        requireActiveRecipientForHandoff(db.prisma, orgA, 'rcp_1'),
      ).resolves.toMatchObject({ id: 'rcp_1', active: true });
      await deactivateRecipient(db.prisma, orgA, 'rcp_1');
      await expect(
        requireActiveRecipientForHandoff(db.prisma, orgA, 'rcp_1'),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });

  describe('paginated active listing', () => {
    it('returns an empty page and a null cursor for no active Recipients', async () => {
      const page = await listActiveRecipientsPage(db.prisma, { organizationId: orgA });
      expect(page.items).toHaveLength(0);
      expect(page.nextCursor).toBeNull();
    });

    it('excludes inactive Recipients and scopes to the organization', async () => {
      await seed(db, orgA, recipient({ id: 'rcp_1', displayName: 'Active A' }));
      await seed(db, orgA, recipient({ id: 'rcp_2', displayName: 'Inactive A' }));
      await deactivateRecipient(db.prisma, orgA, 'rcp_2');
      await seed(db, orgB, recipient({ id: 'rcp_3', displayName: 'Other Org' }));

      const page = await listActiveRecipientsPage(db.prisma, { organizationId: orgA });
      expect(page.items.map((r) => r.id)).toEqual(['rcp_1']);
      expect(page.nextCursor).toBeNull();
    });

    it('orders by normalized display name (case/whitespace-insensitive) then id', async () => {
      await seed(db, orgA, recipient({ id: 'rcp_b', displayName: 'bob' }));
      await seed(db, orgA, recipient({ id: 'rcp_a2', displayName: '  alice  ' }));
      await seed(db, orgA, recipient({ id: 'rcp_a1', displayName: 'Alice' }));
      await seed(db, orgA, recipient({ id: 'rcp_c', displayName: 'Charlie' }));

      const page = await listActiveRecipientsPage(db.prisma, { organizationId: orgA, limit: 100 });
      // Two "alice" entries sort together, broken by id ascending (rcp_a1 < rcp_a2).
      expect(page.items.map((r) => r.id)).toEqual(['rcp_a1', 'rcp_a2', 'rcp_b', 'rcp_c']);
    });

    it('continues a compound cursor without skipping or duplicating rows', async () => {
      const ids = ['rcp_1', 'rcp_2', 'rcp_3', 'rcp_4', 'rcp_5'];
      for (const [index, id] of ids.entries()) {
        await seed(db, orgA, recipient({ id, displayName: `Name ${index}` }));
      }

      const collected: string[] = [];
      let cursor: string | null | undefined;
      let guard = 0;
      do {
        const page = await listActiveRecipientsPage(db.prisma, {
          organizationId: orgA,
          limit: 2,
          cursor,
        });
        collected.push(...page.items.map((r) => r.id));
        cursor = page.nextCursor;
        guard += 1;
      } while (cursor && guard < 10);

      expect(collected).toHaveLength(5);
      expect(new Set(collected).size).toBe(5);
      expect([...collected].sort()).toEqual([...ids].sort());
    });

    it('keeps pagination stable across pages with duplicate display names', async () => {
      const ids = ['rcp_a', 'rcp_b', 'rcp_c', 'rcp_d'];
      for (const id of ids) {
        await seed(db, orgA, recipient({ id, displayName: 'Same Name', email: `${id}@x.com` }));
      }
      const first = await listActiveRecipientsPage(db.prisma, { organizationId: orgA, limit: 2 });
      const second = await listActiveRecipientsPage(db.prisma, {
        organizationId: orgA,
        limit: 2,
        cursor: first.nextCursor,
      });
      expect(first.items.map((r) => r.id)).toEqual(['rcp_a', 'rcp_b']);
      expect(second.items.map((r) => r.id)).toEqual(['rcp_c', 'rcp_d']);
      expect(second.nextCursor).toBeNull();
    });

    it('clamps limit below minimum and above maximum', async () => {
      for (let i = 0; i < 3; i += 1) {
        await seed(db, orgA, recipient({ id: `rcp_${i}`, displayName: `Name ${i}` }));
      }
      const clampedLow = await listActiveRecipientsPage(db.prisma, {
        organizationId: orgA,
        limit: 0,
      });
      expect(clampedLow.items).toHaveLength(1);
      const clampedHigh = await listActiveRecipientsPage(db.prisma, {
        organizationId: orgA,
        limit: 1000,
      });
      expect(clampedHigh.items).toHaveLength(3);
      expect(clampedHigh.nextCursor).toBeNull();
    });

    it('rejects a malformed cursor with a validation error', async () => {
      await seed(db, orgA, recipient({ id: 'rcp_1' }));
      await expect(
        listActiveRecipientsPage(db.prisma, {
          organizationId: orgA,
          cursor: 'not a real cursor!!',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });

      const wrongShape = Buffer.from(JSON.stringify({ x: 1 }), 'utf8').toString('base64url');
      await expect(
        listActiveRecipientsPage(db.prisma, { organizationId: orgA, cursor: wrongShape }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });
});
