import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A8.7b-INCIDENT-1h runbook accuracy guards.
 *
 * Three statements survived the 1e, 1f, and 1g reconciliations and would each have produced a
 * false stop during Gate 4. The reminder-engine section still said the A8 persistence tables were
 * unapplied in Production — about `task_reminder_schedules`, the one table Gate 4's lock probe
 * exists to protect, and applied since 2026-08-04. The post-migration checks asked for "three new"
 * enum values where the gate adds two, the third having arrived with the repair. And the evidence
 * record called the two migration slices the only ones that connect to Production, which its own
 * Q15–Q21 stages contradict.
 *
 * These guards derive the label count from the migration SQL and pin the corrected claims, so a
 * future edit cannot quietly reintroduce a stop condition that fires on a correct Gate 4.
 */

const repoRoot = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(repoRoot, 'packages/db/prisma/migrations');

/** The four migrations Gate 4 applies. */
const GATE_4_FOUR = [
  '20260802173000_a8_4b1_capability_skip_reason',
  '20260802210000_a8_4b2_repeated_ambiguous_stop_reason',
  '20260803090000_a8_4b3_advance_due_scan_index',
  '20260803120000_a8_5a_owner_notification_intents',
] as const;

function read(relativePath: string): string {
  const absolute = path.join(repoRoot, relativePath);
  expect(existsSync(absolute), `${relativePath} must exist`).toBe(true);
  return readFileSync(absolute, 'utf8');
}

function runbook(): string {
  return read('docs/DEPLOYMENT.md');
}

function evidence(): string {
  return read('docs/A8_7_EVIDENCE.md');
}

/** Enum labels the Gate 4 set adds to types that already exist. */
function gate4EnumLabels(): readonly string[] {
  const sql = GATE_4_FOUR.map((name) =>
    readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8'),
  ).join('\n');

  return [...sql.matchAll(/ADD VALUE IF NOT EXISTS '([a-z_]+)'/g)].map((match) => match[1]);
}

describe('the runbook records the Production schema as it actually is', () => {
  it('does not claim the applied A8 persistence tables are unapplied', () => {
    const contents = runbook();

    expect(contents, 'the repair applied these three objects on 2026-08-04').not.toMatch(
      /`tasks\.due_local_date`\) are not applied in Production/,
    );
    expect(contents, 'they must be recorded as applied, with the date').toMatch(
      /were applied to Production on 2026-08-04/,
    );
  });

  it('separates the repair set from the Gate 4 set, both now applied', () => {
    const contents = runbook();
    const heading = '### Reminder engine operations';
    const start = contents.indexOf(heading);
    expect(start, 'the reminder operations section must exist').toBeGreaterThan(-1);
    const section = contents.slice(start, contents.indexOf('### Owner notification worker'));

    // Gate 4 applied the four on 2026-08-05, so the separation is now by date and gate rather
    // than by applied-versus-pending. Losing the distinction would erase which gate did what.
    expect(section, 'the repair set must stay dated to 2026-08-04').toMatch(
      /applied to Production on 2026-08-04/,
    );
    expect(section, 'the four remaining migrations must be recorded as applied by Gate 4').toMatch(
      /remaining migrations were applied on 2026-08-05 by \[Gate 4\]/i,
    );
    expect(section, 'the section must name the resulting state').toMatch(/is at `D2`/);
    expect(section, 'deploying the consuming code must be named as Gate 5, and not begun').toMatch(
      /\[Gate 5\][^\n]*which has not begun/,
    );
    expect(section, 'the reminder routes must be recorded as functional, not future').toMatch(
      /lifecycle wiring \*\*are\*\* functional/,
    );
    expect(section, 'the Owner restraint obligation must survive the correction').toMatch(
      /must not create or modify a reminder until the later rollout is authorized/,
    );
  });

  it('links only to headings that exist for the state it describes', () => {
    expect(
      runbook(),
      'the renamed current-state heading must not be linked by its old anchor',
    ).not.toMatch(/\]\(#current-incident-state\)/);
    expect(runbook(), 'the current state must be reachable').toMatch(
      /\]\(#current-production-state\)/,
    );
  });
});

describe('Gate 4 post-migration checks ask for the labels the gate actually adds', () => {
  it('derives two added enum labels from the Gate 4 migration SQL', () => {
    const labels = gate4EnumLabels();

    expect(labels, 'migrations 6 and 7 add one label each; 8 and 9 add none').toEqual([
      'no_actionable_capability',
      'repeated_ambiguous_outcomes',
    ]);
  });

  it('never describes the gate as adding three new enum values', () => {
    for (const [name, contents] of [
      ['DEPLOYMENT.md', runbook()],
      ['A8_7_EVIDENCE.md', evidence()],
    ] as const) {
      expect(contents, `${name} must not overstate the labels Gate 4 adds`).not.toMatch(
        /all three new values|three\*\* new labels|three new labels/,
      );
    }
  });

  it('names both added labels wherever it states the count', () => {
    const labels = gate4EnumLabels();

    for (const [name, contents] of [
      ['DEPLOYMENT.md', runbook()],
      ['A8_7_EVIDENCE.md', evidence()],
    ] as const) {
      expect(contents, `${name} must state the corrected count`).toMatch(
        /\*\*two\*\* labels this gate adds/,
      );
      for (const label of labels) {
        expect(contents, `${name} must name ${label}`).toContain(label);
      }
    }
  });

  it('keeps the repair-era label distinct from the two the gate adds', () => {
    expect(runbook(), 'skipped_waiting_elapsed arrived with migration 3, not with Gate 4').toMatch(
      /`skipped_waiting_elapsed` is already present from the repair/,
    );
  });
});

describe('the evidence record does not contradict its own later stages', () => {
  it('scopes the migration-endpoint note to migration slices, not to all database contact', () => {
    const contents = evidence();

    expect(
      contents,
      'later slices query Production read-only, so this claim was false',
    ).not.toMatch(/only two slices that connect to the Production database/);
    expect(contents, 'the note must be scoped to running migrations').toMatch(
      /only two slices that run migrations/,
    );
  });

  it('still records the later read-only Production queries it must not contradict', () => {
    const contents = evidence();

    expect(contents, 'the capture and canary stages read Production through Q15–Q21').toMatch(
      /Q15/,
    );
    expect(contents, 'the correction must acknowledge those reads').toMatch(
      /query the Production database read-only through Q15–Q21 but never migrate it/,
    );
  });
});
