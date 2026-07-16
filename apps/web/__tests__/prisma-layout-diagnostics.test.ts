// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@aicaa/db';
import { ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV } from '@/lib/db/diagnostics';
import {
  RHEL_ENGINE_FILENAME,
  classifyPrismaLayoutFailure,
  inspectPrismaGeneratedClientLayout,
} from '@/lib/db/prisma-layout-diagnostics';
import {
  runWithDbStageContext,
  setDbStageContext,
  resetDbStageContextForTests,
  updateDbStageContext,
} from '@/lib/db/stage-context';
import { logDbRuntimeStageFailure } from '@/lib/db/stage-diagnostics';
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
import { NextResponse } from 'next/server';
import { mapOwnerTaskRouteError, mapRecipientCapabilityRouteError } from '@/lib/http/errors';
import { TaskServiceError } from '@/lib/tasks/errors';

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

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetDbStageContextForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetDbStageContextForTests();
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
      engineFileReadable: true,
      schemaFileReadable: true,
    });
    assertSafe(JSON.stringify(result));
  });

  it('reports engine missing as ENGINE_NOT_FOUND', () => {
    const dir = makeTempClientDir({ engine: false });
    const result = inspectPrismaGeneratedClientLayout(undefined, dir);

    expect(result.prismaEngineAdjacent).toBe(false);
    expect(result.prismaExpectedEngineTarget).toBe('UNKNOWN');
    expect(result.prismaFailureClass).toBe('ENGINE_NOT_FOUND');
  });

  it('reports schema missing as SCHEMA_NOT_FOUND', () => {
    const dir = makeTempClientDir({ schema: false });
    const result = inspectPrismaGeneratedClientLayout(undefined, dir);

    expect(result.prismaSchemaAdjacent).toBe(false);
    expect(result.prismaFailureClass).toBe('SCHEMA_NOT_FOUND');
  });

  it('reports runtime/library.js missing as GENERATED_CLIENT_RUNTIME_MISSING', () => {
    const dir = makeTempClientDir({ library: false });
    const result = inspectPrismaGeneratedClientLayout(undefined, dir);

    expect(result.prismaRuntimeLibraryPresent).toBe(false);
    expect(result.prismaFailureClass).toBe('GENERATED_CLIENT_RUNTIME_MISSING');
  });

  it('reports generated package.json missing without changing failure class when other artifacts exist', () => {
    const dir = makeTempClientDir({ packageJson: false });
    const result = inspectPrismaGeneratedClientLayout(
      { message: 'unrelated mystery failure' },
      dir,
    );

    expect(result.prismaGeneratedPackagePresent).toBe(false);
    expect(result.prismaClientIndexPresent).toBe(true);
    expect(result.prismaFailureClass).toBe('UNKNOWN');
  });

  it('maps known engine-not-found message to ENGINE_NOT_FOUND without exposing text', () => {
    const dir = makeTempClientDir();
    const message =
      'PrismaClientInitializationError: Could not locate the Query Engine for runtime rhel-openssl-3.0.x';
    const result = inspectPrismaGeneratedClientLayout({ message }, dir);

    expect(result.prismaFailureClass).toBe('ENGINE_NOT_FOUND');
    assertSafe(JSON.stringify(result));
    expect(JSON.stringify(result)).not.toContain('Could not locate');
  });

  it('maps known dlopen/shared-library pattern to ENGINE_LOAD_FAILED', () => {
    const dir = makeTempClientDir();
    const error = Object.assign(new Error('dlopen failed: cannot open shared object file'), {
      code: 'ERR_DLOPEN_FAILED',
    });
    const result = inspectPrismaGeneratedClientLayout(error, dir);

    expect(result.prismaFailureClass).toBe('ENGINE_LOAD_FAILED');
    assertSafe(JSON.stringify(result));
  });

  it('maps unknown message to UNKNOWN', () => {
    const dir = makeTempClientDir();
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
    const result = inspectPrismaGeneratedClientLayout(toxic, dir);
    expect(result.generatedClientDirectoryResolved).toBe(true);
    assertSafe(JSON.stringify(result));
  });

  it('attaches allowlisted layout headers on owner-task 500 when diagnostics enabled', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_layout' });

    const dir = makeTempClientDir({ engine: false });
    const layout = inspectPrismaGeneratedClientLayout(
      new Prisma.PrismaClientInitializationError('init', '6.19.3'),
      dir,
    );
    updateDbStageContext({ ...layout });
    logDbRuntimeStageFailure(
      new Prisma.PrismaClientInitializationError('init', '6.19.3'),
      'PRISMA_ENGINE_OR_CLIENT_LOAD',
    );

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

  it('omits new layout headers when diagnostics are disabled', async () => {
    delete process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV];
    setDbStageContext({
      routePathname: '/api/v1/tasks',
      requestId: 'req_off',
      lastStage: 'DB_RUNTIME_FAILURE',
      failureCategory: 'PRISMA_ENGINE_OR_CLIENT_LOAD',
      prismaFailureClass: 'ENGINE_NOT_FOUND',
      prismaClientIndexPresent: true,
      prismaSchemaAdjacent: true,
      prismaEngineAdjacent: false,
      prismaRuntimeLibraryPresent: true,
      prismaGeneratedPackagePresent: true,
      prismaExpectedEngineTarget: 'UNKNOWN',
    });

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
    const headers = readHeaders(response);
    expect(headers[DB_PRISMA_FAILURE_HEADER.toLowerCase()]).toBeUndefined();
    expect(headers[DB_STAGE_HEADER.toLowerCase()]).toBeUndefined();
  });

  it('omits layout headers on 4xx responses', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({
      routePathname: '/api/v1/tasks',
      requestId: 'req_4xx',
      lastStage: 'DB_RUNTIME_FAILURE',
      failureCategory: 'PRISMA_ENGINE_OR_CLIENT_LOAD',
      prismaFailureClass: 'ENGINE_NOT_FOUND',
      prismaClientIndexPresent: true,
      prismaSchemaAdjacent: true,
      prismaEngineAdjacent: false,
      prismaRuntimeLibraryPresent: true,
      prismaGeneratedPackagePresent: true,
      prismaExpectedEngineTarget: 'UNKNOWN',
    });

    const response = mapOwnerTaskRouteError(new TaskServiceError('NOT_FOUND', 'Task not found.'));
    const headers = readHeaders(response);
    expect(response.status).toBe(404);
    expect(headers[DB_PRISMA_FAILURE_HEADER.toLowerCase()]).toBeUndefined();
  });

  it('omits layout headers on recipient and session routes', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';

    setDbStageContext({
      routePathname: '/api/v1/session',
      requestId: 'req_session',
      lastStage: 'DB_RUNTIME_FAILURE',
      failureCategory: 'PRISMA_ENGINE_OR_CLIENT_LOAD',
      prismaFailureClass: 'ENGINE_NOT_FOUND',
      prismaClientIndexPresent: true,
      prismaSchemaAdjacent: true,
      prismaEngineAdjacent: false,
      prismaRuntimeLibraryPresent: true,
      prismaGeneratedPackagePresent: true,
      prismaExpectedEngineTarget: 'UNKNOWN',
    });
    expect(
      readHeaders(mapOwnerTaskRouteError(new Error('x')))[DB_PRISMA_FAILURE_HEADER.toLowerCase()],
    ).toBeUndefined();

    setDbStageContext({
      routePathname: '/api/v1/capabilities/tok/tasks/t1',
      requestId: 'req_cap',
      lastStage: 'DB_RUNTIME_FAILURE',
      failureCategory: 'PRISMA_ENGINE_OR_CLIENT_LOAD',
      prismaFailureClass: 'ENGINE_NOT_FOUND',
      prismaClientIndexPresent: true,
      prismaSchemaAdjacent: true,
      prismaEngineAdjacent: false,
      prismaRuntimeLibraryPresent: true,
      prismaGeneratedPackagePresent: true,
      prismaExpectedEngineTarget: 'UNKNOWN',
    });
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
          logDbRuntimeStageFailure(new Error('left'), 'PRISMA_ENGINE_OR_CLIENT_LOAD');
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
          logDbRuntimeStageFailure(new Error('right'), 'PRISMA_ENGINE_OR_CLIENT_LOAD');
          return readHeaders(mapOwnerTaskRouteError(new Error('right')));
        }),
      ),
    ]);

    expect(left[DB_PRISMA_FAILURE_HEADER.toLowerCase()]).toBe('ENGINE_NOT_FOUND');
    expect(left[DB_PRISMA_ENGINE_HEADER.toLowerCase()]).toBe('missing');
    expect(right[DB_PRISMA_FAILURE_HEADER.toLowerCase()]).toBe('SCHEMA_NOT_FOUND');
    expect(right[DB_PRISMA_SCHEMA_HEADER.toLowerCase()]).toBe('missing');
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
    expect(headers[DB_PRISMA_TARGET_HEADER]).toBe('RHEL_OPENSSL_3');
  });
});
