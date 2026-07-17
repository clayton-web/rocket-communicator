// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DB_BACKED_ROUTE_NFTS,
  DB_RUNTIME_RELATIVE,
  DOMAIN_NODE_MODULES_DIST_INDEX_RELATIVE,
  DOMAIN_RELATIVE_IMPORT_SPECIFIER,
  DOMAIN_RELATIVE_INDEX_RELATIVE,
  PGLITE_MARKERS,
  REQUIRED_RUNTIME_EXPORTS,
  RHEL_ENGINE,
  assertBuiltOutputUsesRuntimeBridge,
  assertCompiledBridgeNamespace,
  assertDomainMappersUsesRelativeDomainImport,
  assertIsolatedNftLayoutOutsideRepo,
  assertNoPackageNameDomainImportsInDbDist,
  assertNftIncludesDbPackageRuntime,
  assertNftIncludesResolvableDomainPackage,
  findCompiledBridgeExportNames,
  getRequiredDbPackageRuntimeFiles,
  getRequiredDomainPackageRuntimeFiles,
  materializeNftLayout,
  nftIncludesNodeModulesDomainDist,
  nftIncludesNodeModulesDomainIndex,
  nftIncludesRepoFile,
  simulateLambdaLayoutBridgeInit,
  simulateRouteRuntimeRequire,
  simulateRuntimeImportFailureWithoutDomainDist,
  walkDbPackageRuntimeJsFiles,
} from '../scripts/lib/db-package-trace.mjs';
import {
  GENERATED_CLIENT_ENGINE_RELATIVE,
  GENERATED_CLIENT_INDEX_RELATIVE,
  GENERATED_CLIENT_LIBRARY_RELATIVE,
  GENERATED_CLIENT_SCHEMA_RELATIVE,
  inspectPrismaLayoutArtifacts,
  isLinuxPlatform,
  runPrismaClientConstructionProbe,
  sanitizeGeneratorOutputShape,
} from '../scripts/lib/prisma-client-construction-probe.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(webRoot, '../..');
const schemaPath = path.join(repoRoot, 'packages/db/prisma/schema.prisma');
const nextConfigPath = path.join(webRoot, 'next.config.mjs');
const generatedClientDir = path.join(repoRoot, 'packages/db/dist/generated/client');
const verifyScriptPath = path.join(webRoot, 'scripts/verify-prisma-serverless-trace.mjs');
const verifyDbRuntimeScriptPath = path.join(webRoot, 'scripts/verify-db-runtime-resolution.mjs');
const verifyDbPackageRequirePath = path.join(webRoot, 'scripts/verify-db-package-require.mjs');
const verifyLambdaLayoutBridgePath = path.join(webRoot, 'scripts/verify-lambda-layout-bridge.mjs');
const verifyPrismaClientConstructionPath = path.join(
  webRoot,
  'scripts/verify-prisma-client-construction.mjs',
);
const tasksNftPath = path.join(webRoot, '.next/server/app/api/v1/tasks/route.js.nft.json');

const FORBIDDEN_TRACE_GLOBS = ['../../packages/db/**/*', '../../**/*'];

describe('Prisma serverless packaging configuration', () => {
  it('declares native and rhel-openssl-3.0.x binary targets in schema.prisma', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    expect(schema).toMatch(/binaryTargets\s*=\s*\[[^\]]*"native"[^\]]*"rhel-openssl-3\.0\.x"/s);
    expect(schema).toContain('provider      = "prisma-client-js"');
    expect(schema).toContain('output        = "../src/generated/client"');
  });

  it('externalizes @aicaa/db and sets monorepo Prisma trace includes in next.config.mjs', () => {
    const config = fs.readFileSync(nextConfigPath, 'utf8');
    expect(config).toContain("serverExternalPackages: ['@aicaa/db', 'google-auth-library']");
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
    expect(config).toContain('node_modules/@aicaa/domain/dist/**/*.js');
    expect(config).toContain('turbopack:');
    expect(config).toContain('root: monorepoRoot');
    expect(config).toContain(RHEL_ENGINE);
    expect(config).toContain('schema.prisma');
    expect(config).toContain("'/api/v1/tasks'");
    expect(config).toContain("'/api/v1/tasks/**/*'");
    expect(config).toContain("'/api/v1/capabilities/**/*'");
    expect(config).toContain("'/api/v1/gmail/**/*'");
    expect(config).toContain("'/api/v1/internal/**/*'");
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
    expect(graph.some((filePath) => filePath.endsWith('client/create-prisma-client.js'))).toBe(
      true,
    );
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

  it('includes resolvable node_modules @aicaa/domain dist tree in DB-backed route NFTs when built', () => {
    const nextDir = path.join(webRoot, '.next');
    if (!fs.existsSync(nextDir)) {
      return;
    }

    const domainRequired = getRequiredDomainPackageRuntimeFiles(repoRoot);

    for (const relativeNft of DB_BACKED_ROUTE_NFTS) {
      const nftPath = path.join(webRoot, '.next/server', relativeNft);
      const nft = JSON.parse(fs.readFileSync(nftPath, 'utf8')) as { files?: string[] };
      const files = Array.isArray(nft.files) ? nft.files : [];

      expect(
        files.some((entry) => entry.includes('.nft-sim')),
        relativeNft,
      ).toBe(false);
      expect(nftIncludesNodeModulesDomainIndex(files), relativeNft).toBe(true);
      expect(nftIncludesNodeModulesDomainDist(files), relativeNft).toBe(true);
      assertNftIncludesResolvableDomainPackage(files, repoRoot, relativeNft);

      for (const jsFile of domainRequired.importGraphJs) {
        expect(nftIncludesRepoFile(files, repoRoot, jsFile), relativeNft).toBe(true);
      }
    }
  });

  it('emits a relative domain import in domain-mappers.js without package-name runtime imports', () => {
    expect(() => assertNoPackageNameDomainImportsInDbDist(repoRoot)).not.toThrow();
    expect(() => assertDomainMappersUsesRelativeDomainImport(repoRoot)).not.toThrow();

    const mapperJs = path.join(repoRoot, 'packages/db/dist/mappers/domain-mappers.js');
    const content = fs.readFileSync(mapperJs, 'utf8');
    expect(content).not.toContain('@aicaa/domain');
    expect(content).toContain(DOMAIN_RELATIVE_IMPORT_SPECIFIER);
    expect(
      fs.existsSync(path.resolve(path.dirname(mapperJs), DOMAIN_RELATIVE_IMPORT_SPECIFIER)),
    ).toBe(true);
  });

  it('materializes isolated NFT layouts outside the repository when built', () => {
    if (!fs.existsSync(tasksNftPath)) {
      return;
    }

    const { layoutRoot } = materializeNftLayout({
      webRoot,
      repoRoot,
      nftRelativePath: 'app/api/v1/tasks/route.js.nft.json',
      includeWorkspaceSymlinks: false,
    });

    try {
      expect(() => assertIsolatedNftLayoutOutsideRepo(layoutRoot, repoRoot)).not.toThrow();
      expect(layoutRoot.startsWith(repoRoot)).toBe(false);
      expect(fs.existsSync(path.join(layoutRoot, DOMAIN_RELATIVE_INDEX_RELATIVE))).toBe(true);
      expect(fs.existsSync(path.join(layoutRoot, DOMAIN_NODE_MODULES_DIST_INDEX_RELATIVE))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(layoutRoot, 'node_modules/@aicaa/domain'))).toBe(false);
    } finally {
      fs.rmSync(layoutRoot, { recursive: true, force: true });
    }
  });

  it('reproduces ERR_MODULE_NOT_FOUND when traced domain dist is removed from isolated layout', () => {
    if (!fs.existsSync(tasksNftPath)) {
      return;
    }

    const failure = simulateRuntimeImportFailureWithoutDomainDist({
      webRoot,
      repoRoot,
      nftRelativePath: 'app/api/v1/tasks/route.js.nft.json',
    });
    expect(failure.code).toBe('ERR_MODULE_NOT_FOUND');
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

  it('registers static bridge exports in the compiled bridge namespace when built', () => {
    const nextDir = path.join(webRoot, '.next');
    if (!fs.existsSync(nextDir)) {
      return;
    }

    expect(() => assertCompiledBridgeNamespace(webRoot)).not.toThrow();
    const bridge = findCompiledBridgeExportNames(webRoot);
    expect(bridge.lazy).toBe(true);
    expect(bridge.exportNames).toEqual(REQUIRED_RUNTIME_EXPORTS);
  });

  it('does not compile undeclared Export alias bindings in bridge chunks when built', () => {
    const nextDir = path.join(webRoot, '.next');
    if (!fs.existsSync(nextDir)) {
      return;
    }

    const { chunkPath } = assertCompiledBridgeNamespace(webRoot);
    const bridgeContent = fs.readFileSync(chunkPath, 'utf8');
    expect(bridgeContent).not.toMatch(/createPrismaClient:createPrismaClientExport/);
    expect(bridgeContent).toMatch(/createPrismaClient:\w+\.createPrismaClient/);
  });

  it('does not compile Turbopack dynamic runtime import stubs in bridge chunks when built', () => {
    const nextDir = path.join(webRoot, '.next');
    if (!fs.existsSync(nextDir)) {
      return;
    }

    const { chunkPath } = assertCompiledBridgeNamespace(webRoot);
    const bridgeContent = fs.readFileSync(chunkPath, 'utf8');
    expect(bridgeContent).not.toContain('expression is too dynamic');
    expect(bridgeContent).not.toMatch(/createPrismaClient:\s*void 0/);
  });

  it('compiles durable database runtime failure logging when built', () => {
    const nextDir = path.join(webRoot, '.next');
    if (!fs.existsSync(nextDir)) {
      return;
    }

    const { chunkPath } = assertCompiledBridgeNamespace(webRoot);
    const bridgeContent = fs.readFileSync(chunkPath, 'utf8');

    expect(bridgeContent).toContain('Traced DB runtime');
    expect(bridgeContent).toContain('loadDbRuntime');
    expect(bridgeContent).toContain('createPrismaClient');
    expect(bridgeContent).not.toContain('X-AICAA-DB-Stage');
    expect(bridgeContent).not.toContain('X-AICAA-DB-Prisma-Connect-Probe');
    expect(bridgeContent).not.toContain('PRISMA_CONNECT_PROBE_START');
    expect(bridgeContent).not.toContain('prismaConnectProbeResult');
    expect(bridgeContent).not.toContain('prismaFailureClass');
  });

  it('loads traced runtime from simulated Vercel Lambda layout when built', () => {
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
    expect(fs.existsSync(result.layoutRoot)).toBe(false);
  });

  it('loads traced runtime from simulated capability route layout when built', () => {
    const nextDir = path.join(webRoot, '.next');
    if (!fs.existsSync(nextDir)) {
      return;
    }

    const result = simulateLambdaLayoutBridgeInit({
      webRoot,
      repoRoot,
      nftRelativePath: 'app/api/v1/capabilities/[token]/tasks/[taskId]/route.js.nft.json',
    });
    expect(result.resolved.replace(/\\/g, '/')).toMatch(/packages\/db\/dist\/runtime\.js$/);
  });

  it('passes post-build lambda layout bridge verification when .next output exists', () => {
    const nextDir = path.join(webRoot, '.next');
    if (!fs.existsSync(nextDir)) {
      return;
    }

    const output = execFileSync(process.execPath, [verifyLambdaLayoutBridgePath], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(output.trim()).toMatch(/^verify-lambda-layout-bridge: ok/);
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

  it('sanitizes embedded Prisma generator output paths to repository-relative shapes', () => {
    expect(
      sanitizeGeneratorOutputShape(
        '/Users/example/rocket communicator/packages/db/src/generated/client',
      ),
    ).toBe('packages/db/src/generated/client');
    expect(sanitizeGeneratorOutputShape('/vercel/path0/packages/db/dist/generated/client')).toBe(
      '<build-root>/packages/db/dist/generated/client',
    );
  });

  it('reports co-located Prisma artifacts in faithful NFT layouts when built', () => {
    if (!fs.existsSync(tasksNftPath)) {
      return;
    }

    const { layoutRoot } = materializeNftLayout({
      webRoot,
      repoRoot,
      nftRelativePath: 'app/api/v1/tasks/route.js.nft.json',
      includeWorkspaceSymlinks: false,
    });

    try {
      const inspection = inspectPrismaLayoutArtifacts(layoutRoot);
      expect(inspection.artifacts.indexJs).toBe(true);
      expect(inspection.artifacts.libraryJs).toBe(true);
      expect(inspection.artifacts.schemaPrisma).toBe(true);
      expect(inspection.artifacts.rhelEngine).toBe(true);
      expect(inspection.schemaColocatedWithIndex).toBe(true);
      expect(inspection.engineColocatedWithIndex).toBe(true);
      expect(inspection.dirnameFallbackWouldActivate).toBe(false);
      expect(fs.existsSync(path.join(layoutRoot, GENERATED_CLIENT_INDEX_RELATIVE))).toBe(true);
      expect(fs.existsSync(path.join(layoutRoot, GENERATED_CLIENT_LIBRARY_RELATIVE))).toBe(true);
      expect(fs.existsSync(path.join(layoutRoot, GENERATED_CLIENT_SCHEMA_RELATIVE))).toBe(true);
      expect(fs.existsSync(path.join(layoutRoot, GENERATED_CLIENT_ENGINE_RELATIVE))).toBe(true);
    } finally {
      fs.rmSync(layoutRoot, { recursive: true, force: true });
    }
  });

  it('passes post-build Prisma client construction verification on Linux when built', () => {
    if (!fs.existsSync(path.join(webRoot, '.next'))) {
      return;
    }
    if (!isLinuxPlatform()) {
      return;
    }

    const output = execFileSync(process.execPath, [verifyPrismaClientConstructionPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PRISMA_CLIENT_CONSTRUCTION_PROBE_REQUIRED: 'true',
      },
    });
    expect(output.trim()).toMatch(/^verify-prisma-client-construction: ok/);
  });

  it('runs the Linux Prisma construction probe directly on Linux when built', () => {
    if (!fs.existsSync(tasksNftPath) || !isLinuxPlatform()) {
      return;
    }

    const result = runPrismaClientConstructionProbe({ webRoot, repoRoot });
    expect(result.probe1.classification).toBe('CONSTRUCTION_SUCCEEDED');
    expect(result.probe2.classification).toBe('CONNECT_REACHED_DATABASE_NETWORK');
    expect(result.probe2.prismaErrorCode).toBe('P1001');
  });
});
