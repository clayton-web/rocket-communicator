import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertLocalDatabaseUrl } from '../scripts/assert-local-database-url.mjs';

/**
 * A8.7b-INCIDENT-1b migration-command safety and repair-boundary guards.
 *
 * Production is serving A8 code against a database holding only the five pre-A8 migrations.
 * Repairing it means applying exactly the five A8 migrations that exist at `ee5e82a`, from a
 * detached worktree at that commit — `prisma migrate deploy` cannot apply a subset, so the
 * worktree is what bounds the set.
 *
 * The incident was created by a command reaching further than its operator intended. These
 * guards make the two ways that can happen fail a build instead: a package script that
 * inherits a `DATABASE_URL` nobody named, and a drift back to a nine-migration boundary.
 */

const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '../..');

/** The commit Production is serving, and the only commit the repair may migrate from. */
const PRODUCTION_COMMIT = 'ee5e82a';

/** The five A8 migrations present at `ee5e82a`. Applying these repairs the incident. */
const REPAIR_MIGRATIONS = [
  '20260731040000_a8_reminder_persistence',
  '20260731170000_a8_3b_reminder_concurrency',
  '20260731230000_a8_advance_waiting_skip',
  '20260801120000_a8_4a_worker_safety',
  '20260802094500_a8_4a_settlement_marker',
] as const;

/** The four A8 migrations that exist only at HEAD. Applying these during the repair is prohibited. */
const PROHIBITED_MIGRATIONS = [
  '20260802173000_a8_4b1_capability_skip_reason',
  '20260802210000_a8_4b2_repeated_ambiguous_stop_reason',
  '20260803090000_a8_4b3_advance_due_scan_index',
  '20260803120000_a8_5a_owner_notification_intents',
] as const;

const PRE_A8_MIGRATION_COUNT = 5;

describe('A8.7b-INCIDENT migration command safety', () => {
  const pkg = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('declares no package script that runs Prisma Migrate against an inherited DATABASE_URL', () => {
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (!/\bmigrate\b/.test(command)) continue;
      expect(
        command,
        `script "${name}" runs Prisma Migrate without the loopback guard, so it would inherit ` +
          'whatever DATABASE_URL is in scope — including one loaded silently from packages/db/.env',
      ).toContain('run-local-prisma.mjs');
    }
  });

  it('no longer exposes the removed unguarded migration scripts', () => {
    for (const removed of ['migrate:deploy', 'migrate:dev', 'migrate:status']) {
      expect(pkg.scripts, `${removed} must stay removed`).not.toHaveProperty(removed);
    }
  });

  it('asserts loopback before spawning the Prisma child process', () => {
    const runner = readFileSync(path.join(packageRoot, 'scripts/run-local-prisma.mjs'), 'utf8');
    const assertedAt = runner.indexOf('assertLocalDatabaseUrl(LOCAL_DATABASE_URL)');
    // `lastIndexOf` reaches the call site rather than the import at the top of the file.
    const spawnedAt = runner.lastIndexOf('spawnSync(');

    expect(assertedAt, 'the runner must assert the URL is loopback').toBeGreaterThan(-1);
    expect(spawnedAt, 'the runner must spawn Prisma').toBeGreaterThan(-1);
    expect(assertedAt, 'the loopback assertion must run before Prisma is spawned').toBeLessThan(
      spawnedAt,
    );
  });

  it('rejects every non-loopback migration target', () => {
    const rejected = [
      'postgresql://user:pw@aws-us-west-1.pooler.supabase.com:5432/postgres',
      'postgresql://user:pw@db.exampleprojectref.supabase.co:5432/postgres',
      'postgresql://user:pw@10.0.0.5:5432/postgres',
      'postgresql://user:pw@example.com:5432/postgres',
      // A loopback host that redirects off loopback through a libpq query parameter.
      'postgresql://user:pw@127.0.0.1:5432/postgres?host=aws-us-west-1.pooler.supabase.com',
    ];

    for (const url of rejected) {
      expect(() => assertLocalDatabaseUrl(url), `${url} must be refused`).toThrow();
    }
  });

  it('accepts only loopback targets, and requires a URL at all', () => {
    expect(() =>
      assertLocalDatabaseUrl('postgresql://prisma:prisma@127.0.0.1:5433/prisma?schema=public'),
    ).not.toThrow();
    expect(() =>
      assertLocalDatabaseUrl('postgresql://prisma:prisma@localhost:5433/prisma?schema=public'),
    ).not.toThrow();

    expect(() => assertLocalDatabaseUrl(undefined)).toThrow();
    expect(() => assertLocalDatabaseUrl('')).toThrow();
    expect(() => assertLocalDatabaseUrl('not-a-url')).toThrow();
  });

  it('keeps the example environment files pointed at loopback only', () => {
    for (const file of ['.env.example', '.env.docker.example']) {
      const contents = readFileSync(path.join(packageRoot, file), 'utf8');
      const active = contents
        .split('\n')
        .filter((line) => /^\s*DATABASE_URL\s*=/.test(line))
        .map((line) => line.trim());

      expect(active, `${file} must declare exactly one active DATABASE_URL`).toHaveLength(1);
      expect(active[0], `${file} must point at loopback`).toMatch(
        /@(127\.0\.0\.1|localhost):\d+\//,
      );
    }
  });

  it('commits no concrete Supabase pooler host or project reference', () => {
    const tracked = spawnSync('git', ['ls-files', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    // Without git there is nothing to assert about what is committed.
    if (tracked.status !== 0) return;

    const files = tracked.stdout.split('\0').filter(Boolean);
    expect(files.length).toBeGreaterThan(0);

    // A real region makes the host resolvable; `<REGION>` and friends do not.
    const concretePoolerHost = /aws-[a-z]+-[a-z]+-\d+\.pooler\.supabase\.com/;
    const concreteProjectRef = /\bdb\.[a-z]{16,}\.supabase\.co\b|\bpostgres\.[a-z]{16,}\b/;

    // The guards themselves must name the shapes they forbid.
    const selfReferential = new Set([
      'packages/db/__tests__/a8-7b-incident-migration-safety.test.ts',
      'apps/web/__tests__/a8-7a-rollout-doc-guards.test.ts',
    ]);

    for (const file of files) {
      if (selfReferential.has(file)) continue;

      const absolute = path.join(repoRoot, file);
      if (!existsSync(absolute)) continue;

      let contents: string;
      try {
        contents = readFileSync(absolute, 'utf8');
      } catch {
        continue;
      }

      expect(contents, `${file} must not commit a concrete Supabase pooler host`).not.toMatch(
        concretePoolerHost,
      );
      expect(contents, `${file} must not commit a Supabase project reference`).not.toMatch(
        concreteProjectRef,
      );
    }
  });
});

describe('A8.7b-INCIDENT repair boundary', () => {
  const migrationsDir = path.join(packageRoot, 'prisma/migrations');

  it('holds exactly the five repair migrations and the four prohibited ones at HEAD', () => {
    const present = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    const a8 = present.filter((name) => name.includes('_a8'));

    expect(a8).toEqual([...REPAIR_MIGRATIONS, ...PROHIBITED_MIGRATIONS].sort());
    expect(a8).toHaveLength(9);
    expect(present).toHaveLength(PRE_A8_MIGRATION_COUNT + 9);
  });

  it('proves the repair set is exactly what a worktree at the production commit would hold', () => {
    const tree = spawnSync(
      'git',
      ['ls-tree', '--name-only', PRODUCTION_COMMIT, 'packages/db/prisma/migrations/'],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    // A shallow CI clone need not contain the commit. Absence is not evidence of a wrong
    // boundary, so this assertion runs only where the object is reachable.
    if (tree.status !== 0 || tree.stdout.trim() === '') return;

    const names = tree.stdout
      .split('\n')
      .map((line) => path.basename(line.trim()))
      .filter((name) => name !== '' && name !== 'migration_lock.toml')
      .sort();

    expect(names).toHaveLength(PRE_A8_MIGRATION_COUNT + REPAIR_MIGRATIONS.length);
    for (const migration of REPAIR_MIGRATIONS) {
      expect(names, `${migration} must exist at ${PRODUCTION_COMMIT}`).toContain(migration);
    }
    for (const migration of PROHIBITED_MIGRATIONS) {
      expect(names, `${migration} must NOT exist at ${PRODUCTION_COMMIT}`).not.toContain(migration);
    }
  });
});
