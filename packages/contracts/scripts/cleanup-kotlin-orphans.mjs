import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const contractsRoot = path.resolve(root, '..');
const kotlinRoot = path.join(contractsRoot, 'generated', 'kotlin');
const manifestPath = path.join(kotlinRoot, '.openapi-generator', 'FILES');

/**
 * Remove tracked Kotlin generator outputs that are absent from the current manifest.
 * OpenAPI Generator does not delete stale model files when schemas are renamed or removed.
 */
export function cleanupKotlinOrphans({ dryRun = false } = {}) {
  const manifest = new Set(
    readFileSync(manifestPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const orphans = [];

  function walk(relativeDir) {
    const absoluteDir = path.join(kotlinRoot, relativeDir);
    if (!statSync(absoluteDir).isDirectory()) {
      return;
    }

    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const relativePath = path.posix.join(relativeDir.split(path.sep).join('/'), entry.name);
      if (entry.isDirectory()) {
        walk(relativePath);
        continue;
      }

      const normalized = relativePath.split(path.sep).join('/');
      if (!manifest.has(normalized)) {
        orphans.push(path.join(kotlinRoot, relativePath));
      }
    }
  }

  for (const dir of ['docs', 'src']) {
    const absoluteDir = path.join(kotlinRoot, dir);
    if (statSync(absoluteDir).isDirectory()) {
      walk(dir);
    }
  }

  if (dryRun) {
    return orphans;
  }

  for (const orphan of orphans) {
    rmSync(orphan, { force: true });
  }

  return orphans;
}

function main() {
  const dryRun = process.argv.includes('--check');
  const orphans = cleanupKotlinOrphans({ dryRun });

  if (orphans.length > 0) {
    const header = dryRun
      ? 'Stale generated Kotlin artifacts absent from .openapi-generator/FILES:'
      : 'Removed stale generated Kotlin artifacts:';
    console.error(header);
    for (const orphan of orphans) {
      console.error(`  ${path.relative(contractsRoot, orphan)}`);
    }
    if (dryRun) {
      process.exit(1);
    }
  } else if (dryRun) {
    console.log('No stale generated Kotlin artifacts.');
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main();
}
