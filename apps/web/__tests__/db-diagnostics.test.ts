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
      prismaTransactionErrorKind: undefined,
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
    // Gated DB incident probe must stay silent when disabled. Always-on operational
    // diagnostics (P1.1) may still emit privacy-safe JSON lines.
    const serializedLogs = consoleErrorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(serializedLogs).not.toContain('database_runtime_failure');
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

describe('Prisma P2028 transaction subtype diagnostics', () => {
  const originalEnv = { ...process.env };
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  const LEAKY_POSTGRES_URL = 'postgresql://owner:super_secret_db_password@db.example.com:5432/app';
  const LEAKY_SQL = 'SELECT * FROM "InboxMessage" WHERE tokenHash = \'rt_secret\'';
  const LEAKY_TOKEN = 'ya29.leaky_access_token';
  const LEAKY_GMAIL_BODY = 'Hello from Gmail secret inbox';
  const LEAKY_SECRET = 'super_secret_value';
  const LEAKY_FRAGMENTS = [
    LEAKY_POSTGRES_URL,
    LEAKY_SQL,
    LEAKY_TOKEN,
    LEAKY_GMAIL_BODY,
    LEAKY_SECRET,
    'super_secret_db_password',
    'InboxMessage',
    'tokenHash',
    'rt_secret',
    'ya29',
  ];

  // Representative Prisma 6.19.3 P2028 shapes from prisma-engines
  // TransactionError / ClosedTransaction. Variable operation names and
  // durations are present only to exercise the classifier; they must never
  // appear in emitted diagnostics.
  const P2028_TIMEOUT_MESSAGE =
    'Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 6123 ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.';
  const P2028_MAX_WAIT_MESSAGE =
    'Transaction API error: Unable to start a transaction in the given time.';
  const P2028_COMMITTED_MESSAGE =
    'Transaction API error: Transaction already closed: A commit cannot be executed on a committed transaction.';
  const P2028_ROLLED_BACK_MESSAGE =
    'Transaction API error: Transaction already closed: A rollback cannot be executed on a transaction that was rolled back.';
  const P2028_NOT_FOUND_MESSAGE =
    "Transaction API error: Transaction not found. Transaction ID is invalid, refers to an old closed transaction Prisma doesn't have information about anymore, or was obtained before disconnecting.";
  const P2028_UNKNOWN_MESSAGE =
    'Transaction API error: Attempted to start a transaction inside of a transaction.';
  const P2028_LEAKY_UNKNOWN_MESSAGE = [
    'Transaction API error: unrecognized interactive transaction failure.',
    LEAKY_POSTGRES_URL,
    LEAKY_SQL,
    `token=${LEAKY_TOKEN}`,
    `gmail body: ${LEAKY_GMAIL_BODY}`,
    LEAKY_SECRET,
  ].join(' ');

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env = { ...originalEnv };
    process.env.DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/DATABASE';
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function knownRequestError(code: string, message: string) {
    return new Prisma.PrismaClientKnownRequestError(message, {
      code,
      clientVersion: '6.19.3',
    });
  }

  function emittedDiagnosticJson(): Record<string, unknown> {
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const serialized = String(consoleErrorSpy.mock.calls[0]?.[0]);
    assertSafeSerializedLog(serialized);
    expect(serialized).not.toContain('"message"');
    expect(serialized).not.toContain('"stack"');
    for (const fragment of LEAKY_FRAGMENTS) {
      expect(serialized).not.toContain(fragment);
    }
    return JSON.parse(serialized) as Record<string, unknown>;
  }

  function expectP2028Kind(error: Prisma.PrismaClientKnownRequestError, kind: string) {
    expect(classifyDatabaseRuntimeFailure(error)).toBe('DATABASE_QUERY_FAILED');
    const payload = logDatabaseRuntimeFailure(error, { requestId: 'req_p2028_kind' });
    expect(payload?.category).toBe('DATABASE_QUERY_FAILED');
    expect(payload?.prismaErrorClass).toBe('PrismaClientKnownRequestError');
    expect(payload?.prismaErrorCode).toBe('P2028');
    expect(payload?.prismaTransactionErrorKind).toBe(kind);
    expect(payload).not.toHaveProperty('message');
    expect(payload).not.toHaveProperty('stack');

    const parsed = emittedDiagnosticJson();
    expect(parsed.event).toBe('database_runtime_failure');
    expect(parsed.prismaErrorCode).toBe('P2028');
    expect(parsed.prismaTransactionErrorKind).toBe(kind);
    expect(parsed).not.toHaveProperty('message');
    expect(parsed).not.toHaveProperty('stack');
    expect(JSON.stringify(parsed)).not.toContain(error.message);
  }

  it('maps an expired interactive transaction to timeout', () => {
    expectP2028Kind(knownRequestError('P2028', P2028_TIMEOUT_MESSAGE), 'timeout');
    const serialized = String(consoleErrorSpy.mock.calls[0]?.[0]);
    expect(serialized).not.toContain('5000');
    expect(serialized).not.toContain('6123');
    expect(serialized).not.toContain('cannot be executed');
  });

  it('maps an acquisition maxWait failure to max_wait', () => {
    expectP2028Kind(knownRequestError('P2028', P2028_MAX_WAIT_MESSAGE), 'max_wait');
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).not.toContain(
      'Unable to start a transaction',
    );
  });

  it('maps a committed-transaction variant to already_committed', () => {
    expectP2028Kind(knownRequestError('P2028', P2028_COMMITTED_MESSAGE), 'already_committed');
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).not.toContain('committed transaction');
  });

  it('maps a rolled-back-transaction variant to already_rolled_back', () => {
    expectP2028Kind(knownRequestError('P2028', P2028_ROLLED_BACK_MESSAGE), 'already_rolled_back');
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).not.toContain('rolled back');
  });

  it('maps a transaction-not-found variant to not_found', () => {
    expectP2028Kind(knownRequestError('P2028', P2028_NOT_FOUND_MESSAGE), 'not_found');
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).not.toContain('Transaction not found');
  });

  it('maps an unrecognized P2028 message to other', () => {
    expectP2028Kind(knownRequestError('P2028', P2028_UNKNOWN_MESSAGE), 'other');
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).not.toContain('inside of a transaction');
  });

  it('does not attach a transaction subtype for non-P2028 Prisma errors', () => {
    const error = knownRequestError(
      'P2034',
      'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
    );
    const payload = logDatabaseRuntimeFailure(error, { requestId: 'req_p2034' });
    expect(payload?.prismaErrorCode).toBe('P2034');
    expect(payload?.prismaTransactionErrorKind).toBeUndefined();
    const parsed = emittedDiagnosticJson();
    expect(parsed.prismaErrorCode).toBe('P2034');
    expect(parsed).not.toHaveProperty('prismaTransactionErrorKind');
  });

  it('emits nothing for P2028 when diagnostics are OFF', () => {
    delete process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV];
    const error = knownRequestError('P2028', P2028_TIMEOUT_MESSAGE);
    expect(isDatabaseRuntimeDiagnosticsEnabled()).toBe(false);
    expect(logDatabaseRuntimeFailure(error)).toBeUndefined();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('never emits the raw Prisma message or leaky content from an unknown P2028', () => {
    const error = knownRequestError('P2028', P2028_LEAKY_UNKNOWN_MESSAGE);
    expectP2028Kind(error, 'other');

    const serialized = String(consoleErrorSpy.mock.calls[0]?.[0]);
    expect(serialized).not.toMatch(/postgresql:\/\//i);
    expect(serialized).not.toMatch(/postgres:\/\//i);
    expect(serialized).not.toContain('SELECT ');
    expect(serialized).not.toContain('InboxMessage');
    expect(serialized).not.toContain('ya29');
    expect(serialized).not.toContain(LEAKY_GMAIL_BODY);
    expect(serialized).not.toContain(LEAKY_SECRET);
    expect(serialized).not.toContain('super_secret_db_password');
    expect(serialized).not.toContain('unrecognized interactive transaction failure');
  });
});
