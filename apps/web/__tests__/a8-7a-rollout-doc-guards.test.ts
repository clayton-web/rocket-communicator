import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A8.7a is a documentation slice, so these guards protect the two things documentation can still get
 * wrong in a way that reaches production: an example environment file that hands somebody a live
 * value, and a scheduler declaration that would start invoking a worker without anyone deciding to.
 *
 * They deliberately do not assert prose. Wording is what architecture review is for.
 */
const repoRoot = path.resolve(__dirname, '../../..');

function read(relativePath: string): string {
  const absolute = path.join(repoRoot, relativePath);
  expect(existsSync(absolute), `${relativePath} must exist`).toBe(true);
  return readFileSync(absolute, 'utf8');
}

const A8_FLAGS = [
  'ENABLE_OWNER_EVENT_CAPTURE',
  'ENABLE_OWNER_EVENT_DELIVERY',
  'ENABLE_REMINDER_DELIVERY',
] as const;

const EXAMPLE_ENV_FILES = ['apps/web/.env.example', 'packages/db/.env.example'] as const;

/**
 * Plausible leaked Bearer credential in documentation.
 * Requires a token-shaped payload (≥8 allowed characters and at least one digit, '.', or '_')
 * so ordinary prose such as "Bearer promotion" or "Bearer successor" is not flagged.
 */
const BEARER_CREDENTIAL_LEAK =
  /Bearer\s+(?=[A-Za-z0-9._-]{8,})(?=[A-Za-z0-9._-]*[0-9._])[A-Za-z0-9._-]+/;

describe('A8.7a Bearer credential leak pattern', () => {
  it('rejects a plausible JWT-shaped Bearer credential', () => {
    expect(
      BEARER_CREDENTIAL_LEAK.test(
        'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature',
      ),
    ).toBe(true);
  });

  it('rejects an opaque token-like Bearer payload with digits', () => {
    expect(BEARER_CREDENTIAL_LEAK.test('Bearer abcd1234efgh5678')).toBe(true);
  });

  it('allows ordinary Bearer-related prose', () => {
    for (const prose of [
      'Bearer promotion',
      'Bearer successor',
      'Bearer authorization',
      'Bearer integration',
    ]) {
      expect(BEARER_CREDENTIAL_LEAK.test(prose), prose).toBe(false);
    }
  });
});

describe('A8.7a scheduler configuration guards', () => {
  it('keeps root vercel.json empty, so no worker gains a schedule by configuration', () => {
    const raw = read('vercel.json');
    expect(JSON.parse(raw)).toEqual({});
  });

  it('declares no crons for either A8 worker endpoint', () => {
    const config = JSON.parse(read('vercel.json')) as {
      crons?: Array<{ path?: string }>;
    };
    expect(config.crons).toBeUndefined();
  });
});

describe('A8.7a example environment guards', () => {
  it.each(EXAMPLE_ENV_FILES)('leaves every A8 flag unset in %s', (file) => {
    const contents = read(file);
    for (const flag of A8_FLAGS) {
      // An active assignment is any uncommented `FLAG=` line, whatever the value.
      expect(contents, `${file} must not actively assign ${flag}`).not.toMatch(
        new RegExp(String.raw`^\s*${flag}\s*=`, 'm'),
      );
      expect(contents).not.toMatch(new RegExp(String.raw`^\s*${flag}\s*=\s*true`, 'm'));
    }
  });

  it('documents ENABLE_REMINDER_DELIVERY in apps/web/.env.example as a commented placeholder', () => {
    const contents = read('apps/web/.env.example');
    expect(contents).toMatch(/^#\s*ENABLE_REMINDER_DELIVERY=\s*$/m);
  });

  it('offers the production migration endpoint only as a commented placeholder', () => {
    const contents = read('packages/db/.env.example');
    expect(contents).toMatch(/^#\s*DATABASE_URL="postgresql:\/\/postgres\.<PROJECT_REF>:/m);
    expect(contents).toContain('pooler.supabase.com:5432');
  });

  it('carries no real Supabase credential in either example file', () => {
    for (const file of EXAMPLE_ENV_FILES) {
      const contents = read(file);
      // A concrete pooler host means a project reference and region were pasted in.
      expect(contents, `${file} must keep the region a placeholder`).not.toMatch(
        /aws-[a-z]+-[a-z]+-\d+\.pooler\.supabase\.com/,
      );
      expect(contents).not.toMatch(/postgres\.[a-z]{16,}/);
      expect(contents).not.toMatch(/\bdb\.[a-z]{16,}\.supabase\.co\b/);
    }
  });

  it('keeps the only active packages/db DATABASE_URL pointed at loopback', () => {
    const contents = read('packages/db/.env.example');
    const active = contents
      .split('\n')
      .filter((line) => /^\s*DATABASE_URL\s*=/.test(line))
      .map((line) => line.trim());
    expect(active).toHaveLength(1);
    expect(active[0]).toMatch(/@127\.0\.0\.1:5433\//);
  });
});

describe('A8.7a rollout documentation guards', () => {
  it('publishes the A8.7 evidence template', () => {
    const contents = read('docs/A8_7_EVIDENCE.md');
    expect(contents).toMatch(/A8\.7 production rollout — evidence record/);
  });

  it('keeps the evidence template free of anything resembling a credential', () => {
    const contents = read('docs/A8_7_EVIDENCE.md');
    expect(contents).not.toMatch(/postgresql:\/\//);
    expect(contents).not.toMatch(BEARER_CREDENTIAL_LEAK);
  });

  it('gives every A8.7 stage all seven normalized headings', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    const section = runbook.slice(runbook.indexOf('## A8.7 production rollout'));
    expect(section.length).toBeGreaterThan(0);

    const stageHeadings = section.match(/^#### Stage \d+ — .+$/gm) ?? [];
    expect(stageHeadings).toHaveLength(21);

    const required = [
      '**Preconditions.**',
      '**Execution.**',
      '**Verification.**',
      '**Stop/go criteria.**',
      '**Immediate containment.**',
      '**Recovery or rollback.**',
      '**Evidence to record.**',
    ];
    for (const heading of required) {
      const occurrences = section.split(heading).length - 1;
      expect(occurrences, `${heading} must appear once per stage`).toBeGreaterThanOrEqual(21);
    }
  });

  it('does not route production migrations through the transaction-mode pooler port', () => {
    const runbook = read('docs/DEPLOYMENT.md');
    expect(runbook).toMatch(/pooler\.supabase\.com:5432/);
    expect(runbook).not.toMatch(/migrate:deploy[^\n]*6543/);
  });
});
