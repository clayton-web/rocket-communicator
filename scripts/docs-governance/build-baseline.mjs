#!/usr/bin/env node
/**
 * Freezes the normalized pre-representation baseline of docs/DECISIONS.md.
 *
 *   pnpm docs:decisions:baseline           # create it if it does not exist
 *   pnpm docs:decisions:baseline --force   # refreeze an existing baseline
 *
 * Refreezing is a reviewed governance act, never a way to clear a failing check: it destroys
 * the evidence the failing check was comparing against. `--force` therefore exists, refuses to
 * run quietly, and prints what changed.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { format, resolveConfig } from 'prettier';

import { buildBaseline, serializeBaseline } from './lib/baseline.mjs';
import { parseRegister } from './lib/parse-register.mjs';
import { BASELINE_PATH, REGISTER_PATH, REPO_ROOT } from './paths.mjs';

const force = process.argv.includes('--force');

if (existsSync(BASELINE_PATH) && !force) {
  process.stderr.write(
    `A baseline already exists at ${path.relative(REPO_ROOT, BASELINE_PATH)}.\n` +
      'It is frozen evidence of the pre-representation register. Refreezing it discards that\n' +
      'evidence and is a reviewed governance act — pass --force only with that authority.\n',
  );
  process.exit(2);
}

const source = readFileSync(REGISTER_PATH, 'utf8');
const { records, problems } = parseRegister(source);

if (problems.length > 0) {
  for (const problem of problems) {
    process.stderr.write(`line ${problem.line}: ${problem.message}\n`);
  }
  process.stderr.write('Refusing to freeze a baseline from a register that does not parse.\n');
  process.exit(1);
}

const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
}).trim();

const baseline = buildBaseline({
  records,
  source,
  sourcePath: path.relative(REPO_ROOT, REGISTER_PATH),
  commit,
});

const previous = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : null;

// Formatted through the repository's own Prettier configuration so the committed artifact
// satisfies `pnpm format:check` and regenerating it stays byte-reproducible.
const prettierOptions = await resolveConfig(BASELINE_PATH);
const serialized = await format(serializeBaseline(baseline), {
  ...prettierOptions,
  filepath: BASELINE_PATH,
  parser: 'json',
});

mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
writeFileSync(BASELINE_PATH, serialized);

const { first, last, count } = baseline.artifact.idRange;
process.stdout.write(
  `Froze ${count} record(s) ${first}–${last} from ${baseline.artifact.capturedFrom} at ${commit}.\n`,
);

if (previous !== null) {
  const before = new Set(previous.records.map((record) => record.id));
  const after = new Set(baseline.records.map((record) => record.id));
  const added = [...after].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));
  const restated = baseline.records.filter((record) => {
    const old = previous.records.find((candidate) => candidate.id === record.id);
    return old !== undefined && old.operative.digest !== record.operative.digest;
  });

  process.stdout.write(
    `Refroze over a previous baseline: ${added.length} added, ${removed.length} removed, ${restated.length} with different operative text.\n`,
  );
  if (removed.length > 0) process.stdout.write(`  removed: ${removed.join(', ')}\n`);
  if (restated.length > 0) {
    process.stdout.write(`  operative text differs: ${restated.map((r) => r.id).join(', ')}\n`);
  }
}
