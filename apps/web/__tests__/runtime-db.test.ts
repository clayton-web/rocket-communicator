// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as aicaaDb from '@aicaa/db/runtime';
import { resolveTracedRuntimePath } from '@/lib/db/db-runtime-entry';
import {
  DbRuntimeConfigurationError,
  loadDbRuntime,
  resetDbRuntimeForTests,
  setDbRuntimeForTests,
} from '@/lib/db/runtime-db';
import { getDb, setDbForTests } from '@/lib/db/server';

describe('db runtime loader', () => {
  beforeEach(() => {
    resetDbRuntimeForTests();
    setDbForTests(undefined);
  });

  afterEach(() => {
    resetDbRuntimeForTests();
    setDbForTests(undefined);
  });

  it('loads @aicaa/db/runtime through the injected test runtime', () => {
    setDbRuntimeForTests(aicaaDb);
    const runtime = loadDbRuntime();
    expect(typeof runtime.createPrismaClient).toBe('function');
    expect(typeof runtime.listTasks).toBe('function');
  });

  it('caches the loaded module', () => {
    setDbRuntimeForTests(aicaaDb);
    const first = loadDbRuntime();
    const second = loadDbRuntime();
    expect(first).toBe(second);
  });

  it('throws DbRuntimeConfigurationError when a required export is missing', () => {
    expect(() => setDbRuntimeForTests({ createPrismaClient: undefined } as never)).toThrow(
      DbRuntimeConfigurationError,
    );
  });

  it('invokes runtime-loaded createPrismaClient from getDb()', () => {
    const fakeClient = { kind: 'test-db' } as never;
    const createPrismaClient = vi.fn(() => fakeClient);
    setDbRuntimeForTests({
      ...aicaaDb,
      createPrismaClient,
    });

    expect(getDb()).toBe(fakeClient);
    expect(createPrismaClient).toHaveBeenCalledTimes(1);
  });

  it('keeps setDbForTests injection without calling createPrismaClient', () => {
    const injected = { injected: true } as never;
    setDbForTests(injected);

    expect(getDb()).toBe(injected);
  });

  it('exposes the same createPrismaClient export as @aicaa/db/runtime in integration mode', () => {
    setDbRuntimeForTests(aicaaDb);
    expect(loadDbRuntime().createPrismaClient).toBe(aicaaDb.createPrismaClient);
  });

  it('loads traced runtime through the production bridge entry', () => {
    const runtime = loadDbRuntime();
    expect(typeof runtime.createPrismaClient).toBe('function');
    expect(typeof runtime.listTasks).toBe('function');
    expect(typeof runtime.persistWorkRequest).toBe('function');
  });

  it('resolves traced runtime.js from the bridge module location', () => {
    const bridgePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../lib/db/db-runtime-entry.ts',
    );
    const resolved = resolveTracedRuntimePath(`file://${bridgePath}`);
    expect(resolved.replace(/\\/g, '/')).toMatch(/packages\/db\/dist\/runtime\.js$/);
  });

  it('does not use package-name require for production runtime loading', () => {
    const runtimeDbPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../lib/db/runtime-db.ts');
    const bridgePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../lib/db/db-runtime-entry.ts');
    const runtimeSource = fs.readFileSync(runtimeDbPath, 'utf8');
    const bridgeSource = fs.readFileSync(bridgePath, 'utf8');

    expect(runtimeSource).not.toMatch(/from ['"]@aicaa\/db\/runtime['"]/);
    expect(runtimeSource).not.toMatch(/require\(['"]@aicaa\/db\/runtime['"]\)/);
    expect(runtimeSource).not.toMatch(/createRequire/);
    expect(bridgeSource).toContain('packages/db/dist/runtime.js');
    expect(bridgeSource).toContain('createRequire');
    expect(bridgeSource).not.toMatch(/from ['"]@aicaa\/db\/runtime['"]/);
    expect(bridgeSource).not.toMatch(/require\(['"]@aicaa\/db\/runtime['"]\)/);
    expect(bridgeSource).not.toMatch(/export \* from/);
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
