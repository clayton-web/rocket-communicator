import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NO_SCHEDULE_REMINDER_VERSION as PERSISTENCE_NO_SCHEDULE_VERSION } from '@aicaa/db';
import {
  NO_SCHEDULE_REMINDER_VERSION,
  currentReminderVersion,
  reminderETag,
} from '@/lib/reminders/etag';

/**
 * A8.7b-INCIDENT-1d guards for the reminder ETag constant.
 *
 * `@aicaa/db` is listed in `serverExternalPackages`, so Next leaves it a runtime external and a
 * *value* imported from it statically does not survive the build. Deployed commit `ee5e82a` emitted
 * `NO_SCHEDULE_REMINDER_VERSION` into the server chunk as an undeclared free variable while every
 * neighbouring binding was minified, so the first real Task without a reminder schedule threw
 * `ReferenceError: NO_SCHEDULE_REMINDER_VERSION is not defined` and the route answered
 * `INTERNAL_ERROR`. Nothing in the unit suite could see it: Vitest resolves `@aicaa/db` directly, so
 * the constant is present in every test and absent only in the artefact that ships.
 *
 * That is the whole reason these three guards are separate. The source guard catches the import
 * pattern, the value guard catches drift from persistence, and the bundle guard is the only one that
 * inspects what is actually deployed.
 */

const webRoot = path.resolve(__dirname, '..');
const REMINDERS_DIR = path.join(webRoot, 'lib/reminders');
const BUILD_SERVER_DIR = path.join(webRoot, '.next/server');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readCode(absolutePath: string): string {
  return stripComments(readFileSync(absolutePath, 'utf8'));
}

function reminderSources(): string[] {
  return readdirSync(REMINDERS_DIR)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => path.join(REMINDERS_DIR, entry));
}

/** Every built JavaScript file Next emits for the server, chunks included. */
function serverBundleFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...serverBundleFiles(absolute));
      continue;
    }
    // `.map` files carry original identifier names by design and prove nothing about execution.
    if (entry.endsWith('.js')) {
      found.push(absolute);
    }
  }
  return found;
}

describe('A8.7b-INCIDENT-1d reminder ETag constant', () => {
  describe('the runtime-import hazard', () => {
    it('imports only types from the externalized database package', () => {
      for (const source of reminderSources()) {
        const code = readCode(source);
        // `[^;]*` keeps the match inside one statement, so a preceding import cannot absorb it.
        expect(
          code,
          `${path.basename(source)} must not import a runtime value from @aicaa/db`,
        ).not.toMatch(/import\s+(?!type\b)[^;]*from\s+['"]@aicaa\/db['"]/);
        expect(code).not.toMatch(/import\s+['"]@aicaa\/db['"]/);
        expect(code).not.toMatch(/require\(\s*['"]@aicaa\/db['"]/);
      }
    });

    it('declares the constant locally rather than re-exporting the imported binding', () => {
      const code = readCode(path.join(REMINDERS_DIR, 'etag.ts'));
      expect(code).toMatch(/export const NO_SCHEDULE_REMINDER_VERSION = 0;/);
      expect(code).not.toMatch(/export\s*\{\s*NO_SCHEDULE_REMINDER_VERSION\s*\}/);
    });
  });

  describe('the value itself', () => {
    it('is zero and matches the persistence authority, so the two cannot drift', () => {
      expect(NO_SCHEDULE_REMINDER_VERSION).toBe(0);
      expect(NO_SCHEDULE_REMINDER_VERSION).toBe(PERSISTENCE_NO_SCHEDULE_VERSION);
    });

    it('resolves the no-schedule ETag to version 0, never to vundefined', () => {
      const etag = reminderETag('task_abc', currentReminderVersion(null));
      expect(etag).toBe('"task-reminder-task_abc-v0"');
      expect(etag).not.toContain('vundefined');
    });
  });

  /**
   * Conditional by necessity, not by convenience.
   *
   * `pnpm verify` runs the suite before `build:web`, so on a clean checkout there is no artefact to
   * read and a hard failure here would only mean "you have not built yet". It is asserted against a
   * real production build in the A8.7b-INCIDENT-1d evidence, which is where the proof lives.
   */
  describe('the built server output', () => {
    const built = existsSync(BUILD_SERVER_DIR);

    it.runIf(built)('leaves no undeclared NO_SCHEDULE_REMINDER_VERSION identifier', () => {
      const offenders = serverBundleFiles(BUILD_SERVER_DIR).filter((file) =>
        readFileSync(file, 'utf8').includes('NO_SCHEDULE_REMINDER_VERSION'),
      );
      expect(
        offenders.map((file) => path.relative(webRoot, file)),
        'the constant must be inlined by the bundler, not emitted as a free variable',
      ).toEqual([]);
    });

    it.runIf(built)('emits a no-schedule ETag whose version is a literal 0', () => {
      const chunk = serverBundleFiles(BUILD_SERVER_DIR).find((file) =>
        readFileSync(file, 'utf8').includes('"no_due_date"'),
      );
      expect(chunk, 'no server chunk contains the no_due_date projection').toBeDefined();
      const code = readFileSync(chunk as string, 'utf8');
      const index = code.indexOf('"no_due_date"');
      const window = code.slice(Math.max(0, index - 200), index);
      expect(window).toMatch(/etag:\s*\w+\([^,]+,\s*0\)/);
    });
  });
});
