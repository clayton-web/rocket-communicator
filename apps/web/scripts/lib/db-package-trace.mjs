/**
 * Shared helpers for @aicaa/db output-file tracing verification (no database access).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, Module } from 'node:module';

export const RHEL_ENGINE = 'libquery_engine-rhel-openssl-3.0.x.so.node';
export const SCHEMA_FILE = 'schema.prisma';
export const INVALID_ROOT_PATTERN = '/ROOT/packages/db';
export const DB_PACKAGE_LITERAL = '@aicaa/db/runtime';
export const DB_TESTING_LITERAL = '@aicaa/db/testing';
export const DOMAIN_PACKAGE_LITERAL = '@aicaa/domain';

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
];

export const PGLITE_MARKERS = [
  '@electric-sql/pglite',
  'pglite-prisma-adapter',
  'create-test-database.js',
];

export const DB_BACKED_API_ROUTE_NFTS = [
  'app/api/v1/tasks/route.js.nft.json',
  'app/api/v1/tasks/[taskId]/route.js.nft.json',
  'app/api/v1/capabilities/[token]/tasks/[taskId]/route.js.nft.json',
];

export const DB_BACKED_PAGE_ROUTE_NFTS = ['app/c/[token]/page.js.nft.json'];

export const DB_BACKED_ROUTE_NFTS = [
  ...DB_BACKED_API_ROUTE_NFTS,
  ...DB_BACKED_PAGE_ROUTE_NFTS,
];

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

export function materializeNftLayout({ webRoot, repoRoot, nftRelativePath }) {
  const nftPath = path.join(webRoot, '.next/server', nftRelativePath);
  const nft = JSON.parse(fs.readFileSync(nftPath, 'utf8'));
  const files = Array.isArray(nft.files) ? nft.files : [];
  const serverRoot = path.dirname(nftPath);
  const layoutRoot = fs.mkdtempSync(path.join(webRoot, '.nft-sim-'));
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

  return { layoutRoot, routeJs };
}

export function simulateRouteRuntimeRequire({ webRoot, repoRoot, nftRelativePath }) {
  const { layoutRoot, routeJs } = materializeNftLayout({ webRoot, repoRoot, nftRelativePath });
  const req = createRequire(routeJs);
  const resolved = req.resolve(DB_PACKAGE_LITERAL);
  const loaded = req(DB_PACKAGE_LITERAL);

  for (const exportName of REQUIRED_RUNTIME_EXPORTS) {
    if (typeof loaded[exportName] === 'undefined') {
      throw new Error(`loaded runtime missing export: ${exportName}`);
    }
  }

  if (typeof loaded.createTestDatabase !== 'undefined') {
    throw new Error('loaded runtime unexpectedly exports createTestDatabase');
  }

  const required = getRequiredDbPackageRuntimeFiles(repoRoot);
  assertRuntimeGraphExcludesPglite(required.importGraphJs, repoRoot);
  assertNoTopLevelAwait(required.runtimeJs);

  let pgliteRequested = false;
  const originalLoad = Module.prototype.require;
  Module.prototype.require = function patchedRequire(specifier) {
    if (
      specifier === '@electric-sql/pglite' ||
      specifier === 'pglite-prisma-adapter' ||
      String(specifier).includes('create-test-database')
    ) {
      pgliteRequested = true;
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    req(DB_PACKAGE_LITERAL);
  } finally {
    Module.prototype.require = originalLoad;
    fs.rmSync(layoutRoot, { recursive: true, force: true });
  }

  if (pgliteRequested) {
    throw new Error('runtime require attempted to load PGlite/test modules');
  }

  return { resolved, exportNames: Object.keys(loaded).sort() };
}

export function readTaskRouteNftFiles(webRoot) {
  const nftPath = path.join(webRoot, '.next/server/app/api/v1/tasks/route.js.nft.json');
  const nft = JSON.parse(fs.readFileSync(nftPath, 'utf8'));
  return Array.isArray(nft.files) ? nft.files : [];
}
