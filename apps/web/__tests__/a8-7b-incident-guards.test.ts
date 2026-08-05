import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A8.7b-INCIDENT-1b documentation guards.
 *
 * Production is serving A8 code (`ee5e82a`) against a database holding only the five pre-A8
 * migrations. The repair applies exactly the five A8 migrations available at that commit and
 * deploys nothing.
 *
 * The runbook previously described a pre-A8 Production and a nine-migration rollout. An
 * operator following that text during an incident would migrate too far, from the wrong
 * worktree, and then deploy. These guards assert the specific facts that prevent it — never
 * prose style, which is what architecture review is for.
 *
 * Migration-command safety and the boundary itself are guarded in
 * `packages/db/__tests__/a8-7b-incident-migration-safety.test.ts`.
 */

const repoRoot = path.resolve(__dirname, '../../..');

function read(relativePath: string): string {
  const absolute = path.join(repoRoot, relativePath);
  expect(existsSync(absolute), `${relativePath} must exist`).toBe(true);
  return readFileSync(absolute, 'utf8');
}

const PRODUCTION_COMMIT = 'ee5e82a';

const REPAIR_MIGRATIONS = [
  '20260731040000_a8_reminder_persistence',
  '20260731170000_a8_3b_reminder_concurrency',
  '20260731230000_a8_advance_waiting_skip',
  '20260801120000_a8_4a_worker_safety',
  '20260802094500_a8_4a_settlement_marker',
] as const;

const PROHIBITED_MIGRATIONS = [
  '20260802173000_a8_4b1_capability_skip_reason',
  '20260802210000_a8_4b2_repeated_ambiguous_stop_reason',
  '20260803090000_a8_4b3_advance_due_scan_index',
  '20260803120000_a8_5a_owner_notification_intents',
] as const;

describe('A8.7b-INCIDENT baseline truthfulness', () => {
  it('records the production commit and the unmigrated schema as the incident baseline', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    const milestones = read('docs/MILESTONES.md');

    for (const [name, contents] of [
      ['docs/DEPLOYMENT.md', runbook],
      ['docs/MILESTONES.md', milestones],
    ] as const) {
      expect(contents, `${name} must name the deployed production commit`).toContain(
        PRODUCTION_COMMIT,
      );
      expect(contents, `${name} must state the schema is five pre-A8 migrations`).toMatch(
        /five pre-A8 migrations/i,
      );
    }

    expect(runbook).toContain('Current production state');
  });

  it('no longer claims Production runs pre-A8 code', () => {
    for (const file of ['docs/DEPLOYMENT.md', 'docs/MILESTONES.md', 'README.md']) {
      const contents = read(file);
      expect(contents, `${file} must not restate the pre-A8 premise`).not.toMatch(
        /Production currently serves commit `8588c5d/i,
      );
      expect(contents, `${file} must not claim no A8 code is deployed`).not.toMatch(
        /The deployed commit predates every A8 slice/i,
      );
    }
  });

  it('records the corrected P1 completion tag rather than denying it exists', () => {
    const milestones = read('docs/MILESTONES.md');
    expect(milestones).toContain('v0.8.0-p1-complete');
    expect(milestones).toContain('eb79a94');
    expect(milestones).not.toMatch(/No P1 completion tag has been created/i);
  });

  it('records Gmail as connected in Production', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    const milestones = read('docs/MILESTONES.md');
    expect(runbook).toMatch(/Production Gmail is connected/i);
    expect(milestones).toMatch(/Gmail is connected in Production|Connected in Production/i);
  });
});

describe('A8.7b-INCIDENT repair runbook', () => {
  it('bounds the repair at five migrations, each named individually', () => {
    const runbook = read('docs/DEPLOYMENT.md');

    for (const migration of REPAIR_MIGRATIONS) {
      expect(runbook, `the runbook must name ${migration} in the repair set`).toContain(migration);
    }
    for (const migration of PROHIBITED_MIGRATIONS) {
      expect(runbook, `the runbook must name ${migration} as out of scope`).toContain(migration);
    }
  });

  it('prohibits migrating from current HEAD and prohibits migrations 6 through 9', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    const section = runbook.slice(runbook.indexOf('### Repair boundary'));
    expect(section.length).toBeGreaterThan(0);

    expect(section).toMatch(/Running the migration from current HEAD is prohibited/i);
    expect(section).toMatch(/Applying migrations 6 through 9 during the repair is prohibited/i);
    expect(section).toMatch(/detached worktree at `ee5e82a`/i);
  });

  it('retires the original A8.7b rollout rather than leaving it as the plan of record', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    expect(runbook).toMatch(/A8\.7b as originally written is retired/i);
    expect(runbook).toContain('A8.7b-INCIDENT-1c');
  });

  it('keeps the retired deployment stage from telling an operator to deploy', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    const start = runbook.indexOf('#### Stage 9 —');
    const end = runbook.indexOf('#### Stage 10 —');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const stage9 = runbook.slice(start, end);
    expect(stage9).toMatch(/retired/i);
    expect(stage9).toMatch(/must not be performed|Do not deploy/i);
  });

  it('requires a process-scoped credential and an execution worktree with no .env', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    const section = runbook.slice(runbook.indexOf('### Local credential safety'));
    expect(section.length).toBeGreaterThan(0);

    expect(section).toMatch(/must be supplied process-scoped/i);
    expect(section).toMatch(/must contain no `\.env`/i);
    expect(section).toMatch(/Bare migration commands are prohibited/i);
  });

  it('treats containment as a redeployment rather than a one-step Instant Rollback', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    expect(runbook).toMatch(/not assumed to be reachable through one-step Instant Rollback/i);
  });

  it('states the Owner reminder restraint the repair makes necessary', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    expect(runbook).toMatch(
      /Owner must not create or modify a reminder until the later (A8 )?rollout is authorized/i,
    );
  });

  it('records the known migrate status pending-migrations exit code', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    expect(runbook).toMatch(
      /`prisma migrate status` \*\*exits non-zero when migrations are pending/i,
    );
  });
});

describe('A8.7b-INCIDENT review and evidence structure', () => {
  it('publishes the A8.7b-INCIDENT-1c review gates', () => {
    const checklist = read('docs/REVIEW_CHECKLIST.md');
    expect(checklist).toContain('A8.7b-INCIDENT-1c');
    expect(checklist).toMatch(/detached worktree at `ee5e82a`/i);
    expect(checklist).toMatch(/exactly ten\*{0,2} migration directories/i);
    expect(checklist).toMatch(/No migration 6 through 9 was applied/i);
    expect(checklist).toMatch(/Nothing was deployed/i);
    expect(checklist).toMatch(/Nothing was pushed/i);
    expect(checklist).toMatch(/No feature flag changed/i);
    expect(checklist).toMatch(/No Gmail action was taken/i);
  });

  it('gives the production repair an evidence template that captures the boundary', () => {
    const evidence = read('docs/A8_7_EVIDENCE.md');
    for (const slice of ['A8.7b-INCIDENT-1a', 'A8.7b-INCIDENT-1b', 'A8.7b-INCIDENT-1c']) {
      expect(evidence, `the evidence record must cover ${slice}`).toContain(slice);
    }
    expect(evidence).toMatch(/Worktree migration-directory count/i);
    expect(evidence).toMatch(/Migrations 6–9 absent from history/i);
    expect(evidence).toMatch(/`packages\/db\/\.env` absent from worktree/i);
    expect(evidence).toMatch(/No mutation performed/i);
  });

  it('keeps the incident evidence free of anything resembling a credential', () => {
    for (const file of ['docs/A8_7_EVIDENCE.md', 'docs/A8_7B_INCIDENT_1A_EVIDENCE.md']) {
      const contents = read(file);
      expect(contents, `${file} must carry no connection string`).not.toMatch(
        /postgresql:\/\/[^\s`"]*:[^\s`"]*@/,
      );
      expect(contents, `${file} must carry no bearer token`).not.toMatch(
        /Bearer\s+[A-Za-z0-9._-]{8,}/,
      );
    }
  });
});

/**
 * The repair ran on 2026-08-04 and succeeded, but not cleanly: the database password was rotated,
 * Vercel Production `DATABASE_URL` was changed, and a redeploy was attempted — none of which the
 * approved plan permitted — while the lock probe and the authenticated smoke tests were skipped.
 *
 * The risk these guards address is a reader six months from now concluding the repair was routine
 * and complete. They assert that the repaired state is recorded, that the boundary held, and that
 * the deviations and outstanding work remain visible.
 */
describe('A8.7b-INCIDENT-1c repaired state is recorded truthfully', () => {
  it('records the repair and the new schema baseline', () => {
    for (const file of ['docs/DEPLOYMENT.md', 'docs/MILESTONES.md']) {
      const contents = read(file);
      expect(contents, `${file} must date the repair`).toMatch(/2026-08-04/);
      expect(contents, `${file} must state migrations 1–5 are applied`).toMatch(
        /A8 migrations 1–5/,
      );
    }
    const runbook = read('docs/DEPLOYMENT.md');
    expect(runbook, 'D1′ must be recorded as the current state, not D1').toMatch(
      /\*\*D1′\*\*[^\n]*Current state/,
    );
  });

  it('keeps the boundary visible: five applied, four still prohibited', () => {
    const runbook = read('docs/DEPLOYMENT.md');

    const applied = runbook.match(/\*\*applied in production 2026-08-04\*\*/g) ?? [];
    expect(applied, 'exactly the five repair migrations are marked applied').toHaveLength(
      REPAIR_MIGRATIONS.length,
    );

    const pending = runbook.match(/\*\*not yet applied in production\*\*/g) ?? [];
    expect(pending, 'migrations 6–9 must still be marked unapplied').toHaveLength(
      PROHIBITED_MIGRATIONS.length,
    );
  });

  it('records every deviation from the approved procedure', () => {
    const evidence = read('docs/A8_7_EVIDENCE.md');

    expect(evidence, 'the 1c record must no longer say it was not performed').not.toMatch(
      /## A8\.7b-INCIDENT-1c[\s\S]{0,200}\*\*Not performed\.\*\*/,
    );
    expect(evidence).toMatch(/Deviations from the approved procedure/);
    for (const deviation of [/rotated/i, /`DATABASE_URL` was \*\*updated\*\*/, /redeploy/i]) {
      expect(evidence, `deviation ${deviation} must be recorded`).toMatch(deviation);
    }
    expect(evidence, 'the skipped lock probe must be recorded').toMatch(
      /Stage 4 lock probe[\s\S]{0,80}not\*{0,2} run/i,
    );
  });

  it('shows the smoke tests as closed by 1d rather than as still outstanding', () => {
    const evidence = read('docs/A8_7_EVIDENCE.md');

    expect(evidence, 'the deferred smoke tests must be recorded as passed').toMatch(
      /Authenticated Task-list smoke result[^|]*\|[^|]*Passed 2026-08-05/,
    );
    expect(evidence, 'deviation D-e must point at the slice that discharged it').toMatch(
      /\*\*D-e\*\*[\s\S]{0,400}Closed by 1d/,
    );
  });

  it('keeps the redeploy anomaly recorded as unexplained rather than quietly dropping it', () => {
    const evidence = read('docs/A8_7_EVIDENCE.md');

    expect(evidence, 'the anomaly must remain in the record').toMatch(/Anomaly, still unexplained/);
    expect(evidence, 'what 1d did and did not settle must be separated').toMatch(
      /Why the pre-rotation build kept working was never determined/i,
    );
    expect(evidence, 'the rollback consequence of the unexplained rotation must be stated').toMatch(
      /one-step rollback/i,
    );
  });

  it('still records no credential anywhere, after the rotation', () => {
    const evidence = read('docs/A8_7_EVIDENCE.md');
    expect(evidence).not.toMatch(/postgresql:\/\/[^\s`"]*:[^\s`"]*@/);
    expect(evidence, 'no concrete pooler host may be recorded').not.toMatch(
      /aws-[a-z0-9-]+\.pooler\.supabase\.com/,
    );
  });
});

/**
 * The verification SQL was authored for the nine-migration end state. A8.7b-INCIDENT-1c applies
 * five, so an operator following the published `Expected` column literally would read a correct
 * repair as a hard stop, and would run two `count(*)` statements against tables that do not exist.
 *
 * These guards derive the true end state from the migration SQL rather than restating it, so the
 * documentation cannot drift away from what the migrations actually build.
 */
describe('A8.7b-INCIDENT-1c verification SQL is scoped to five migrations', () => {
  const migrationsDir = path.join(repoRoot, 'packages/db/prisma/migrations');

  function repairSql(): string {
    return REPAIR_MIGRATIONS.map((name) =>
      readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8'),
    ).join('\n');
  }

  it('builds exactly two tables and six reminder enum types, and no notification objects', () => {
    const sql = repairSql();

    const tables = new Set(
      [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?([a-z_]+)"?/g)].map((m) => m[1]),
    );
    expect(tables, 'the five repair migrations create exactly two tables').toEqual(
      new Set(['task_reminder_schedules', 'reminder_delivery_attempts']),
    );

    const enums = [...sql.matchAll(/CREATE TYPE "([A-Za-z]+)" AS ENUM/g)].map((m) => m[1]);
    expect(enums.filter((name) => name.startsWith('Reminder'))).toHaveLength(6);
    expect(sql, 'no repair migration may create a notification object').not.toMatch(
      /owner_notification|OwnerNotification/,
    );
  });

  it('the prohibited migrations are the only source of the notification objects', () => {
    const prohibited = PROHIBITED_MIGRATIONS.map((name) =>
      readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8'),
    ).join('\n');

    for (const object of [
      'owner_notification_intents',
      'owner_notification_attempts',
      'no_actionable_capability',
      'repeated_ambiguous_outcomes',
    ]) {
      expect(prohibited, `${object} must come from migrations 6–9`).toContain(object);
      expect(repairSql(), `${object} must not come from the repair set`).not.toContain(object);
    }
  });

  it('states the five-migration expectations rather than the nine-migration ones', () => {
    const runbook = read('docs/DEPLOYMENT.md');

    expect(runbook).toMatch(/Five-migration expectations \(A8\.7b-INCIDENT-1c\)/);
    expect(runbook, 'Q7 must not claim four tables without qualifying the repair').toMatch(
      /After 1c: exactly two/,
    );
    expect(runbook, 'Q9 must expect two RLS rows after the repair').toMatch(
      /\*\*After 1c: two rows\*\*/,
    );
    expect(runbook, 'Q12 must expect six reminder types after the repair').toMatch(
      /After 1c: exactly the six `Reminder\*` types/,
    );
    expect(runbook, 'the two prohibited enum labels must be called out as required-absent').toMatch(
      /`no_actionable_capability` \(migration 6\)[\s\S]{0,120}must be ABSENT/,
    );
  });

  it('replaces Q8 with a runnable two-table variant and adds the boundary assertion', () => {
    const runbook = read('docs/DEPLOYMENT.md');

    expect(runbook, 'Q8 as published cannot run after the repair').toMatch(/Q8, two-table variant/);
    expect(runbook, 'a boundary assertion must prove the prohibited objects are absent').toMatch(
      /QB, the boundary assertion/,
    );
    expect(runbook).toMatch(/boundary\.prohibited_absent/);
    expect(runbook, 'Q15–Q21 must be marked out of scope for the repair').toMatch(
      /Out of scope for 1c: Q15 through Q21/,
    );

    const step23 = runbook.match(/\| 23 {2}\|[^\n]*/)?.[0] ?? '';
    const queryList = step23.match(/\((Q5[^)]*)\)/)?.[1] ?? '';
    expect(queryList, 'step 23 must enumerate the queries to run').toMatch(/Q5/);
    expect(queryList, 'the unrunnable Q8 must not be in the list to run').not.toMatch(/Q8/);
    expect(step23, 'step 23 must redirect the operator to the runnable variant').toMatch(
      /two-table variant/,
    );
  });

  it('states the worktree dependency prerequisite that makes the repair runnable', () => {
    const runbook = read('docs/DEPLOYMENT.md');

    expect(runbook, 'a fresh worktree has no node_modules and cannot run Prisma').toMatch(
      /pnpm install --filter @aicaa\/db --ignore-scripts/,
    );
    expect(runbook, 'the install must precede the no-use window').toMatch(
      /before\*{0,2} the Owner no-use window/i,
    );
    expect(runbook, 'the Prisma version must be pinned to the rehearsed one').toMatch(/6\.19\.3/);
    expect(
      runbook,
      'the --schema shortcut must be rejected because it loads packages/db/.env',
    ).toMatch(/Do not substitute `--schema/);

    const step8 = runbook.match(/\| 8 {3}\|[^\n]*/)?.[0] ?? '';
    expect(step8, 'step 8 must cover the dependency install').toMatch(/install/i);
  });

  it('carries the same five-migration expectations into the evidence template', () => {
    const evidence = read('docs/A8_7_EVIDENCE.md');

    expect(evidence, 'the Stage 8 table must not expect four tables').not.toMatch(
      /`schema\.tables` \(Q7\) *\| *4 /,
    );
    expect(evidence, 'the Stage 8 table must not expect eleven enums').not.toMatch(
      /`schema\.enums` \(Q12\) *\| *all 11/,
    );
    expect(evidence).toMatch(/\*\*2\*\* reminder only/);
    expect(evidence).toMatch(/\*\*6\*\* `Reminder\*`/);
    expect(evidence).toMatch(/Boundary \(QB\)/);
  });
});

/**
 * A8.7b-INCIDENT-1e documentation guards.
 *
 * Production no longer serves `ee5e82a`, and for the first time it serves a commit that is not on
 * `main`. Almost every stale claim these guards catch is a restatement of that one fact, so they
 * assert the specific corrected values rather than prose — an operator reading a superseded baseline
 * during the next slice is the failure being prevented.
 */

const HOTFIX_COMMIT = '534959d';
const HOTFIX_DEPLOYMENT = 'dpl_3oder2T3PuDYdmp8pezy6u7RwPRm';
const PREVIOUS_DEPLOYMENT = 'dpl_AnUKqdGj3gBw7N56yUT4pMBAVbac';

describe('A8.7b-INCIDENT-1e reconciled production baseline', () => {
  it('records the validated baseline: commit, deployment, and rollback target', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    const milestones = read('docs/MILESTONES.md');

    for (const [name, contents] of [
      ['docs/DEPLOYMENT.md', runbook],
      ['docs/MILESTONES.md', milestones],
    ] as const) {
      expect(contents, `${name} must name the deployed hotfix commit`).toContain(HOTFIX_COMMIT);
      expect(contents, `${name} must name the promoted deployment`).toContain(HOTFIX_DEPLOYMENT);
      expect(contents, `${name} must name the previous deployment`).toContain(PREVIOUS_DEPLOYMENT);
    }

    expect(
      runbook,
      'the deployed commit not being on main is the fact most likely to be assumed away',
    ).toMatch(/[Nn]ot an ancestor of `main`/);
  });

  it('no longer claims Production serves ee5e82a or that the incident is open', () => {
    expect(read('README.md'), 'the README baseline must not say the incident is open').not.toMatch(
      /Incident open/i,
    );
    expect(read('docs/MILESTONES.md')).not.toMatch(/incident still open/i);
    expect(read('docs/DEPLOYMENT.md')).not.toMatch(/\*\*The incident is not closed\.\*\*/);
    expect(
      read('docs/API_CONTRACT.md'),
      'the reminder routes are functional in Production now',
    ).not.toMatch(/the A8\.3a migration is \*\*not applied in Production\*\*/);
  });

  it('separates the unvalidated D1 from the validated D1′ in the state matrix', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    const matrix = runbook.slice(
      runbook.indexOf('### Approved repair state matrix'),
      runbook.indexOf('### Repair boundary'),
    );
    expect(matrix.length).toBeGreaterThan(0);

    expect(matrix, 'D1 must be marked as never validated').toMatch(
      /\*\*D1\*\*[^\n]*[Nn]ever a validated baseline/,
    );
    expect(matrix, 'D1′ must carry the hotfix commit').toMatch(
      new RegExp(`\\*\\*D1′\\*\\*[^\\n]*${HOTFIX_COMMIT}`),
    );
    expect(matrix, 'the reason for splitting the two must be stated, not just the rows').toMatch(
      /deliberately separate rows/i,
    );
  });

  it('records the smoke evidence that closed the incident', () => {
    const evidence = read('docs/A8_7_EVIDENCE.md');
    const section = evidence.slice(evidence.indexOf('## A8.7b-INCIDENT-1d'));
    expect(section.length).toBeGreaterThan(0);

    expect(section, 'the reminder GET result must be recorded').toMatch(/no_due_date/);
    expect(section, 'the ETag version must be recorded as v0').toMatch(/ETag ends \*\*`v0`\*\*/);
    expect(section, 'the unknown-Task result must be recorded').toMatch(/NOT_FOUND/);
    expect(section, 'the absence of a build-time migration must be recorded').toMatch(
      /\*\*None\.\*\* Only `prisma generate`/,
    );
    expect(section, 'no reminder may have been created or modified').toMatch(
      /No reminder created or modified/i,
    );
  });

  it('documents the deployment method and why a Preview build was not promoted', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    const section = runbook.slice(
      runbook.indexOf('### Deploying a commit that is not on `main`'),
      runbook.indexOf('### The runtime-value import hazard'),
    );
    expect(section.length).toBeGreaterThan(0);

    expect(section, 'the three-step method must be named').toMatch(/--skip-domain/);
    expect(section).toMatch(/vercel promote/);
    expect(section, 'the reason Preview promotion is unsafe must be the missing variable').toMatch(
      /DATABASE_URL/,
    );
    expect(section, 'promotion must be stated not to rebuild').toMatch(/without rebuilding/i);
    expect(section, 'the outage consequence must be explicit').toMatch(/outage/i);
  });

  it('records the runtime-value import hazard as a permanent rule, not incident trivia', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    const section = runbook.slice(runbook.indexOf('### The runtime-value import hazard'));
    expect(section.length).toBeGreaterThan(0);

    expect(section, 'the externalization mechanism must be named').toMatch(
      /serverExternalPackages/,
    );
    expect(section, 'type-only imports must be stated as safe').toMatch(
      /[Tt]ype-only imports are always safe/,
    );
    expect(section, 'the reason unit tests cannot catch it must be stated').toMatch(
      /[Uu]nit tests structurally cannot detect this/,
    );
    expect(section, 'bundle verification must be named as the guard').toMatch(
      /Production bundle verification is the only guard/,
    );
    expect(section, 'the misleading diagnostic signature must be recorded').toMatch(
      /UNKNOWN_FAILURE/,
    );
    expect(section, 'the remaining known instance must be named').toMatch(
      /suggestions\/process-service\.ts/,
    );

    expect(
      read('docs/ARCHITECTURE.md'),
      'the hazard is an architectural constraint, not only an operational one',
    ).toMatch(/runtime value imported from it does not reliably survive the Next build/i);
    expect(read('docs/REVIEW_CHECKLIST.md'), 'a review gate must enforce it').toMatch(
      /No runtime value is imported from a package listed in `serverExternalPackages`/,
    );
  });

  it('records the rollback target as unsafe rather than as a safe harbour', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    const section = runbook.slice(runbook.indexOf('## Rollback principles'));
    expect(section.length).toBeGreaterThan(0);

    expect(section, 'the one-step target must be named').toContain(PREVIOUS_DEPLOYMENT);
    expect(section, 'the stale environment binding must be called out').toMatch(
      /pre-rotation `DATABASE_URL`/,
    );
    expect(section, 'the worst case must be stated as an outage, not a regression').toMatch(
      /total database outage/i,
    );
    expect(section, 'one-step rollback must be declared unavailable').toMatch(
      /[Tt]reat one-step rollback as unavailable/,
    );
  });

  it('carries no credential into the new material', () => {
    for (const file of ['docs/DEPLOYMENT.md', 'docs/A8_7_EVIDENCE.md', 'docs/MILESTONES.md']) {
      const contents = read(file);
      // `<...>` is excluded so the fully-placeholdered template in the connection strategy passes.
      expect(contents, `${file} must record no connection string`).not.toMatch(
        /postgresql:\/\/[^\s`"<>]*:[^\s`"<>]*@/,
      );
      expect(contents, `${file} must record no concrete pooler host`).not.toMatch(
        /aws-[a-z0-9-]+\.pooler\.supabase\.com/,
      );
    }
  });
});
