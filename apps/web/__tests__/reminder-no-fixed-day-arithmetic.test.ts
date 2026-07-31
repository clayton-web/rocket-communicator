// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A8.2 reminder scheduling source guards (D103).
 *
 * D103 bans two specific ways of being quietly wrong about time, and neither one fails a
 * behavioural test on an ordinary day:
 *
 * 1. **Fixed-duration day arithmetic.** Adding 86,400,000 milliseconds to move a calendar day is
 *    right 363 days a year and silently wrong on the two daylight-saving transition days, when it
 *    moves 09:00 to 08:00 or 10:00.
 * 2. **Machine-local timezone.** Reading the process zone passes on a developer laptop set to
 *    Pacific time and sends every reminder on the wrong day from a UTC serverless region.
 *
 * These guards therefore assert against the *source* of the A8.2 reminder modules, so the
 * prohibited constructs cannot reappear at all — including on a code path no test happens to
 * exercise yet.
 *
 * **Why this guard lives in `apps/web`.** It has to read files. `packages/domain` intentionally
 * carries no `@types/node`, and adding a dependency to that package is outside the A8.2
 * authorization, while file-reading structural guards that scan `packages/**` already live here
 * (`prisma-serverless-packaging.test.ts`, `vercel-build-pipeline.test.ts`). It runs in
 * `pnpm test:web`, so `pnpm verify` enforces it.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const remindersDir = path.join(repoRoot, 'packages/domain/src/reminders');

/**
 * The A8.2 modules. `calculators.ts` is deliberately absent: it is dormant pre-A8.1 code that
 * A8.2 must not modify, and holding it to A8.2's rules would invite exactly that edit.
 */
const A8_2_REMINDER_SOURCES = [
  'constants.ts',
  'local-date.ts',
  'occurrence.ts',
  'schedule-policy.ts',
] as const;

const PRESENTATION_DATETIME = path.join(repoRoot, 'apps/web/lib/presentation/datetime.ts');
const DOMAIN_REMINDER_CONSTANTS = path.join(remindersDir, 'constants.ts');

function readReminderSource(fileName: string): string {
  return readFileSync(path.join(remindersDir, fileName), 'utf8');
}

/**
 * Comments are removed before scanning. The subject of these guards is what the modules *do*;
 * a doc comment that names a prohibited construct in order to explain why it is prohibited is
 * documentation, not a violation, and failing on it would push the explanation out of the code.
 */
export function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function collectMatches(content: string, patterns: readonly RegExp[]): string[] {
  const code = stripComments(content);
  const offenders: string[] = [];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      offenders.push(match[0].trim());
    }
  }
  return offenders;
}

/**
 * Fixed-duration day movement in any of the forms that would pass review: the shared constant,
 * the literal, the same literal spelled arithmetically, and the generic instant-shifting helper.
 */
export function findFixedDayArithmetic(content: string): string[] {
  return collectMatches(content, [
    /\bMS_PER_DAY\b/g,
    /\b86_?400_?000\b/g,
    /\b86_?400\s*\*\s*1_?000\b/g,
    /\b24\s*\*\s*60\s*\*\s*60\s*\*\s*1_?000\b/g,
    /\baddMilliseconds\b/g,
  ]);
}

/**
 * Reads of ambient time or the machine timezone. `getTime`, `getUTC*`, and `new Date(epochMs)`
 * are all permitted — they are explicit about what they operate on.
 */
export function findAmbientTimeReads(content: string): string[] {
  return collectMatches(content, [
    /\bDate\.now\s*\(/g,
    /new\s+Date\s*\(\s*\)/g,
    /\bprocess\b/g,
    /\.getTimezoneOffset\s*\(/g,
    /\bresolvedOptions\s*\(/g,
    /\.toLocale(?:Date|Time)?String\s*\(/g,
    /\.get(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\s*\(/g,
  ]);
}

/** Imports that would drag web-application or dormant A8.0 behaviour into the new modules. */
export function findForbiddenImports(content: string): string[] {
  return collectMatches(content, [
    /from\s+['"][^'"]*apps\/web[^'"]*['"]/g,
    /from\s+['"]@aicaa\/web['"]/g,
    /from\s+['"]\.\.\/\.\.\/\.\.\/[^'"]*['"]/g,
    /from\s+['"]\.\/calculators\.js['"]/g,
  ]);
}

/** `Intl.DateTimeFormat` constructions that do not pass an explicit `timeZone`. */
export function findImplicitTimeZoneFormatters(content: string): string[] {
  const code = stripComments(content);
  const offenders: string[] = [];
  for (const match of code.matchAll(/new\s+Intl\.DateTimeFormat\s*\(/g)) {
    const start = match.index ?? 0;
    if (!code.slice(start, start + 400).includes('timeZone')) {
      offenders.push(code.slice(start, start + 60).trim());
    }
  }
  return offenders;
}

describe('A8.2 reminder modules avoid fixed-duration day arithmetic (D103)', () => {
  it('reads every A8.2 reminder source', () => {
    for (const fileName of A8_2_REMINDER_SOURCES) {
      expect(readReminderSource(fileName).length, fileName).toBeGreaterThan(0);
    }
  });

  it('never references MS_PER_DAY, the day literal, or addMilliseconds', () => {
    for (const fileName of A8_2_REMINDER_SOURCES) {
      expect(
        findFixedDayArithmetic(readReminderSource(fileName)),
        `${fileName} must move calendar days with calendar arithmetic, never a fixed 24-hour duration (D103).`,
      ).toEqual([]);
    }
  });

  it('detects each prohibited form', () => {
    expect(findFixedDayArithmetic('const next = addMilliseconds(instant, MS_PER_DAY);')).toEqual([
      'MS_PER_DAY',
      'addMilliseconds',
    ]);
    expect(findFixedDayArithmetic('const t = base + 86400000;')).toHaveLength(1);
    expect(findFixedDayArithmetic('const t = base + 86_400_000;')).toHaveLength(1);
    expect(findFixedDayArithmetic('const day = 24 * 60 * 60 * 1000;')).toHaveLength(1);
    expect(findFixedDayArithmetic('const day = 86400 * 1000;')).toHaveLength(1);
  });

  it('permits hour-scale instant arithmetic, which the transition search needs', () => {
    expect(findFixedDayArithmetic('const MS_PER_HOUR = 60 * 60 * 1000;')).toEqual([]);
    expect(findFixedDayArithmetic('const window = 26 * MS_PER_HOUR;')).toEqual([]);
  });

  it('scans code rather than documentation', () => {
    expect(stripComments('/* MS_PER_DAY is banned */ const a = 1;').trim()).toBe('const a = 1;');
    expect(stripComments('const a = 1; // never add 86400000').trim()).toBe('const a = 1;');
    expect(stripComments("const url = 'https://example.test';").trim()).toBe(
      "const url = 'https://example.test';",
    );
    expect(findFixedDayArithmetic('// MS_PER_DAY would be wrong here')).toEqual([]);
    expect(findFixedDayArithmetic('const step = MS_PER_DAY;')).toEqual(['MS_PER_DAY']);
  });
});

describe('A8.2 reminder modules never consult machine-local time (D103)', () => {
  it('reads no ambient clock, process state, or machine timezone', () => {
    for (const fileName of A8_2_REMINDER_SOURCES) {
      expect(
        findAmbientTimeReads(readReminderSource(fileName)),
        `${fileName} must take the current instant and the timezone as arguments (D103).`,
      ).toEqual([]);
    }
  });

  it('detects ambient and machine-local reads', () => {
    expect(findAmbientTimeReads('const now = Date.now();')).toHaveLength(1);
    expect(findAmbientTimeReads('const now = new Date();')).toHaveLength(1);
    expect(findAmbientTimeReads('const zone = process.env.TZ;')).toHaveLength(1);
    expect(findAmbientTimeReads('const offset = value.getTimezoneOffset();')).toHaveLength(1);
    expect(
      findAmbientTimeReads('const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;'),
    ).toHaveLength(1);
    expect(findAmbientTimeReads('const day = value.getDate();')).toHaveLength(1);
    expect(findAmbientTimeReads('const text = value.toLocaleDateString();')).toHaveLength(1);
  });

  it('permits explicit UTC and epoch access', () => {
    expect(findAmbientTimeReads('const ms = parseUtcInstant(now).getTime();')).toEqual([]);
    expect(findAmbientTimeReads('const year = normalized.getUTCFullYear();')).toEqual([]);
    expect(findAmbientTimeReads('const date = new Date(epochMs);')).toEqual([]);
    expect(findAmbientTimeReads('const utc = Date.UTC(year, month - 1, day);')).toEqual([]);
  });

  it('always constructs Intl formatters with an explicit timeZone', () => {
    for (const fileName of A8_2_REMINDER_SOURCES) {
      expect(findImplicitTimeZoneFormatters(readReminderSource(fileName)), fileName).toEqual([]);
    }

    expect(findImplicitTimeZoneFormatters("new Intl.DateTimeFormat('en-US', {})")).toHaveLength(1);
    expect(
      findImplicitTimeZoneFormatters("new Intl.DateTimeFormat('en-US', { timeZone })"),
    ).toEqual([]);
  });
});

describe('A8.2 reminder modules stay inside the domain package', () => {
  it('imports no web-application or dormant A8.0 reminder behaviour', () => {
    for (const fileName of A8_2_REMINDER_SOURCES) {
      expect(
        findForbiddenImports(readReminderSource(fileName)),
        `${fileName} must not import timezone or reminder behaviour from outside the domain package.`,
      ).toEqual([]);
    }
  });

  it('detects forbidden import forms', () => {
    expect(
      findForbiddenImports("import { OWNER_DISPLAY_TIME_ZONE } from '../../../apps/web/lib/x.js';"),
    ).not.toEqual([]);
    expect(findForbiddenImports("import { formatOwnerDate } from '@aicaa/web';")).toHaveLength(1);
    expect(findForbiddenImports("import { stopReminders } from './calculators.js';")).toHaveLength(
      1,
    );
    expect(
      findForbiddenImports("import { validationError } from '../errors/domain-errors.js';"),
    ).toEqual([]);
  });
});

describe('scheduling and presentation timezone constants stay separate (D103, D117, D122)', () => {
  const domainConstants = readFileSync(DOMAIN_REMINDER_CONSTANTS, 'utf8');
  const presentation = readFileSync(PRESENTATION_DATETIME, 'utf8');

  it('declares the domain scheduling zone in the domain package', () => {
    expect(domainConstants).toContain(
      "export const REMINDER_SCHEDULING_TIME_ZONE = 'America/Vancouver';",
    );
  });

  it('declares the Owner presentation zone in the web application', () => {
    expect(presentation).toContain("export const OWNER_DISPLAY_TIME_ZONE = 'America/Vancouver';");
  });

  it('keeps them as two symbols that never reference each other', () => {
    // Same value today, different responsibilities: one decides when a reminder fires, the other
    // only decides what string an Owner reads. Aliasing either to the other would let a display
    // change reschedule production sends. Each file may *name* the other in prose — that is how
    // the separation stays documented — so only executable code is checked.
    expect(stripComments(domainConstants)).not.toContain('OWNER_DISPLAY_TIME_ZONE');
    expect(stripComments(presentation)).not.toContain('REMINDER_SCHEDULING_TIME_ZONE');
    expect(stripComments(presentation)).not.toContain('@aicaa/domain');
  });
});
