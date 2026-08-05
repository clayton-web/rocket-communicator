import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A8.7b-INCIDENT-1f Gate 4 documentation guards.
 *
 * Gate 4 applies A8 migrations 6–9 to Production. Every published expectation before it was
 * written for the five-migration repair, where the notification objects were *required to be
 * absent* and ten history rows were the correct answer. After Gate 4 both statements invert, and
 * an operator verifying Gate 4 against the repair's expectations would read a correct migration
 * as a hard stop — or, worse, read the repair's `tasks` lock probe as covering a gate whose only
 * lock is on `task_reminder_schedules`.
 *
 * These guards assert the specific load-bearing facts of the Gate 4 runbook and derive the
 * migration and object names from the migration SQL rather than restating them, so the
 * documentation cannot drift away from what the migrations actually do. They deliberately do not
 * assert prose; wording is what architecture review is for.
 */

const repoRoot = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(repoRoot, 'packages/db/prisma/migrations');

function read(relativePath: string): string {
  const absolute = path.join(repoRoot, relativePath);
  expect(existsSync(absolute), `${relativePath} must exist`).toBe(true);
  return readFileSync(absolute, 'utf8');
}

const GATE_4_HEADING = '### Gate 4 — Production migrations 6–9';

/** The ten migrations Production holds before Gate 4, in application order. */
const BASELINE_TEN = [
  '20260713190000_a4_persistence_foundation',
  '20260716140000_a5_gmail_persistence',
  '20260717180000_a6_suggestion_persistence',
  '20260718210000_a7_handoff_persistence',
  '20260718223000_a7_handoff_concurrency_hardening',
  '20260731040000_a8_reminder_persistence',
  '20260731170000_a8_3b_reminder_concurrency',
  '20260731230000_a8_advance_waiting_skip',
  '20260801120000_a8_4a_worker_safety',
  '20260802094500_a8_4a_settlement_marker',
] as const;

/** The four migrations Gate 4 applies, in application order. */
const GATE_4_FOUR = [
  '20260802173000_a8_4b1_capability_skip_reason',
  '20260802210000_a8_4b2_repeated_ambiguous_stop_reason',
  '20260803090000_a8_4b3_advance_due_scan_index',
  '20260803120000_a8_5a_owner_notification_intents',
] as const;

/** The table migration 8 locks, and the one the repair's probe does not cover. */
const INDEXED_TABLE = 'task_reminder_schedules';

function runbook(): string {
  return read('docs/DEPLOYMENT.md');
}

/** The Gate 4 section alone, so a fact stated only for the repair cannot satisfy a Gate 4 guard. */
function gate4Section(): string {
  const contents = runbook();
  const start = contents.indexOf(GATE_4_HEADING);
  expect(start, 'the Gate 4 runbook section must exist').toBeGreaterThan(-1);

  // The next `###` heading bounds the section; `####` subsections belong to it.
  const rest = contents.slice(start + GATE_4_HEADING.length);
  const end = rest.search(/\n### [^#]/);
  return end === -1 ? rest : rest.slice(0, end);
}

function migrationSql(name: string): string {
  return readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8');
}

describe('Gate 4 runbook exists and is bounded to migrations 6–9', () => {
  it('names Gate 4 as its own section with the migration set in the heading', () => {
    expect(runbook(), 'Gate 4 must be findable without chat history').toContain(GATE_4_HEADING);
  });

  it('pins the baseline ten and the Gate 4 four against the migrations on disk', () => {
    const present = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(present, 'HEAD must hold exactly the fourteen documented migrations').toEqual(
      [...BASELINE_TEN, ...GATE_4_FOUR].sort(),
    );
  });

  it('names all four pending migrations inside the Gate 4 section', () => {
    const section = gate4Section();
    for (const migration of GATE_4_FOUR) {
      expect(section, `Gate 4 must name ${migration} as part of its set`).toContain(migration);
    }
  });

  it('names the expected ten baseline migrations as a positive pre-migration assertion', () => {
    const section = gate4Section();
    for (const migration of BASELINE_TEN) {
      expect(section, `the Gate 4 baseline must name ${migration}`).toContain(migration);
    }
    expect(
      section,
      'a matching row count with a non-matching name set must be called a stop',
    ).toMatch(/names must be exactly these|names do not match/i);
  });

  it('cannot be confused with the five-migration repair', () => {
    const section = gate4Section();

    expect(section, 'the repair must be named as a different operation').toMatch(
      /Gate 4 is not the five-migration repair/i,
    );
    expect(section, 'the repair worktree commit must be distinguished from the Gate 4 one').toMatch(
      /ee5e82a/,
    );
    expect(section, 'the repair stages must be excluded from the Gate 4 path').toMatch(
      /Stage 1[^\n]*Stage 10/,
    );
  });
});

describe('Gate 4 migration expectations are the fourteen-row ones', () => {
  it('requires exactly fourteen fully applied rows after Gate 4', () => {
    const section = gate4Section();

    expect(section, 'the post-Gate-4 row count must be fourteen').toMatch(
      /\*\*Exactly fourteen rows\*\*/,
    );
    expect(section, 'every row must have a non-null finished_at').toMatch(
      /fourteen have a non-null `finished_at`/,
    );
    expect(section, 'every row must have a null rolled_back_at').toMatch(
      /fourteen have a null `rolled_back_at`/,
    );
    expect(section, 'every row must carry applied_steps_count = 1').toMatch(
      /fourteen have `applied_steps_count = 1`/,
    );
    expect(section, 'migrations 6–9 must be required present').toMatch(
      /[Mm]igrations 6–9 are present/,
    );
    expect(section, 'Q3 must still be required to return zero rows').toMatch(
      /Q3 returns zero rows/,
    );
  });

  it('never presents ten rows or absent migrations 6–9 as correct after Gate 4', () => {
    const section = gate4Section();

    expect(section, 'ten rows is the pre-Gate-4 baseline, never the result').not.toMatch(
      /(?:exactly )?(?:ten|fourteen|14) rows[^\n]{0,80}after Gate 4[^\n]{0,80}(?:6–9|migrations) absent/i,
    );
    expect(
      section,
      'the absence of migrations 6–9 must not be a post-Gate-4 expectation',
    ).not.toMatch(/[Mm]igrations 6–9 (?:remain|must be|are) absent/);
  });

  it('corrects Q2 so the published stop threshold is not ten rows after Gate 4', () => {
    const q2 = runbook().match(/^\| \*\*Q2\*\*.*$/m)?.[0] ?? '';
    expect(q2, 'Q2 must exist').not.toBe('');

    expect(q2, 'Q2 must state the post-Gate-4 count').toMatch(/fourteen after Gate 4/i);
    expect(q2, 'Q2 must scope the ten-row expectation to the pre-Gate-4 baseline').toMatch(
      /pre-Gate-4 baseline/i,
    );
    expect(q2, 'Q2 must stop on a wrong applied_steps_count').toMatch(/applied_steps_count != 1/);
  });

  it('scopes the five-migration expectations and QB to the pre-Gate-4 baseline', () => {
    const contents = runbook();
    const start = contents.indexOf('### Five-migration expectations');
    expect(start, 'the repair expectations section must still exist').toBeGreaterThan(-1);
    const section = contents.slice(start, contents.indexOf('### Stage runbook'));

    expect(section, 'the repair expectations must be scoped, not authoritative forever').toMatch(
      /pre-Gate-4 baseline only/i,
    );
    expect(section, 'the section must point forward to the Gate 4 expectations').toMatch(
      /g411-post-migration-verification/,
    );
    expect(section, 'QB must be marked as a pre-Gate-4 assertion').toMatch(
      /QB is a pre-Gate-4 assertion/i,
    );
  });
});

describe('Gate 4 notification-object expectations are inverted to present', () => {
  it('requires every object migrations 6–9 create, derived from their SQL', () => {
    const section = gate4Section();
    const sql = GATE_4_FOUR.map(migrationSql).join('\n');

    const tables = [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?([a-z_]+)"?/g)].map(
      (match) => match[1],
    );
    expect(tables, 'migration 9 creates the two notification tables').toEqual([
      'owner_notification_intents',
      'owner_notification_attempts',
    ]);

    const enums = [...sql.matchAll(/CREATE TYPE "(OwnerNotification[A-Za-z]*)" AS ENUM/g)].map(
      (match) => match[1],
    );
    expect(enums, 'migration 9 creates five notification enum types').toHaveLength(5);

    for (const object of [...tables, ...enums]) {
      expect(section, `${object} must be required present after Gate 4`).toContain(object);
    }

    for (const label of ['no_actionable_capability', 'repeated_ambiguous_outcomes']) {
      expect(sql, `${label} must come from the Gate 4 set`).toContain(label);
      expect(section, `${label} must be required present after Gate 4`).toContain(label);
    }
  });

  it('states the presence requirements explicitly rather than by implication', () => {
    const section = gate4Section();

    expect(section, 'the presence table must exist').toMatch(
      /Fourteen-migration expectations \(Gate 4\)/,
    );
    expect(section, 'RLS must be required on both new tables').toMatch(
      /RLS on `owner_notification_intents` and `owner_notification_attempts`[^\n]*enabled on both/i,
    );
    expect(section, 'zero RLS policies must be recorded as the approved state').toMatch(
      /policies[^\n]*\*\*zero\*\*[^\n]*(?:deny-by-default|approved)/i,
    );
    expect(section, 'zero unvalidated constraints must be required').toMatch(
      /[Uu]nvalidated constraints[^\n]*\*\*zero\*\*/,
    );
    expect(section, 'the absence of unexpected writes must be required').toMatch(
      /No unexpected data writes/i,
    );
  });

  it('labels the published verification rows with their post-Gate-4 expectation', () => {
    const contents = runbook();
    for (const id of ['Q7', 'Q8', 'Q9', 'Q11', 'Q12', 'Q13']) {
      const row = contents.match(new RegExp(String.raw`^\| \*\*${id}\*\*.*$`, 'm'))?.[0] ?? '';
      expect(row, `${id} must exist`).not.toBe('');
      expect(row, `${id} must state its post-Gate-4 expectation`).toMatch(/After Gate 4 \(6–9\)/);
    }
  });

  it('publishes a runnable positive assertion with its expected tuple', () => {
    const section = gate4Section();

    expect(section, 'the Gate 4 object assertion must be named').toMatch(
      /QG — the Gate 4 positive assertion/,
    );
    expect(section, 'the assertion must count the notification tables').toMatch(
      /AS notification_tables/,
    );
    expect(section, 'the assertion must count RLS-enabled tables').toMatch(/AS rls_enabled/);
    expect(section, 'the assertion must count RLS policies').toMatch(/AS notification_policies/);
    expect(section, 'the assertion must count unvalidated constraints').toMatch(
      /AS unvalidated_constraints/,
    );
    expect(section, 'the expected result must be stated').toMatch(/\*\*`2, 5, 1, 1, 2, 0, 0`\*\*/);
  });
});

describe('Gate 4 lock risk targets the table migration 8 actually locks', () => {
  it('probes task_reminder_schedules and not tasks', () => {
    const section = gate4Section();

    expect(section, 'the probe must lock the indexed table').toMatch(
      new RegExp(String.raw`LOCK TABLE ${INDEXED_TABLE} IN SHARE MODE`),
    );
    expect(section, 'the repair probe on `tasks` must not be reused for Gate 4').not.toMatch(
      /LOCK TABLE tasks\b/,
    );
    expect(section, 'the difference from the repair probe must be stated').toMatch(
      new RegExp(String.raw`table at risk in Gate 4 is \`${INDEXED_TABLE}\`, not \`tasks\``, 'i'),
    );
  });

  it('explains the non-concurrent index build and the write it blocks', () => {
    const section = gate4Section();
    const sql = migrationSql('20260803090000_a8_4b3_advance_due_scan_index');

    expect(sql, 'migration 8 is a plain CREATE INDEX').toMatch(/CREATE INDEX IF NOT EXISTS/);
    expect(sql, 'migration 8 is not concurrent').not.toMatch(/CREATE INDEX CONCURRENTLY/);

    expect(section, 'the non-concurrent build must be named').toMatch(
      /non-concurrent `CREATE INDEX`/i,
    );
    expect(section, 'the SHARE lock must be named').toMatch(/\*\*`SHARE`\*\* lock/);
    expect(section, 'the blocked writes must be stated').toMatch(/blocks every write/i);
  });

  it('requires a pre-migration row count for the locked table', () => {
    const section = gate4Section();

    expect(section, 'the row-count query must be published').toMatch(
      new RegExp(String.raw`SELECT[\s\S]{0,200}FROM ${INDEXED_TABLE};`),
    );
    expect(section, 'the row count must have an evidence field').toMatch(
      /gate4\.schedules\.before/,
    );
    expect(section, 'the count must be repeated after the migration').toMatch(
      /gate4\.schedules\.before` \/ `\.after`|`\.after`/,
    );
  });
});

describe('Gate 4 populated-table branch is documented and gated', () => {
  it('branches on the row count rather than assuming the table is empty', () => {
    const section = gate4Section();

    expect(section, 'the branch must be its own subsection').toMatch(
      /#### G4\.9 The populated-table branch/,
    );
    expect(section, 'the empty case must proceed as committed').toMatch(
      /\*\*Empty\*\*[^\n]*\*\*Proceed\*\*[^\n]*as committed/i,
    );
    expect(section, 'the populated case must stop the normal path').toMatch(
      /\*\*Any rows\*\*[^\n]*Stop the normal path/i,
    );
  });

  it('forbids modifying the committed migration and requires the concurrent forward fix', () => {
    const section = gate4Section();

    expect(section, 'the committed migration must not be edited').toMatch(
      /committed migration is not modified/i,
    );
    expect(section, 'the out-of-band index must be built concurrently').toMatch(
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS/,
    );
    expect(section, 'the exact definition must be verified').toMatch(
      /[Vv]erify the index definition matches the migration exactly/,
    );
    expect(section, 'migration 8 must then be allowed to no-op').toMatch(
      /`CREATE INDEX IF NOT EXISTS` no-op/,
    );
    expect(section, 'a differing definition must be a stop').toMatch(
      /definition that differs[^\n]*hard stop/i,
    );
  });

  it('requires separate Owner authorization before any write on that branch', () => {
    const section = gate4Section();
    expect(section, 'the branch must not be reachable under Gate 4 authorization').toMatch(
      /separate Owner authorization/i,
    );
    expect(section, 'the branch must be documented as unperformed').toMatch(
      /[Nn]othing in this branch is performed or rehearsed/,
    );
  });
});

describe('Gate 4 Owner no-use window', () => {
  it('requires the window and names what may not happen inside it', () => {
    const section = gate4Section();

    expect(section, 'the window must be its own subsection').toMatch(
      /#### G4\.6 Owner no-use window/,
    );
    expect(section, 'reminder writes must be prohibited').toMatch(
      /no reminder creation, modification, or deletion/i,
    );
    expect(section, 'the cron jobs must stay inactive').toMatch(/cron job[^\n]*stays inactive/i);
    expect(section, 'manual scheduler invocation must be prohibited').toMatch(
      /No scheduler endpoint is invoked manually/i,
    );
    expect(section, 'no production reminder write may occur').toMatch(
      /No Production reminder write occurs/i,
    );
  });

  it('states that the reminder write path is functional, so emptiness is not assumable', () => {
    const section = gate4Section();
    expect(section, 'the 1d hotfix removed the accidental protection').toMatch(
      /reminder write path is functional in Production, so emptiness must not be assumed/i,
    );
    expect(section, 'the hotfix must be named as the reason').toMatch(/1d hotfix/);
  });
});

describe('Gate 4 worktree and connection requirements', () => {
  it('requires a fresh detached worktree with fourteen migrations and no .env', () => {
    const section = gate4Section();

    expect(section, 'the worktree commit must be pinned').toMatch(/68bedff/);
    expect(section, 'the worktree must be detached and new').toMatch(/new detached worktree/i);
    expect(section, 'the directory count must be fourteen').toMatch(/\*\*[Ee]xactly fourteen\*\*/);
    expect(section, '.env must be required absent').toMatch(
      /`packages\/db\/\.env`[\s\S]{0,80}\*\*[Aa]bsent\.?\*\*/,
    );
    expect(section, 'dependencies must be installed in the worktree').toMatch(
      /pnpm install --filter @aicaa\/db --ignore-scripts/,
    );
    expect(section, 'the Prisma CLI version must be pinned').toMatch(/6\.19\.3/);
    expect(section, 'the ten-migration worktrees must be excluded').toMatch(
      /ten-migration worktrees must not be used/i,
    );
  });

  it('preserves the session-mode connection strategy', () => {
    const section = gate4Section();

    expect(section, 'the pooler must be named').toMatch(/Supabase Shared Pooler/);
    expect(section, 'session mode must be required').toMatch(/\*\*session\*\* mode/);
    expect(section, 'the port must be 5432').toMatch(/port \*\*`5432`\*\*/);
    expect(section, 'pgbouncer=true must be forbidden').toMatch(/No `pgbouncer=true`/);
    expect(section, 'the string must post-date the rotation').toMatch(
      /fresh connection string taken after the 2026-08-04 credential rotation/i,
    );
    expect(section, 'the secret must be process-scoped').toMatch(/[Ss]upply it process-scoped/);
    expect(section, "the main worktree's .env must be excluded").toMatch(
      /[Nn]ever run from the main worktree's gitignored `packages\/db\/\.env`/,
    );
    expect(section, 'recombining host and port must be forbidden').toMatch(
      /[Nn]ever recombine a host from one string with a port from another/,
    );
  });

  it('requires the exact four-migration pending set before deploying', () => {
    const section = gate4Section();

    expect(section, 'migrate status must report exactly four pending').toMatch(
      /\*\*exactly four\*\* pending migrations/i,
    );
    expect(section, 'the pending-migrations exit code must be recorded').toMatch(
      /exits 1 when migrations are pending/i,
    );
    expect(section, 'one invocation only').toMatch(/pnpm exec prisma migrate deploy/);
  });
});

describe('Gate 4 stop conditions are complete', () => {
  const CONDITIONS: ReadonlyArray<readonly [string, RegExp]> = [
    ['worktree commit or cleanliness', /not at the expected commit, or is not clean/i],
    ['migration directory count', /migration directory count is not \*\*fourteen\*\*/i],
    ['.env present', /`packages\/db\/\.env` exists in the Gate 4 worktree/i],
    ['Prisma version', /reports anything other than \*\*`6\.19\.3`\*\*/],
    ['baseline names', /baseline migration \*\*names\*\* do not match the expected ten/i],
    ['baseline row count', /baseline row count in `_prisma_migrations` is not \*\*ten\*\*/i],
    [
      'baseline row health',
      /baseline row is unfinished, rolled back, or has `applied_steps_count != 1`/i,
    ],
    ['pending set', /anything other than \*\*exactly the four expected pending migrations\*\*/i],
    ['PostgreSQL version', /PostgreSQL major version is not \*\*17\*\*/],
    ['cron-job.org baseline', /cron-job\.org state differs from the recorded baseline/i],
    ['populated table without authorization', /is populated \*\*and\*\* the/i],
    ['lock probe', /lock probe on `task_reminder_schedules` does not return promptly/i],
    ['migrate deploy exit code', /`prisma migrate deploy` exits non-zero/],
    ['advisory lock timeout', /advisory-lock acquisition timeout occurs/i],
    ['post-migration row count', /row count in `_prisma_migrations` is not \*\*fourteen\*\*/i],
    ['verification mismatch', /post-migration verification differs from the expected object set/i],
    ['unexpected write or scheduler activity', /unexpected write, or any scheduler activity/i],
  ];

  it.each(CONDITIONS)('stops on %s', (_label, pattern) => {
    expect(gate4Section()).toMatch(pattern);
  });

  it('keeps every stop condition in one enumerated list', () => {
    const section = gate4Section();
    const start = section.indexOf('#### G4.12 Stop conditions');
    expect(start, 'the stop-condition subsection must exist').toBeGreaterThan(-1);

    const rows = section.slice(start).match(/^\| \d+ +\|/gm) ?? [];
    expect(rows.length, 'no stop condition may be dropped from the list').toBeGreaterThanOrEqual(
      CONDITIONS.length,
    );
  });

  it('forbids the four unsafe responses to a stop', () => {
    const section = gate4Section();

    expect(section, 'blind reruns must be forbidden').toMatch(/Do not rerun blindly/i);
    expect(section, 'resolve from the history row alone must be forbidden').toMatch(
      /Do not call `migrate resolve` on the strength of `_prisma_migrations` alone/i,
    );
    expect(section, 'hand-patching must be forbidden').toMatch(/Do not hand-patch/i);
    expect(section, 'the recovery tree must be the documented path').toMatch(
      /per-migration recovery decision tree/i,
    );
  });
});

describe('Gate 4 containment, rollback, and the boundary at Gate 5', () => {
  it('records the schema-ahead-of-code resting state accurately', () => {
    const section = gate4Section();

    expect(section, 'the code must stay on the validated commit').toMatch(
      /leaves Production code on `534959d`/i,
    );
    expect(section, 'D2 must be named as a safe resting state').toMatch(
      /`D2` is a safe resting state/i,
    );
    expect(section, 'all four migrations must be described as additive').toMatch(
      /all four migrations are additive/i,
    );
    expect(section, 'the absence of a down migration must be stated').toMatch(/no down migration/i);
    expect(section, 'stopping before deployment must be the response to a problem').toMatch(
      /stop before deployment, not to roll back the schema/i,
    );
  });

  it('records one-step rollback as unsafe rather than as containment', () => {
    const section = gate4Section();

    expect(section, 'the one-step target must be named').toContain(
      'dpl_AnUKqdGj3gBw7N56yUT4pMBAVbac',
    );
    expect(section, 'the reminder defect must be named as a consequence').toMatch(
      /reinstates the reminder defect/i,
    );
    expect(section, 'the pre-rotation binding must be named').toMatch(
      /pre-rotation `DATABASE_URL`/,
    );
    expect(section, 'one-step rollback must be declared unavailable').toMatch(
      /[Tt]reat one-step rollback as unavailable/,
    );
    expect(section, 'the hotfix must be preserved and redeployable').toMatch(
      /not an ancestor of `main`/i,
    );
  });

  it('stops before Gate 5 and before flag staging', () => {
    const section = gate4Section();

    expect(section, 'the stop must be its own subsection').toMatch(
      /#### G4\.14 Stop before Gate 5/,
    );
    expect(section, 'Gate 4 must not authorize Gate 5 or Gate 6').toMatch(
      /Gate 4 does not authorize Gate 5 or Gate 6/i,
    );
    expect(section, 'pushing must be treated as a deployment decision').toMatch(
      /push to `main` deploys automatically/i,
    );
    expect(section, 'flag staging must remain out of scope').toMatch(
      /Setting any A8 flag, creating any scheduler job/i,
    );
  });

  it('requires its own authorization and does not inherit an earlier one', () => {
    const section = gate4Section();

    expect(section, 'Gate 4 must require explicit authorization').toMatch(
      /Gate 4 requires its own explicit Owner authorization/i,
    );
    expect(section, 'earlier authorizations must not carry forward').toMatch(
      /does not carry into it/i,
    );
    expect(section, 'the rehearsal must not be read as authorization').toMatch(
      /evidence about the migrations, not an authorization to run them/i,
    );
  });
});

describe('Gate 4 documentation carries no credential', () => {
  it('records no connection string and no concrete pooler host', () => {
    const section = gate4Section();
    expect(section, 'no connection string may appear').not.toMatch(
      /postgresql:\/\/[^\s`"<>]*:[^\s`"<>]*@/,
    );
    expect(section, 'no concrete pooler host may appear').not.toMatch(
      /aws-[a-z]+-[a-z]+-\d+\.pooler\.supabase\.com/,
    );
  });
});
