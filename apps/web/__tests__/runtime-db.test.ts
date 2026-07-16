// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as aicaaDb from '@aicaa/db/runtime';
import {
  DB_RUNTIME_LITERAL_SPECIFIER,
  REQUIRED_RUNTIME_EXPORTS,
  simulateLambdaLayoutBridgeInit,
} from '../scripts/lib/db-package-trace.mjs';
import { loadTracedRuntimeModule } from '@/lib/db/db-runtime-entry';
import {
  DbRuntimeConfigurationError,
  loadDbRuntime,
  resetDbRuntimeForTests,
  setDbRuntimeForTests,
} from '@/lib/db/runtime-db';
import { getDb, setDbForTests } from '@/lib/db/server';
import { mapOwnerTaskRouteError } from '@/lib/http/errors';

describe('db runtime loader', () => {
  beforeEach(() => {
    resetDbRuntimeForTests();
    setDbForTests(undefined);
  });

  afterEach(() => {
    resetDbRuntimeForTests();
    setDbForTests(undefined);
    vi.restoreAllMocks();
  });

  it('loads @aicaa/db/runtime through the injected test runtime', async () => {
    setDbRuntimeForTests(aicaaDb);
    const runtime = await loadDbRuntime();
    expect(typeof runtime.createPrismaClient).toBe('function');
    expect(typeof runtime.listTasks).toBe('function');
  });

  it('caches the loaded module', async () => {
    setDbRuntimeForTests(aicaaDb);
    const first = await loadDbRuntime();
    const second = await loadDbRuntime();
    expect(first).toBe(second);
  });

  it('shares one import promise for concurrent loadDbRuntime calls', async () => {
    const importSpy = vi.spyOn(
      await import('@/lib/db/db-runtime-entry'),
      'loadTracedRuntimeModule',
    );
    importSpy.mockImplementation(async () => aicaaDb);

    const [first, second] = await Promise.all([loadDbRuntime(), loadDbRuntime()]);
    expect(first).toBe(second);
    expect(importSpy).toHaveBeenCalledTimes(1);
  });

  it('does not poison test injection after a failed import', async () => {
    const importSpy = vi.spyOn(
      await import('@/lib/db/db-runtime-entry'),
      'loadTracedRuntimeModule',
    );
    importSpy.mockRejectedValueOnce(new Error('bridge import failed'));

    await expect(loadDbRuntime()).rejects.toThrow(DbRuntimeConfigurationError);

    resetDbRuntimeForTests();
    setDbRuntimeForTests(aicaaDb);
    const runtime = await loadDbRuntime();
    expect(typeof runtime.createPrismaClient).toBe('function');
  });

  it('throws DbRuntimeConfigurationError when a required export is missing', () => {
    expect(() => setDbRuntimeForTests({ createPrismaClient: undefined } as never)).toThrow(
      DbRuntimeConfigurationError,
    );
  });

  it('invokes runtime-loaded createPrismaClient from getDb()', async () => {
    const fakeClient = { kind: 'test-db' } as never;
    const createPrismaClient = vi.fn(() => fakeClient);
    setDbRuntimeForTests({
      ...aicaaDb,
      createPrismaClient,
    });

    await expect(getDb()).resolves.toBe(fakeClient);
    expect(createPrismaClient).toHaveBeenCalledTimes(1);
  });

  it('keeps setDbForTests injection without calling createPrismaClient', async () => {
    const injected = { injected: true } as never;
    setDbForTests(injected);

    await expect(getDb()).resolves.toBe(injected);
  });

  it('exposes the same createPrismaClient export as @aicaa/db/runtime in integration mode', async () => {
    setDbRuntimeForTests(aicaaDb);
    const runtime = await loadDbRuntime();
    expect(runtime.createPrismaClient).toBe(aicaaDb.createPrismaClient);
  });

  it('loads traced runtime through the production bridge entry', () => {
    const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const repoRoot = path.resolve(webRoot, '../..');
    const nextDir = path.join(webRoot, '.next');
    if (!fs.existsSync(nextDir)) {
      return;
    }

    const result = simulateLambdaLayoutBridgeInit({
      webRoot,
      repoRoot,
      nftRelativePath: 'app/api/v1/tasks/route.js.nft.json',
    });
    expect(result.resolved.replace(/\\/g, '/')).toMatch(/packages\/db\/dist\/runtime\.js$/);
  });

  it('uses a literal static runtime specifier in the bridge layer', () => {
    const reexportsPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../lib/db/db-runtime-reexports.ts',
    );
    const bridgePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../lib/db/db-runtime-entry.ts',
    );
    const reexportsSource = fs.readFileSync(reexportsPath, 'utf8');
    const bridgeSource = fs.readFileSync(bridgePath, 'utf8');

    expect(reexportsSource).toContain(DB_RUNTIME_LITERAL_SPECIFIER);
    expect(reexportsSource).toContain(`from '${DB_RUNTIME_LITERAL_SPECIFIER}'`);
    expect(reexportsSource).not.toMatch(/import\(/);
    expect(reexportsSource).not.toMatch(/pathToFileURL/);
    expect(reexportsSource).not.toMatch(/createRequire/);
    expect(reexportsSource).not.toMatch(/process\.cwd\(/);
    expect(bridgeSource).toContain('./db-runtime-reexports');
    expect(bridgeSource).toContain('resolveTracedRuntimePath');
    expect(bridgeSource).toContain('importExternalModule');
    expect(bridgeSource).toContain('tracedRuntime.createPrismaClient');
    expect(bridgeSource).not.toMatch(/as \w+Export/);
    expect(bridgeSource).not.toMatch(/createPrismaClient:createPrismaClientExport/);
  });

  it('statically references all required runtime exports in the bridge layer', () => {
    const bridgePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../lib/db/db-runtime-entry.ts',
    );
    const reexportsPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../lib/db/db-runtime-reexports.ts',
    );
    const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
    const reexportsSource = fs.readFileSync(reexportsPath, 'utf8');

    for (const exportName of REQUIRED_RUNTIME_EXPORTS) {
      expect(reexportsSource).toContain(exportName);
      expect(bridgeSource).toContain(exportName);
    }
  });

  it('does not use package-name require for production runtime loading', () => {
    const runtimeDbPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../lib/db/runtime-db.ts',
    );
    const bridgePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../lib/db/db-runtime-entry.ts',
    );
    const reexportsPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../lib/db/db-runtime-reexports.ts',
    );
    const runtimeSource = fs.readFileSync(runtimeDbPath, 'utf8');
    const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
    const reexportsSource = fs.readFileSync(reexportsPath, 'utf8');

    expect(runtimeSource).not.toMatch(/from ['"]@aicaa\/db\/runtime['"]/);
    expect(runtimeSource).not.toMatch(/require\(['"]@aicaa\/db\/runtime['"]\)/);
    expect(runtimeSource).not.toMatch(/createRequire/);
    expect(runtimeSource).toContain('loadTracedRuntimeModule');
    expect(reexportsSource).toContain(DB_RUNTIME_LITERAL_SPECIFIER);
    expect(bridgeSource).toContain('loadTracedRuntimeModule');
    expect(bridgeSource).toContain('resolveTracedRuntimePath');
    expect(bridgeSource).toContain('importExternalModule');
    expect(bridgeSource).not.toMatch(/createRequire/);
    expect(bridgeSource).not.toMatch(/from ['"]@aicaa\/db\/runtime['"]/);
    expect(bridgeSource).not.toMatch(/require\(['"]@aicaa\/db\/runtime['"]\)/);
    expect(bridgeSource).not.toMatch(/export \* from/);
    expect(reexportsSource).not.toMatch(/export \* from/);
  });

  it('returns the contracted JSON error envelope for bridge-loading failure', () => {
    const response = mapOwnerTaskRouteError(new DbRuntimeConfigurationError());
    expect(response.status).toBe(500);
    return response.json().then((body) => {
      expect(body).toMatchObject({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
        },
      });
    });
  });
});

describe('session-only path isolation', () => {
  it('session route source does not reference db runtime loader', () => {
    const sessionRoutePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../app/api/v1/session/route.ts',
    );
    const source = fs.readFileSync(sessionRoutePath, 'utf8');
    expect(source).not.toMatch(/loadDbRuntime|getDb|@aicaa\/db/);
  });
});
