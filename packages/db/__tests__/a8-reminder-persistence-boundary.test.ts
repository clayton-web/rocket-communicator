import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A8.3a persistence/domain boundary guard (D103, D127).
 *
 * A8.2 put every scheduling decision in one place on purpose. The way that erodes is not a
 * deliberate rewrite — it is a repository that one day computes "the next day" inline because it
 * already has the date in hand, and now 09:00 local is decided in two places that disagree across a
 * daylight-saving transition.
 *
 * This guard reads the reminder persistence modules and fails on the constructs that would mean
 * scheduling had moved. It complements `apps/web/__tests__/reminder-no-fixed-day-arithmetic.test.ts`,
 * which guards the domain modules themselves.
 */

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const REMINDER_PERSISTENCE_MODULES = [
  'repositories/reminder-schedule-repository.ts',
  'repositories/reminder-delivery-attempt-repository.ts',
  'repositories/reminder-scope-guard.ts',
  'transactions/a8-reminder-transactions.ts',
  'transactions/a8b-owner-reminder-transactions.ts',
  'transactions/a8-4a-occurrence-transactions.ts',
  'mappers/reminder-mappers.ts',
];

/**
 * Remove block and line comments so the guards read executable code only.
 *
 * Without this the guard fails on its own explanatory prose — these modules discuss "overdue",
 * `Date.now`, and the functions they deliberately do not call.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Constructs that would mean occurrence arithmetic had leaked into persistence. */
const FORBIDDEN = [
  {
    label: 'fixed 24-hour day arithmetic (D103, D127)',
    pattern: /\bMS_PER_DAY\b|\b86400000\b|\baddMilliseconds\b/,
  },
  {
    label: 'ambient clock read — callers must pass the instant',
    pattern: /\bDate\.now\s*\(|\bnew Date\s*\(\s*\)/,
  },
  {
    label: 'timezone resolution — belongs to the A8.2 resolver',
    pattern:
      /\bIntl\.DateTimeFormat\b|\bgetTimezoneOffset\b|\btoLocaleString\b|\btoLocaleDateString\b/,
  },
  {
    label: 'machine timezone read',
    pattern: /process\.env\.TZ\b|resolvedOptions\s*\(/,
  },
  {
    label: 'occurrence computation — persistence receives occurrences, it does not derive them',
    pattern:
      /\b(decideAdvanceReminder|selectNextOverdueOccurrence|addLocalDays|resolveLocalWallClock|localDateOfInstant)\b/,
  },
  {
    label: 'hardcoded overdue ceiling — import the domain constant instead (D106)',
    pattern: /\b14\b/,
  },
];

describe('A8.3a reminder persistence boundary guard', () => {
  for (const relativePath of REMINDER_PERSISTENCE_MODULES) {
    describe(relativePath, () => {
      const code = stripComments(readFileSync(path.join(srcRoot, relativePath), 'utf8'));

      for (const rule of FORBIDDEN) {
        it(`does not contain ${rule.label}`, () => {
          const match = code.match(rule.pattern);
          expect(
            match?.[0] ?? null,
            `${relativePath} must not contain ${rule.label}. Scheduling belongs to ` +
              `packages/domain/src/reminders/ (D103); persistence stores what the domain decided.`,
          ).toBeNull();
        });
      }
    });
  }

  it('reaches real files with real content', () => {
    for (const relativePath of REMINDER_PERSISTENCE_MODULES) {
      expect(readFileSync(path.join(srcRoot, relativePath), 'utf8').length).toBeGreaterThan(500);
    }
  });

  it('strips comments before scanning, so prose about a construct is not a violation', () => {
    expect(stripComments('/* mentions MS_PER_DAY */ const a = 1;')).not.toMatch(/MS_PER_DAY/);
    expect(stripComments('// mentions Date.now()\nconst b = 2;')).not.toMatch(/Date\.now/);
    expect(stripComments('const c = MS_PER_DAY;')).toMatch(/MS_PER_DAY/);
  });

  it('imports the ceiling rule from the domain rather than restating it', () => {
    // A8.4a moved ceiling evaluation out of `a8-reminder-transactions.ts` and into the occurrence
    // finalizer, along with the two F1-unsafe delivery transactions it replaced. The rule the guard
    // protects is unchanged: whichever module judges the ceiling must ask the domain.
    const finalizer = readFileSync(
      path.join(srcRoot, 'transactions/a8-4a-occurrence-transactions.ts'),
      'utf8',
    );
    expect(finalizer).toContain('hasReachedOverdueDeliveryCeiling');
    // The relative specifier is required by the serverless packaging convention (A7.4 guard).
    expect(finalizer).toContain("from '../../../domain/dist/index.js'");

    const transactions = readFileSync(
      path.join(srcRoot, 'transactions/a8-reminder-transactions.ts'),
      'utf8',
    );
    expect(transactions).not.toContain('OVERDUE_SUCCESSFUL_DELIVERY_CEILING');
  });
});
