// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOrganizationId, asOwnerId, ownerActor } from '@aicaa/domain';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { GET as listRecipients, POST as createRecipientRoute } from '@/app/api/v1/recipients/route';
import { PATCH as patchRecipient } from '@/app/api/v1/recipients/[recipientId]/route';
import { POST as deactivateRecipientRoute } from '@/app/api/v1/recipients/[recipientId]/deactivate/route';
import { POST as createTaskRoute } from '@/app/api/v1/tasks/route';

const org = 'org_rcp_mgmt';
const otherOrg = 'org_rcp_other';
const owner = ownerActor(asOwnerId('owner_rcp'), asOrganizationId(org));
const otherOwner = ownerActor(asOwnerId('owner_rcp_other'), asOrganizationId(otherOrg));

function authOwner(actor = owner) {
  vi.mocked(getAuthenticatedOwner).mockResolvedValue({
    user: { id: actor.ownerId } as never,
    actor,
    session: {
      ownerId: actor.ownerId,
      organizationId: actor.organizationId,
      role: 'owner',
      displayName: 'Owner',
    },
  });
}

function jsonRequest(url: string, method: string, body?: unknown, headers?: HeadersInit) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function recipientParams(recipientId: string) {
  return { params: Promise.resolve({ recipientId }) };
}

async function createRecipient(body: unknown, headers?: HeadersInit) {
  return createRecipientRoute(
    jsonRequest('http://localhost/api/v1/recipients', 'POST', body, headers),
  );
}

const summaryPoints = [{ id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Do work' }];

describe('A7.6 Recipient management HTTP routes', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    installDbTestRuntime(db.prisma);
  });

  afterAll(async () => {
    clearDbTestRuntime();
    await db.close();
  });

  beforeEach(async () => {
    vi.mocked(getAuthenticatedOwner).mockReset();
    await db.prisma.auditEvent.deleteMany();
    await db.prisma.taskCapability.deleteMany();
    await db.prisma.handoffAttempt.deleteMany();
    await db.prisma.taskNote.deleteMany();
    await db.prisma.taskAssignment.deleteMany();
    await db.prisma.taskSuggestion.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.recipient.deleteMany();
  });

  describe('authentication and isolation', () => {
    it('rejects unauthenticated list', async () => {
      vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
      const res = await listRecipients(new Request('http://localhost/api/v1/recipients'));
      expect(res.status).toBe(401);
    });

    it('does not authorize via capability token header', async () => {
      vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
      const res = await listRecipients(
        new Request('http://localhost/api/v1/recipients', {
          headers: { 'x-capability-token': 'cap', authorization: 'Bearer cap' },
        }),
      );
      expect(res.status).toBe(401);
      expect(getAuthenticatedOwner).toHaveBeenCalled();
    });

    it('scopes lists per organization', async () => {
      authOwner();
      await createRecipient({ displayName: 'Mine', email: 'mine@example.com' });
      authOwner(otherOwner);
      await createRecipient({ displayName: 'Theirs', email: 'theirs@example.com' });

      authOwner();
      const res = await listRecipients(new Request('http://localhost/api/v1/recipients'));
      const body = await res.json();
      expect(body.items.map((r: { email: string }) => r.email)).toEqual(['mine@example.com']);
    });
  });

  describe('listing', () => {
    it('returns empty list with Cache-Control: no-store', async () => {
      authOwner();
      const res = await listRecipients(new Request('http://localhost/api/v1/recipients'));
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = await res.json();
      expect(body).toEqual({ items: [], nextCursor: null });
    });

    it('excludes inactive recipients and internal fields', async () => {
      authOwner();
      const created = await (
        await createRecipient({ displayName: 'Active', email: 'a@example.com' })
      ).json();
      await createRecipient({ displayName: 'Inactive', email: 'b@example.com' });
      const inactive = await (
        await createRecipient({ displayName: 'Gone', email: 'c@example.com' })
      ).json();
      await deactivateRecipientRoute(
        jsonRequest(`http://localhost/api/v1/recipients/${inactive.id}/deactivate`, 'POST'),
        recipientParams(inactive.id),
      );

      const res = await listRecipients(new Request('http://localhost/api/v1/recipients'));
      const body = await res.json();
      const emails = body.items.map((r: { email: string }) => r.email);
      expect(emails).toContain('a@example.com');
      expect(emails).not.toContain('c@example.com');
      const first = body.items.find((r: { id: string }) => r.id === created.id);
      expect(first).not.toHaveProperty('organizationId');
      expect(first).not.toHaveProperty('emailNormalized');
      expect(first).not.toHaveProperty('createdAt');
      expect(first).not.toHaveProperty('updatedAt');
    });

    it('paginates with a compound cursor and rejects a malformed cursor', async () => {
      authOwner();
      for (const name of ['Charlie', 'alice', 'Bob', 'dave']) {
        await createRecipient({ displayName: name, email: `${name}@example.com` });
      }
      const page1 = await (
        await listRecipients(new Request('http://localhost/api/v1/recipients?limit=2'))
      ).json();
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).toBeTruthy();
      const page2 = await (
        await listRecipients(
          new Request(
            `http://localhost/api/v1/recipients?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
          ),
        )
      ).json();
      expect(page2.items).toHaveLength(2);
      expect(page2.nextCursor).toBeNull();
      const seen = [...page1.items, ...page2.items].map((r: { email: string }) => r.email);
      expect(new Set(seen).size).toBe(4);

      const malformed = await listRecipients(
        new Request('http://localhost/api/v1/recipients?cursor=%%%not-valid'),
      );
      expect(malformed.status).toBe(400);
      await expect(malformed.json()).resolves.toMatchObject({
        error: { code: 'VALIDATION_ERROR' },
      });
    });

    it('rejects limit outside the contract range', async () => {
      authOwner();
      const tooBig = await listRecipients(
        new Request('http://localhost/api/v1/recipients?limit=101'),
      );
      expect(tooBig.status).toBe(400);
      const zero = await listRecipients(new Request('http://localhost/api/v1/recipients?limit=0'));
      expect(zero.status).toBe(400);
    });
  });

  describe('creation', () => {
    it('creates an active recipient and returns 201 no-store with a durable audit', async () => {
      authOwner();
      const res = await createRecipient({
        displayName: '  Alex Owner  ',
        email: 'Alex@Example.com',
        relationshipLabel: 'agent',
      });
      expect(res.status).toBe(201);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = await res.json();
      expect(body.active).toBe(true);
      expect(body.displayName).toBe('Alex Owner');
      expect(body.email).toBe('Alex@Example.com');
      expect(body.relationshipLabel).toBe('agent');

      const audits = await db.prisma.auditEvent.findMany({ where: { action: 'create_recipient' } });
      expect(audits).toHaveLength(1);
      expect(audits[0]?.ownerId).toBe(owner.ownerId);
      // Privacy: the raw email must never appear in the audit note.
      expect(audits[0]?.note ?? '').not.toContain('Alex@Example.com');
      expect(audits[0]?.intendedRecipientEmail).toBeNull();
    });

    it('rejects a duplicate active normalized email with 409', async () => {
      authOwner();
      await createRecipient({ displayName: 'One', email: 'dup@example.com' });
      const res = await createRecipient({ displayName: 'Two', email: 'DUP@example.com' });
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({ error: { code: 'DOMAIN_CONFLICT' } });
    });

    it('allows the same email in a different organization', async () => {
      authOwner();
      await createRecipient({ displayName: 'A', email: 'shared@example.com' });
      authOwner(otherOwner);
      const res = await createRecipient({ displayName: 'B', email: 'shared@example.com' });
      expect(res.status).toBe(201);
    });

    it('validates missing/empty name and invalid or injected email', async () => {
      authOwner();
      expect((await createRecipient({ email: 'x@example.com' })).status).toBe(400);
      expect((await createRecipient({ displayName: '   ', email: 'x@example.com' })).status).toBe(
        400,
      );
      expect((await createRecipient({ displayName: 'X', email: 'not-an-email' })).status).toBe(400);
      expect(
        (await createRecipient({ displayName: 'X', email: 'a@b.com\r\nBcc: evil@x.com' })).status,
      ).toBe(400);
      expect(
        (await createRecipient({ displayName: 'X'.repeat(201), email: 'x@example.com' })).status,
      ).toBe(400);
    });

    it('treats HTML-like display names as data and ignores privileged fields', async () => {
      authOwner();
      const res = await createRecipient({
        displayName: '<script>alert(1)</script>',
        email: 'html@example.com',
        id: 'attacker-controlled',
        organizationId: otherOrg,
        active: false,
        emailNormalized: 'spoof@example.com',
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.displayName).toBe('<script>alert(1)</script>');
      expect(body.active).toBe(true);
      expect(body.id).not.toBe('attacker-controlled');
      const row = await db.prisma.recipient.findFirst({ where: { id: body.id } });
      expect(row?.organizationId).toBe(org);
      expect(row?.emailNormalized).toBe('html@example.com');
    });

    it('requires application/json (415) and rejects malformed JSON (400)', async () => {
      authOwner();
      const wrongType = await createRecipient(
        { displayName: 'X', email: 'x@example.com' },
        {
          'content-type': 'text/plain',
        },
      );
      expect(wrongType.status).toBe(415);

      const accepted = await createRecipient(
        { displayName: 'Y', email: 'ok@example.com' },
        {
          'content-type': 'application/json; charset=utf-8',
        },
      );
      expect(accepted.status).toBe(201);

      const malformed = await createRecipientRoute(
        new Request('http://localhost/api/v1/recipients', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{bad',
        }),
      );
      expect(malformed.status).toBe(400);
    });
  });

  describe('update', () => {
    async function seedRecipient(email = 'u@example.com', displayName = 'U') {
      authOwner();
      return (await createRecipient({ displayName, email })).json();
    }

    it('updates mutable fields and records only changed field names', async () => {
      const created = await seedRecipient();
      const res = await patchRecipient(
        jsonRequest(`http://localhost/api/v1/recipients/${created.id}`, 'PATCH', {
          displayName: 'Renamed',
        }),
        recipientParams(created.id),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = await res.json();
      expect(body.displayName).toBe('Renamed');

      const audit = await db.prisma.auditEvent.findFirst({ where: { action: 'update_recipient' } });
      expect(audit?.note).toContain('changed=displayName');
    });

    it('returns 404 for missing or cross-organization ids', async () => {
      const created = await seedRecipient('crossorg@example.com');
      authOwner(otherOwner);
      const res = await patchRecipient(
        jsonRequest(`http://localhost/api/v1/recipients/${created.id}`, 'PATCH', {
          displayName: 'X',
        }),
        recipientParams(created.id),
      );
      expect(res.status).toBe(404);
    });

    it('rejects an empty update body with 400', async () => {
      const created = await seedRecipient('empty@example.com');
      const res = await patchRecipient(
        jsonRequest(`http://localhost/api/v1/recipients/${created.id}`, 'PATCH', {}),
        recipientParams(created.id),
      );
      expect(res.status).toBe(400);
    });

    it('rejects updating an inactive recipient with 409', async () => {
      const created = await seedRecipient('inactiveupd@example.com');
      await deactivateRecipientRoute(
        jsonRequest(`http://localhost/api/v1/recipients/${created.id}/deactivate`, 'POST'),
        recipientParams(created.id),
      );
      authOwner();
      const res = await patchRecipient(
        jsonRequest(`http://localhost/api/v1/recipients/${created.id}`, 'PATCH', {
          displayName: 'Nope',
        }),
        recipientParams(created.id),
      );
      expect(res.status).toBe(409);
    });

    it('requires application/json (415)', async () => {
      const created = await seedRecipient('ct@example.com');
      const res = await patchRecipient(
        jsonRequest(
          `http://localhost/api/v1/recipients/${created.id}`,
          'PATCH',
          { displayName: 'X' },
          { 'content-type': 'text/plain' },
        ),
        recipientParams(created.id),
      );
      expect(res.status).toBe(415);
    });
  });

  describe('deactivation', () => {
    async function seedRecipient(email = 'd@example.com') {
      authOwner();
      return (await createRecipient({ displayName: 'D', email })).json();
    }

    it('deactivates, is replay-safe (409), and allows reusing the email', async () => {
      const created = await seedRecipient('reuse@example.com');
      const first = await deactivateRecipientRoute(
        jsonRequest(`http://localhost/api/v1/recipients/${created.id}/deactivate`, 'POST'),
        recipientParams(created.id),
      );
      expect(first.status).toBe(200);
      expect((await first.json()).active).toBe(false);

      const again = await deactivateRecipientRoute(
        jsonRequest(`http://localhost/api/v1/recipients/${created.id}/deactivate`, 'POST'),
        recipientParams(created.id),
      );
      expect(again.status).toBe(409);

      authOwner();
      const revived = await createRecipient({ displayName: 'D2', email: 'reuse@example.com' });
      expect(revived.status).toBe(201);
    });

    it('returns 404 for a cross-organization id', async () => {
      const created = await seedRecipient('xorg-deact@example.com');
      authOwner(otherOwner);
      const res = await deactivateRecipientRoute(
        jsonRequest(`http://localhost/api/v1/recipients/${created.id}/deactivate`, 'POST'),
        recipientParams(created.id),
      );
      expect(res.status).toBe(404);
    });
  });

  describe('task-create recipientId guard (D091)', () => {
    const cases: Array<[string, unknown]> = [
      ['valid uuid', '123e4567-e89b-12d3-a456-426614174000'],
      ['unknown id', 'rcp_missing'],
      ['malformed string', '!!!'],
      ['empty string', ''],
      ['null', null],
      ['number', 5],
      ['boolean', true],
      ['object', { id: 'x' }],
      ['array', ['x']],
    ];

    for (const [label, value] of cases) {
      it(`rejects a supplied recipientId (${label}) with 400 and no side effects`, async () => {
        authOwner();
        const res = await createTaskRoute(
          jsonRequest('http://localhost/api/v1/tasks', 'POST', {
            summaryPoints,
            recipientId: value,
          }),
        );
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({
          error: { code: 'RECIPIENT_HANDOFF_NOT_AVAILABLE' },
        });
        expect(await db.prisma.task.count()).toBe(0);
        expect(await db.prisma.taskAssignment.count()).toBe(0);
        expect(await db.prisma.taskCapability.count()).toBe(0);
        expect(await db.prisma.handoffAttempt.count()).toBe(0);
        // No durable audit row is created for the rejection.
        expect(await db.prisma.auditEvent.count()).toBe(0);
      });
    }

    it('allows task creation when recipientId is omitted', async () => {
      authOwner();
      const res = await createTaskRoute(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', { summaryPoints }),
      );
      expect(res.status).toBe(201);
      expect(await db.prisma.task.count()).toBe(1);
      expect(await db.prisma.taskAssignment.count()).toBe(0);
    });

    it('does not treat a nested recipientId as the legacy assignment field', async () => {
      authOwner();
      const res = await createTaskRoute(
        jsonRequest('http://localhost/api/v1/tasks', 'POST', {
          summaryPoints: [
            {
              id: 'p1',
              kind: 'next_action',
              label: 'Act',
              order: 0,
              value: 'Do work',
              recipientId: 'nested-not-legacy',
            },
          ],
        }),
      );
      expect(res.status).toBe(201);
      expect(await db.prisma.taskAssignment.count()).toBe(0);
    });

    it('rejects a repeated recipientId payload with no accumulated side effects', async () => {
      authOwner();
      for (let i = 0; i < 3; i += 1) {
        const res = await createTaskRoute(
          jsonRequest('http://localhost/api/v1/tasks', 'POST', {
            summaryPoints,
            recipientId: 'rcp_repeat',
          }),
        );
        expect(res.status).toBe(400);
      }
      expect(await db.prisma.task.count()).toBe(0);
      expect(await db.prisma.auditEvent.count()).toBe(0);
    });
  });
});
