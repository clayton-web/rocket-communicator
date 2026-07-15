/**
 * Shared helpers for @aicaa/db output-file tracing verification (no database access).
 */
import fs from 'node:fs';
import path from 'node:path';

export const RHEL_ENGINE = 'libquery_engine-rhel-openssl-3.0.x.so.node';
export const SCHEMA_FILE = 'schema.prisma';
export const INVALID_ROOT_PATTERN = '/ROOT/packages/db';
export const DB_PACKAGE_LITERAL = '@aicaa/db';

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
  const indexJs = path.join(packageRoot, 'dist/index.js');
  const distDir = path.join(packageRoot, 'dist');
  const generatedClientDir = path.join(distDir, 'generated/client');

  if (!fs.existsSync(packageJson)) {
    throw new Error(`missing ${path.relative(repoRoot, packageJson)}`);
  }
  if (!fs.existsSync(indexJs)) {
    throw new Error(`missing ${path.relative(repoRoot, indexJs)} — run pnpm build:db`);
  }

  const importGraphJs = walkDbPackageRuntimeJsFiles(indexJs);
  const distJs = listDistJsFiles(distDir);
  const rhelEngine = path.join(generatedClientDir, RHEL_ENGINE);
  const schema = path.join(generatedClientDir, SCHEMA_FILE);

  if (!fs.existsSync(rhelEngine)) {
    throw new Error(`missing ${path.relative(repoRoot, rhelEngine)} — run pnpm build:db`);
  }
  if (!fs.existsSync(schema)) {
    throw new Error(`missing ${path.relative(repoRoot, schema)} — run pnpm build:db`);
  }

  return {
    packageJson,
    indexJs,
    importGraphJs,
    distJs,
    rhelEngine,
    schema,
    libraryJs: path.join(generatedClientDir, 'runtime/library.js'),
  };
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
  const missing = [];

  if (!nftIncludesRepoFile(nftFiles, repoRoot, required.packageJson)) {
    missing.push('packages/db/package.json');
  }
  if (!nftIncludesRepoFile(nftFiles, repoRoot, required.indexJs)) {
    missing.push('packages/db/dist/index.js');
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

  for (const jsFile of required.importGraphJs) {
    if (!nftIncludesRepoFile(nftFiles, repoRoot, jsFile)) {
      missing.push(path.relative(repoRoot, jsFile));
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `${routeLabel} NFT trace is missing @aicaa/db runtime files: ${missing.join(', ')}`,
    );
  }

  return required;
}
