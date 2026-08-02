import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Repository-wide guard against one specific false statement.
 *
 * Several A8 migration comments, and the documentation and tests written from them, asserted that
 * Prisma applies each migration file inside a single transaction, and then reasoned from it — about
 * enum-visibility ordering, and about whether a `NOT VALID` / `VALIDATE` split can reduce lock
 * duration. The repository establishes only that migrations are applied with `prisma migrate deploy`.
 * It establishes nothing about transaction grouping, so nothing may be concluded from it.
 *
 * The claim spread by being copied from one migration into the next. This guard is the stop: it
 * scans documentation, TypeScript, and migration SQL and fails on the wording, so a future slice
 * cannot reintroduce it by imitation.
 *
 * What is deliberately NOT banned: accurate discussion of transactions the repository really does
 * open (`prisma.$transaction`, `Prisma.TransactionClient`, the A8.3a/A8.4a settlement transactions),
 * and accurate statements about PostgreSQL's own behaviour, such as its restriction on using a
 * freshly added enum value in the transaction that added it. Only the attribution to Prisma is wrong.
 */

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..', '..', '..');

/** Directories that are never source: dependencies, build output, and generated code. */
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  '.git',
  'coverage',
  'generated',
]);

/**
 * Three migration files whose header comments still carry the claim.
 *
 * They are applied in local developer databases, and editing an applied migration changes its
 * recorded checksum, which breaks `prisma migrate deploy` against those databases. Rewriting history
 * to fix a comment is the more damaging option, so the comments stay and DEPLOYMENT.md carries the
 * authoritative correction. Production has none of these applied; the SQL statements are unaffected.
 *
 * This list is closed. A new migration that repeats the claim is a guard failure, not an addition.
 */
const GRANDFATHERED_MIGRATIONS = [
  'packages/db/prisma/migrations/20260802094500_a8_4a_settlement_marker/migration.sql',
  'packages/db/prisma/migrations/20260802173000_a8_4b1_capability_skip_reason/migration.sql',
  'packages/db/prisma/migrations/20260802210000_a8_4b2_repeated_ambiguous_stop_reason/migration.sql',
];

/** This guard quotes the banned wording as fixtures, so it cannot scan itself. */
const SELF = 'packages/db/__tests__/no-prisma-transaction-claim.test.ts';

const EXEMPT = new Set([...GRANDFATHERED_MIGRATIONS, SELF]);

/** Literal phrasings of the claim, matched case-insensitively. */
const BANNED_PHRASES = [
  /prisma\s+wraps/i,
  /wraps\s+each\s+migration/i,
  /wraps\s+a\s+migration/i,
  /prisma\s+runs\s+each\s+migration\s+in\s+(a|one)\s+transaction/i,
];

/**
 * "wrapped in a transaction" is only wrong when the same sentence pins it on Prisma — an explicitly
 * transactional custom migration may accurately describe itself that way.
 */
const PASSIVE_WRAP = /wrapped\s+in\s+(a|one)\s+transaction/i;

/** Split on sentence terminators and line breaks, so a SQL comment block splits per line too. */
function sentences(content: string): string[] {
  return content.split(/(?<=[.;!?])\s+|\n/);
}

/** Return every sentence in `content` that states the inaccurate Prisma transaction claim. */
export function findPrismaTransactionClaims(content: string): string[] {
  const offenders: string[] = [];

  for (const sentence of sentences(content)) {
    const banned = BANNED_PHRASES.some((pattern) => pattern.test(sentence));
    const passive = PASSIVE_WRAP.test(sentence) && /prisma/i.test(sentence);
    if (banned || passive) {
      offenders.push(sentence.trim());
    }
  }

  return offenders;
}

function listFiles(dir: string, extensions: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      out.push(...listFiles(path.join(dir, entry.name), extensions));
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** docs + packages + apps sources, plus the root README, as repo-relative POSIX paths. */
function scannedFiles(): string[] {
  const files: string[] = [];

  for (const dir of ['docs', 'packages', 'apps']) {
    const full = path.join(repoRoot, dir);
    if (existsSync(full)) {
      files.push(...listFiles(full, ['.md', '.ts', '.tsx', '.sql']));
    }
  }

  const rootReadme = path.join(repoRoot, 'README.md');
  if (existsSync(rootReadme)) {
    files.push(rootReadme);
  }

  return files
    .map((file) => path.relative(repoRoot, file).split(path.sep).join('/'))
    .filter((file) => !EXEMPT.has(file));
}

describe('no inaccurate Prisma migration-transaction claim', () => {
  it('scans documentation, TypeScript, and migration SQL across the repository', () => {
    const files = scannedFiles();

    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('docs/DEPLOYMENT.md');
    expect(files).toContain('packages/db/README.md');
    expect(files).toContain('README.md');
    expect(files.some((file) => file.startsWith('packages/db/prisma/migrations/'))).toBe(true);
    expect(files.some((file) => file.startsWith('apps/web/'))).toBe(true);
    expect(files.every((file) => !file.includes('node_modules'))).toBe(true);
  });

  it('finds no file claiming that Prisma wraps migrations in a transaction', () => {
    const violations: string[] = [];

    for (const file of scannedFiles()) {
      const content = readFileSync(path.join(repoRoot, file), 'utf8');
      for (const offender of findPrismaTransactionClaims(content)) {
        violations.push(`${file}: ${offender}`);
      }
    }

    expect(
      violations,
      `The repository does not establish how Prisma groups migration statements into transactions, ` +
        `so nothing may be concluded from it. Describe the actual reason instead: enum introduction ` +
        `is kept separate from anything consuming the new value to avoid PostgreSQL enum-visibility ` +
        `and deployment-order hazards. See docs/DEPLOYMENT.md. Offenders:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps the grandfathered migration exemption closed and honest', () => {
    for (const file of GRANDFATHERED_MIGRATIONS) {
      const full = path.join(repoRoot, file);
      expect(existsSync(full), `${file} is exempted but missing`).toBe(true);
      expect(
        findPrismaTransactionClaims(readFileSync(full, 'utf8')).length,
        `${file} no longer contains the claim, so its exemption should be removed`,
      ).toBeGreaterThan(0);
    }
  });

  it('rejects every phrasing of the claim', () => {
    expect(
      findPrismaTransactionClaims('Prisma wraps each migration file in one transaction.'),
    ).toHaveLength(1);
    expect(
      findPrismaTransactionClaims('-- prisma wraps a migration file in one transaction'),
    ).toHaveLength(1);
    expect(
      findPrismaTransactionClaims(
        'Prisma runs each migration in one transaction, so ordering matters.',
      ),
    ).toHaveLength(1);
    expect(
      findPrismaTransactionClaims('Each migration is wrapped in a transaction by Prisma.'),
    ).toHaveLength(1);
  });

  it('allows accurate transaction and PostgreSQL discussion', () => {
    expect(
      findPrismaTransactionClaims(
        'PostgreSQL restricts using a freshly added enum value in the same transaction that added it.',
      ),
    ).toEqual([]);
    expect(
      findPrismaTransactionClaims('The settlement write runs inside prisma.$transaction.'),
    ).toEqual([]);
    expect(findPrismaTransactionClaims('type Client = DbClient | DbTransaction;')).toEqual([]);
    expect(
      findPrismaTransactionClaims('The backfill is wrapped in a transaction by this migration.'),
    ).toEqual([]);
  });
});
