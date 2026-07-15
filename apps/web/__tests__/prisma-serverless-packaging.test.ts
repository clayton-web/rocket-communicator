// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DB_BACKED_ROUTE_NFTS,
  DB_RUNTIME_RELATIVE,
  PGLITE_MARKERS,
  RHEL_ENGINE,
  assertBuiltOutputUsesRuntimeBridge,
  assertNftIncludesDbPackageRuntime,
  getRequiredDbPackageRuntimeFiles,
  getRequiredDomainPackageRuntimeFiles,
  nftIncludesRepoFile,
  simulateRouteRuntimeRequire,
  walkDbPackageRuntimeJsFiles,
} from '../scripts/lib/db-package-trace.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(webRoot, '../..');
const schemaPath = path.join(repoRoot, 'packages/db/prisma/schema.prisma');
const nextConfigPath = path.join(webRoot, 'next.config.mjs');
const generatedClientDir = path.join(repoRoot, 'packages/db/dist/generated/client');
const verifyScriptPath = path.join(webRoot, 'scripts/verify-prisma-serverless-trace.mjs');
const verifyDbRuntimeScriptPath = path.join(webRoot, 'scripts/verify-db-runtime-resolution.mjs');
const verifyDbPackageRequirePath = path.join(webRoot, 'scripts/verify-db-package-require.mjs');
const tasksNftPath = path.join(webRoot, '.next/server/app/api/v1/tasks/route.js.nft.json');

const FORBIDDEN_TRACE_GLOBS = [
  '../../packages/db/**/*',
  '../../**/*',
];

describe('Prisma serverless packaging configuration', () => {
  it('declares native and rhel-openssl-3.0.x binary targets in schema.prisma', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    expect(schema).toMatch(/binaryTargets\s*=\s*\[[^\]]*"native"[^\]]*"rhel-openssl-3\.0\.x"/s);
    expect(schema).toContain('provider      = "prisma-client-js"');
    expect(schema).toContain('output        = "../src/generated/client"');
  });

  it('externalizes @aicaa/db and sets monorepo Prisma trace includes in next.config.mjs', () => {
    const config = fs.readFileSync(nextConfigPath, 'utf8');
    expect(config).toContain("serverExternalPackages: ['@aicaa/db']");
    expect(config).toContain("transpilePackages: ['@aicaa/domain']");
    expect(config).not.toMatch(/transpilePackages:\s*\[[^\]]*@aicaa\/db/);
    expect(config).toContain('outputFileTracingRoot');
    expect(config).toContain('outputFileTracingIncludes');
    expect(config).toContain('dbPackageRuntimeTraceFiles');
    expect(config).toContain('domainPackageRuntimeTraceFiles');
    expect(config).toContain('workspacePackageEntryTraceFiles');
    expect(config).toContain('dbPackageRoot');
    expect(config).toContain('${dbPackageRoot}/package.json');
    expect(config).toContain('${dbPackageRoot}/dist/**/*.js');
    expect(config).toContain('domainPackageRoot');
    expect(config).toContain('${domainPackageRoot}/package.json');
    expect(config).toContain('${domainPackageRoot}/dist/**/*.js');
    expect(config).toContain('node_modules/@aicaa/db/package.json');
    expect(config).toContain('node_modules/@aicaa/domain/package.json');
    expect(config).toContain('turbopack:');
    expect(config).toContain('root: monorepoRoot');
    expect(config).toContain(RHEL_ENGINE);
    expect(config).toContain('schema.prisma');
    expect(config).toContain("'/api/v1/tasks'");
    expect(config).toContain("'/api/v1/tasks/**/*'");
    expect(config).toContain("'/api/v1/capabilities/**/*'");
    expect(config).toContain("'/c/[token]'");
    expect(config).toContain("'/c/**/*'");
    expect(config).not.toContain("'/api/v1/session'");

    for (const forbidden of FORBIDDEN_TRACE_GLOBS) {
      expect(config).not.toContain(forbidden);
    }
  });

  it('includes the Linux engine in dist/generated/client after db build', () => {
    const rhelEnginePath = path.join(generatedClientDir, RHEL_ENGINE);
    const schemaArtifactPath = path.join(generatedClientDir, 'schema.prisma');
    expect(fs.existsSync(rhelEnginePath)).toBe(true);
    expect(fs.existsSync(schemaArtifactPath)).toBe(true);
  });

  it('computes the @aicaa/db runtime import graph from dist/runtime.js', () => {
    const runtimeJs = path.join(repoRoot, 'packages/db/dist/runtime.js');
    const graph = walkDbPackageRuntimeJsFiles(runtimeJs);
    expect(graph).toContain(runtimeJs);
    expect(graph.some((filePath) => filePath.endsWith('generated/client/index.js'))).toBe(true);
    expect(graph.some((filePath) => filePath.endsWith('generated/client/runtime/library.js'))).toBe(
      true,
    );
    expect(graph.some((filePath) => filePath.endsWith('client/create-prisma-client.js'))).toBe(true);
    expect(graph.some((filePath) => filePath.includes('create-test-database.js'))).toBe(false);
    for (const marker of PGLITE_MARKERS) {
      expect(graph.some((filePath) => filePath.includes(marker))).toBe(false);
    }
  });

  it('includes @aicaa/db runtime and domain package files in task-route NFT when .next output exists', () => {
    if (!fs.existsSync(tasksNftPath)) {
      return;
    }

    const nft = JSON.parse(fs.readFileSync(tasksNftPath, 'utf8')) as { files?: string[] };
    const files = Array.isArray(nft.files) ? nft.files : [];
    const required = getRequiredDbPackageRuntimeFiles(repoRoot);
    const domainRequired = getRequiredDomainPackageRuntimeFiles(repoRoot);

    expect(nftIncludesRepoFile(files, repoRoot, required.packageJson)).toBe(true);
    expect(nftIncludesRepoFile(files, repoRoot, required.runtimeJs)).toBe(true);
    expect(nftIncludesRepoFile(files, repoRoot, required.libraryJs)).toBe(true);
    expect(nftIncludesRepoFile(files, repoRoot, required.rhelEngine)).toBe(true);
    expect(nftIncludesRepoFile(files, repoRoot, required.schema)).toBe(true);
    expect(nftIncludesRepoFile(files, repoRoot, domainRequired.packageJson)).toBe(true);
    expect(nftIncludesRepoFile(files, repoRoot, domainRequired.indexJs)).toBe(true);

    for (const jsFile of required.importGraphJs) {
      expect(nftIncludesRepoFile(files, repoRoot, jsFile)).toBe(true);
    }

    for (const jsFile of domainRequired.importGraphJs) {
      expect(nftIncludesRepoFile(files, repoRoot, jsFile)).toBe(true);
    }

    assertNftIncludesDbPackageRuntime(files, repoRoot, 'task route');
  });

  it('resolves traced packages/db runtime from simulated task-route layout without workspace symlinks when built', () => {
    if (!fs.existsSync(tasksNftPath)) {
      return;
    }

    const result = simulateRouteRuntimeRequire({
      webRoot,
      repoRoot,
      nftRelativePath: 'app/api/v1/tasks/route.js.nft.json',
    });
    expect(result.resolved.replace(/\\/g, '/')).toMatch(/packages\/db\/dist\/runtime\.js$/);
    expect(result.exportNames).toContain('createPrismaClient');
    expect(result.exportNames).not.toContain('createTestDatabase');
  });

  it('covers Owner, Recipient capability, and Recipient page route NFT manifests when built', () => {
    const nextDir = path.join(webRoot, '.next');
    if (!fs.existsSync(nextDir)) {
      return;
    }

    for (const relativeNft of DB_BACKED_ROUTE_NFTS) {
      const nftPath = path.join(webRoot, '.next/server', relativeNft);
      expect(fs.existsSync(nftPath), relativeNft).toBe(true);
    }
  });

  it('passes post-build serverless trace verification when .next output exists', () => {
    const nextDir = path.join(webRoot, '.next');
    if (!fs.existsSync(nextDir)) {
      return;
    }

    const output = execFileSync(process.execPath, [verifyScriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(output.trim()).toBe('verify-prisma-serverless-trace: ok');
  });

  it('passes post-build db runtime resolution verification when .next output exists', () => {
    const nextDir = path.join(webRoot, '.next');
    if (!fs.existsSync(nextDir)) {
      return;
    }

    const output = execFileSync(process.execPath, [verifyDbRuntimeScriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(output.trim()).toBe('verify-db-runtime-resolution: ok');
  });

  it('uses the app-local DB runtime bridge in built server output when .next exists', () => {
    const nextDir = path.join(webRoot, '.next');
    if (!fs.existsSync(nextDir)) {
      return;
    }

    expect(() => assertBuiltOutputUsesRuntimeBridge(webRoot, repoRoot)).not.toThrow();
    const combined = fs
      .readdirSync(path.join(webRoot, '.next/server/chunks'))
      .filter((name) => name.endsWith('.js') && !name.endsWith('.js.map'))
      .map((name) => fs.readFileSync(path.join(webRoot, '.next/server/chunks', name), 'utf8'))
      .join('\n');
    expect(combined).not.toContain('@aicaa/db/runtime');
    expect(combined).not.toContain('requireImpl("@aicaa/db/runtime")');
  });

  it('passes post-build package require simulation when .next output exists', () => {
    const nextDir = path.join(webRoot, '.next');
    if (!fs.existsSync(nextDir)) {
      return;
    }

    const output = execFileSync(process.execPath, [verifyDbPackageRequirePath], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(output.trim()).toMatch(/^verify-db-package-require: ok/);
    expect(output).toContain(DB_RUNTIME_RELATIVE);
  });
});
