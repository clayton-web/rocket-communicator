import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A8.7b-INCIDENT-1g Gate 4 evidence and recovery guards.
 *
 * A8.7b-INCIDENT-1f wrote the Gate 4 runbook but left two things it depends on unreconciled.
 * The runbook tells an operator to record evidence in `A8_7_EVIDENCE.md`, which had no Gate 4
 * section — so the nearest fitting table was the 1c capture record, two of whose rows require the
 * objects a correct Gate 4 creates to be *absent*. And the runbook makes recovery-tree entries 6
 * through 9 authoritative for the gate, while those entries were written as future reference: two
 * carried none of the physical-state classifications the runbook sends an operator to use, one
 * pointed at an unauthorized manual index build, and migration 9's index count was wrong.
 *
 * These guards assert that both dependencies resolve, and derive migration 9's object inventory
 * from its SQL rather than restating it, so the published verification list cannot drift from what
 * the migration builds.
 */

const repoRoot = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(repoRoot, 'packages/db/prisma/migrations');

const GATE_4_HEADING = 'Gate 4 — Production migrations 6–9';
const MIGRATION_9 = '20260803120000_a8_5a_owner_notification_intents';

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

function migration9Sql(): string {
  return readFileSync(path.join(migrationsDir, MIGRATION_9, 'migration.sql'), 'utf8');
}

/** Slice a section out of a document, bounded by the next heading at the same level. */
function section(contents: string, heading: string): string {
  const start = contents.indexOf(heading);
  expect(start, `${heading} must exist`).toBeGreaterThan(-1);

  const level = heading.match(/^#+/)?.[0].length ?? 2;
  const rest = contents.slice(start + heading.length);
  const end = rest.search(new RegExp(String.raw`\n#{1,${level}} [^#]`));
  return end === -1 ? rest : rest.slice(0, end);
}

/** The Gate 4 evidence section alone, so a fact recorded for 1c cannot satisfy a Gate 4 guard. */
function gate4Evidence(): string {
  return section(evidence(), `## ${GATE_4_HEADING}`);
}

function recoveryTree(): string {
  return section(runbook(), '### Per-migration recovery decision tree');
}

/** One numbered entry of the recovery tree, bounded by the rule that separates entries. */
function recoveryEntry(number: number): string {
  const tree = recoveryTree();
  const start = tree.indexOf(`**${number}. \``);
  expect(start, `recovery-tree entry ${number} must exist`).toBeGreaterThan(-1);

  const rest = tree.slice(start);
  const end = rest.indexOf('\n---\n');
  return end === -1 ? rest : rest.slice(0, end);
}

/** GitHub's heading-to-anchor rule, enough of it for the links these two documents use. */
function slug(heading: string): string {
  return heading
    .replace(/^#+\s*/, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s/g, '-');
}

function anchors(contents: string): ReadonlySet<string> {
  const headings = contents.match(/^#{1,6} .+$/gm) ?? [];
  return new Set(headings.map(slug));
}

describe('Gate 4 has an evidence record of its own', () => {
  it('exists as its own section, between the hotfix and the capture slice', () => {
    const contents = evidence();
    const gate4 = contents.indexOf(`## ${GATE_4_HEADING}`);
    const hotfix = contents.indexOf('## A8.7b-INCIDENT-1d');
    const capture = contents.indexOf('## A8.7c — Owner-event capture');

    expect(gate4, 'Gate 4 must have somewhere to record evidence').toBeGreaterThan(-1);
    expect(gate4, 'Gate 4 follows the hotfix it depends on').toBeGreaterThan(hotfix);
    expect(gate4, 'Gate 4 precedes the capture slice that sits behind Gate 5').toBeLessThan(
      capture,
    );
  });

  it('forbids reusing the 1c capture record, and says why', () => {
    const gate4 = gate4Evidence();

    expect(gate4, 'the 1c record must be excluded by name').toMatch(
      /[Dd]o not record Gate 4 in the \[1c capture record\]/,
    );
    expect(gate4, 'the reason must be the inverted absence rows').toMatch(
      /require migrations 6–9 and the notification tables to be \*\*absent\*\*/i,
    );
    expect(gate4, 'the inversion must be stated as the expected outcome').toMatch(
      /Ten history rows become \*\*fourteen\*\*/i,
    );
    expect(gate4, 'the probe difference must carry into the evidence record').toMatch(
      /`task_reminder_schedules`\*\*, not `tasks`/,
    );
  });

  it('captures every evidence field the Gate 4 runbook names', () => {
    const gate4 = gate4Evidence();

    for (const field of [
      'gate4.schedules.before',
      'gate4.schedules.after',
      'gate4.lock_probe',
      'gate4.objects_present',
      'migrations.status.before',
      'migrations.status.after',
      'tasks.count.before',
    ]) {
      expect(gate4, `${field} must have a row to record it`).toContain(field);
    }
  });

  it('records the load-bearing Gate 4 expectations rather than blank rows alone', () => {
    const gate4 = gate4Evidence();

    expect(gate4, 'the worktree must be the fourteen-migration one').toMatch(/\*\*expect 14\*\*/);
    expect(gate4, 'the pre-migration history must be the ten-row baseline').toMatch(
      /\*\*expect 10\*\*/,
    );
    expect(gate4, 'the post-migration history must be fourteen rows').toMatch(/\*\*expect 14\*\*/);
    expect(gate4, 'the QG tuple must be recorded').toMatch(/`2, 5, 1, 1, 2, 0, 0`/);
    expect(gate4, 'applied_steps_count must be confirmed rather than inherited').toMatch(
      /never confirmed during 1c; Gate 4 confirms it/i,
    );
    expect(gate4, 'the expected end state must be D2').toMatch(/\*\*expect D2\*\*/);
  });

  it('records the prohibitions that make Gate 4 a database-only gate', () => {
    const gate4 = gate4Evidence();

    expect(gate4, 'the gate must be recorded as executed under its own authorization').toMatch(
      /\*\*Executed and verified 2026-08-05 under explicit Owner authorization/i,
    );
    expect(gate4, 'the deployment ID must be unchanged').toMatch(
      /deployment ID unchanged \(y\/n\)/i,
    );
    expect(gate4, 'nothing may be pushed').toMatch(/Nothing pushed \(y\/n\)/i);
    expect(gate4, 'a push must be recorded as a deployment decision').toMatch(
      /push deploys automatically/i,
    );
    expect(gate4, 'Gate 5 must be recorded as not begun').toMatch(/Gate 5 not begun/i);
    expect(gate4, 'deviations must have somewhere to be recorded').toMatch(
      /### Deviations from the approved procedure/,
    );
    expect(gate4, 'stops must have somewhere to be recorded').toMatch(
      /### Stop conditions encountered/,
    );
  });

  it('carries no credential and no concrete pooler host', () => {
    const gate4 = gate4Evidence();

    expect(gate4, 'no connection string may appear').not.toMatch(
      /postgresql:\/\/[^\s`"<>]*:[^\s`"<>]*@/,
    );
    expect(gate4, 'no concrete pooler host may appear').not.toMatch(
      /aws-[a-z]+-[a-z]+-\d+\.pooler\.supabase\.com/,
    );
  });

  it('no longer claims the record is untouched by Production', () => {
    const contents = evidence();
    const preamble = contents.slice(0, contents.indexOf('## How to use this record'));

    expect(preamble, '1c and 1d were performed against Production').not.toMatch(
      /no part of it has been performed against Production/i,
    );
    expect(preamble, 'the performed sections must be distinguished from the template').toMatch(
      /part record and part template/i,
    );
  });
});

describe('the runbook and the evidence record point at each other', () => {
  it('sends the operator from Gate 4 closure to the Gate 4 evidence section', () => {
    const gate4Runbook = section(runbook(), `### ${GATE_4_HEADING}`);

    expect(gate4Runbook, 'closure must name the Gate 4 evidence section').toMatch(
      /A8_7_EVIDENCE\.md#gate-4--production-migrations-69/,
    );
    expect(gate4Runbook, 'the 1c record must be excluded at the point of recording').toMatch(
      /\*\*Do not record Gate 4 in the 1c capture record\*\*/,
    );
  });

  it('resolves every cross-document anchor between the two files', () => {
    const runbookContents = runbook();
    const evidenceContents = evidence();
    const runbookAnchors = anchors(runbookContents);
    const evidenceAnchors = anchors(evidenceContents);

    const intoEvidence = [...runbookContents.matchAll(/A8_7_EVIDENCE\.md#([\w-]+)/g)].map(
      (match) => match[1],
    );
    expect(intoEvidence.length, 'the runbook must link into the evidence record').toBeGreaterThan(
      0,
    );
    for (const anchor of intoEvidence) {
      expect(evidenceAnchors, `A8_7_EVIDENCE.md#${anchor} must resolve to a heading`).toContain(
        anchor,
      );
    }

    const intoRunbook = [...gate4Evidence().matchAll(/DEPLOYMENT\.md#([\w-]+)/g)].map(
      (match) => match[1],
    );
    expect(intoRunbook.length, 'the Gate 4 record must link back to its procedure').toBeGreaterThan(
      0,
    );
    for (const anchor of intoRunbook) {
      expect(runbookAnchors, `DEPLOYMENT.md#${anchor} must resolve to a heading`).toContain(anchor);
    }
  });
});

describe('the recovery tree is usable as Gate 4 recovery reference', () => {
  it('names entries 6 through 9 as the live Gate 4 set', () => {
    const tree = recoveryTree();

    expect(tree, 'entries 6–9 must be identified as the Gate 4 set').toMatch(
      /[Mm]igrations 6 through 9 are exactly the \[Gate 4\]/,
    );
    expect(tree, 'the repair entries must be marked as history').toMatch(
      /[Ee]ntries 1 through 5 are history/i,
    );
    expect(tree, 'the repair-era prohibition must be recorded as ended').toMatch(
      /prohibition ended with the repair/i,
    );
  });

  it('no longer rests its escalation rationale on the expired pre-repair premise', () => {
    const tree = recoveryTree();

    expect(tree, 'Production now holds A8 migrations 1–5').not.toMatch(
      /Production holds no A8 rows, and the deployed code was already incompatible/,
    );
    expect(tree, 'the replacement rationale must be stated').toMatch(
      /no deployed code reads anything migrations 6–9 create/i,
    );
    expect(tree, 'waiting must still be recorded as costless').toMatch(/[Ww]aiting still costs/);
  });

  it.each([6, 7, 8])(
    'gives entry %i the three physical-state classifications G4.12 sends an operator to use',
    (number) => {
      const entry = recoveryEntry(number);

      expect(entry, 'the none-present case must be documented').toMatch(/\*\*None present:\*\*/);
      expect(entry, 'the all-present case must be documented').toMatch(/\*\*All present:\*\*/);
      expect(entry, 'the some-present case must be documented').toMatch(/\*\*Some present(?:,|:)/);
      expect(entry, 'the entry must be identified as part of the gate').toMatch(
        /Gate 4 migration \d of 4/,
      );
    },
  );

  it('routes a populated table to the authorized branch rather than a manual index build', () => {
    const entry = recoveryEntry(8);

    expect(entry, 'the free-hand build must be excluded').toMatch(
      /not\*\* a free-hand manual build/i,
    );
    expect(entry, 'the authorized branch must be named').toMatch(/g49-the-populated-table-branch/);
    expect(entry, 'the second authorization must be required').toMatch(
      /separate Owner authorization before any write/i,
    );
    expect(entry, 'an invalid index must be dropped concurrently').toMatch(
      /`DROP INDEX CONCURRENTLY`/,
    );
    expect(entry, 'the name-only match of IF NOT EXISTS must be recorded as a trap').toMatch(
      /matches on the \*\*name alone\*\*/i,
    );
  });

  it('publishes migration 9 object inventory, derived from the migration SQL', () => {
    const entry = recoveryEntry(9);
    const sql = migration9Sql();

    const constraints = [...sql.matchAll(/CONSTRAINT "([a-z_]+)"/g)].map((match) => match[1]);
    const indexes = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([a-z_]+)"/g)].map(
      (match) => match[1],
    );
    const enums = [...sql.matchAll(/CREATE TYPE "(OwnerNotification[A-Za-z]*)" AS ENUM/g)].map(
      (match) => match[1],
    );

    expect(constraints, 'migration 9 names fifteen constraints').toHaveLength(15);
    expect(indexes, 'migration 9 creates six indexes').toHaveLength(6);
    expect(enums, 'migration 9 creates five enum types').toHaveLength(5);

    for (const object of [...constraints, ...indexes, ...enums]) {
      expect(entry, `${object} must be verifiable by name after Gate 4`).toContain(object);
    }

    expect(entry, 'the constraint count must match the SQL').toMatch(/fifteen named constraints/);
    expect(entry, 'the index count must match the SQL').toMatch(/six indexes/);
    expect(entry, 'the corrected count must not survive anywhere in the entry').not.toMatch(
      /five indexes/,
    );
    expect(entry, 'the primary-key indexes must be counted in Q13').toMatch(
      /Q13 returns eight rows for these two tables/i,
    );
  });

  it('makes the post-migration checks name checks against that inventory', () => {
    const gate4Runbook = section(runbook(), `### ${GATE_4_HEADING}`);

    expect(gate4Runbook, 'Q11 and Q13 must be described as name checks').toMatch(
      /Q11 and Q13 are name checks/i,
    );
    expect(gate4Runbook, 'the inventory must be linked from the verification step').toMatch(
      /per-migration-recovery-decision-tree/,
    );
    expect(gate4Runbook, 'a count alone must be recorded as insufficient').toMatch(
      /count alone does not distinguish a complete migration 9 from a partial one/i,
    );
  });
});
