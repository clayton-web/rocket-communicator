// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOrganizationId, asOwnerId, ownerActor } from '@aicaa/domain';
import { runOwnerTaskRoute } from '@/lib/tasks/route-context';
import { TaskServiceError } from '@/lib/tasks/errors';
import { setOperationalLogSinkForTests } from '@/lib/observability';
import { clearDbTestRuntime } from './helpers/db-test-runtime';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

vi.mock('@/lib/db/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/server')>();
  return {
    ...actual,
    getDb: vi.fn(async () => ({})),
  };
});

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';

const owner = ownerActor(asOwnerId('owner_corr'), asOrganizationId('org_corr'));

describe('P1.1 runOwnerTaskRoute correlation continuity', () => {
  const lines: string[] = [];

  beforeEach(() => {
    clearDbTestRuntime();
    lines.length = 0;
    setOperationalLogSinkForTests((line) => {
      lines.push(line);
    });
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
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    setOperationalLogSinkForTests(null);
    vi.restoreAllMocks();
    clearDbTestRuntime();
  });

  it('public error envelope requestId matches the route context requestId', async () => {
    let contextRequestId: string | undefined;

    const response = await runOwnerTaskRoute(
      new Request('http://localhost/api/v1/tasks/task_1', { method: 'GET' }),
      async (ctx) => {
        contextRequestId = ctx.requestId;
        throw new TaskServiceError('NOT_FOUND', 'Task not found.');
      },
    );

    const body = (await response.json()) as {
      error: { requestId: string; code: string };
    };
    expect(response.status).toBe(404);
    expect(contextRequestId).toEqual(expect.any(String));
    expect(body.error.requestId).toBe(contextRequestId);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('unauthorized responses still carry a stable requestId from the route scope', async () => {
    vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
    const response = await runOwnerTaskRoute(
      new Request('http://localhost/api/v1/tasks', { method: 'GET' }),
      async () => new Response('should not run'),
    );
    const body = (await response.json()) as { error: { requestId: string; code: string } };
    expect(response.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.requestId).toEqual(expect.any(String));
  });

  it('domain NOT_FOUND does not emit operational_failure (timing only)', async () => {
    const response = await runOwnerTaskRoute(
      new Request('http://localhost/api/v1/tasks/task_missing', { method: 'GET' }),
      async () => {
        throw new TaskServiceError('NOT_FOUND', 'Task not found.');
      },
    );

    expect(response.status).toBe(404);
    const events = lines.map((l) => JSON.parse(l).event as string);
    expect(events).toContain('operation_timing');
    expect(events).not.toContain('operational_failure');
  });
});
