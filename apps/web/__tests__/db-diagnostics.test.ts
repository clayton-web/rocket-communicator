// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, PersistenceError } from '@aicaa/db';
import { asOrganizationId, asOwnerId, ownerActor } from '@aicaa/domain';
import { TaskServiceError } from '@/lib/tasks/errors';
import {
  ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV,
  buildDatabaseRuntimeFailureLogPayload,
  classifyDatabaseRuntimeFailure,
  isDatabaseRuntimeDiagnosticsEnabled,
  logDatabaseRuntimeFailure,
  safeReadProperty,
  serializeDatabaseRuntimeFailureLogPayload,
  shouldLogDatabaseRuntimeFailure,
} from '@/lib/db/diagnostics';
import { mapOwnerTaskRouteError } from '@/lib/http/errors';
import { clearDbTestRuntime } from './helpers/db-test-runtime';
import * as aicaaDb from '@aicaa/db';
import { setDbRuntimeForTests } from '@/lib/db/runtime-db';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { GET as listTasks } from '@/app/api/v1/tasks/route';

const FORBIDDEN_LOG_FRAGMENTS = [
  'postgresql://',
  'password',
  'tokenHash',
  'pepper',
  '"stack"',
  'at Object.',
  'DATABASE_URL is required',
  'User:password@',
];

const owner = ownerActor(asOwnerId('owner_diag'), asOrganizationId('org_diag'));

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

function assertSafeSerializedLog(serialized: string) {
  const lower = serialized.toLowerCase();
  for (const fragment of FORBIDDEN_LOG_FRAGMENTS) {
    expect(lower).not.toContain(fragment.toLowerCase());
  }
  expect(serialized).not.toMatch(/\n\s+at /);
}

describe('database runtime diagnostics', () => {
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

  it('disables runtime diagnostics by default', () => {
    delete process.env.DATABASE_URL;
    delete process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV];

    expect(isDatabaseRuntimeDiagnosticsEnabled()).toBe(false);

    const error = new Error('DATABASE_URL is required to create the Prisma client.');
    expect(logDatabaseRuntimeFailure(error)).toBeUndefined();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('enables runtime diagnostics only when ENABLE_DB_RUNTIME_DIAGNOSTICS=true', () => {
    delete process.env.DATABASE_URL;
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';

    expect(isDatabaseRuntimeDiagnosticsEnabled()).toBe(true);

    const payload = logDatabaseRuntimeFailure(
      new Error('DATABASE_URL is required to create the Prisma client.'),
      { routePathname: '/api/v1/tasks', requestId: 'req_diag_flag' },
    );
    expect(payload?.category).toBe('DATABASE_URL_MISSING');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    assertSafeSerializedLog(String(consoleErrorSpy.mock.calls[0]?.[0]));
  });

  it('does not enable runtime diagnostics for other flag values', () => {
    delete process.env.DATABASE_URL;
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = '1';

    expect(isDatabaseRuntimeDiagnosticsEnabled()).toBe(false);
    expect(
      logDatabaseRuntimeFailure(new Error('DATABASE_URL is required to create the Prisma client.')),
    ).toBeUndefined();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('classifies missing DATABASE_URL as DATABASE_URL_MISSING', () => {
    delete process.env.DATABASE_URL;
    const error = new Error('DATABASE_URL is required to create the Prisma client.');

    expect(classifyDatabaseRuntimeFailure(error)).toBe('DATABASE_URL_MISSING');
    expect(shouldLogDatabaseRuntimeFailure(error)).toBe(true);
  });

  it('classifies Prisma initialization errors without logging message or stack', () => {
    process.env.DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/DATABASE';
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    const error = new Prisma.PrismaClientInitializationError(
      'secret connection detail message',
      '6.19.3',
      'P1001',
    );

    expect(classifyDatabaseRuntimeFailure(error)).toBe('DATABASE_UNREACHABLE');

    const payload = logDatabaseRuntimeFailure(error, {
      routePathname: '/api/v1/tasks',
      requestId: 'req_diag_1',
    });
    expect(payload).toBeDefined();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    const serialized = String(consoleErrorSpy.mock.calls[0]?.[0]);
    assertSafeSerializedLog(serialized);
    expect(serialized).toContain('DATABASE_UNREACHABLE');
    expect(serialized).toContain('PrismaClientInitializationError');
    expect(serialized).not.toContain('secret connection detail message');
  });

  it('maps Prisma auth and TLS codes to safe categories', () => {
    process.env.DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/DATABASE';

    const authError = new Prisma.PrismaClientKnownRequestError('auth detail', {
      code: 'P1000',
      clientVersion: '6.19.3',
    });
    const tlsError = new Prisma.PrismaClientKnownRequestError('tls detail', {
      code: 'P1011',
      clientVersion: '6.19.3',
    });

    expect(classifyDatabaseRuntimeFailure(authError)).toBe('DATABASE_AUTHENTICATION_FAILED');
    expect(classifyDatabaseRuntimeFailure(tlsError)).toBe('DATABASE_TLS_OR_DNS');
  });

  it('maps unknown database-related errors to UNKNOWN_DATABASE_ERROR', () => {
    process.env.DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/DATABASE';
    const error = new Error('generic');

    expect(classifyDatabaseRuntimeFailure(error)).toBe('UNKNOWN_DATABASE_ERROR');
    expect(shouldLogDatabaseRuntimeFailure(error)).toBe(false);
  });

  it('serializes only the allowed diagnostic payload shape', () => {
    delete process.env.DATABASE_URL;
    const payload = buildDatabaseRuntimeFailureLogPayload(
      new Error('DATABASE_URL is required to create the Prisma client.'),
      {
        routePathname: '/api/v1/tasks',
        requestId: 'req_diag_2',
      },
    );

    expect(payload).toEqual({
      event: 'database_runtime_failure',
      category: 'DATABASE_URL_MISSING',
      prismaErrorClass: 'Error',
      prismaErrorCode: undefined,
      nodeErrorCode: undefined,
      clientVersion: undefined,
      routePathname: '/api/v1/tasks',
      deploymentRuntime: expect.any(String),
      databaseUrlPresent: false,
      requestId: 'req_diag_2',
      timestamp: expect.any(String),
    });

    const serialized = serializeDatabaseRuntimeFailureLogPayload(payload);
    assertSafeSerializedLog(serialized);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'category',
        'databaseUrlPresent',
        'deploymentRuntime',
        'event',
        'prismaErrorClass',
        'requestId',
        'routePathname',
        'timestamp',
      ].sort(),
    );
    expect(parsed).not.toHaveProperty('message');
    expect(parsed).not.toHaveProperty('stack');
  });

  it('keeps public Owner route response generic 500 INTERNAL_ERROR', async () => {
    setDbRuntimeForTests(aicaaDb);
    delete process.env.DATABASE_URL;
    delete process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV];

    const response = await listTasks(new Request('http://localhost/api/v1/tasks'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId: expect.any(String),
        correlationId: null,
      },
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('logs sanitized diagnostics on Owner route only when diagnostics are enabled', async () => {
    setDbRuntimeForTests(aicaaDb);
    delete process.env.DATABASE_URL;
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';

    const response = await listTasks(new Request('http://localhost/api/v1/tasks'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(consoleErrorSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    const serializedLogs = consoleErrorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(serializedLogs).toContain('database_runtime_failure');
    assertSafeSerializedLog(serializedLogs);
  });

  it('does not log expected TaskServiceError responses', () => {
    const error = new TaskServiceError('NOT_FOUND', 'Task not found.');

    expect(shouldLogDatabaseRuntimeFailure(error)).toBe(false);
    expect(logDatabaseRuntimeFailure(error)).toBeUndefined();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    const response = mapOwnerTaskRouteError(error);
    expect(response.status).toBe(404);
  });

  it('classifies invalid DATABASE_URL format when present but non-postgres', () => {
    process.env.DATABASE_URL = 'not-a-valid-database-url';
    const error = new Prisma.PrismaClientInitializationError('init', '6.19.3', 'P1001');

    expect(classifyDatabaseRuntimeFailure(error)).toBe('DATABASE_URL_INVALID_FORMAT');
  });
});

function expectNeverThrows(fn: () => unknown): void {
  expect(fn).not.toThrow();
}

describe('fail-safe database runtime diagnostics', () => {
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
    { label: 'string', value: 'database exploded' },
    { label: 'plain object', value: { code: 'P1001' } },
    {
      label: 'Error',
      value: new Error('sensitive connection detail'),
    },
    {
      label: 'synthetic Prisma-shaped object',
      value: {
        name: 'PrismaClientInitializationError',
        errorCode: 'P1001',
        clientVersion: '6.19.3',
      },
    },
    {
      label: 'name getter throws',
      value: {
        get name() {
          throw new Error('name getter');
        },
      },
    },
    {
      label: 'code getter throws',
      value: {
        name: 'PrismaClientKnownRequestError',
        get code() {
          throw new Error('code getter');
        },
      },
    },
    {
      label: 'cause getter throws',
      value: {
        get cause() {
          throw new Error('cause getter');
        },
      },
    },
    {
      label: 'Proxy throws on access',
      value: new Proxy(
        {},
        {
          get() {
            throw new Error('proxy trap');
          },
        },
      ),
    },
    {
      label: 'distinct module identity Prisma error',
      value: Object.assign(new Error('distinct identity'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P1011',
        clientVersion: '6.19.3',
      }),
    },
  ];

  it.each(hostileInputs)('classifier never throws for $label', ({ value }) => {
    process.env.DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/DATABASE';
    expectNeverThrows(() => classifyDatabaseRuntimeFailure(value));
    expectNeverThrows(() => shouldLogDatabaseRuntimeFailure(value));
    expectNeverThrows(() => buildDatabaseRuntimeFailureLogPayload(value));
    expectNeverThrows(() => logDatabaseRuntimeFailure(value));
  });

  it('classifies structural Prisma errors without constructor identity', () => {
    process.env.DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/DATABASE';
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';

    const error = {
      name: 'PrismaClientInitializationError',
      errorCode: 'P1001',
      clientVersion: '6.19.3',
    };

    expect(classifyDatabaseRuntimeFailure(error)).toBe('DATABASE_UNREACHABLE');
    const payload = logDatabaseRuntimeFailure(error, {
      routePathname: '/api/v1/tasks',
      requestId: 'req_structural',
    });
    expect(payload?.category).toBe('DATABASE_UNREACHABLE');
    expect(payload?.prismaErrorClass).toBe('PrismaClientInitializationError');
    expect(payload?.prismaErrorCode).toBe('P1001');
    expect(payload?.clientVersion).toBe('6.19.3');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    assertSafeSerializedLog(String(consoleErrorSpy.mock.calls[0]?.[0]));
  });

  it('never throws when instanceof right-hand side is undefined', () => {
    process.env.DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/DATABASE';
    const brokenConstructor = undefined;

    expect(() => {
      if (typeof brokenConstructor === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        new Error() instanceof brokenConstructor;
      }
    }).not.toThrow();

    const error = { name: 'PrismaClientKnownRequestError', code: 'P1000', clientVersion: '6.19.3' };
    expect(classifyDatabaseRuntimeFailure(error)).toBe('DATABASE_AUTHENTICATION_FAILED');
    expect(shouldLogDatabaseRuntimeFailure(error)).toBe(true);
  });

  it('safeReadProperty returns undefined when property access throws', () => {
    const hostile = {
      get name() {
        throw new Error('boom');
      },
    };
    expect(safeReadProperty(hostile, 'name')).toBeUndefined();
  });

  it('returns undefined and preserves route JSON when console.error throws', async () => {
    delete process.env.DATABASE_URL;
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    consoleErrorSpy.mockImplementation(() => {
      throw new Error('console sink unavailable');
    });

    const payload = logDatabaseRuntimeFailure(
      new Error('DATABASE_URL is required to create the Prisma client.'),
      { routePathname: '/api/v1/tasks', requestId: 'req_console_fail' },
    );
    expect(payload).toBeUndefined();

    setDbRuntimeForTests(aicaaDb);
    const response = await listTasks(new Request('http://localhost/api/v1/tasks'));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId: expect.any(String),
        correlationId: null,
      },
    });
  });

  it('falls back when JSON serialization fails', () => {
    process.env.DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/DATABASE';
    const circular: Record<string, unknown> = { event: 'database_runtime_failure' };
    circular.self = circular;

    const serialized = serializeDatabaseRuntimeFailureLogPayload(circular as never);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed.event).toBe('database_runtime_failure');
    expect(parsed.category).toBe('UNKNOWN_DATABASE_ERROR');
    assertSafeSerializedLog(serialized);
  });

  it('does not log when diagnostics are disabled', () => {
    delete process.env.DATABASE_URL;
    delete process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV];

    expect(
      logDatabaseRuntimeFailure(new Error('DATABASE_URL is required to create the Prisma client.')),
    ).toBeUndefined();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('keeps TaskServiceError public responses unchanged', () => {
    const error = new TaskServiceError('NOT_FOUND', 'Task not found.');
    expect(shouldLogDatabaseRuntimeFailure(error)).toBe(false);
    expect(logDatabaseRuntimeFailure(error)).toBeUndefined();

    const response = mapOwnerTaskRouteError(error);
    expect(response.status).toBe(404);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('classifies structural PersistenceError without constructor identity', () => {
    process.env.DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/DATABASE';
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';

    const error = { name: 'PersistenceError', code: 'UNIQUE_VIOLATION' };
    expect(classifyDatabaseRuntimeFailure(error)).toBe('DATABASE_QUERY_FAILED');
    expect(shouldLogDatabaseRuntimeFailure(error)).toBe(true);
    expect(logDatabaseRuntimeFailure(error)).toBeDefined();
    assertSafeSerializedLog(String(consoleErrorSpy.mock.calls[0]?.[0]));
  });
});
