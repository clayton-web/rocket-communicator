import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A8.7b-INCIDENT-1i QG scope guards.
 *
 * QG's unvalidated-constraint term carried no schema filter, and `pg_constraint` is cluster-wide.
 * Supabase's managed `realtime` schema holds an unvalidated constraint that no migration in this
 * repository creates, controls, or may validate, so the published query returns 1 on a perfectly
 * healthy Production database — which under G4.11's literal "any other result is a hard stop"
 * reading is a false stop on a correct gate, inside a live Owner no-use window.
 *
 * Gate 4 hit exactly that on 2026-08-05 and recorded both readings instead of halting. These
 * guards pin the scoped query, pin the reason next to it so the scope is not tidied away later,
 * and pin the Gate 4 record's original readings so the correction cannot be applied by rewriting
 * history instead of the runbook.
 */

const repoRoot = path.resolve(__dirname, '../../..');
const GATE_4_HEADING = 'Gate 4 — Production migrations 6–9';

function read(relativePath: string): string {
  const absolute = path.join(repoRoot, relativePath);
  expect(existsSync(absolute), `${relativePath} must exist`).toBe(true);
  return readFileSync(absolute, 'utf8');
}

/** A markdown section, from its heading to the next heading at the same level. */
function section(contents: string, heading: string): string {
  const start = contents.indexOf(heading);
  expect(start, `${heading} must exist`).toBeGreaterThan(-1);

  const level = heading.slice(0, heading.indexOf(' ')).length;
  const next = contents.indexOf(`\n${'#'.repeat(level)} `, start + heading.length);

  return next === -1 ? contents.slice(start) : contents.slice(start, next);
}

/** The Gate 4 runbook procedure alone. */
function gate4Runbook(): string {
  return section(read('docs/DEPLOYMENT.md'), `### ${GATE_4_HEADING}`);
}

/** The Gate 4 evidence record alone. */
function gate4Evidence(): string {
  return section(read('docs/A8_7_EVIDENCE.md'), `## ${GATE_4_HEADING}`);
}

describe('QG scopes the unvalidated-constraint check to the application schema', () => {
  it('filters on the public schema rather than counting every schema', () => {
    const gate4 = gate4Runbook();

    expect(gate4, 'the term must join through to a namespace').toMatch(
      /JOIN pg_namespace n ON n\.oid = r\.relnamespace/,
    );
    expect(gate4, 'the filter must name the public schema').toMatch(
      /WHERE NOT c\.convalidated AND n\.nspname = 'public'/,
    );
  });

  it('leaves no unscoped constraint count anywhere in the gate', () => {
    const gate4 = gate4Runbook();

    expect(gate4, 'the cluster-wide form must not survive').not.toMatch(
      /FROM pg_constraint WHERE NOT convalidated/,
    );
    expect(
      gate4,
      'the expectation must not ask for zero unvalidated constraints anywhere',
    ).not.toMatch(/Unvalidated constraints anywhere/);
    expect(gate4, 'the expectation must name the schema it covers').toMatch(
      /Unvalidated constraints \*\*in the `public` schema\*\*/,
    );
  });

  it('changes the scope without changing the expected result', () => {
    expect(gate4Runbook(), 'the QG tuple is unchanged by this correction').toMatch(
      /`2, 5, 1, 1, 2, 0, 0`/,
    );
  });

  it('records why the scope is narrow, so it is not widened as a tidy-up', () => {
    const gate4 = gate4Runbook();

    expect(gate4, 'the managed schema must be named as the cause').toMatch(/realtime/);
    expect(gate4, 'the false stop must be stated explicitly').toMatch(
      /returns \*\*1 on a perfectly healthy Production database\*\*/,
    );
    expect(gate4, 'widening it back must be prohibited in terms').toMatch(
      /\*\*Do not widen this back to every schema\*\*/,
    );
    expect(gate4, 'an application-table constraint must still be a stop').toMatch(
      /an unvalidated constraint on an application table is still a hard stop/i,
    );
  });
});

describe('the correction does not rewrite what Gate 4 observed', () => {
  it('preserves both readings Production actually returned', () => {
    const gate4 = gate4Evidence();

    expect(gate4, 'the cluster-wide reading must survive as observed').toMatch(
      /unvalidated_all = 1/,
    );
    expect(gate4, 'the scoped reading must survive as observed').toMatch(/unvalidated_public = 0/);
  });

  it('closes the deviation rather than deleting it', () => {
    const gate4 = gate4Evidence();

    expect(gate4, 'the deviation must still describe what occurred').toMatch(
      /QG `unvalidated_constraints` term was scoped to the `public` schema/,
    );
    expect(gate4, 'the resolution must name the slice that made it').toMatch(
      /\*\*Closed by A8\.7b-INCIDENT-1i\.\*\*/,
    );
  });
});
