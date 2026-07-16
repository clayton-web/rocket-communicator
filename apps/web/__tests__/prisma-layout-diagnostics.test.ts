// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@aicaa/db';
import * as aicaaDb from '@aicaa/db/runtime';
import { ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV } from '@/lib/db/diagnostics';
import {
  EXPECTED_CI_ENGINE_BYTE_LENGTH,
  EXPECTED_CI_ENGINE_SHA256,
  RHEL_ENGINE_FILENAME,
  capturePrismaLayoutFailureDiagnostics,
  classifyPrismaLayoutFailure,
  inspectPrismaEngineIdentity,
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
  DB_PRISMA_ENGINE_ARCH_HEADER,
  DB_PRISMA_ENGINE_BYTES_HEADER,
  DB_PRISMA_ENGINE_ELF_HEADER,
  DB_PRISMA_ENGINE_EXECUTABLE_HEADER,
  DB_PRISMA_ENGINE_HEADER,
  DB_PRISMA_ENGINE_IDENTITY_HEADER,
  DB_PRISMA_ENGINE_READABLE_HEADER,
  DB_PRISMA_ENGINE_SHA256_HEADER,
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
  'cannot open shared object',
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

const CI_ENGINE_SOURCE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/dist/generated/client',
  RHEL_ENGINE_FILENAME,
);

function writeMinimalElf64(eMachine: number): Buffer {
  const buf = Buffer.alloc(64, 0);
  buf[0] = 0x7f;
  buf[1] = 0x45;
  buf[2] = 0x4c;
  buf[3] = 0x46;
  buf[4] = 2; // ELFCLASS64
  buf[5] = 1; // ELFDATA2LSB
  buf[6] = 1; // EV_CURRENT
  buf.writeUInt16LE(eMachine, 18);
  return buf;
}

function writeArtifactTree(
  root: string,
  artifacts: {
    index?: boolean;
    schema?: boolean;
    engine?: boolean;
    library?: boolean;
    packageJson?: boolean;
    engineBytes?: Buffer | string;
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
    const enginePath = path.join(root, RHEL_ENGINE_FILENAME);
    if (artifacts.engineBytes !== undefined) {
      fs.writeFileSync(enginePath, artifacts.engineBytes);
    } else {
      fs.writeFileSync(enginePath, 'engine');
    }
    try {
      fs.chmodSync(enginePath, 0o755);
    } catch {
      // Best-effort mode for fixtures.
    }
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
    expect(loadFailed.prismaFailureClass).toBe('ENGINE_DLOPEN_FAILED');
    assertSafe(JSON.stringify(loadFailed));
  });

  it('maps fine-grained message categories without exposing text', () => {
    const layout = {
      generatedClientDirectoryResolved: true,
      prismaClientIndexPresent: true,
      prismaSchemaAdjacent: true,
      prismaEngineAdjacent: true,
      prismaRuntimeLibraryPresent: true,
    };
    const cases: Array<{ message?: string; code?: string; expected: string }> = [
      { message: 'dlopen failed loading engine', expected: 'ENGINE_DLOPEN_FAILED' },
      { message: 'libssl.so.3: cannot open shared object', expected: 'OPENSSL_LIBRARY_MISSING' },
      { message: 'version `GLIBC_2.34` not found', expected: 'GLIBC_INCOMPATIBLE' },
      { message: 'invalid ELF header', expected: 'ELF_ARCHITECTURE_MISMATCH' },
      {
        message: 'Module did not self-register',
        expected: 'NATIVE_MODULE_REGISTRATION_FAILED',
      },
      { code: 'EACCES', message: 'permission denied', expected: 'ENGINE_PERMISSION_DENIED' },
      { message: 'engine file truncated', expected: 'ENGINE_FILE_TRUNCATED' },
      { message: 'checksum verification failed', expected: 'ENGINE_CHECKSUM_MISMATCH' },
      { message: 'thread panicked at query engine', expected: 'QUERY_ENGINE_PANIC' },
      {
        message: 'Error validating datasource `db`: the URL must start with',
        expected: 'DATASOURCE_CONFIGURATION',
      },
    ];
    for (const c of cases) {
      expect(
        classifyPrismaLayoutFailure(
          { message: c.message, code: c.code },
          layout,
        ),
      ).toBe(c.expected);
    }
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

  it('classifies known CI engine bytes as MATCHES_CI_ENGINE', () => {
    expect(fs.existsSync(CI_ENGINE_SOURCE)).toBe(true);
    const dir = makeTempClientDir({
      engineBytes: fs.readFileSync(CI_ENGINE_SOURCE),
    });
    const result = inspectPrismaGeneratedClientLayout(undefined, dir);
    expect(result.prismaEngineByteLength).toBe(EXPECTED_CI_ENGINE_BYTE_LENGTH);
    expect(result.prismaEngineSha256).toBe(EXPECTED_CI_ENGINE_SHA256);
    expect(result.prismaEngineElfClass).toBe('ELF64');
    expect(result.prismaEngineArchitecture).toBe('X86_64');
    expect(result.prismaEngineIdentity).toBe('MATCHES_CI_ENGINE');
    assertSafe(JSON.stringify(result));
  });

  it('classifies same-size altered bytes as HASH_MISMATCH', () => {
    const bytes = Buffer.from(fs.readFileSync(CI_ENGINE_SOURCE));
    bytes[bytes.length - 1] ^= 0xff;
    const dir = makeTempClientDir({ engineBytes: bytes });
    const result = inspectPrismaGeneratedClientLayout(undefined, dir);
    expect(result.prismaEngineByteLength).toBe(EXPECTED_CI_ENGINE_BYTE_LENGTH);
    expect(result.prismaEngineSha256).not.toBe(EXPECTED_CI_ENGINE_SHA256);
    expect(result.prismaEngineIdentity).toBe('HASH_MISMATCH');
    assertSafe(JSON.stringify(result));
  });

  it('classifies truncated engine as SIZE_MISMATCH', () => {
    const bytes = fs.readFileSync(CI_ENGINE_SOURCE).subarray(0, 4096);
    const dir = makeTempClientDir({ engineBytes: bytes });
    const result = inspectPrismaGeneratedClientLayout(undefined, dir);
    expect(result.prismaEngineByteLength).toBe(4096);
    expect(result.prismaEngineIdentity).toBe('SIZE_MISMATCH');
    assertSafe(JSON.stringify(result));
  });

  it('classifies invalid ELF as INVALID_ELF', () => {
    const dir = makeTempClientDir({ engineBytes: Buffer.from('not-an-elf-file') });
    const result = inspectPrismaGeneratedClientLayout(undefined, dir);
    expect(result.prismaEngineElfMagicValid).toBe(false);
    expect(result.prismaEngineIdentity).toBe('INVALID_ELF');
    assertSafe(JSON.stringify(result));
  });

  it('classifies wrong-architecture ELF64 as WRONG_ARCHITECTURE', () => {
    const dir = makeTempClientDir({ engineBytes: writeMinimalElf64(3) }); // EM_386
    const result = inspectPrismaGeneratedClientLayout(undefined, dir);
    expect(result.prismaEngineElfMagicValid).toBe(true);
    expect(result.prismaEngineElfClass).toBe('ELF64');
    expect(result.prismaEngineArchitecture).toBe('OTHER');
    expect(result.prismaEngineIdentity).toBe('WRONG_ARCHITECTURE');
    assertSafe(JSON.stringify(result));
  });

  it('classifies unreadable engine as UNREADABLE without throwing', () => {
    const dir = makeTempClientDir();
    const enginePath = path.join(dir, RHEL_ENGINE_FILENAME);
    fs.chmodSync(enginePath, 0o000);
    expect(() => inspectPrismaEngineIdentity(enginePath)).not.toThrow();
    const result = inspectPrismaGeneratedClientLayout(undefined, dir);
    expect(result.prismaEngineReadable).toBe(false);
    expect(result.prismaEngineIdentity).toBe('UNREADABLE');
    try {
      fs.chmodSync(enginePath, 0o755);
    } catch {
      // restore best-effort for cleanup
    }
    assertSafe(JSON.stringify(result));
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

  it('maps query-time engine-load failure to ENGINE_DLOPEN_FAILED and preserves identity fields', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    installTracedLayout({
      engineBytes: fs.readFileSync(CI_ENGINE_SOURCE),
    });
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

    const ctx = getDbStageContext();
    expect(ctx?.prismaFailureClass).toBe('ENGINE_DLOPEN_FAILED');
    expect(ctx?.prismaEngineIdentity).toBe('MATCHES_CI_ENGINE');
    expect(ctx?.prismaEngineByteLength).toBe(EXPECTED_CI_ENGINE_BYTE_LENGTH);
    expect(ctx?.prismaEngineSha256).toBe(EXPECTED_CI_ENGINE_SHA256);

    const headers = readHeaders(mapOwnerTaskRouteError(error));
    expect(headers[DB_PRISMA_FAILURE_HEADER.toLowerCase()]).toBe('ENGINE_DLOPEN_FAILED');
    expect(headers[DB_PRISMA_ENGINE_IDENTITY_HEADER.toLowerCase()]).toBe('MATCHES_CI_ENGINE');
    expect(headers[DB_PRISMA_ENGINE_BYTES_HEADER.toLowerCase()]).toBe(
      String(EXPECTED_CI_ENGINE_BYTE_LENGTH),
    );
    expect(headers[DB_PRISMA_ENGINE_SHA256_HEADER.toLowerCase()]).toBe(EXPECTED_CI_ENGINE_SHA256);
    expect(headers[DB_PRISMA_ENGINE_READABLE_HEADER.toLowerCase()]).toBe('true');
    expect(headers[DB_PRISMA_ENGINE_EXECUTABLE_HEADER.toLowerCase()]).toBe('true');
    expect(headers[DB_PRISMA_ENGINE_ELF_HEADER.toLowerCase()]).toBe('ELF64');
    expect(headers[DB_PRISMA_ENGINE_ARCH_HEADER.toLowerCase()]).toBe('X86_64');
    expect(JSON.stringify(headers)).not.toContain('cannot open shared object');
    expect(JSON.stringify(headers)).not.toContain('postgresql://');
    assertSafe(JSON.stringify(headers));
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
      prismaFailureClass: 'ENGINE_DLOPEN_FAILED',
      prismaClientIndexPresent: true,
      prismaSchemaAdjacent: true,
      prismaEngineAdjacent: true,
      prismaRuntimeLibraryPresent: true,
      prismaGeneratedPackagePresent: true,
      prismaExpectedEngineTarget: 'RHEL_OPENSSL_3',
      prismaEngineByteLength: EXPECTED_CI_ENGINE_BYTE_LENGTH,
      prismaEngineSha256: EXPECTED_CI_ENGINE_SHA256,
      prismaEngineReadable: true,
      prismaEngineExecutable: true,
      prismaEngineElfClass: 'ELF64',
      prismaEngineArchitecture: 'X86_64',
      prismaEngineIdentity: 'MATCHES_CI_ENGINE',
    });

    const headers = buildOwnerTaskDbDiagnosticHeaders() as Record<string, string>;
    assertSafe(JSON.stringify(headers));
    expect(headers[DB_PRISMA_FAILURE_HEADER]).toBe('ENGINE_DLOPEN_FAILED');
    expect(headers[DB_PRISMA_ENGINE_IDENTITY_HEADER]).toBe('MATCHES_CI_ENGINE');
    expect(headers[DB_PRISMA_ENGINE_SHA256_HEADER]).toBe(EXPECTED_CI_ENGINE_SHA256);
  });

  it('hashing/read failure cannot alter the public response body or status', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    const { clientDir } = installTracedLayout();
    const enginePath = path.join(clientDir, RHEL_ENGINE_FILENAME);
    fs.writeFileSync(enginePath, 'x');
    fs.chmodSync(enginePath, 0o000);
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_hash_fail' });

    const error = new Prisma.PrismaClientInitializationError('init', '6.19.3');
    expect(() => logDbRuntimeStageFailure(error, 'PRISMA_ENGINE_OR_CLIENT_LOAD')).not.toThrow();

    const response = mapOwnerTaskRouteError(error);
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
    try {
      fs.chmodSync(enginePath, 0o755);
    } catch {
      // cleanup best-effort
    }
  });

  it('omits engine-identity headers on 200, 4xx, session, recipient, and diagnostics-off', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({
      routePathname: '/api/v1/tasks',
      requestId: 'req_gate',
      lastStage: 'DB_RUNTIME_FAILURE',
      failureCategory: 'PRISMA_ENGINE_OR_CLIENT_LOAD',
      prismaFailureClass: 'UNKNOWN',
      prismaEngineIdentity: 'MATCHES_CI_ENGINE',
      prismaEngineSha256: EXPECTED_CI_ENGINE_SHA256,
      prismaEngineByteLength: EXPECTED_CI_ENGINE_BYTE_LENGTH,
      prismaEngineReadable: true,
      prismaEngineExecutable: true,
      prismaEngineElfClass: 'ELF64',
      prismaEngineArchitecture: 'X86_64',
    });

    const ok = attachOwnerTaskDbDiagnosticHeaders(
      NextResponse.json({ items: [] }, { status: 200 }),
    );
    expect(readHeaders(ok)[DB_PRISMA_ENGINE_IDENTITY_HEADER.toLowerCase()]).toBeUndefined();

    const fourxx = mapOwnerTaskRouteError(new TaskServiceError('NOT_FOUND', 'Task not found.'));
    expect(readHeaders(fourxx)[DB_PRISMA_ENGINE_IDENTITY_HEADER.toLowerCase()]).toBeUndefined();

    setDbStageContext({
      routePathname: '/api/v1/session',
      requestId: 'req_session_id',
      lastStage: 'DB_RUNTIME_FAILURE',
      failureCategory: 'PRISMA_ENGINE_OR_CLIENT_LOAD',
      prismaFailureClass: 'UNKNOWN',
      prismaEngineIdentity: 'MATCHES_CI_ENGINE',
    });
    expect(
      readHeaders(mapOwnerTaskRouteError(new Error('x')))[
        DB_PRISMA_ENGINE_IDENTITY_HEADER.toLowerCase()
      ],
    ).toBeUndefined();

    setDbStageContext({
      routePathname: '/api/v1/capabilities/tok/tasks/t1',
      requestId: 'req_cap_id',
      lastStage: 'DB_RUNTIME_FAILURE',
      failureCategory: 'PRISMA_ENGINE_OR_CLIENT_LOAD',
      prismaFailureClass: 'UNKNOWN',
      prismaEngineIdentity: 'MATCHES_CI_ENGINE',
    });
    expect(
      readHeaders(mapRecipientCapabilityRouteError(new Error('x')))[
        DB_PRISMA_ENGINE_IDENTITY_HEADER.toLowerCase()
      ],
    ).toBeUndefined();

    delete process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV];
    setDbStageContext({
      routePathname: '/api/v1/tasks',
      requestId: 'req_off_id',
      lastStage: 'DB_RUNTIME_FAILURE',
      failureCategory: 'PRISMA_ENGINE_OR_CLIENT_LOAD',
      prismaFailureClass: 'UNKNOWN',
      prismaEngineIdentity: 'MATCHES_CI_ENGINE',
    });
    expect(
      readHeaders(mapOwnerTaskRouteError(new Error('x')))[
        DB_PRISMA_ENGINE_IDENTITY_HEADER.toLowerCase()
      ],
    ).toBeUndefined();
  });
});
