/**
 * Append-only source guard for acceptance-time responsibility-selection evidence (D168).
 *
 * Unique `suggestion_id` / `task_id` hold the carrier to one initial acceptance record; they are
 * cardinality protection, not immutability. Immutability is enforced here by forbidding non-test
 * source from calling Prisma rewrite / delete / upsert methods on the delegate, so this evidence
 * cannot quietly turn into mutable current-responsibility state or a responsibility-history stream.
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

const DELEGATE = 'taskSuggestionResponsibilitySelection';

const FORBIDDEN = ['update', 'updateMany', 'delete', 'deleteMany', 'upsert'].map((method) => ({
  label: `${DELEGATE}.${method}`,
  pattern: new RegExp(`\\b${DELEGATE}\\s*\\.\\s*${method}\\s*\\(`),
}));

const repositoryPath = 'packages/db/src/repositories/responsibility-selection-repository.ts';

describe('D168 responsibility-selection append-only source guard', () => {
  const files = SCAN_ROOTS.flatMap((root) => walkTypeScriptFiles(root));

  it('scans non-test application/package source', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith('responsibility-selection-repository.ts'))).toBe(true);
  });

  it(`forbids rewrite/delete/upsert Prisma calls on ${DELEGATE} outside tests`, () => {
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
      'Responsibility-selection rows are append-only evidence of the Owner\u2019s initial ' +
        'acceptance decision. Non-test source must not call Prisma ' +
        'update/updateMany/delete/deleteMany/upsert on ' +
        `${DELEGATE}. Later reassignment, clearing, and return-to-Owner belong to ` +
        'TaskAssignment/handoff/audit, not to this carrier (D168).',
    ).toEqual([]);
  });

  it('exposes only create and organization-scoped reads from the repository module', () => {
    const source = stripComments(readFileSync(path.join(repoRoot, repositoryPath), 'utf8'));
    expect(source).toMatch(/export async function createResponsibilitySelection/);
    expect(source).toMatch(/export async function getResponsibilitySelectionBySuggestionId/);
    expect(source).toMatch(/export async function getResponsibilitySelectionByTaskId/);
    expect(source).not.toMatch(/export async function update/);
    expect(source).not.toMatch(/export async function delete/);
    expect(source).not.toMatch(/export async function upsert/);
    expect(source).not.toMatch(/export async function set/);
    expect(source).not.toMatch(/export async function clear/);
  });

  it('keeps AuditEvent out of the responsibility-evidence role', () => {
    const auditRepository = stripComments(
      readFileSync(path.join(repoRoot, 'packages/db/src/repositories/audit-repository.ts'), 'utf8'),
    );
    expect(auditRepository).not.toMatch(/partyKind|responsibleParty|responsibilitySelection/);
  });

  it('records the evidence only inside the approve transaction, with no later write path', () => {
    const producers: string[] = [];
    for (const file of SCAN_ROOTS.flatMap((root) => walkTypeScriptFiles(root))) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/\bcreateResponsibilitySelection\s*\(/.test(code)) {
        producers.push(path.relative(repoRoot, file));
      }
    }
    expect(producers.sort()).toEqual([
      'packages/db/src/repositories/responsibility-selection-repository.ts',
      'packages/db/src/transactions/a6-owner-suggestion-transactions.ts',
    ]);
  });
});
