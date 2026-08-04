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

    expect(runbook).toContain('Current incident state');
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
