// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as aicaaDb from '@aicaa/db/runtime';
import { ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV } from '@/lib/db/diagnostics';
import {
  classifyPrismaConnectProbeResult,
  type PrismaConnectProbeResult,
} from '@/lib/db/prisma-connect-probe';
import { resetDbRuntimeForTests, setDbRuntimeForTests } from '@/lib/db/runtime-db';
import {
  getDb,
  resetDbClientForTests,
  setDbForTests,
} from '@/lib/db/server';
import {
  getDbStageContext,
  resetDbStageContextForTests,
  setDbStageContext,
} from '@/lib/db/stage-context';
import {
  DB_PRISMA_CONNECT_PROBE_HEADER,
  DB_PRISMA_FAILURE_HEADER,
  attachOwnerTaskDbDiagnosticHeaders,
  buildOwnerTaskDbDiagnosticHeaders,
} from '@/lib/db/stage-response-headers';
import { mapOwnerTaskRouteError, mapRecipientCapabilityRouteError } from '@/lib/http/errors';
import { NextResponse } from 'next/server';

const FORBIDDEN_FRAGMENTS = [
  'postgresql://',
  'password',
  'secret',
  'packages/db',
  'node_modules',
  'findMany',
  'Could not',
  ' at ',
  'DATABASE_URL',
  'db.example.com',
];

function prismaInitError(errorCode?: string, message = 'hidden init detail'): Error {
  return Object.assign(new Error(message), {
    name: 'PrismaClientInitializationError',
    ...(errorCode ? { errorCode } : {}),
    clientVersion: '6.19.3',
  });
}

function assertSafe(serialized: string) {
  const lower = serialized.toLowerCase();
  for (const fragment of FORBIDDEN_FRAGMENTS) {
    expect(lower).not.toContain(fragment.toLowerCase());
  }
}

describe('classifyPrismaConnectProbeResult', () => {
  const cases: Array<{ error: unknown; expected: PrismaConnectProbeResult }> = [
    { error: prismaInitError('P1001'), expected: 'REACHED_NETWORK_P1001' },
    { error: prismaInitError('P1000'), expected: 'DATABASE_AUTH_P1000' },
    { error: prismaInitError('P1011'), expected: 'DATABASE_TLS_P1011' },
    { error: prismaInitError('P1012'), expected: 'DATASOURCE_P1012' },
    { error: prismaInitError('P1013'), expected: 'DATASOURCE_P1013' },
    { error: prismaInitError('P1014'), expected: 'OTHER_CODED_INIT' },
    { error: prismaInitError(undefined), expected: 'NO_CODE_INIT' },
    {
      error: Object.assign(prismaInitError(undefined), {
        cause: Object.assign(new Error('x'), { code: 'MODULE_NOT_FOUND' }),
      }),
      expected: 'NODE_CODE_ONLY',
    },
    {
      error: Object.assign(new Error('plain'), { code: 'ECONNREFUSED' }),
      expected: 'NODE_CODE_ONLY',
    },
    { error: new Error('plain failure'), expected: 'NON_PRISMA_ERROR' },
  ];

  for (const { error, expected } of cases) {
    it(`classifies as ${expected}`, () => {
      expect(classifyPrismaConnectProbeResult(error)).toBe(expected);
    });
  }

  it('never classifies from raw message text', () => {
    const error = Object.assign(new Error('P1001 unreachable host db.example.com'), {
      name: 'PrismaClientInitializationError',
    });
    expect(classifyPrismaConnectProbeResult(error)).toBe('NO_CODE_INIT');
  });
});

describe('getDb $connect probe singleton', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    process.env.DATABASE_URL = 'postgresql://user:secret@db.example.com:5432/app';
    resetDbRuntimeForTests();
    resetDbClientForTests();
    resetDbStageContextForTests();
    setDbStageContext({ routePathname: '/api/v1/tasks', requestId: 'req_probe' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetDbRuntimeForTests();
    resetDbClientForTests();
    resetDbStageContextForTests();
    vi.restoreAllMocks();
  });

  it('returns singleton client after successful $connect', async () => {
    const fakeClient = { kind: 'test-db', $connect: vi.fn(async () => undefined) };
    const createPrismaClient = vi.fn(() => fakeClient);
    setDbRuntimeForTests({ ...aicaaDb, createPrismaClient });

    const first = await getDb();
    const second = await getDb();

    expect(first).toBe(fakeClient);
    expect(second).toBe(fakeClient);
    expect(createPrismaClient).toHaveBeenCalledTimes(1);
    expect(fakeClient.$connect).toHaveBeenCalledTimes(1);
    expect(getDbStageContext()?.prismaConnectProbeResult).toBe('SUCCESS');
  });

  it('shares one construction/connect attempt across concurrent getDb calls', async () => {
    let releaseConnect!: () => void;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    const $connect = vi.fn(() => connectGate);
    const fakeClient = { kind: 'shared', $connect };
    const createPrismaClient = vi.fn(() => fakeClient);
    setDbRuntimeForTests({ ...aicaaDb, createPrismaClient });

    const pending = Promise.all([getDb(), getDb(), getDb()]);
    await Promise.resolve();
    expect(createPrismaClient).toHaveBeenCalledTimes(1);
    expect($connect).toHaveBeenCalledTimes(1);

    releaseConnect();
    const [a, b, c] = await pending;
    expect(a).toBe(fakeClient);
    expect(b).toBe(fakeClient);
    expect(c).toBe(fakeClient);
    expect(createPrismaClient).toHaveBeenCalledTimes(1);
  });

  it('rethrows the original error object unchanged for coded connect failures', async () => {
    const initError = prismaInitError('P1001', 'secret unreachable host detail');
    const fakeClient = {
      $connect: vi.fn(async () => {
        throw initError;
      }),
    };
    setDbRuntimeForTests({
      ...aicaaDb,
      createPrismaClient: () => fakeClient as never,
    });

    await expect(getDb()).rejects.toBe(initError);
    expect(getDbStageContext()?.prismaConnectProbeResult).toBe('REACHED_NETWORK_P1001');
    expect(getDbStageContext()?.lastStage).toBe('PRISMA_CONNECT_PROBE_FAILED');
  });

  it('clears shared init promise after failure so a later call may retry', async () => {
    const initError = prismaInitError('P1001');
    const $connect = vi
      .fn()
      .mockRejectedValueOnce(initError)
      .mockResolvedValueOnce(undefined);
    const fakeClient = { kind: 'retry', $connect };
    const createPrismaClient = vi.fn(() => fakeClient);
    setDbRuntimeForTests({ ...aicaaDb, createPrismaClient });

    await expect(getDb()).rejects.toBe(initError);
    await expect(getDb()).resolves.toBe(fakeClient);
    expect(createPrismaClient).toHaveBeenCalledTimes(2);
    expect($connect).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['P1000', 'DATABASE_AUTH_P1000'],
    ['P1011', 'DATABASE_TLS_P1011'],
    ['P1012', 'DATASOURCE_P1012'],
    ['P1013', 'DATASOURCE_P1013'],
    ['P1999', 'OTHER_CODED_INIT'],
  ] as const)('maps $connect %s to %s', async (code, expected) => {
    const initError = prismaInitError(code);
    setDbRuntimeForTests({
      ...aicaaDb,
      createPrismaClient: () =>
        ({
          $connect: async () => {
            throw initError;
          },
        }) as never,
    });

    await expect(getDb()).rejects.toBe(initError);
    expect(getDbStageContext()?.prismaConnectProbeResult).toBe(expected);
  });

  it('maps no-code PrismaClientInitializationError to NO_CODE_INIT', async () => {
    const initError = prismaInitError(undefined);
    setDbRuntimeForTests({
      ...aicaaDb,
      createPrismaClient: () =>
        ({
          $connect: async () => {
            throw initError;
          },
        }) as never,
    });

    await expect(getDb()).rejects.toBe(initError);
    expect(getDbStageContext()?.prismaConnectProbeResult).toBe('NO_CODE_INIT');
  });

  it('maps node-code-only errors to NODE_CODE_ONLY', async () => {
    const err = Object.assign(new Error('hidden'), { code: 'MODULE_NOT_FOUND' });
    setDbRuntimeForTests({
      ...aicaaDb,
      createPrismaClient: () =>
        ({
          $connect: async () => {
            throw err;
          },
        }) as never,
    });

    await expect(getDb()).rejects.toBe(err);
    expect(getDbStageContext()?.prismaConnectProbeResult).toBe('NODE_CODE_ONLY');
  });

  it('maps non-Prisma errors to NON_PRISMA_ERROR', async () => {
    const err = new Error('plain');
    setDbRuntimeForTests({
      ...aicaaDb,
      createPrismaClient: () =>
        ({
          $connect: async () => {
            throw err;
          },
        }) as never,
    });

    await expect(getDb()).rejects.toBe(err);
    expect(getDbStageContext()?.prismaConnectProbeResult).toBe('NON_PRISMA_ERROR');
  });

  it('bypasses connect probe when setDbForTests injects a client', async () => {
    const injected = { injected: true } as never;
    setDbForTests(injected);
    await expect(getDb()).resolves.toBe(injected);
  });
});

describe('X-AICAA-DB-Prisma-Connect-Probe header gating', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetDbStageContextForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetDbStageContextForTests();
  });

  it('exposes allowlisted probe header on Owner-task 500 when diagnostics enabled', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({
      routePathname: '/api/v1/tasks',
      requestId: 'req_hdr',
      lastStage: 'PRISMA_CONNECT_PROBE_FAILED',
      failureCategory: 'PRISMA_ENGINE_OR_CLIENT_LOAD',
      errorName: 'PrismaClientInitializationError',
      prismaErrorCode: 'P1001',
      prismaConnectProbeResult: 'REACHED_NETWORK_P1001',
      prismaFailureClass: 'OTHER',
      prismaClientIndexPresent: true,
      prismaEngineAdjacent: true,
      prismaSchemaAdjacent: true,
      prismaRuntimeLibraryPresent: true,
      prismaGeneratedPackagePresent: true,
      prismaExpectedEngineTarget: 'RHEL_OPENSSL_3',
      prismaEngineIdentity: 'MATCHES_CI_ENGINE',
    });

    const response = mapOwnerTaskRouteError(prismaInitError('P1001'));
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    expect(response.status).toBe(500);
    expect(headers[DB_PRISMA_CONNECT_PROBE_HEADER.toLowerCase()]).toBe('REACHED_NETWORK_P1001');
    expect(headers[DB_PRISMA_FAILURE_HEADER.toLowerCase()]).toBe('OTHER');
    assertSafe(JSON.stringify(headers));
  });

  it('does not expose probe header when diagnostics are off', () => {
    delete process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV];
    setDbStageContext({
      routePathname: '/api/v1/tasks',
      lastStage: 'PRISMA_CONNECT_PROBE_FAILED',
      prismaConnectProbeResult: 'REACHED_NETWORK_P1001',
    });

    expect(buildOwnerTaskDbDiagnosticHeaders()).toBeUndefined();
  });

  it('does not expose probe header on session route context', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({
      routePathname: '/api/v1/session',
      lastStage: 'PRISMA_CONNECT_PROBE_FAILED',
      prismaConnectProbeResult: 'REACHED_NETWORK_P1001',
    });

    expect(buildOwnerTaskDbDiagnosticHeaders()).toBeUndefined();
  });

  it('does not expose probe header on Recipient capability errors', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({
      routePathname: '/api/v1/tasks',
      lastStage: 'PRISMA_CONNECT_PROBE_FAILED',
      prismaConnectProbeResult: 'REACHED_NETWORK_P1001',
    });

    const response = mapRecipientCapabilityRouteError(new Error('x'));
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    expect(headers[DB_PRISMA_CONNECT_PROBE_HEADER.toLowerCase()]).toBeUndefined();
  });

  it('does not expose probe header on 4xx responses', () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({
      routePathname: '/api/v1/tasks',
      lastStage: 'PRISMA_CONNECT_PROBE_FAILED',
      prismaConnectProbeResult: 'REACHED_NETWORK_P1001',
    });

    const response = attachOwnerTaskDbDiagnosticHeaders(
      NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'x' } } as never, {
        status: 401,
      }),
    );
    expect(response.headers.get(DB_PRISMA_CONNECT_PROBE_HEADER)).toBeNull();
  });

  it('keeps public JSON body/status unchanged when probe header is attached', async () => {
    process.env[ENABLE_DB_RUNTIME_DIAGNOSTICS_ENV] = 'true';
    setDbStageContext({
      routePathname: '/api/v1/tasks',
      lastStage: 'PRISMA_CONNECT_PROBE_FAILED',
      prismaConnectProbeResult: 'NO_CODE_INIT',
      failureCategory: 'PRISMA_ENGINE_OR_CLIENT_LOAD',
      errorName: 'PrismaClientInitializationError',
    });

    const response = mapOwnerTaskRouteError(prismaInitError());
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
});
