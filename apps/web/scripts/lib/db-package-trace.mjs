/**
 * Shared helpers for @aicaa/db output-file tracing verification (no database access).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const RHEL_ENGINE = 'libquery_engine-rhel-openssl-3.0.x.so.node';
export const SCHEMA_FILE = 'schema.prisma';
export const INVALID_ROOT_PATTERN = '/ROOT/packages/db';
export const DB_PACKAGE_LITERAL = '@aicaa/db/runtime';
export const DB_RUNTIME_RELATIVE = 'packages/db/dist/runtime.js';
export const DB_RUNTIME_BRIDGE_MODULE = 'db-runtime-entry';
export const DB_RUNTIME_REEXPORTS_MODULE = 'db-runtime-reexports';
export const DB_RUNTIME_BRIDGE_EXPORTS = ['loadTracedRuntimeModule'];
export const DB_RUNTIME_LITERAL_SPECIFIER = '../../../../packages/db/dist/runtime.js';
export const DB_RUNTIME_TOO_DYNAMIC_MARKER = 'expression is too dynamic';
export const DB_RUNTIME_LOAD_START_STAGE = 'DB_RUNTIME_LOAD_START';
export const TRACED_DB_RUNTIME_MARKER = 'Traced DB runtime';
export const DB_TESTING_LITERAL = '@aicaa/db/testing';
export const DOMAIN_PACKAGE_LITERAL = '@aicaa/domain';
export const DOMAIN_NODE_MODULES_RELATIVE = 'apps/web/node_modules/@aicaa/domain';
export const DOMAIN_NODE_MODULES_DIST_INDEX_RELATIVE =
  'apps/web/node_modules/@aicaa/domain/dist/index.js';
export const DOMAIN_FUNCTION_ROOT_DIST_INDEX_RELATIVE = 'node_modules/@aicaa/domain/dist/index.js';
export const DOMAIN_MAPPERS_RELATIVE = 'packages/db/dist/mappers/domain-mappers.js';
export const DOMAIN_RELATIVE_IMPORT_SPECIFIER = '../../../domain/dist/index.js';
export const DOMAIN_RELATIVE_INDEX_RELATIVE = 'packages/domain/dist/index.js';
export const FORBIDDEN_RUNTIME_PACKAGE_REQUIRE = 'require("@aicaa/db/runtime")';
export const FORBIDDEN_RUNTIME_PACKAGE_REQUIRE_ALT = "require('@aicaa/db/runtime')";

export const REQUIRED_RUNTIME_EXPORTS = [
  'createPrismaClient',
  'getTaskById',
  'listTasks',
  'createTask',
  'getRecipientById',
  'createAuditEvent',
  'persistOwnerTaskMutation',
  'persistReturnToOwner',
  'findCapabilityByTokenHash',
  'createCapability',
  'findActiveCapabilitiesForAssignment',
  'revokeCapabilityRecord',
  'updateActiveAssignmentCapabilityBinding',
  'updateTaskWithExpectedVersion',
  'getCapabilityById',
  'markCapabilityExpiredRecord',
  'persistCapabilityAction',
  'persistWorkRequest',
  'listTaskSuggestions',
  'getTaskSuggestionById',
  'persistApproveTaskSuggestion',
  'persistEditTaskSuggestion',
  'persistDismissTaskSuggestion',
  'persistMergeTaskSuggestion',
  'getCommunicationAccountByOrganization',
  'getCommunicationAccountById',
  'getGmailOAuthCredentialByAccountId',
  'listEligibleGmailAccountsForPoll',
  'createGmailOAuthState',
  'consumeGmailOAuthState',
  'inspectGmailOAuthState',
  'deleteFinishedGmailOAuthStates',
  'persistGmailConnectionTransaction',
  'persistGmailDisconnectTransaction',
  'acquireGmailSyncLock',
  'releaseGmailSyncLock',
  'markCommunicationAccountNeedsReauth',
  'markCommunicationAccountResyncRequired',
  'createGmailSyncRun',
  'finishGmailSyncRun',
  'listGmailSyncRuns',
  'persistGmailHistoryPageTransaction',
];

export const PGLITE_MARKERS = [
  '@electric-sql/pglite',
  'pglite-prisma-adapter',
  'create-test-database.js',
];

export const DB_BACKED_API_ROUTE_NFTS = [
  'app/api/v1/tasks/route.js.nft.json',
  'app/api/v1/tasks/[taskId]/route.js.nft.json',
  'app/api/v1/task-suggestions/route.js.nft.json',
  'app/api/v1/capabilities/[token]/tasks/[taskId]/route.js.nft.json',
];

/** All A6.2 Owner suggestion HTTP entrypoints (final .next NFT traces). */
export const A6_2_SUGGESTION_ROUTE_NFTS = [
  'app/api/v1/task-suggestions/route.js.nft.json',
  'app/api/v1/task-suggestions/[suggestionId]/route.js.nft.json',
  'app/api/v1/task-suggestions/[suggestionId]/edit/route.js.nft.json',
  'app/api/v1/task-suggestions/[suggestionId]/dismiss/route.js.nft.json',
  'app/api/v1/task-suggestions/[suggestionId]/approve/route.js.nft.json',
  'app/api/v1/task-suggestions/[suggestionId]/merge/route.js.nft.json',
];

/** Owner suggestion routes must load these via the production runtime bridge. */
export const A6_2_REQUIRED_RUNTIME_MODULES = [
  'packages/db/dist/runtime.js',
  'packages/db/dist/transactions/a6-owner-suggestion-transactions.js',
];

/**
 * A6.3 processing modules must not appear in the runtime.js import graph.
 * Note: NFT traces may still list unused packages/db/dist JS files because
 * next.config outputFileTracingIncludes uses a blanket dist glob for DB-backed routes.
 */
export const A6_3_PROCESSING_MODULES_EXCLUDED_FROM_RUNTIME_GRAPH = [
  'packages/db/dist/transactions/a6-transactions.js',
  'packages/db/dist/repositories/suggestion-processing-repository.js',
];

export const DB_BACKED_PAGE_ROUTE_NFTS = ['app/c/[token]/page.js.nft.json'];

export const DB_BACKED_ROUTE_NFTS = [...DB_BACKED_API_ROUTE_NFTS, ...DB_BACKED_PAGE_ROUTE_NFTS];

const RELATIVE_JS_IMPORT =
  /(?:from|export\s+(?:\{[^}]*\}|\*)\s+from)\s+['"](\.\.?\/[^'"]+\.js)['"]|require\(\s*['"](\.\.?\/[^'"]+\.js)['"]\s*\)/g;

const PACKAGE_IMPORT =
  /from\s+['"](@aicaa\/[^'"]+|@electric-sql\/[^'"]+|pglite-prisma-adapter)['"]/g;

export function collectRelativeJsImports(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const imports = new Set();
  for (const match of content.matchAll(RELATIVE_JS_IMPORT)) {
    const specifier = match[1] ?? match[2];
    if (specifier) {
      imports.add(specifier);
    }
  }
  return [...imports];
}

export function collectPackageImports(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const imports = new Set();
  for (const match of content.matchAll(PACKAGE_IMPORT)) {
    imports.add(match[1]);
  }
  return [...imports];
}

export function walkDbPackageRuntimeJsFiles(entryFile) {
  const visited = new Set();
  const queue = [entryFile];

  while (queue.length > 0) {
    const current = queue.pop();
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    for (const relativeImport of collectRelativeJsImports(current)) {
      const resolved = path.resolve(path.dirname(current), relativeImport);
      if (fs.existsSync(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return [...visited].sort();
}

export function listDistJsFiles(distDir) {
  const results = [];
  if (!fs.existsSync(distDir)) {
    return results;
  }

  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    const fullPath = path.join(distDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listDistJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.js.map')) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

export function getRequiredDbPackageRuntimeFiles(repoRoot) {
  const packageRoot = path.join(repoRoot, 'packages/db');
  const packageJson = path.join(packageRoot, 'package.json');
  const runtimeJs = path.join(packageRoot, 'dist/runtime.js');
  const distDir = path.join(packageRoot, 'dist');
  const generatedClientDir = path.join(distDir, 'generated/client');

  if (!fs.existsSync(packageJson)) {
    throw new Error(`missing ${path.relative(repoRoot, packageJson)}`);
  }
  if (!fs.existsSync(runtimeJs)) {
    throw new Error(`missing ${path.relative(repoRoot, runtimeJs)} — run pnpm build:db`);
  }

  const importGraphJs = walkDbPackageRuntimeJsFiles(runtimeJs);
  const distJs = listDistJsFiles(distDir);
  const rhelEngine = path.join(generatedClientDir, RHEL_ENGINE);
  const schema = path.join(generatedClientDir, SCHEMA_FILE);

  if (!fs.existsSync(rhelEngine)) {
    throw new Error(`missing ${path.relative(repoRoot, rhelEngine)} — run pnpm build:db`);
  }
  if (!fs.existsSync(schema)) {
    throw new Error(`missing ${path.relative(repoRoot, schema)} — run pnpm build:db`);
  }

  const packageImports = new Set();
  for (const jsFile of importGraphJs) {
    for (const pkgImport of collectPackageImports(jsFile)) {
      packageImports.add(pkgImport);
    }
  }

  return {
    packageJson,
    runtimeJs,
    importGraphJs,
    distJs,
    rhelEngine,
    schema,
    libraryJs: path.join(generatedClientDir, 'runtime/library.js'),
    packageImports: [...packageImports].sort(),
  };
}

export function getRequiredDomainPackageRuntimeFiles(repoRoot) {
  const packageRoot = path.join(repoRoot, 'packages/domain');
  const packageJson = path.join(packageRoot, 'package.json');
  const indexJs = path.join(packageRoot, 'dist/index.js');

  if (!fs.existsSync(packageJson)) {
    throw new Error(`missing ${path.relative(repoRoot, packageJson)}`);
  }
  if (!fs.existsSync(indexJs)) {
    throw new Error(`missing ${path.relative(repoRoot, indexJs)} — run pnpm build:domain`);
  }

  return {
    packageJson,
    indexJs,
    importGraphJs: walkDbPackageRuntimeJsFiles(indexJs),
  };
}

export function assertRuntimeGraphExcludesPglite(importGraphJs, repoRoot) {
  const offenders = importGraphJs.filter((filePath) =>
    PGLITE_MARKERS.some((marker) => filePath.includes(marker)),
  );
  if (offenders.length > 0) {
    throw new Error(
      `production runtime graph includes PGlite/test files: ${offenders
        .map((filePath) => path.relative(repoRoot, filePath))
        .join(', ')}`,
    );
  }
}

export function assertNoTopLevelAwait(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (/\btop-level await\b/.test(content)) {
    throw new Error(`unexpected top-level await marker comment in ${filePath}`);
  }
  if (/^\s*await\s+/m.test(content)) {
    throw new Error(`top-level await found in ${filePath}`);
  }
}

export function normalizeNftEntry(entry) {
  return entry.replace(/\\/g, '/');
}

export function nftIncludesRepoFile(nftFiles, repoRoot, absolutePath) {
  const relative = normalizeNftEntry(path.relative(repoRoot, absolutePath));
  const basename = path.basename(absolutePath);

  return nftFiles.some((entry) => {
    const normalized = normalizeNftEntry(entry);
    return (
      normalized === relative ||
      normalized.endsWith(`/${relative}`) ||
      normalized.endsWith(`/${basename}`)
    );
  });
}

export function nftIncludesNodeModulesDomainDist(nftFiles) {
  return nftFiles.some((entry) => {
    const normalized = normalizeNftEntry(entry);
    return normalized.includes('node_modules/@aicaa/domain/dist/');
  });
}

export function nftIncludesNodeModulesDomainIndex(nftFiles) {
  return nftFiles.some((entry) => {
    const normalized = normalizeNftEntry(entry);
    return normalized.endsWith('node_modules/@aicaa/domain/dist/index.js');
  });
}

export function assertNftIncludesResolvableDomainPackage(nftFiles, repoRoot, routeLabel) {
  const domainRequired = getRequiredDomainPackageRuntimeFiles(repoRoot);
  const missing = [];

  if (!nftIncludesNodeModulesDomainIndex(nftFiles)) {
    missing.push(DOMAIN_NODE_MODULES_DIST_INDEX_RELATIVE);
  }

  for (const jsFile of domainRequired.importGraphJs) {
    if (!nftIncludesRepoFile(nftFiles, repoRoot, jsFile)) {
      missing.push(path.relative(repoRoot, jsFile));
    }
  }

  const nodeModulesDistFiles = nftFiles.filter((entry) =>
    normalizeNftEntry(entry).includes('node_modules/@aicaa/domain/dist/'),
  );
  if (nodeModulesDistFiles.length === 0) {
    missing.push('node_modules/@aicaa/domain/dist/**/*.js');
  }

  if (missing.length > 0) {
    throw new Error(
      `${routeLabel} NFT trace is missing resolvable @aicaa/domain package files: ${missing.join(', ')}`,
    );
  }

  return { domainRequired, nodeModulesDistFiles };
}

export function assertIsolatedNftLayoutOutsideRepo(layoutRoot, repoRoot) {
  const resolvedLayoutRoot = path.resolve(layoutRoot);
  const resolvedRepoRoot = path.resolve(repoRoot);
  const relative = path.relative(resolvedRepoRoot, resolvedLayoutRoot);

  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('NFT simulation layout must be created outside the repository');
  }

  let dir = resolvedLayoutRoot;
  for (let depth = 0; depth < 32; depth += 1) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    const parentNodeModules = path.join(parent, 'node_modules');
    if (fs.existsSync(parentNodeModules)) {
      const repoNodeModules = path.join(resolvedRepoRoot, 'node_modules');
      if (parentNodeModules === repoNodeModules) {
        throw new Error('host repository node_modules is reachable from simulation layout');
      }
    }
    dir = parent;
  }
}

export function assertNftIncludesDbPackageRuntime(nftFiles, repoRoot, routeLabel) {
  const required = getRequiredDbPackageRuntimeFiles(repoRoot);
  const domainRequired = getRequiredDomainPackageRuntimeFiles(repoRoot);
  const missing = [];

  if (!nftIncludesRepoFile(nftFiles, repoRoot, required.packageJson)) {
    missing.push('packages/db/package.json');
  }
  if (!nftIncludesRepoFile(nftFiles, repoRoot, required.runtimeJs)) {
    missing.push('packages/db/dist/runtime.js');
  }
  if (!nftIncludesRepoFile(nftFiles, repoRoot, required.libraryJs)) {
    missing.push('packages/db/dist/generated/client/runtime/library.js');
  }
  if (!nftIncludesRepoFile(nftFiles, repoRoot, required.rhelEngine)) {
    missing.push(`packages/db/dist/generated/client/${RHEL_ENGINE}`);
  }
  if (!nftIncludesRepoFile(nftFiles, repoRoot, required.schema)) {
    missing.push(`packages/db/dist/generated/client/${SCHEMA_FILE}`);
  }
  if (!nftIncludesRepoFile(nftFiles, repoRoot, domainRequired.packageJson)) {
    missing.push('packages/domain/package.json');
  }
  if (!nftIncludesRepoFile(nftFiles, repoRoot, domainRequired.indexJs)) {
    missing.push('packages/domain/dist/index.js');
  }

  for (const jsFile of required.importGraphJs) {
    if (!nftIncludesRepoFile(nftFiles, repoRoot, jsFile)) {
      missing.push(path.relative(repoRoot, jsFile));
    }
  }

  for (const jsFile of domainRequired.importGraphJs) {
    if (!nftIncludesRepoFile(nftFiles, repoRoot, jsFile)) {
      missing.push(path.relative(repoRoot, jsFile));
    }
  }

  assertNftIncludesResolvableDomainPackage(nftFiles, repoRoot, routeLabel);

  if (missing.length > 0) {
    throw new Error(
      `${routeLabel} NFT trace is missing @aicaa/db runtime files: ${missing.join(', ')}`,
    );
  }

  assertRuntimeGraphExcludesPglite(required.importGraphJs, repoRoot);

  return { required, domainRequired };
}

function copyFileOrSymlink(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(src);
    try {
      fs.symlinkSync(target, dest);
    } catch {
      const resolved = path.resolve(path.dirname(src), target);
      if (fs.existsSync(resolved)) {
        if (fs.statSync(resolved).isDirectory()) {
          fs.cpSync(resolved, dest, { recursive: true });
        } else {
          fs.copyFileSync(resolved, dest);
        }
      }
    }
    return;
  }
  if (stat.isDirectory()) {
    fs.cpSync(src, dest, { recursive: true });
    return;
  }
  fs.copyFileSync(src, dest);
}

export function assertNoPackageNameDomainImportsInDbDist(repoRoot) {
  const distDir = path.join(repoRoot, 'packages/db/dist');
  const offenders = [];

  for (const jsFile of listDistJsFiles(distDir)) {
    const content = fs.readFileSync(jsFile, 'utf8');
    if (/from\s+['"]@aicaa\/domain['"]/.test(content)) {
      offenders.push(path.relative(repoRoot, jsFile));
    }
  }

  if (offenders.length > 0) {
    throw new Error(
      `packages/db/dist still contains runtime @aicaa/domain imports: ${offenders.join(', ')}`,
    );
  }
}

export function assertDomainMappersUsesRelativeDomainImport(repoRoot) {
  const mapperJs = path.join(repoRoot, DOMAIN_MAPPERS_RELATIVE);
  if (!fs.existsSync(mapperJs)) {
    throw new Error(`missing ${DOMAIN_MAPPERS_RELATIVE} — run pnpm build:db`);
  }

  const content = fs.readFileSync(mapperJs, 'utf8');
  if (content.includes('@aicaa/domain')) {
    throw new Error(`${DOMAIN_MAPPERS_RELATIVE} still references @aicaa/domain`);
  }
  if (!content.includes(DOMAIN_RELATIVE_IMPORT_SPECIFIER)) {
    throw new Error(
      `${DOMAIN_MAPPERS_RELATIVE} is missing relative domain import ${DOMAIN_RELATIVE_IMPORT_SPECIFIER}`,
    );
  }

  const resolvedDomainIndex = path.resolve(
    path.dirname(mapperJs),
    DOMAIN_RELATIVE_IMPORT_SPECIFIER,
  );
  if (!fs.existsSync(resolvedDomainIndex)) {
    throw new Error(`relative domain import does not resolve to ${DOMAIN_RELATIVE_INDEX_RELATIVE}`);
  }
}

export function materializeNftLayout({
  webRoot,
  repoRoot,
  nftRelativePath,
  includeWorkspaceSymlinks = true,
}) {
  const nftPath = path.join(webRoot, '.next/server', nftRelativePath);
  const nft = JSON.parse(fs.readFileSync(nftPath, 'utf8'));
  const files = Array.isArray(nft.files) ? nft.files : [];
  const serverRoot = path.dirname(nftPath);
  const layoutRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-nft-sim-'));
  assertIsolatedNftLayoutOutsideRepo(layoutRoot, repoRoot);
  const routeJs = path.join(
    layoutRoot,
    'apps/web/.next/server',
    path.relative(path.join(webRoot, '.next/server'), nftPath).replace(/\.nft\.json$/, ''),
  );

  fs.mkdirSync(path.dirname(routeJs), { recursive: true });
  if (fs.existsSync(nftPath.replace(/\.nft\.json$/, ''))) {
    fs.copyFileSync(nftPath.replace(/\.nft\.json$/, ''), routeJs);
  } else {
    fs.writeFileSync(routeJs, '// simulated route\n');
  }

  for (const entry of files) {
    if (normalizeNftEntry(entry).includes('.nft-sim')) {
      continue;
    }
    const src = path.resolve(serverRoot, entry);
    if (!fs.existsSync(src)) {
      continue;
    }
    const relToRepo = path.relative(repoRoot, src);
    if (relToRepo.startsWith('..')) {
      continue;
    }
    const dest = path.join(layoutRoot, relToRepo);
    copyFileOrSymlink(src, dest);
  }

  if (includeWorkspaceSymlinks) {
    const webNodeModules = path.join(repoRoot, 'apps/web/node_modules/@aicaa');
    const layoutNodeModules = path.join(layoutRoot, 'apps/web/node_modules/@aicaa');
    if (fs.existsSync(webNodeModules)) {
      fs.mkdirSync(layoutNodeModules, { recursive: true });
      for (const name of ['db', 'domain']) {
        const src = path.join(webNodeModules, name);
        const dest = path.join(layoutNodeModules, name);
        if (fs.existsSync(src)) {
          copyFileOrSymlink(src, dest);
        }
      }
    }
  }

  return { layoutRoot, routeJs };
}

function loadTracedRuntimeExports(runtimePath) {
  const script = `
import { pathToFileURL } from 'node:url';
const loaded = await import(pathToFileURL(${JSON.stringify(runtimePath)}).href);
for (const exportName of ${JSON.stringify(REQUIRED_RUNTIME_EXPORTS)}) {
  if (typeof loaded[exportName] !== 'function') {
    throw new Error('loaded runtime missing export: ' + exportName);
  }
}
if (typeof loaded.createTestDatabase !== 'undefined') {
  throw new Error('loaded runtime unexpectedly exports createTestDatabase');
}
console.log(JSON.stringify(Object.keys(loaded).sort()));
`;
  const proc = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: process.env,
  });

  if (proc.status !== 0) {
    throw new Error(proc.stderr?.trim() || proc.stdout?.trim() || 'traced runtime import failed');
  }

  return JSON.parse(proc.stdout.trim());
}

export function simulateRouteRuntimeBridge({ webRoot, repoRoot, nftRelativePath }) {
  const { layoutRoot } = materializeNftLayout({
    webRoot,
    repoRoot,
    nftRelativePath,
    includeWorkspaceSymlinks: false,
  });

  const runtimePath = path.join(layoutRoot, DB_RUNTIME_RELATIVE);
  if (!fs.existsSync(runtimePath)) {
    fs.rmSync(layoutRoot, { recursive: true, force: true });
    throw new Error(`traced layout missing ${DB_RUNTIME_RELATIVE}`);
  }

  let exportNames;
  try {
    exportNames = loadTracedRuntimeExports(runtimePath);
  } finally {
    fs.rmSync(layoutRoot, { recursive: true, force: true });
  }

  const required = getRequiredDbPackageRuntimeFiles(repoRoot);
  assertRuntimeGraphExcludesPglite(required.importGraphJs, repoRoot);
  assertNoTopLevelAwait(required.runtimeJs);

  return {
    resolved: runtimePath,
    exportNames,
  };
}

export function simulateRouteRuntimeRequire({ webRoot, repoRoot, nftRelativePath }) {
  return simulateRouteRuntimeBridge({ webRoot, repoRoot, nftRelativePath });
}

export function simulateRuntimeImportFailureWithoutDomainDist({
  webRoot,
  repoRoot,
  nftRelativePath,
}) {
  const { layoutRoot } = materializeNftLayout({
    webRoot,
    repoRoot,
    nftRelativePath,
    includeWorkspaceSymlinks: false,
  });

  const domainDistPath = path.join(layoutRoot, 'packages/domain/dist');

  try {
    if (!fs.existsSync(domainDistPath)) {
      throw new Error('isolated layout missing packages/domain/dist');
    }
    fs.rmSync(domainDistPath, { recursive: true, force: true });

    const runtimePath = path.join(layoutRoot, DB_RUNTIME_RELATIVE);
    const script = `
import { pathToFileURL } from 'node:url';
try {
  await import(pathToFileURL(${JSON.stringify(runtimePath)}).href);
  console.log('UNEXPECTED_SUCCESS');
} catch (error) {
  console.log(JSON.stringify({
    code: error?.code,
    message: String(error?.message ?? error).slice(0, 250),
  }));
}
`;
    const proc = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: layoutRoot,
      encoding: 'utf8',
      env: { NODE_ENV: 'production' },
    });

    if (proc.status !== 0) {
      throw new Error(
        proc.stderr?.trim() || proc.stdout?.trim() || 'domain removal import probe failed',
      );
    }

    const output = proc.stdout.trim();
    if (output === 'UNEXPECTED_SUCCESS') {
      throw new Error('runtime import unexpectedly succeeded without packages/domain/dist');
    }

    const parsed = JSON.parse(output);
    if (parsed.code !== 'ERR_MODULE_NOT_FOUND') {
      throw new Error(
        `expected ERR_MODULE_NOT_FOUND after removing packages/domain/dist, got ${output}`,
      );
    }

    return parsed;
  } finally {
    fs.rmSync(layoutRoot, { recursive: true, force: true });
  }
}

export function collectServerJsFiles(webRoot) {
  const roots = [path.join(webRoot, '.next/server/chunks'), path.join(webRoot, '.next/server/app')];
  const files = [];
  for (const root of roots) {
    files.push(...listDistJsFiles(root));
  }
  return files;
}

export function findBridgeChunkFiles(webRoot) {
  const chunksDir = path.join(webRoot, '.next/server/chunks');
  return listDistJsFiles(chunksDir).filter((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.includes('loadDbRuntime') && content.includes(TRACED_DB_RUNTIME_MARKER);
  });
}

export function findCompiledBridgeExportNames(webRoot) {
  const { chunkPath } = assertCompiledBridgeNamespace(webRoot);
  return {
    chunkPath,
    exportNames: [...REQUIRED_RUNTIME_EXPORTS],
    lazy: true,
  };
}

function extractLoadTracedRuntimeModuleBody(content) {
  const match =
    content.match(
      /async function \w+\(\)\{(?:let \w+=await [^;]+;)?return\{createPrismaClient:(?:\w+\.)?createPrismaClient[^}]+\}\}/,
    ) ??
    // Larger return objects (A5.3 Gmail runtime exports) exceed the prior 1200-char window.
    content.match(
      /async function \w+\(\)\{let \w+=[\s\S]{0,6000}?createPrismaClient:\w+\.createPrismaClient[\s\S]{0,6000}?\}\}/,
    ) ??
    content.match(
      /async function \w+\(\)\{[\s\S]{0,6000}?return\{createPrismaClient:\w+\.createPrismaClient[\s\S]{0,6000}?\}\}/,
    );
  return match?.[0];
}

function assertCompiledBridgeBindings(content, chunkPath) {
  const returnBody = extractLoadTracedRuntimeModuleBody(content);
  if (!returnBody) {
    throw new Error(
      `compiled bridge is missing loadTracedRuntimeModule return object in ${path.basename(chunkPath)}`,
    );
  }

  for (const exportName of REQUIRED_RUNTIME_EXPORTS) {
    if (returnBody.includes(`${exportName}:${exportName}Export`)) {
      throw new Error(
        `compiled bridge still references undeclared Export alias for ${exportName} in ${path.basename(chunkPath)}`,
      );
    }
  }

  if (
    !/createPrismaClient:(?:\w+\.)?createPrismaClient/.test(returnBody) ||
    /createPrismaClient:\s*void 0/.test(returnBody)
  ) {
    throw new Error(
      `compiled bridge does not use namespace property access for runtime exports in ${path.basename(chunkPath)}`,
    );
  }
}

function assertStaticBridgeInChunk(content, chunkPath) {
  assertCompiledBridgeBindings(content, chunkPath);

  if (content.includes(DB_RUNTIME_TOO_DYNAMIC_MARKER)) {
    throw new Error(
      `compiled bridge still contains Turbopack dynamic import stub in ${path.basename(chunkPath)}`,
    );
  }

  if (/createPrismaClient:\s*void 0/.test(content)) {
    throw new Error(
      `compiled bridge still contains void 0 runtime export stubs in ${path.basename(chunkPath)}`,
    );
  }

  const loadTracedRuntimeModuleBody = extractLoadTracedRuntimeModuleBody(content);

  if (
    !/e\.s\(\[\],\d+\)/.test(content) &&
    !/await e\.A\(\d+\)/.test(loadTracedRuntimeModuleBody ?? '') &&
    !/Traced DB runtime not found/.test(content)
  ) {
    throw new Error(
      `compiled bridge is missing traced external runtime module reference in ${path.basename(chunkPath)}`,
    );
  }

  if (!content.includes(TRACED_DB_RUNTIME_MARKER)) {
    throw new Error(
      `compiled bridge is missing ${TRACED_DB_RUNTIME_MARKER} in ${path.basename(chunkPath)}`,
    );
  }

  let retainedExportCount = 0;
  for (const exportName of REQUIRED_RUNTIME_EXPORTS) {
    if (content.includes(exportName)) {
      retainedExportCount += 1;
    }
  }
  if (retainedExportCount < REQUIRED_RUNTIME_EXPORTS.length) {
    throw new Error(
      `compiled bridge is missing required runtime export markers in ${path.basename(chunkPath)}`,
    );
  }

  if (
    content.includes('Traced DB runtime not found') &&
    !/createPrismaClient:\w+\.createPrismaClient/.test(content)
  ) {
    throw new Error(
      `compiled bridge still contains runtime path resolution marker in ${path.basename(chunkPath)}`,
    );
  }

  if (/pathToFileURL\(/.test(content)) {
    throw new Error(
      `compiled bridge still contains pathToFileURL runtime resolution in ${path.basename(chunkPath)}`,
    );
  }

  if (/createRequire\)\([^)]*\)\([^)]*runtime\.js/.test(content)) {
    throw new Error(
      `compiled bridge still uses createRequire for traced runtime.js in ${path.basename(chunkPath)}`,
    );
  }

  if (/require\([^)]*packages\/db\/dist\/runtime\.js/.test(content)) {
    throw new Error(
      `compiled bridge still uses require() for ESM runtime.js in ${path.basename(chunkPath)}`,
    );
  }
}

export function assertCompiledBridgeNamespace(webRoot) {
  const chunkFiles = findBridgeChunkFiles(webRoot);

  if (chunkFiles.length === 0) {
    throw new Error('no compiled server chunks contain loadDbRuntime');
  }

  for (const chunkPath of chunkFiles) {
    const content = fs.readFileSync(chunkPath, 'utf8');
    assertStaticBridgeInChunk(content, chunkPath);
    return { chunkPath };
  }

  throw new Error('compiled bridge validation failed');
}

function findLayoutBridgeChunkPath(layoutWeb) {
  const chunksDir = path.join(layoutWeb, '.next/server/chunks');
  const bridgeChunks = listDistJsFiles(chunksDir).filter((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.includes('loadDbRuntime') && content.includes(TRACED_DB_RUNTIME_MARKER);
  });
  if (bridgeChunks.length === 0) {
    return undefined;
  }
  return bridgeChunks[0];
}

function writeLambdaBridgeSimulationScript({
  layoutRoot,
  layoutWeb,
  routeJs,
  bridgeChunkRelativePath,
  repoRoot,
}) {
  const scriptPath = path.join(layoutRoot, 'lambda-bridge-sim.mjs');
  const routeBootstrapPath = routeJs;
  const turbopackRouteId = `server/${path
    .relative(path.join(layoutWeb, '.next/server'), routeJs)
    .replace(/\\/g, '/')}`;
  const source = `
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const layoutRoot = ${JSON.stringify(layoutRoot)};
const layoutWeb = ${JSON.stringify(layoutWeb)};
const routeJs = ${JSON.stringify(routeJs)};
const bridgeChunkRelativePath = ${JSON.stringify(bridgeChunkRelativePath)};
const tracedRelative = ${JSON.stringify(DB_RUNTIME_RELATIVE)};
const routeBootstrapPath = ${JSON.stringify(routeBootstrapPath)};
const turbopackRouteId = ${JSON.stringify(turbopackRouteId)};
const repoRoot = ${JSON.stringify(repoRoot)};

function assertIsolatedLayout() {
  const resolvedLayoutRoot = path.resolve(layoutRoot);
  const resolvedRepoRoot = path.resolve(repoRoot);
  const relative = path.relative(resolvedRepoRoot, resolvedLayoutRoot);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('simulation layout must be outside repository');
  }

  let dir = resolvedLayoutRoot;
  for (let depth = 0; depth < 32; depth += 1) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    const parentNodeModules = path.join(parent, 'node_modules');
    if (fs.existsSync(parentNodeModules)) {
      const repoNodeModules = path.join(resolvedRepoRoot, 'node_modules');
      if (parentNodeModules === repoNodeModules) {
        throw new Error('host repository node_modules is reachable from simulation layout');
      }
    }
    dir = parent;
  }
}

function assertDomainRelativeImportInLayout() {
  const mapperPath = path.join(layoutRoot, ${JSON.stringify(DOMAIN_MAPPERS_RELATIVE)});
  const content = fs.readFileSync(mapperPath, 'utf8');
  if (content.includes('@aicaa/domain')) {
    throw new Error('domain-mappers still contains @aicaa/domain package import');
  }
  if (!content.includes(${JSON.stringify(DOMAIN_RELATIVE_IMPORT_SPECIFIER)})) {
    throw new Error('domain-mappers missing relative domain import');
  }
  const domainIndex = path.join(layoutRoot, ${JSON.stringify(DOMAIN_RELATIVE_INDEX_RELATIVE)});
  if (!fs.existsSync(domainIndex)) {
    throw new Error('layout missing packages/domain/dist/index.js');
  }
}

process.chdir(layoutRoot);
process.env.NODE_ENV = 'production';
delete process.env.DATABASE_URL;

assertIsolatedLayout();
console.log('ISOLATED_LAYOUT_OK');

const requireFromWeb = createRequire(path.join(layoutWeb, 'package.json'));
requireFromWeb(routeJs);
console.log('ROUTE_IMPORT_OK');

const runtimePath = path.join(layoutRoot, tracedRelative);
const runtimeModule = await import(pathToFileURL(runtimePath).href);
for (const exportName of ${JSON.stringify(REQUIRED_RUNTIME_EXPORTS)}) {
  if (typeof runtimeModule[exportName] !== 'function') {
    throw new Error('loaded runtime missing export: ' + exportName);
  }
}
if (typeof runtimeModule.createTestDatabase !== 'undefined') {
  throw new Error('loaded runtime unexpectedly exports createTestDatabase');
}
assertDomainRelativeImportInLayout();
console.log('DOMAIN_RELATIVE_IMPORT_OK');
console.log('RUNTIME_LOAD_OK');

const bridgeChunkPath = path.join(layoutWeb, '.next', bridgeChunkRelativePath);
const bridgeContent = fs.readFileSync(bridgeChunkPath, 'utf8');
if (bridgeContent.includes(${JSON.stringify(DB_RUNTIME_TOO_DYNAMIC_MARKER)})) {
  throw new Error('compiled bridge still contains dynamic import stub');
}
if (/createPrismaClient:\\s*void 0/.test(bridgeContent)) {
  throw new Error('compiled bridge still contains void 0 runtime stubs');
}

const routeBootstrap = fs.readFileSync(routeBootstrapPath, 'utf8');
const turbopackRuntime = requireFromWeb(
  path.join(layoutWeb, '.next/server/chunks/[turbopack]_runtime.js'),
);
const R = turbopackRuntime(turbopackRouteId);
for (const match of routeBootstrap.matchAll(/R\\.c\\("([^"]+)"\\)/g)) {
  R.c(match[1]);
}

const loadDbRuntimeModuleMatch = bridgeContent.match(
  /e\\.s\\(\\[[^\\]]*"loadDbRuntime"[^\\]]*\\],(\\d+)\\)/,
);
const loadDbRuntimeModuleId = loadDbRuntimeModuleMatch
  ? Number(loadDbRuntimeModuleMatch[1])
  : undefined;
if (loadDbRuntimeModuleId === undefined) {
  throw new Error('compiled bridge missing turbopack module id for loadDbRuntime');
}

const loadDbRuntime = R.m(loadDbRuntimeModuleId).exports.loadDbRuntime;
if (typeof loadDbRuntime !== 'function') {
  throw new Error('compiled bridge missing loadDbRuntime export in turbopack module graph');
}

const runtime = await loadDbRuntime();
for (const exportName of ${JSON.stringify(REQUIRED_RUNTIME_EXPORTS)}) {
  if (typeof runtime[exportName] !== 'function') {
    throw new Error('loadDbRuntime missing export: ' + exportName);
  }
}
console.log('COMPILED_BRIDGE_LOAD_OK');
`;
  fs.writeFileSync(scriptPath, source);
  return scriptPath;
}

export function simulateLambdaLayoutBridgeInit({
  webRoot,
  repoRoot,
  nftRelativePath = 'app/api/v1/tasks/route.js.nft.json',
}) {
  const { layoutRoot, routeJs } = materializeNftLayout({
    webRoot,
    repoRoot,
    nftRelativePath,
    includeWorkspaceSymlinks: false,
  });

  const runtimePath = path.join(layoutRoot, DB_RUNTIME_RELATIVE);
  if (!fs.existsSync(runtimePath)) {
    fs.rmSync(layoutRoot, { recursive: true, force: true });
    throw new Error(`traced layout missing ${DB_RUNTIME_RELATIVE}`);
  }

  const layoutWeb = path.join(layoutRoot, 'apps/web');
  const layoutBridgeChunkPath = findLayoutBridgeChunkPath(layoutWeb);
  if (!layoutBridgeChunkPath) {
    fs.rmSync(layoutRoot, { recursive: true, force: true });
    throw new Error('traced layout missing compiled bridge chunk');
  }
  const bridgeChunkRelativePath = path.relative(
    path.join(layoutWeb, '.next'),
    layoutBridgeChunkPath,
  );

  const scriptPath = writeLambdaBridgeSimulationScript({
    layoutRoot,
    layoutWeb,
    routeJs,
    bridgeChunkRelativePath,
    repoRoot,
  });

  try {
    const proc = spawnSync(process.execPath, [scriptPath], {
      cwd: layoutRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
      },
    });

    if (proc.status !== 0) {
      throw new Error(
        proc.stderr?.trim() || proc.stdout?.trim() || 'lambda bridge simulation failed',
      );
    }

    const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`;
    if (
      !output.includes('ISOLATED_LAYOUT_OK') ||
      !output.includes('ROUTE_IMPORT_OK') ||
      !output.includes('DOMAIN_RELATIVE_IMPORT_OK') ||
      !output.includes('RUNTIME_LOAD_OK') ||
      !output.includes('COMPILED_BRIDGE_LOAD_OK')
    ) {
      throw new Error(`lambda bridge simulation missing expected markers: ${output}`);
    }

    return {
      layoutRoot,
      routeJs,
      resolved: runtimePath,
      bridgeChunkRelativePath,
    };
  } finally {
    fs.rmSync(layoutRoot, { recursive: true, force: true });
  }
}

export function assertBuiltOutputUsesRuntimeBridge(webRoot, repoRoot) {
  const { chunkPath } = assertCompiledBridgeNamespace(webRoot);
  const bridgeFiles = [chunkPath];
  const combined = bridgeFiles.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');

  if (!combined.includes('loadDbRuntime')) {
    throw new Error('built bridge output does not reference loadDbRuntime');
  }
  if (!combined.includes(TRACED_DB_RUNTIME_MARKER)) {
    throw new Error(`built bridge output does not reference ${TRACED_DB_RUNTIME_MARKER}`);
  }
  if (!combined.includes('createPrismaClient')) {
    throw new Error('built bridge output does not reference createPrismaClient');
  }

  if (
    combined.includes(FORBIDDEN_RUNTIME_PACKAGE_REQUIRE) ||
    combined.includes(FORBIDDEN_RUNTIME_PACKAGE_REQUIRE_ALT) ||
    combined.includes('requireImpl("@aicaa/db/runtime")') ||
    combined.includes("requireImpl('@aicaa/db/runtime')")
  ) {
    throw new Error('built bridge output still contains package-name @aicaa/db/runtime require');
  }

  if (combined.includes(INVALID_ROOT_PATTERN)) {
    throw new Error(`built bridge output contains invalid bundling path ${INVALID_ROOT_PATTERN}`);
  }

  for (const filePath of bridgeFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes(DB_RUNTIME_TOO_DYNAMIC_MARKER)) {
      throw new Error(
        `built bridge output contains Turbopack dynamic import stub in ${path.relative(repoRoot, filePath)}`,
      );
    }
    if (/createPrismaClient:\s*void 0/.test(content)) {
      throw new Error(
        `built bridge output contains void 0 runtime export stubs in ${path.relative(repoRoot, filePath)}`,
      );
    }
    if (/\bawait\s+\(void\s+0\)\s*\(/.test(content)) {
      throw new Error(
        `built bridge output contains void 0 stub in ${path.relative(repoRoot, filePath)}`,
      );
    }
    if (/require\([^)]*packages\/db\/dist\/runtime\.js/.test(content)) {
      throw new Error(
        `built bridge output contains require() of ESM runtime.js in ${path.relative(repoRoot, filePath)}`,
      );
    }
    if (/createRequire\)\([^)]*\)\([^)]*runtime\.js/.test(content)) {
      throw new Error(
        `built bridge output contains createRequire() of runtime.js in ${path.relative(repoRoot, filePath)}`,
      );
    }
  }
}

export function readTaskRouteNftFiles(webRoot) {
  const nftPath = path.join(webRoot, '.next/server/app/api/v1/tasks/route.js.nft.json');
  const nft = JSON.parse(fs.readFileSync(nftPath, 'utf8'));
  return Array.isArray(nft.files) ? nft.files : [];
}
