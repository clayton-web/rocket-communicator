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
 * inherits a `DATABASE_URL` nobody named, and drift of the fourteen migration directories the
 * incident is defined in terms of.
 *
 * What the repair boundary is made of is a *classification*, not a directory count. The count is
 * a property of how far the product has shipped; the classification is a property of the
 * incident and does not change when the product ships again. So the boundary is asserted as set
 * membership over the historical names below, and the total is deliberately left unbounded —
 * a later non-A8 product migration is ordinary evolution and must not re-baseline this guard,
 * while any new `_a8` directory still fails the exact A8 set assertion.
 */

const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '../..');

/** The commit Production is serving, and the only commit the repair may migrate from. */
const PRODUCTION_COMMIT = 'ee5e82a';

/** The five migrations Production held when the incident was discovered (pre-A8 boundary). */
const PRE_A8_MIGRATIONS = [
  '20260713190000_a4_persistence_foundation',
  '20260716140000_a5_gmail_persistence',
  '20260717180000_a6_suggestion_persistence',
  '20260718210000_a7_handoff_persistence',
  '20260718223000_a7_handoff_concurrency_hardening',
] as const;

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

/** Production pre-repair migration count at the incident — still five, proven at `ee5e82a`. */
const PRE_A8_MIGRATION_COUNT = PRE_A8_MIGRATIONS.length;

/**
 * Every migration the incident is defined in terms of. All fourteen must still exist: deleting,
 * renaming or squashing one rewrites what the repair means.
 */
const HISTORICAL_MIGRATIONS = [
  ...PRE_A8_MIGRATIONS,
  ...REPAIR_MIGRATIONS,
  ...PROHIBITED_MIGRATIONS,
] as const;

/**
 * The A8-classified directories among `names`.
 *
 * This is the detector the boundary rests on now that the total is unbounded, so it is a plain
 * function the fixtures below can exercise directly rather than only through the filesystem.
 */
export function a8MigrationsIn(names: readonly string[]): string[] {
  return names.filter((name) => name.includes('_a8')).sort();
}

/** Historical migrations that have gone missing from `names`. */
export function missingHistoricalMigrations(names: readonly string[]): string[] {
  return HISTORICAL_MIGRATIONS.filter((historical) => !names.includes(historical));
}

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

  const presentMigrations = (): string[] =>
    readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

  it('holds exactly the five repair migrations and the four prohibited ones at HEAD', () => {
    expect(
      a8MigrationsIn(presentMigrations()),
      'the A8 classification is fixed by the incident: a directory matching `_a8` that is not one ' +
        'of the five repair or four prohibited migrations means the repair boundary has moved, ' +
        'and the A8.7b runbook is no longer describing this repository',
    ).toEqual([...REPAIR_MIGRATIONS, ...PROHIBITED_MIGRATIONS].sort());
  });

  it('still holds every migration the incident is defined in terms of', () => {
    expect(
      missingHistoricalMigrations(presentMigrations()),
      'deleting, renaming or squashing one of the fourteen historical migrations rewrites what ' +
        'the repair applies',
    ).toEqual([]);
  });

  /**
   * The total directory count is not asserted anywhere above, so these fixtures are what prove
   * the classification still bites. A count would only have caught an unexpected directory until
   * the next authorized product migration bumped it — which is how this guard came to fail on
   * ordinary growth in the first place.
   */
  it('rejects an unexpected A8 migration while allowing ordinary product growth', () => {
    const atHead = [...HISTORICAL_MIGRATIONS];

    // Ordinary non-A8 product migrations: permitted, however many arrive.
    const grown = [
      ...atHead,
      '20260810210000_interpretation_run_persistence',
      '20260811190000_responsibility_selection_evidence',
      '20270101000000_some_future_product_migration',
    ];
    expect(a8MigrationsIn(grown)).toEqual([...REPAIR_MIGRATIONS, ...PROHIBITED_MIGRATIONS].sort());
    expect(missingHistoricalMigrations(grown)).toEqual([]);

    // A new A8-classified migration: caught, regardless of where it sorts.
    for (const intruder of [
      '20260804000000_a8_6_unexpected_repair',
      '20260731050000_a8_backdated_between_repair_migrations',
    ]) {
      expect(a8MigrationsIn([...atHead, intruder])).toContain(intruder);
      expect(a8MigrationsIn([...atHead, intruder])).not.toEqual(
        [...REPAIR_MIGRATIONS, ...PROHIBITED_MIGRATIONS].sort(),
      );
    }

    // A historical migration going missing: caught.
    expect(
      missingHistoricalMigrations(atHead.filter((name) => name !== REPAIR_MIGRATIONS[0])),
    ).toEqual([REPAIR_MIGRATIONS[0]]);
    expect(
      missingHistoricalMigrations(atHead.filter((name) => name !== PROHIBITED_MIGRATIONS[0])),
    ).toEqual([PROHIBITED_MIGRATIONS[0]]);
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
