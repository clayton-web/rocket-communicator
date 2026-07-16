// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@aicaa/db';
import * as aicaaDb from '@aicaa/db/runtime';
import { ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV } from '@/lib/db/diagnostics';
import {
  RHEL_ENGINE_FILENAME,
  capturePrismaLayoutFailureDiagnostics,
  classifyPrismaLayoutFailure,
  inspectPrismaGeneratedClientLayout,
  shouldCapturePrismaLayoutDiagnostics,
} from '@/lib/db/prisma-layout-diagnostics';
import {
  getDbStageContext,
  runWithDbStageContext,
  setDbStageContext,
  resetDbStageContextForTests,
  updateDbStageContext,
} from '@/lib/db/stage-context';
import { logDbRuntimeStage, logDbRuntimeStageFailure } from '@/lib/db/stage-diagnostics';
import {
  DB_CATEGORY_HEADER,
  DB_PRISMA_CLIENT_INDEX_HEADER,
  DB_PRISMA_ENGINE_HEADER,
  DB_PRISMA_FAILURE_HEADER,
  DB_PRISMA_LIBRARY_HEADER,
  DB_PRISMA_PACKAGE_HEADER,
  DB_PRISMA_SCHEMA_HEADER,
  DB_PRISMA_TARGET_HEADER,
  DB_STAGE_HEADER,
  attachOwnerTaskDbDiagnosticHeaders,
  buildOwnerTaskDbDiagnosticHeaders,
} from '@/lib/db/stage-response-headers';
import { getDb, setDbForTests } from '@/lib/db/server';
import { resetDbRuntimeForTests, setDbRuntimeForTests } from '@/lib/db/runtime-db';
import {
  resetLastResolvedTracedRuntimePathForTests,
  setLastResolvedTracedRuntimePath,
} from '@/lib/db/traced-runtime-path';
import { NextResponse } from 'next/server';
import { mapOwnerTaskRouteError, mapRecipientCapabilityRouteError } from '@/lib/http/errors';
import { TaskServiceError } from '@/lib/tasks/errors';
import { listTasksFromDb } from '@/lib/tasks/internal';

const FORBIDDEN_FRAGMENTS = [
  'postgresql://',
  'password',
  'packages/db',
  'node_modules',
  '@aicaa/db',
  'findMany',
  'tokenHash',
  'pepper',
  'DATABASE_URL',
  '/var/task',
  'libquery_engine',
  'schema.prisma',
  'could not locate',
  'ERR_DLOPEN_FAILED',
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

function assertSafe(serialized: string) {
  const lower = serialized.toLowerCase();
  for (const fragment of FORBIDDEN_FRAGMENTS) {
    expect(lower).not.toContain(fragment.toLowerCase());
  }
}

function writeArtifactTree(
  root: string,
  artifacts: {
    index?: boolean;
    schema?: boolean;
    engine?: boolean;
    library?: boolean;
    packageJson?: boolean;
  },
) {
  fs.mkdirSync(root, { recursive: true });
  if (artifacts.index !== false) {
    fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = {}');
  }
  if (artifacts.schema !== false) {
    fs.writeFileSync(path.join(root, 'schema.prisma'), 'generator client {}');
  }
  if (artifacts.engine !== false) {
    fs.writeFileSync(path.join(root, RHEL_ENGINE_FILENAME), 'engine');
  }
  if (artifacts.library !== false) {
    fs.mkdirSync(path.join(root, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(root, 'runtime', 'library.js'), 'module.exports = {}');
  }
  if (artifacts.packageJson !== false) {
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"@prisma/client"}');
  }
}

describe('prisma layout diagnostics probe', () => {
  const originalEnv = { ...process.env };
  let tempRoots: string[] = [];

  function makeTempClientDir(artifacts: Parameters<typeof writeArtifactTree>[1] = {}): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-layout-'));
    tempRoots.push(root);
    writeArtifactTree(root, artifacts);
    return root;
  }

  function installTracedLayout(artifacts: Parameters<typeof writeArtifactTree>[1] = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-traced-'));
    tempRoots.push(root);
    const runtimePath = path.join(root, 'runtime.js');
    fs.writeFileSync(runtimePath, 'export {}');
    const clientDir = path.join(root, 'generated', 'client');
    writeArtifactTree(clientDir, artifacts);
    setLastResolvedTracedRuntimePath(runtimePath);
    return { root, runtimePath, clientDir };
  }

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetDbStageContextForTests();
    resetDbRuntimeForTests();
    resetLastResolvedTracedRuntimePathForTests();
    setDbForTests(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetDbStageContextForTests();
    resetDbRuntimeForTests();
    resetLastResolvedTracedRuntimePathForTests();
    setDbForTests(undefined);
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots = [];
    vi.clearAllMocks();
  });

  it('reports all five artifacts present', () => {
    const dir = makeTempClientDir();
    const result = inspectPrismaGeneratedClientLayout(undefined, dir);
    expect(result).toMatchObject({
      prismaClientIndexPresent: true,
      prismaSchemaAdjacent: true,
      prismaEngineAdjacent: true,
      prismaRuntimeLibraryPresent: true,
      prismaGeneratedPackagePresent: true,
      prismaExpectedEngineTarget: 'RHEL_OPENSSL_3',
      generatedClientDirectoryResolved: true,
    });
    assertSafe(JSON.stringify(result));
  });

  it('reports engine/schema/library/package missing booleans correctly', () => {
    expect(
      inspectPrismaGeneratedClientLayout(undefined, makeTempClientDir({ engine: false })),
    ).toMatchObject({ prismaEngineAdjacent: false, prismaFailureClass: 'ENGINE_NOT_FOUND' });
    expect(
      inspectPrismaGeneratedClientLayout(undefined, makeTempClientDir({ schema: false })),
    ).toMatchObject({ prismaSchemaAdjacent: false, prismaFailureClass: 'SCHEMA_NOT_FOUND' });
    expect(
      inspectPrismaGeneratedClientLayout(undefined, makeTempClientDir({ library: false })),
    ).toMatchObject({
      prismaRuntimeLibraryPresent: false,
      prismaFailureClass: 'GENERATED_CLIENT_RUNTIME_MISSING',
    });
    expect(
      inspectPrismaGeneratedClientLayout(undefined, makeTempClientDir({ packageJson: false }))
        .prismaGeneratedPackagePresent,
    ).toBe(false);
  });

  it('maps known engine-not-found and dlopen patterns without exposing text', () => {
    const dir = makeTempClientDir();
    const notFound = inspectPrismaGeneratedClientLayout(
      { message: 'Could not locate the Query Engine for runtime rhel-openssl-3.0.x' },
      dir,
    );
    expect(notFound.prismaFailureClass).toBe('ENGINE_NOT_FOUND');
    assertSafe(JSON.stringify(notFound));

    const loadFailed = inspectPrismaGeneratedClientLayout(
      Object.assign(new Error('cannot open shared object file'), { code: 'ERR_DLOPEN_FAILED' }),
      dir,
    );
    expect(loadFailed.prismaFailureClass).toBe('ENGINE_LOAD_FAILED');
    assertSafe(JSON.stringify(loadFailed));
  });

  it('maps unknown message to UNKNOWN', () => {
    expect(
      classifyPrismaLayoutFailure(
        { message: 'something completely unexpected happened' },
        {
          generatedClientDirectoryResolved: true,
          prismaClientIndexPresent: true,
          prismaSchemaAdjacent: true,
          prismaEngineAdjacent: true,
          prismaRuntimeLibraryPresent: true,
        },
      ),
    ).toBe('UNKNOWN');
  });

  it('survives throwing getters and proxies', () => {
    const dir = makeTempClientDir();
    const toxic = new Proxy(
      {},
      {
        get() {
          throw new Error('proxy boom with postgresql://user:pass@host/db');
        },
      },
    );
    expect(() => inspectPrismaGeneratedClientLayout(toxic, dir)).not.toThrow();
    expect(() => capturePrismaLayoutFailureDiagnostics(toxic)).not.toThrow();
  });

  it('getDb construction failure captures layout fields via logDbRuntimeStageFailure', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/app';
    installTracedLayout({ engine: false });
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_ctor' });

    const initError = new Prisma.PrismaClientInitializationError('init', '6.19.3');
    setDbRuntimeForTests({
      ...aicaaDb,
      createPrismaClient: () => {
        throw initError;
      },
    });

    await expect(getDb()).rejects.toBe(initError);
    const ctx = getDbStageContext();
    expect(ctx?.prismaFailureClass).toBe('ENGINE_NOT_FOUND');
    expect(ctx?.prismaEngineAdjacent).toBe(false);
    expect(ctx?.prismaClientIndexPresent).toBe(true);

    const headers = readHeaders(mapOwnerTaskRouteError(initError));
    expect(headers[DB_PRISMA_FAILURE_HEADER.toLowerCase()]).toBe('ENGINE_NOT_FOUND');
    expect(headers[DB_PRISMA_ENGINE_HEADER.toLowerCase()]).toBe('missing');
    assertSafe(JSON.stringify(headers));
  });

  it('query-time PrismaClientInitializationError captures layout after PRISMA_QUERY_START clear', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/app';
    installTracedLayout({ engine: false });
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_query' });

    updateDbStageContext({
      prismaFailureClass: 'OTHER',
      prismaClientIndexPresent: false,
      prismaEngineAdjacent: true,
    });
    logDbRuntimeStage('PRISMA_QUERY_START', { queryOperation: 'listTasks' });
    expect(getDbStageContext()?.prismaFailureClass).toBeUndefined();

    const initError = new Prisma.PrismaClientInitializationError(
      'Could not locate the Query Engine',
      '6.19.3',
    );
    const listTasks = vi.fn(async () => {
      throw initError;
    });
    setDbRuntimeForTests({ ...aicaaDb, listTasks });
    setDbForTests({} as never);

    await expect(listTasksFromDb({} as never, { organizationId: 'org_x' as never })).rejects.toBe(
      initError,
    );

    const ctx = getDbStageContext();
    expect(ctx?.lastStage).toBe('DB_RUNTIME_FAILURE');
    expect(ctx?.failureCategory).toBe('PRISMA_ENGINE_OR_CLIENT_LOAD');
    expect(ctx?.prismaFailureClass).toBe('ENGINE_NOT_FOUND');
    expect(ctx?.prismaEngineAdjacent).toBe(false);

    const response = mapOwnerTaskRouteError(initError);
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
    expect(headers[DB_CATEGORY_HEADER.toLowerCase()]).toBe('PRISMA_ENGINE_OR_CLIENT_LOAD');
    expect(headers[DB_PRISMA_CLIENT_INDEX_HEADER.toLowerCase()]).toBe('present');
    expect(headers[DB_PRISMA_SCHEMA_HEADER.toLowerCase()]).toBe('adjacent');
    expect(headers[DB_PRISMA_ENGINE_HEADER.toLowerCase()]).toBe('missing');
    expect(headers[DB_PRISMA_LIBRARY_HEADER.toLowerCase()]).toBe('present');
    expect(headers[DB_PRISMA_PACKAGE_HEADER.toLowerCase()]).toBe('present');
    expect(headers[DB_PRISMA_TARGET_HEADER.toLowerCase()]).toBe('UNKNOWN');
    expect(headers[DB_PRISMA_FAILURE_HEADER.toLowerCase()]).toBe('ENGINE_NOT_FOUND');
    assertSafe(JSON.stringify(headers));
    assertSafe(JSON.stringify(body));
  });

  it('maps query-time engine-load failure to ENGINE_LOAD_FAILED', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    installTracedLayout();
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_dlopen' });
    logDbRuntimeStage('PRISMA_QUERY_START', { queryOperation: 'listTasks' });

    const error = Object.assign(new Error('dlopen failed'), {
      name: 'PrismaClientInitializationError',
      code: 'ERR_DLOPEN_FAILED',
      clientVersion: '6.19.3',
    });
    logDbRuntimeStageFailure(error, 'PRISMA_ENGINE_OR_CLIENT_LOAD', {
      queryOperation: 'listTasks',
    });

    expect(getDbStageContext()?.prismaFailureClass).toBe('ENGINE_LOAD_FAILED');
    const headers = readHeaders(mapOwnerTaskRouteError(error));
    expect(headers[DB_PRISMA_FAILURE_HEADER.toLowerCase()]).toBe('ENGINE_LOAD_FAILED');
    expect(JSON.stringify(headers)).not.toContain('cannot open shared object');
    expect(JSON.stringify(headers)).not.toContain('postgresql://');
  });

  it('does not trigger layout inspection for non-Prisma query errors', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    installTracedLayout({ engine: false });
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_non_prisma' });

    expect(shouldCapturePrismaLayoutDiagnostics(new Error('x'), 'DATABASE_QUERY_FAILED')).toBe(
      false,
    );
    expect(
      shouldCapturePrismaLayoutDiagnostics(new TaskServiceError('NOT_FOUND', 'x'), undefined),
    ).toBe(false);

    const queryError = Object.assign(new Error('hidden'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      clientVersion: '6.19.3',
    });
    logDbRuntimeStageFailure(queryError, 'DATABASE_QUERY_FAILED', {
      queryOperation: 'listTasks',
    });
    expect(getDbStageContext()?.prismaFailureClass).toBeUndefined();
    expect(getDbStageContext()?.prismaEngineAdjacent).toBeUndefined();
  });

  it('preserves TaskServiceError responses without layout headers', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    installTracedLayout({ engine: false });
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_task' });
    logDbRuntimeStageFailure(
      new Prisma.PrismaClientInitializationError('init', '6.19.3'),
      'PRISMA_ENGINE_OR_CLIENT_LOAD',
    );

    const response = mapOwnerTaskRouteError(new TaskServiceError('NOT_FOUND', 'Task not found.'));
    expect(response.status).toBe(404);
    expect(readHeaders(response)[DB_PRISMA_FAILURE_HEADER.toLowerCase()]).toBeUndefined();
  });

  it('omits layout headers when diagnostics are disabled', async () => {
    delete process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV];
    installTracedLayout({ engine: false });
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_off' });
    logDbRuntimeStageFailure(
      new Prisma.PrismaClientInitializationError('init', '6.19.3'),
      'PRISMA_ENGINE_OR_CLIENT_LOAD',
    );

    const response = mapOwnerTaskRouteError(new Error('unexpected'));
    const headers = readHeaders(response);
    expect(headers[DB_PRISMA_FAILURE_HEADER.toLowerCase()]).toBeUndefined();
    expect(headers[DB_STAGE_HEADER.toLowerCase()]).toBeUndefined();
  });

  it('omits layout headers on HTTP 200', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({
      routePathname: '/api/v1/tasks',
      requestId: 'req_ok',
      lastStage: 'PRISMA_QUERY_SUCCEEDED',
      prismaFailureClass: 'ENGINE_NOT_FOUND',
      prismaClientIndexPresent: true,
    });

    const response = attachOwnerTaskDbDiagnosticHeaders(
      NextResponse.json({ items: [], nextCursor: null }, { status: 200 }),
    );
    expect(readHeaders(response)[DB_PRISMA_FAILURE_HEADER.toLowerCase()]).toBeUndefined();
  });

  it('omits layout headers on recipient and session routes', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    installTracedLayout({ engine: false });

    setDbStageContext({ routePathname: '/api/v1/session', requestId: 'req_session' });
    logDbRuntimeStageFailure(
      new Prisma.PrismaClientInitializationError('init', '6.19.3'),
      'PRISMA_ENGINE_OR_CLIENT_LOAD',
    );
    expect(
      readHeaders(mapOwnerTaskRouteError(new Error('x')))[DB_PRISMA_FAILURE_HEADER.toLowerCase()],
    ).toBeUndefined();

    setDbStageContext({
      routePathname: '/api/v1/capabilities/tok/tasks/t1',
      requestId: 'req_cap',
    });
    logDbRuntimeStageFailure(
      new Prisma.PrismaClientInitializationError('init', '6.19.3'),
      'PRISMA_ENGINE_OR_CLIENT_LOAD',
    );
    expect(
      readHeaders(mapRecipientCapabilityRouteError(new Error('x')))[
        DB_PRISMA_FAILURE_HEADER.toLowerCase()
      ],
    ).toBeUndefined();
  });

  it('does not leak layout state between concurrent AsyncLocalStorage contexts', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';

    const [left, right] = await Promise.all([
      Promise.resolve().then(() =>
        runWithDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'left' }, () => {
          updateDbStageContext({
            prismaFailureClass: 'ENGINE_NOT_FOUND',
            prismaClientIndexPresent: true,
            prismaSchemaAdjacent: true,
            prismaEngineAdjacent: false,
            prismaRuntimeLibraryPresent: true,
            prismaGeneratedPackagePresent: true,
            prismaExpectedEngineTarget: 'UNKNOWN',
          });
          // Non-capture category preserves ALS-local layout fields.
          logDbRuntimeStageFailure(new Error('left'), 'DATABASE_QUERY_FAILED');
          return readHeaders(mapOwnerTaskRouteError(new Error('left')));
        }),
      ),
      Promise.resolve().then(() =>
        runWithDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'right' }, () => {
          updateDbStageContext({
            prismaFailureClass: 'SCHEMA_NOT_FOUND',
            prismaClientIndexPresent: true,
            prismaSchemaAdjacent: false,
            prismaEngineAdjacent: true,
            prismaRuntimeLibraryPresent: true,
            prismaGeneratedPackagePresent: true,
            prismaExpectedEngineTarget: 'RHEL_OPENSSL_3',
          });
          logDbRuntimeStageFailure(new Error('right'), 'DATABASE_QUERY_FAILED');
          return readHeaders(mapOwnerTaskRouteError(new Error('right')));
        }),
      ),
    ]);

    expect(left[DB_PRISMA_FAILURE_HEADER.toLowerCase()]).toBe('ENGINE_NOT_FOUND');
    expect(left[DB_PRISMA_ENGINE_HEADER.toLowerCase()]).toBe('missing');
    expect(right[DB_PRISMA_FAILURE_HEADER.toLowerCase()]).toBe('SCHEMA_NOT_FOUND');
    expect(right[DB_PRISMA_SCHEMA_HEADER.toLowerCase()]).toBe('missing');
  });

  it('probe/filesystem failure cannot alter the public response or original error', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_fs' });
    setLastResolvedTracedRuntimePath('/nonexistent/runtime.js');

    const error = new Prisma.PrismaClientInitializationError('init', '6.19.3');
    expect(() => logDbRuntimeStageFailure(error, 'PRISMA_ENGINE_OR_CLIENT_LOAD')).not.toThrow();

    const response = mapOwnerTaskRouteError(error);
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred.');
    expect(error.name).toBe('PrismaClientInitializationError');
  });

  it('keeps buildOwnerTaskDbDiagnosticHeaders free of raw paths and messages', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({
      routePathname: '/api/v1/tasks',
      requestId: 'req_safe',
      lastStage: 'DB_RUNTIME_FAILURE',
      failureCategory: 'PRISMA_ENGINE_OR_CLIENT_LOAD',
      errorName: 'PrismaClientInitializationError',
      prismaFailureClass: 'ENGINE_LOAD_FAILED',
      prismaClientIndexPresent: true,
      prismaSchemaAdjacent: true,
      prismaEngineAdjacent: true,
      prismaRuntimeLibraryPresent: true,
      prismaGeneratedPackagePresent: true,
      prismaExpectedEngineTarget: 'RHEL_OPENSSL_3',
    });

    const headers = buildOwnerTaskDbDiagnosticHeaders() as Record<string, string>;
    assertSafe(JSON.stringify(headers));
    expect(headers[DB_PRISMA_FAILURE_HEADER]).toBe('ENGINE_LOAD_FAILED');
  });
});
