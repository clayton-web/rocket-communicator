/**
 * Append-only source guard for TaskSuggestion revision evidence (D155).
 *
 * Unique (suggestionId, revisionNumber) is numbering protection only — not immutability.
 * Immutability is enforced here by forbidding non-test source from calling Prisma rewrite /
 * delete / upsert methods on the revision delegate.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..', '..', '..');

const SCAN_ROOTS = [path.join(repoRoot, 'packages'), path.join(repoRoot, 'apps')];

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'generated',
  '.git',
  '__tests__',
  '__mocks__',
  'test',
  'tests',
]);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function walkTypeScriptFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry)) continue;
    const full = path.join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkTypeScriptFiles(full, out);
      continue;
    }
    if (!st.isFile()) continue;
    if (!/\.(ts|tsx|js|jsx|mts|cts)$/.test(entry)) continue;
    if (/\.(test|spec)\.(ts|tsx|js|jsx|mts|cts)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

const FORBIDDEN = [
  {
    label: 'taskSuggestionRevision.update',
    pattern: /\btaskSuggestionRevision\s*\.\s*update\s*\(/,
  },
  {
    label: 'taskSuggestionRevision.updateMany',
    pattern: /\btaskSuggestionRevision\s*\.\s*updateMany\s*\(/,
  },
  {
    label: 'taskSuggestionRevision.delete',
    pattern: /\btaskSuggestionRevision\s*\.\s*delete\s*\(/,
  },
  {
    label: 'taskSuggestionRevision.deleteMany',
    pattern: /\btaskSuggestionRevision\s*\.\s*deleteMany\s*\(/,
  },
  {
    label: 'taskSuggestionRevision.upsert',
    pattern: /\btaskSuggestionRevision\s*\.\s*upsert\s*\(/,
  },
];

describe('TaskSuggestion revision append-only source guard', () => {
  const files = SCAN_ROOTS.flatMap((root) => walkTypeScriptFiles(root));

  it('scans non-test application/package source', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith('task-suggestion-revision-repository.ts'))).toBe(true);
  });

  it('forbids rewrite/delete/upsert Prisma calls on taskSuggestionRevision outside tests', () => {
    const violations: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(code)) {
          violations.push(`${path.relative(repoRoot, file)}: ${rule.label}`);
        }
      }
    }
    expect(
      violations,
      'TaskSuggestion revisions are append-only evidence. Non-test source must not call ' +
        'Prisma update/updateMany/delete/deleteMany/upsert on taskSuggestionRevision. ' +
        'Unique (suggestionId, revisionNumber) is numbering protection only — not DB immutability.',
    ).toEqual([]);
  });

  it('exposes only create/list/latest from the revision repository module', () => {
    const source = stripComments(
      readFileSync(
        path.join(repoRoot, 'packages/db/src/repositories/task-suggestion-revision-repository.ts'),
        'utf8',
      ),
    );
    expect(source).toMatch(/export async function createTaskSuggestionRevision/);
    expect(source).toMatch(/export async function listTaskSuggestionRevisions/);
    expect(source).toMatch(/export async function getLatestTaskSuggestionRevision/);
    expect(source).not.toMatch(/export async function update/);
    expect(source).not.toMatch(/export async function delete/);
    expect(source).not.toMatch(/export async function upsert/);
  });
});
