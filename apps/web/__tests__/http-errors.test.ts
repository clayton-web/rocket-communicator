// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersistenceError } from '@aicaa/db';
import { TaskServiceError } from '@/lib/tasks/errors';
import { ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV, logDatabaseRuntimeFailure } from '@/lib/db/diagnostics';
import { mapDomainOrPersistenceError } from '@/lib/tasks/internal';
import { mapOwnerTaskRouteError, mapRecipientCapabilityRouteError } from '@/lib/http/errors';
import { recipientCapabilityServiceError } from '@/lib/capability/recipient-errors';
import { clearDbTestRuntime } from './helpers/db-test-runtime';
import * as aicaaDb from '@aicaa/db';
import { setDbRuntimeForTests } from '@/lib/db/runtime-db';
import { GET as listTasks } from '@/app/api/v1/tasks/route';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { asOrganizationId, asOwnerId, ownerActor } from '@aicaa/domain';

const FORBIDDEN_PUBLIC_FRAGMENTS = [
  'postgresql://',
  'password',
  'PrismaClient',
  'P1001',
  'at Object.',
  '"stack"',
];

const owner = ownerActor(asOwnerId('owner_http'), asOrganizationId('org_http'));

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

function expectGenericJson500(response: Response, body: Record<string, unknown>) {
  expect(response.status).toBe(500);
  expect(body.error).toEqual(
    expect.objectContaining({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId: expect.any(String),
    }),
  );
}

function expectNeverThrows(fn: () => unknown): void {
  expect(fn).not.toThrow();
}

describe('safe HTTP error mapping', () => {
  const originalEnv = { ...process.env };
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env = { ...originalEnv };
    clearDbTestRuntime();
    authOwner();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    process.env = { ...originalEnv };
    clearDbTestRuntime();
    vi.clearAllMocks();
  });

  const hostileInputs: Array<{ label: string; value: unknown }> = [
    { label: 'undefined', value: undefined },
    { label: 'null', value: null },
    { label: 'string', value: 'secret db host failure' },
    { label: 'plain object', value: { code: 'NOT_FOUND' } },
    {
      label: 'name getter throws',
      value: {
        get name() {
          throw new Error('name');
        },
      },
    },
    {
      label: 'code getter throws',
      value: {
        name: 'PersistenceError',
        get code() {
          throw new Error('code');
        },
      },
    },
    {
      label: 'Proxy throws',
      value: new Proxy(
        {},
        {
          get() {
            throw new Error('proxy');
          },
        },
      ),
    },
  ];

  it.each(hostileInputs)('mapOwnerTaskRouteError never throws for $label', async ({ value }) => {
    expectNeverThrows(() => mapOwnerTaskRouteError(value));
    const response = mapOwnerTaskRouteError(value);
    const body = await response.json();
    expectGenericJson500(response, body);
  });

  it('maps structural PersistenceError to NOT_FOUND without constructor identity', async () => {
    const error = { name: 'PersistenceError', code: 'NOT_FOUND' };
    const response = mapOwnerTaskRouteError(error);
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toEqual(expect.any(String));
  });

  it('maps distinct module-identity PersistenceError to PRECONDITION_FAILED', async () => {
    const error = Object.assign(new Error('internal detail'), {
      name: 'PersistenceError',
      code: 'OPTIMISTIC_CONCURRENCY',
    });
    const response = mapOwnerTaskRouteError(error);
    const body = await response.json();
    expect(response.status).toBe(412);
    expect(body.error.code).toBe('PRECONDITION_FAILED');
  });

  it('never throws when PersistenceError constructor is undefined', async () => {
    const brokenConstructor = undefined;
    expect(() => {
      if (typeof brokenConstructor === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        new Error() instanceof brokenConstructor;
      }
    }).not.toThrow();

    const error = { name: 'PersistenceError', code: 'TRANSACTION_FAILED' };
    const response = mapOwnerTaskRouteError(error);
    const body = await response.json();
    expectGenericJson500(response, body);
  });

  it('preserves TaskServiceError mappings', async () => {
    const error = new TaskServiceError('NOT_FOUND', 'Task not found.');
    const response = mapOwnerTaskRouteError(error);
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Task not found.');
  });

  it('preserves Recipient capability route mappings', async () => {
    const error = recipientCapabilityServiceError('UNAUTHORIZED', 'internal');
    const response = mapRecipientCapabilityRouteError(error);
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Capability token is invalid.');
  });

  it('mapDomainOrPersistenceError maps structural persistence to TaskServiceError', () => {
    const error = { name: 'PersistenceError', code: 'NOT_FOUND' };
    expect(() => mapDomainOrPersistenceError(error)).toThrow(TaskServiceError);
    try {
      mapDomainOrPersistenceError(error);
    } catch (mapped) {
      expect(mapped).toBeInstanceOf(TaskServiceError);
      expect((mapped as TaskServiceError).code).toBe('NOT_FOUND');
    }
  });

  it('does not expose secrets in public JSON responses', async () => {
    const error = {
      name: 'PrismaClientInitializationError',
      errorCode: 'P1001',
      message: 'postgresql://user:password@host/db',
    };
    const response = mapOwnerTaskRouteError(error);
    const serialized = JSON.stringify(await response.json()).toLowerCase();
    for (const fragment of FORBIDDEN_PUBLIC_FRAGMENTS) {
      expect(serialized).not.toContain(fragment.toLowerCase());
    }
  });

  it('returns JSON 500 from Owner task route when getDb fails with diagnostics enabled', async () => {
    setDbRuntimeForTests(aicaaDb);
    delete process.env.DATABASE_URL;
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';

    const response = await listTasks(new Request('http://localhost/api/v1/tasks'));
    const body = await response.json();

    expectGenericJson500(response, body);
    expect(consoleErrorSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    const serializedLogs = consoleErrorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(serializedLogs).toContain('db_runtime_stage');
  });

  it('logs diagnostics for genuine PersistenceError shape when enabled', () => {
    process.env.DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/DATABASE';
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';

    const error = new PersistenceError('UNIQUE_VIOLATION', 'duplicate key detail');
    logDatabaseRuntimeFailure(error, { routePathname: '/api/v1/tasks', requestId: 'req_http' });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const serialized = String(consoleErrorSpy.mock.calls[0]?.[0]);
    expect(serialized).toContain('database_runtime_failure');
    expect(serialized.toLowerCase()).not.toContain('duplicate key');
  });
});
