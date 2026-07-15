// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOrganizationId, asOwnerId, ownerActor } from '@aicaa/domain';
import {
  ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV,
  isDatabaseRuntimeDiagnosticsEnabled,
} from '@/lib/db/diagnostics';
import {
  DB_RUNTIME_STAGE_EVENT,
  classifyDbModuleRequireFailure,
  classifyDbRuntimeStageFailure,
  logDbRuntimeStage,
  logDbRuntimeStageFailure,
} from '@/lib/db/stage-diagnostics';
import { getDb, setDbForTests } from '@/lib/db/server';
import {
  DbRuntimeConfigurationError,
  loadDbRuntime,
  resetDbRuntimeForTests,
  setDbRuntimeForTests,
} from '@/lib/db/runtime-db';
import { setDbStageContext, resetDbStageContextForTests } from '@/lib/db/stage-context';
import { listTasksFromDb } from '@/lib/tasks/internal';
import { mapOwnerTaskRouteError } from '@/lib/http/errors';
import { clearDbTestRuntime } from './helpers/db-test-runtime';
import * as aicaaDb from '@aicaa/db/runtime';
import { createTestDatabase } from '@aicaa/db/testing';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
  requireOwnerSession: vi.fn(),
}));

import { getAuthenticatedOwner, requireOwnerSession } from '@/lib/auth/require-owner';
import { GET as listTasksRoute } from '@/app/api/v1/tasks/route';
import { GET as sessionRoute } from '@/app/api/v1/session/route';

const FORBIDDEN_LOG_FRAGMENTS = [
  'postgresql://',
  'password',
  'tokenHash',
  'pepper',
  '"stack"',
  'at Object.',
  'DATABASE_URL is required',
  'packages/db',
  'node_modules',
  '@aicaa/db',
  'findMany',
  'select ',
];

const owner = ownerActor(asOwnerId('owner_stage'), asOrganizationId('org_stage'));

function parseStageLogs(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
  return spy.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.includes(DB_RUNTIME_STAGE_EVENT))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function findStageLog(
  spy: ReturnType<typeof vi.spyOn>,
  stage: string,
): Record<string, unknown> {
  const payload = parseStageLogs(spy).find((entry) => entry.stage === stage);
  expect(payload).toBeDefined();
  return payload!;
}

function assertSafeStageLog(payload: Record<string, unknown>) {
  const serialized = JSON.stringify(payload);
  const lower = serialized.toLowerCase();
  for (const fragment of FORBIDDEN_LOG_FRAGMENTS) {
    expect(lower).not.toContain(fragment.toLowerCase());
  }
  expect(serialized).not.toMatch(/\n\s+at /);
}

describe('db runtime stage diagnostics', () => {
  const originalEnv = { ...process.env };
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env = { ...originalEnv };
    delete process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV];
    resetDbRuntimeForTests();
    resetDbStageContextForTests();
    setDbForTests(undefined);
    clearDbTestRuntime();
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_stage_test' });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    process.env = { ...originalEnv };
    resetDbRuntimeForTests();
    resetDbStageContextForTests();
    setDbForTests(undefined);
    clearDbTestRuntime();
    vi.clearAllMocks();
  });

  it('does not log stages when ENABLE_DB_RUNTIME_DIAGNOSTICS is unset', () => {
    logDbRuntimeStage('DB_RUNTIME_LOAD_START');
    expect(isDatabaseRuntimeDiagnosticsEnabled()).toBe(false);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('logs each success stage only when ENABLE_DB_RUNTIME_DIAGNOSTICS=true', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';

    const stages = [
      'DB_RUNTIME_LOAD_START',
      'DB_RUNTIME_MODULE_LOADED',
      'DB_RUNTIME_EXPORTS_VALIDATED',
      'PRISMA_CLIENT_CONSTRUCTION_START',
      'PRISMA_CLIENT_CONSTRUCTED',
      'PRISMA_QUERY_START',
      'PRISMA_QUERY_SUCCEEDED',
    ] as const;

    for (const stage of stages) {
      consoleErrorSpy.mockClear();
      logDbRuntimeStage(stage, {
        moduleLoaded: stage.includes('MODULE') || stage.includes('EXPORTS'),
        exportsValidated: stage.includes('EXPORTS'),
        queryOperation: stage.includes('QUERY') ? 'listTasks' : undefined,
      });
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const payload = findStageLog(consoleErrorSpy, stage);
      expect(payload.event).toBe(DB_RUNTIME_STAGE_EVENT);
      expect(payload.stage).toBe(stage);
      expect(payload.routePathname).toBe('/api/v1/tasks');
      expect(payload.requestId).toBe('req_stage_test');
      assertSafeStageLog(payload);
    }
  });

  it('never throws when logging stages or failures', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';

    const throwingGetter = {
      get name() {
        throw new Error('getter');
      },
    };

    expect(() => logDbRuntimeStage('PRISMA_QUERY_START')).not.toThrow();
    expect(() => logDbRuntimeStageFailure(throwingGetter, 'UNKNOWN_DATABASE_ERROR')).not.toThrow();
    expect(() =>
      logDbRuntimeStageFailure(new Proxy({}, { get: () => { throw new Error('proxy'); } }), 'UNKNOWN_DATABASE_ERROR'),
    ).not.toThrow();
  });

  it('distinguishes MODULE_NOT_FOUND from other require failures', () => {
    const notFound = { name: 'Error', code: 'MODULE_NOT_FOUND' };
    const other = { name: 'Error', code: 'ERR_REQUIRE_ESM' };

    expect(classifyDbModuleRequireFailure(notFound)).toBe('DB_MODULE_NOT_FOUND');
    expect(classifyDbModuleRequireFailure(other)).toBe('DB_MODULE_LOAD_FAILED');
    expect(classifyDbModuleRequireFailure('string')).toBe('DB_MODULE_LOAD_FAILED');
  });

  it('logs DB_MODULE_NOT_FOUND and DB_EXPORTS_MISSING as distinct failure categories', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';

    logDbRuntimeStageFailure({ name: 'Error', code: 'MODULE_NOT_FOUND' }, 'DB_MODULE_NOT_FOUND', {
      moduleLoaded: false,
      exportsValidated: false,
    });
    const modulePayload = findStageLog(consoleErrorSpy, 'DB_RUNTIME_FAILURE');
    expect(modulePayload.category).toBe('DB_MODULE_NOT_FOUND');
    assertSafeStageLog(modulePayload);

    consoleErrorSpy.mockClear();
    logDbRuntimeStageFailure(new DbRuntimeConfigurationError(), 'DB_EXPORTS_MISSING', {
      moduleLoaded: true,
      exportsValidated: false,
    });
    const exportPayload = findStageLog(consoleErrorSpy, 'DB_RUNTIME_FAILURE');
    expect(exportPayload.category).toBe('DB_EXPORTS_MISSING');
    expect(exportPayload.moduleLoaded).toBe(true);
    expect(exportPayload.exportsValidated).toBe(false);
    assertSafeStageLog(exportPayload);
  });

  it('distinguishes Prisma construction failures from query failures', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db.example.com:5432/app';
    const initError = {
      name: 'PrismaClientInitializationError',
      errorCode: 'P1001',
      clientVersion: '6.19.3',
    };
    const queryError = {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      clientVersion: '6.19.3',
    };

    expect(classifyDbRuntimeStageFailure(initError)).toBe('DATABASE_UNREACHABLE');
    expect(classifyDbRuntimeStageFailure(queryError)).toBe('DATABASE_QUERY_FAILED');
  });

  it('preserves generic JSON 500 envelope for unknown errors', () => {
    const response = mapOwnerTaskRouteError('unexpected');
    expect(response.status).toBe(500);
    return response.json().then((body) => {
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('An unexpected error occurred.');
      expect(body.error.requestId).toBeTruthy();
    });
  });

  it('does not emit stage diagnostics from session route', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    vi.mocked(requireOwnerSession).mockResolvedValue({
      ownerId: owner.ownerId,
      organizationId: owner.organizationId,
      role: 'owner',
      displayName: 'Owner',
    });

    await sessionRoute();
    const stageLogs = consoleErrorSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes(DB_RUNTIME_STAGE_EVENT));
    expect(stageLogs).toHaveLength(0);
  });

  it('emits query stages during injected PGlite list without production Prisma', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    const db = await createTestDatabase();
    clearDbTestRuntime();
    setDbRuntimeForTests(aicaaDb);
    setDbForTests(db.prisma);

    await listTasksFromDb(db.prisma, { organizationId: owner.organizationId, limit: 5 });

    const stageLogs = consoleErrorSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes(DB_RUNTIME_STAGE_EVENT))
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(stageLogs.some((entry) => entry.stage === 'PRISMA_QUERY_START')).toBe(true);
    expect(stageLogs.some((entry) => entry.stage === 'PRISMA_QUERY_SUCCEEDED')).toBe(true);
    expect(stageLogs.some((entry) => entry.stage === 'PRISMA_CLIENT_CONSTRUCTION_START')).toBe(
      false,
    );
    for (const entry of stageLogs) {
      assertSafeStageLog(entry);
    }
  });

  it('logs construction failure at getDb without mutating thrown error type', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    process.env.DATABASE_URL = 'postgresql://user:secret@db.example.com:5432/app';

    const initError = Object.assign(new Error('hidden'), {
      name: 'PrismaClientInitializationError',
      errorCode: 'P1001',
    });
    const createPrismaClient = vi.fn(() => {
      throw initError;
    });
    setDbRuntimeForTests({ ...aicaaDb, createPrismaClient });

    await expect(getDb()).rejects.toThrow(initError);
    const payload = findStageLog(consoleErrorSpy, 'DB_RUNTIME_FAILURE');
    expect(payload.stage).toBe('DB_RUNTIME_FAILURE');
    expect(payload.category).toBe('DATABASE_UNREACHABLE');
    expect(payload.errorName).toBe('PrismaClientInitializationError');
    assertSafeStageLog(payload);
  });

  it('logs query failure from listTasksFromDb with DATABASE_QUERY_FAILED', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    process.env.DATABASE_URL = 'postgresql://user:pass@db.example.com:5432/app';
    const queryError = Object.assign(new Error('hidden'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    });
    const listTasks = vi.fn(async () => {
      throw queryError;
    });
    setDbRuntimeForTests({ ...aicaaDb, listTasks });
    setDbForTests({} as never);

    await expect(
      listTasksFromDb({} as never, { organizationId: owner.organizationId }),
    ).rejects.toBe(queryError);

    const payload = findStageLog(consoleErrorSpy, 'DB_RUNTIME_FAILURE');
    expect(payload.stage).toBe('DB_RUNTIME_FAILURE');
    expect(payload.category).toBe('DATABASE_QUERY_FAILED');
    expect(payload.queryOperation).toBe('listTasks');
    assertSafeStageLog(payload);
  });

  it('keeps owner task route JSON 500 when getDb fails under diagnostics', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
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
    resetDbRuntimeForTests();
    setDbForTests(undefined);
    setDbRuntimeForTests({
      ...aicaaDb,
      createPrismaClient: () => {
        throw new DbRuntimeConfigurationError();
      },
    });

    const response = await listTasksRoute(new Request('http://localhost/api/v1/tasks'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred.');
    expect(body.error.requestId).toBeTruthy();
  });
});

describe('db runtime loader stage integration', () => {
  const originalEnv = { ...process.env };
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env = { ...originalEnv };
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    resetDbRuntimeForTests();
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_loader' });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    process.env = { ...originalEnv };
    resetDbRuntimeForTests();
    resetDbStageContextForTests();
  });

  it('logs export validation failure before throwing DbRuntimeConfigurationError', () => {
    expect(() =>
      setDbRuntimeForTests({
        createPrismaClient: undefined,
      } as never),
    ).toThrow(DbRuntimeConfigurationError);
  });
});
