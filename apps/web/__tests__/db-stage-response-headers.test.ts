// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@aicaa/db';
import { ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV } from '@/lib/db/diagnostics';
import {
  runWithDbStageContext,
  setDbStageContext,
  resetDbStageContextForTests,
  updateDbStageContext,
} from '@/lib/db/stage-context';
import { logDbRuntimeStageFailure } from '@/lib/db/stage-diagnostics';
import {
  DB_CATEGORY_HEADER,
  DB_ERROR_CLASS_HEADER,
  DB_NODE_CODE_HEADER,
  DB_PRISMA_CODE_HEADER,
  DB_STAGE_HEADER,
  attachOwnerTaskDbDiagnosticHeaders,
  buildOwnerTaskDbDiagnosticHeaders,
} from '@/lib/db/stage-response-headers';
import { NextResponse } from 'next/server';
import { DbRuntimeConfigurationError } from '@/lib/db/runtime-db';
import { mapOwnerTaskRouteError, mapRecipientCapabilityRouteError } from '@/lib/http/errors';
import { TaskServiceError } from '@/lib/tasks/errors';
import { CapabilityTokenError } from '@/lib/capability/errors';

const FORBIDDEN_HEADER_FRAGMENTS = [
  'postgresql://',
  'password',
  'packages/db',
  'node_modules',
  '@aicaa/db',
  'findMany',
  'tokenHash',
  'pepper',
  '\n',
  ' at ',
];

function readHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

function assertHeadersSafe(headers: Record<string, string>) {
  const serialized = JSON.stringify(headers).toLowerCase();
  for (const fragment of FORBIDDEN_HEADER_FRAGMENTS) {
    expect(serialized).not.toContain(fragment.toLowerCase());
  }
}

describe('owner task DB diagnostic response headers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetDbStageContextForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetDbStageContextForTests();
    vi.clearAllMocks();
  });

  it('adds DB_MODULE_NOT_FOUND headers for missing runtime module failures', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_module' });

    const moduleError = Object.assign(new Error('module missing'), { code: 'MODULE_NOT_FOUND' });
    logDbRuntimeStageFailure(moduleError, 'DB_MODULE_NOT_FOUND');

    const response = mapOwnerTaskRouteError(new Error('unexpected'));
    const headers = readHeaders(response);
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
    expect(headers[DB_STAGE_HEADER.toLowerCase()]).toBe('DB_RUNTIME_FAILURE');
    expect(headers[DB_CATEGORY_HEADER.toLowerCase()]).toBe('DB_MODULE_NOT_FOUND');
    assertHeadersSafe(headers);
  });

  it('adds DB_EXPORTS_MISSING headers for missing runtime exports', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_exports' });

    logDbRuntimeStageFailure(new DbRuntimeConfigurationError(), 'DB_EXPORTS_MISSING');

    const response = mapOwnerTaskRouteError(new DbRuntimeConfigurationError());
    const headers = readHeaders(response);

    expect(headers[DB_STAGE_HEADER.toLowerCase()]).toBe('DB_RUNTIME_FAILURE');
    expect(headers[DB_CATEGORY_HEADER.toLowerCase()]).toBe('DB_EXPORTS_MISSING');
    expect(headers[DB_ERROR_CLASS_HEADER.toLowerCase()]).toBe('DbRuntimeConfigurationError');
  });

  it('adds Prisma construction failure headers', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_prisma_ctor' });

    const prismaError = new Prisma.PrismaClientInitializationError('init', '6.19.3', 'P1001');
    logDbRuntimeStageFailure(prismaError, 'DATABASE_UNREACHABLE');

    const response = mapOwnerTaskRouteError(prismaError);
    const headers = readHeaders(response);

    expect(headers[DB_STAGE_HEADER.toLowerCase()]).toBe('DB_RUNTIME_FAILURE');
    expect(headers[DB_CATEGORY_HEADER.toLowerCase()]).toBe('DATABASE_UNREACHABLE');
    expect(headers[DB_ERROR_CLASS_HEADER.toLowerCase()]).toBe(
      'PrismaClientInitializationError',
    );
    expect(headers[DB_PRISMA_CODE_HEADER.toLowerCase()]).toBe('P1001');
  });

  it('adds query failure headers', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_query' });

    const queryError = new Prisma.PrismaClientKnownRequestError('query failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
    });
    logDbRuntimeStageFailure(queryError, 'DATABASE_QUERY_FAILED', {
      queryOperation: 'listTasks',
    });

    const response = mapOwnerTaskRouteError(queryError);
    const headers = readHeaders(response);

    expect(headers[DB_STAGE_HEADER.toLowerCase()]).toBe('DB_RUNTIME_FAILURE');
    expect(headers[DB_CATEGORY_HEADER.toLowerCase()]).toBe('DATABASE_QUERY_FAILED');
    expect(headers[DB_PRISMA_CODE_HEADER.toLowerCase()]).toBe('P2002');
  });

  it('omits headers when diagnostics flag is disabled', async () => {
    delete process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV];
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_flag_off' });
    logDbRuntimeStageFailure(new Error('x'), 'DB_MODULE_NOT_FOUND');

    const response = mapOwnerTaskRouteError(new Error('unexpected'));
    const headers = readHeaders(response);

    expect(headers[DB_STAGE_HEADER.toLowerCase()]).toBeUndefined();
    expect(headers[DB_CATEGORY_HEADER.toLowerCase()]).toBeUndefined();
  });

  it.each([
    ['404', () => mapOwnerTaskRouteError(new TaskServiceError('NOT_FOUND', 'Task not found.'))],
    ['400', () => mapOwnerTaskRouteError(new TaskServiceError('VALIDATION_ERROR', 'bad', []))],
    ['401 capability', () => mapOwnerTaskRouteError(new CapabilityTokenError('NOT_FOUND', 'x'))],
    ['409', () => mapOwnerTaskRouteError(new TaskServiceError('DOMAIN_CONFLICT', 'conflict'))],
    ['412', () => mapOwnerTaskRouteError(new TaskServiceError('PRECONDITION_FAILED', 'etag'))],
    ['428', () => mapOwnerTaskRouteError(new TaskServiceError('PRECONDITION_REQUIRED', 'etag'))],
  ])('omits headers on non-500 owner task response (%s)', async (_label, buildResponse) => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_non_500' });
    logDbRuntimeStageFailure(new Error('x'), 'DB_MODULE_NOT_FOUND');

    const response = buildResponse();
    const headers = readHeaders(response);
    expect(response.status).not.toBe(500);
    expect(headers[DB_STAGE_HEADER.toLowerCase()]).toBeUndefined();
  });

  it('omits headers on recipient capability routes', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({ routePathname: '/api/v1/capabilities/tok/tasks/t1', requestId: 'req_rec' });
    logDbRuntimeStageFailure(new Error('x'), 'DB_MODULE_NOT_FOUND');

    const response = mapRecipientCapabilityRouteError(new Error('unexpected'));
    const headers = readHeaders(response);

    expect(response.status).toBe(500);
    expect(headers[DB_STAGE_HEADER.toLowerCase()]).toBeUndefined();
  });

  it('omits headers when route pathname is session', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({ routePathname: '/api/v1/session', requestId: 'req_session' });
    logDbRuntimeStageFailure(new Error('x'), 'DB_MODULE_NOT_FOUND');

    const response = mapOwnerTaskRouteError(new Error('unexpected'));
    const headers = readHeaders(response);

    expect(headers[DB_STAGE_HEADER.toLowerCase()]).toBeUndefined();
  });

  it('does not leak stage state between concurrent request contexts', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';

    const [left, right] = await Promise.all([
      Promise.resolve().then(() =>
        runWithDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'left' }, () => {
          logDbRuntimeStageFailure(new Error('left'), 'DB_MODULE_NOT_FOUND');
          return readHeaders(mapOwnerTaskRouteError(new Error('left')));
        }),
      ),
      Promise.resolve().then(() =>
        runWithDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'right' }, () => {
          logDbRuntimeStageFailure(new Error('right'), 'DB_EXPORTS_MISSING');
          return readHeaders(mapOwnerTaskRouteError(new Error('right')));
        }),
      ),
    ]);

    expect(left[DB_CATEGORY_HEADER.toLowerCase()]).toBe('DB_MODULE_NOT_FOUND');
    expect(right[DB_CATEGORY_HEADER.toLowerCase()]).toBe('DB_EXPORTS_MISSING');
  });

  it('omits headers for unrecognized unsafe values', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({
      routePathname: '/api/v1/tasks',
      requestId: 'req_unsafe',
      lastStage: 'DB_RUNTIME_FAILURE',
      failureCategory: 'DB_MODULE_NOT_FOUND',
      errorName: 'postgresql://user:pass@host',
      prismaErrorCode: 'DROP TABLE',
      nodeErrorCode: 'findMany failed',
    });

    const headers = buildOwnerTaskDbDiagnosticHeaders() as Record<string, string>;
    expect(headers[DB_STAGE_HEADER]).toBe('DB_RUNTIME_FAILURE');
    expect(headers[DB_CATEGORY_HEADER]).toBe('DB_MODULE_NOT_FOUND');
    expect(headers[DB_ERROR_CLASS_HEADER]).toBeUndefined();
    expect(headers[DB_PRISMA_CODE_HEADER]).toBeUndefined();
    expect(headers[DB_NODE_CODE_HEADER]).toBeUndefined();
  });

  it('keeps stage logging non-throwing when diagnostics are enabled', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_log' });

    expect(() =>
      logDbRuntimeStageFailure(new Error('safe'), 'DB_MODULE_NOT_FOUND'),
    ).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('does not add headers to successful responses', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({
      routePathname: '/api/v1/tasks',
      requestId: 'req_ok',
      lastStage: 'PRISMA_QUERY_SUCCEEDED',
    });

    const response = attachOwnerTaskDbDiagnosticHeaders(
      NextResponse.json({ items: [], nextCursor: null }, { status: 200 }),
    );
    const headers = readHeaders(response);
    expect(headers[DB_STAGE_HEADER.toLowerCase()]).toBeUndefined();
  });

  it('updates request stage state even when diagnostics logging is disabled', () => {
    delete process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV];
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_state_only' });

    logDbRuntimeStageFailure(new Error('x'), 'DB_MODULE_LOAD_FAILED');

    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    const headers = buildOwnerTaskDbDiagnosticHeaders() as Record<string, string>;
    expect(headers[DB_STAGE_HEADER]).toBe('DB_RUNTIME_FAILURE');
    expect(headers[DB_CATEGORY_HEADER]).toBe('DB_MODULE_LOAD_FAILED');
  });
});
