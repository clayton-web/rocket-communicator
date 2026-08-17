// @vitest-environment node
/**
 * S7 Gmail Review release gate at the four route-module boundaries.
 *
 * Disabled requests must 404 before authentication, database runtime, S7 services, or
 * interpretation. A5 connection/sync and KEEP-LIVE interpretation routes must not inherit the gate.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asOrganizationId, asOwnerId, ownerActor } from '@aicaa/domain';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { ENABLE_GMAIL_REVIEW_ENV } from '@/lib/gmail/review-release-config';

const getDb = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error('getDb must not be reached when Gmail Review is gated off');
  }),
);

const listOwnerGmailIntake = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error('listOwnerGmailIntake must not be reached when Gmail Review is gated off');
  }),
);

const resolveGmailReviewSource = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error('resolveGmailReviewSource must not be reached when Gmail Review is gated off');
  }),
);

const interpretCapture = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error('interpretCapture must not be reached when Gmail Review is gated off');
  }),
);

const excludeGmailSenderFromEvent = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error(
      'excludeGmailSenderFromEvent must not be reached when Gmail Review is gated off',
    );
  }),
);

const removeGmailSenderExclusion = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error(
      'removeGmailSenderExclusion must not be reached when Gmail Review is gated off',
    );
  }),
);

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

vi.mock('@/lib/db/server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db/server')>('@/lib/db/server');
  return {
    ...actual,
    getDb,
  };
});

vi.mock('@/lib/gmail/intake-service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gmail/intake-service')>(
    '@/lib/gmail/intake-service',
  );
  return {
    ...actual,
    listOwnerGmailIntake,
    resolveGmailReviewSource,
  };
});

vi.mock('@/lib/interpretation/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/interpretation/service')>(
    '@/lib/interpretation/service',
  );
  return {
    ...actual,
    interpretCapture,
  };
});

vi.mock('@/lib/gmail/sender-exclusion-service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gmail/sender-exclusion-service')>(
    '@/lib/gmail/sender-exclusion-service',
  );
  return {
    ...actual,
    excludeGmailSenderFromEvent,
    removeGmailSenderExclusion,
  };
});

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { GET as listGmailIntake } from '@/app/api/v1/gmail/intake/route';
import { POST as createGmailReview } from '@/app/api/v1/gmail/reviews/route';
import { POST as createGmailSenderExclusion } from '@/app/api/v1/gmail/sender-exclusions/route';
import { DELETE as deleteGmailSenderExclusion } from '@/app/api/v1/gmail/sender-exclusions/[exclusionId]/route';
import { GET as getGmailConnection } from '@/app/api/v1/gmail/connection/route';
import { GET as listGmailSyncRuns } from '@/app/api/v1/gmail/sync-runs/route';
import { POST as createManualCapture } from '@/app/api/v1/manual-captures/route';
import { POST as createMessagesReview } from '@/app/api/v1/messages/reviews/route';

const owner = ownerActor(asOwnerId('owner_s7_gate'), asOrganizationId('org_s7_gate'));

const gatedRoutes: Array<{
  name: string;
  invoke: () => Promise<Response>;
}> = [
  {
    name: 'GET /api/v1/gmail/intake',
    invoke: () => listGmailIntake(new Request('http://localhost/api/v1/gmail/intake')),
  },
  {
    name: 'POST /api/v1/gmail/reviews',
    invoke: () =>
      createGmailReview(
        new Request('http://localhost/api/v1/gmail/reviews', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': 'idem-gate-off',
          },
          body: JSON.stringify({ communicationEventId: 'evt_gate_off' }),
        }),
      ),
  },
  {
    name: 'POST /api/v1/gmail/sender-exclusions',
    invoke: () =>
      createGmailSenderExclusion(
        new Request('http://localhost/api/v1/gmail/sender-exclusions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ communicationEventId: 'evt_gate_off' }),
        }),
      ),
  },
  {
    name: 'DELETE /api/v1/gmail/sender-exclusions/{exclusionId}',
    invoke: () =>
      deleteGmailSenderExclusion(
        new Request('http://localhost/api/v1/gmail/sender-exclusions/gse_gate_off', {
          method: 'DELETE',
        }),
        { params: Promise.resolve({ exclusionId: 'gse_gate_off' }) },
      ),
  },
];

function authOwner() {
  vi.mocked(getAuthenticatedOwner).mockResolvedValue({
    user: { id: owner.ownerId } as never,
    actor: owner,
    session: {
      ownerId: owner.ownerId,
      organizationId: owner.organizationId,
      role: 'owner',
      displayName: 'Owner',
    },
  });
}

async function expectUnavailable(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const json = await response.json();
  expect(json.error).toEqual(
    expect.objectContaining({
      code: 'NOT_FOUND',
      message: expect.any(String),
      requestId: expect.any(String),
    }),
  );
  expect(json.error.message).not.toMatch(/ENABLE_GMAIL_REVIEW/);
  expect(json.error.message).not.toMatch(/environment/i);
  expect(json.error.message).not.toMatch(/flag/i);
  expect(json.error.message).not.toMatch(/configuration/i);
}

function expectGateNotEntered(): void {
  expect(getAuthenticatedOwner).not.toHaveBeenCalled();
  expect(getDb).not.toHaveBeenCalled();
  expect(listOwnerGmailIntake).not.toHaveBeenCalled();
  expect(resolveGmailReviewSource).not.toHaveBeenCalled();
  expect(interpretCapture).not.toHaveBeenCalled();
  expect(excludeGmailSenderFromEvent).not.toHaveBeenCalled();
  expect(removeGmailSenderExclusion).not.toHaveBeenCalled();
}

describe('S7 Gmail Review release gate', () => {
  const originalFlag = process.env[ENABLE_GMAIL_REVIEW_ENV];
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
    if (originalFlag === undefined) {
      delete process.env[ENABLE_GMAIL_REVIEW_ENV];
    } else {
      process.env[ENABLE_GMAIL_REVIEW_ENV] = originalFlag;
    }
  });

  beforeEach(() => {
    delete process.env[ENABLE_GMAIL_REVIEW_ENV];
    installDbTestRuntime(db.prisma);
    vi.mocked(getAuthenticatedOwner).mockReset();
    getDb.mockClear();
    listOwnerGmailIntake.mockClear();
    resolveGmailReviewSource.mockClear();
    interpretCapture.mockClear();
    excludeGmailSenderFromEvent.mockClear();
    removeGmailSenderExclusion.mockClear();
  });

  afterEach(() => {
    clearDbTestRuntime();
    delete process.env[ENABLE_GMAIL_REVIEW_ENV];
  });

  describe('when the gate is absent or malformed', () => {
    it.each([
      ['absent', undefined],
      ['1', '1'],
      ['TRUE', 'TRUE'],
      ['True', 'True'],
      ['yes', 'yes'],
      ['on', 'on'],
      ['leading space', ' true'],
      ['trailing space', 'true '],
      ['quoted', '"true"'],
      ['false', 'false'],
      ['empty', ''],
    ])('returns 404 for every S7 route when the value is %s', async (_label, value) => {
      if (value === undefined) {
        delete process.env[ENABLE_GMAIL_REVIEW_ENV];
      } else {
        process.env[ENABLE_GMAIL_REVIEW_ENV] = value;
      }
      vi.mocked(getAuthenticatedOwner).mockRejectedValue(
        new Error('getAuthenticatedOwner must not be reached when Gmail Review is gated off'),
      );

      for (const route of gatedRoutes) {
        const response = await route.invoke();
        await expectUnavailable(response);
      }
      expectGateNotEntered();
    });

    it('returns 404 with or without an Owner session because availability precedes auth', async () => {
      authOwner();
      for (const route of gatedRoutes) {
        const response = await route.invoke();
        await expectUnavailable(response);
      }
      expectGateNotEntered();

      vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
      for (const route of gatedRoutes) {
        const response = await route.invoke();
        await expectUnavailable(response);
      }
      expectGateNotEntered();
    });

    it('creates no Review persistence when Gmail Review is disabled', async () => {
      authOwner();
      const response = await createGmailReview(
        new Request('http://localhost/api/v1/gmail/reviews', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': 'idem-gate-no-write',
          },
          body: JSON.stringify({ communicationEventId: 'evt_gate_no_write' }),
        }),
      );
      await expectUnavailable(response);
      expect(await db.prisma.communicationEvent.count()).toBe(0);
      expect(await db.prisma.temporaryCommunicationExcerpt.count()).toBe(0);
      expect(await db.prisma.interpretationRun.count()).toBe(0);
      expect(await db.prisma.taskSuggestion.count()).toBe(0);
      expect(await db.prisma.task.count()).toBe(0);
      expectGateNotEntered();
    });
  });

  describe('does not leak into A5 or KEEP-LIVE surfaces', () => {
    it('leaves Gmail connection and sync-runs on their ordinary unauthenticated 401', async () => {
      vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
      const connection = await getGmailConnection(
        new Request('http://localhost/api/v1/gmail/connection'),
      );
      expect(connection.status).toBe(401);
      expect(connection.status).not.toBe(404);

      const syncRuns = await listGmailSyncRuns(
        new Request('http://localhost/api/v1/gmail/sync-runs'),
      );
      expect(syncRuns.status).toBe(401);
      expect(syncRuns.status).not.toBe(404);
    });

    it('leaves Manual Capture and Messages Review on their ordinary unauthenticated 401', async () => {
      vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
      const capture = await createManualCapture(
        new Request('http://localhost/api/v1/manual-captures', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'hello' }),
        }),
      );
      expect(capture.status).toBe(401);
      expect(capture.status).not.toBe(404);

      const messages = await createMessagesReview(
        new Request('http://localhost/api/v1/messages/reviews', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': 'idem-keep-live',
          },
          body: JSON.stringify({
            sourceOccurrenceId: 'occ_keep_live',
            selectedText: 'hello',
            observedAt: '2026-08-16T00:00:00.000Z',
          }),
        }),
      );
      expect(messages.status).toBe(401);
      expect(messages.status).not.toBe(404);
    });
  });

  it('checks the release gate before entering either shared route context', () => {
    const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const files = [
      { file: 'app/api/v1/gmail/intake/route.ts', context: 'runOwnerGmailRoute' },
      { file: 'app/api/v1/gmail/reviews/route.ts', context: 'runOwnerInterpretationRoute' },
      { file: 'app/api/v1/gmail/sender-exclusions/route.ts', context: 'runOwnerGmailRoute' },
      {
        file: 'app/api/v1/gmail/sender-exclusions/[exclusionId]/route.ts',
        context: 'runOwnerGmailRoute',
      },
    ];
    for (const { file, context } of files) {
      const source = readFileSync(path.join(webRoot, file), 'utf8');
      const gate = source.indexOf('if (!isGmailReviewEnabled())');
      const enter = source.indexOf(`return ${context}(`);
      expect(gate).toBeGreaterThanOrEqual(0);
      expect(enter).toBeGreaterThan(gate);
      expect(source).not.toMatch(/from '@\/lib\/gmail\/config'/);
    }
  });
});
