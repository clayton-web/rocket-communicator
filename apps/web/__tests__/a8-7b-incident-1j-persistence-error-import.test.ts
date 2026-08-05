import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as tracedRuntime from '@aicaa/db/runtime';
import { PersistenceError, uniqueViolation } from '@aicaa/db';

/**
 * A8.7b-INCIDENT-1j guards for the last runtime-value import from the externalized package.
 *
 * `apps/web/lib/suggestions/process-service.ts` imported the `PersistenceError` class from
 * `@aicaa/db` and classified errors with `instanceof`. That is the same defect class as the
 * A8.7b-INCIDENT-1d reminder ETag incident: `@aicaa/db` sits in `serverExternalPackages`, so Next
 * leaves it a runtime external and a *value* imported from it statically is not guaranteed to
 * survive the build. `DEPLOYMENT.md` recorded it as latent in Production and asked for it to be
 * resolved before the queued A8.4b–A8.6 code deploys.
 *
 * Both former call sites sat inside `catch` blocks, which is what made this instance worse than
 * the reminder one. A `ReferenceError` raised while handling a persistence failure destroys the
 * error being handled, and the surviving branch — the `UNIQUE_VIOLATION` idempotent re-claim —
 * would have degraded into a retryable failure that burns a D084 attempt on every duplicate.
 *
 * The guards are deliberately layered the way 1d's are, because each catches something the others
 * structurally cannot:
 *
 *  - the **source** guards catch the import pattern returning anywhere under `apps/web/lib`,
 *  - the **bridge** guards prove the replacement is carried across the traced runtime and is
 *    validated at load, so a bundle that loses it fails loudly instead of misclassifying,
 *  - the **behaviour** guard proves the predicate still recognises a real persistence error, and
 *  - the **bundle** guard is the only one that inspects what actually ships.
 *
 * Unit tests structurally cannot detect the underlying hazard: Vitest resolves `@aicaa/db`
 * directly, so the binding is present in every test and absent only in the deployed artefact. A
 * green suite is not evidence, which is why the bundle guard exists at all.
 */

const webRoot = path.resolve(__dirname, '..');
const LIB_DIR = path.join(webRoot, 'lib');
const APP_DIR = path.join(webRoot, 'app');
const BUILD_SERVER_DIR = path.join(webRoot, '.next/server');

/**
 * The bridge is the one file allowed to name the externalized package in a value position, because
 * naming it there is precisely how the traced runtime gets re-exported for Turbopack.
 */
const BRIDGE_FILES = new Set([path.join(LIB_DIR, 'db/db-runtime-reexports.ts')]);

/**
 * Classes and constants `apps/web` must never import from `@aicaa/db` as values.
 *
 * Every entry is something whose only use is `instanceof` or a literal comparison — the two shapes
 * that read as harmless in review and vanish in the bundle. Reaching them through
 * `loadDbRuntime()`, or owning the value locally with a drift assertion, are the two sanctioned
 * alternatives ([DEPLOYMENT.md](../../docs/DEPLOYMENT.md) § the runtime-value import hazard).
 */
const PROHIBITED_RUNTIME_VALUES = [
  'PersistenceError',
  'PrismaClient',
  'Prisma',
  'NO_SCHEDULE_REMINDER_VERSION',
] as const;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...sourceFiles(absolute));
      continue;
    }
    if (/\.tsx?$/.test(entry)) {
      found.push(absolute);
    }
  }
  return found;
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

/** The value-position import statements a file makes from the externalized package. */
function valueImportsOfExternalizedPackage(code: string): string[] {
  const statements = code.match(/import\s+(?!type\b)[^;]*?from\s+['"]@aicaa\/db['"]/g) ?? [];
  // `import { type X }` is erased too, so only flag a statement that binds at least one value.
  return statements.filter((statement) => {
    const braced = statement.match(/\{([\s\S]*)\}/);
    if (!braced) {
      // A default or namespace import is always a value binding.
      return true;
    }
    return braced[1]!
      .split(',')
      .map((specifier) => specifier.trim())
      .filter((specifier) => specifier.length > 0)
      .some((specifier) => !specifier.startsWith('type '));
  });
}

describe('A8.7b-INCIDENT-1j PersistenceError runtime-value import', () => {
  describe('the source guards', () => {
    it('imports no runtime value from the externalized package anywhere under lib or app', () => {
      const offenders: string[] = [];
      for (const file of [...sourceFiles(LIB_DIR), ...sourceFiles(APP_DIR)]) {
        if (BRIDGE_FILES.has(file)) {
          continue;
        }
        const code = stripComments(readFileSync(file, 'utf8'));
        if (valueImportsOfExternalizedPackage(code).length > 0) {
          offenders.push(path.relative(webRoot, file));
        }
        if (/require\(\s*['"]@aicaa\/db['"]/.test(code)) {
          offenders.push(path.relative(webRoot, file));
        }
      }
      expect(
        offenders,
        'reach persistence through loadDbRuntime(), or own the value locally with a drift assertion',
      ).toEqual([]);
    });

    it('names no prohibited value in an import specifier from the externalized package', () => {
      const offenders: string[] = [];
      for (const file of [...sourceFiles(LIB_DIR), ...sourceFiles(APP_DIR)]) {
        if (BRIDGE_FILES.has(file)) {
          continue;
        }
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const statement of code.match(/import[^;]*?from\s+['"]@aicaa\/db['"]/g) ?? []) {
          // A whole-statement `import type { … }` erases every specifier inside it.
          if (/^import\s+type\b/.test(statement.trim())) {
            continue;
          }
          for (const value of PROHIBITED_RUNTIME_VALUES) {
            const bound = new RegExp(`(^|[{,\\s])${value}\\s*(,|\\}|$| as )`);
            const specifiers = statement.match(/\{([\s\S]*)\}/)?.[1] ?? statement;
            if (bound.test(specifiers) && !new RegExp(`type\\s+${value}\\b`).test(specifiers)) {
              offenders.push(`${path.relative(webRoot, file)}: ${value}`);
            }
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it('classifies persistence failures in the suggestion processor through the runtime', () => {
      const code = stripComments(
        readFileSync(path.join(LIB_DIR, 'suggestions/process-service.ts'), 'utf8'),
      );
      expect(code).toMatch(/runtime\.isPersistenceError\(/);
      // The local `instanceof` helper this replaced must not come back under any name.
      expect(code).not.toMatch(/instanceof\s+PersistenceError/);
      expect(code).not.toMatch(/function\s+isPersistenceError\b/);
      // The UNIQUE_VIOLATION re-claim branch is the behaviour the predicate protects.
      expect(code).toMatch(/runtime\.isPersistenceError\([^)]*\)\s*&&[^;]*'UNIQUE_VIOLATION'/);
    });
  });

  describe('the runtime bridge', () => {
    it('exports the predicate from the traced runtime module', () => {
      expect(typeof tracedRuntime.isPersistenceError).toBe('function');
    });

    it('is declared, mapped, and required by the loader, so a lost binding fails at load', () => {
      const entry = stripComments(
        readFileSync(path.join(LIB_DIR, 'db/db-runtime-entry.ts'), 'utf8'),
      );
      const reexports = stripComments(
        readFileSync(path.join(LIB_DIR, 'db/db-runtime-reexports.ts'), 'utf8'),
      );
      const loader = stripComments(readFileSync(path.join(LIB_DIR, 'db/runtime-db.ts'), 'utf8'));

      expect(reexports).toMatch(/\bisPersistenceError\b/);
      expect(entry).toMatch(
        /isPersistenceError:\s*typeof\s+TracedRuntimeBindings\.isPersistenceError/,
      );
      expect(entry).toMatch(/isPersistenceError:\s*tracedRuntime\.isPersistenceError/);
      expect(loader).toMatch(/'isPersistenceError'/);
    });
  });

  describe('the behaviour it has to preserve', () => {
    it('recognises a persistence error and reports its code', () => {
      const error = uniqueViolation('duplicate suggestion for source event');
      expect(tracedRuntime.isPersistenceError(error)).toBe(true);
      expect(tracedRuntime.isPersistenceError(error) && error.code).toBe('UNIQUE_VIOLATION');
      expect(error).toBeInstanceOf(PersistenceError);
    });

    it('rejects everything that is not one, including a look-alike', () => {
      const lookAlike = Object.assign(new Error('nope'), {
        name: 'PersistenceError',
        code: 'UNIQUE_VIOLATION',
      });
      expect(tracedRuntime.isPersistenceError(lookAlike)).toBe(false);
      expect(tracedRuntime.isPersistenceError(new Error('plain'))).toBe(false);
      expect(tracedRuntime.isPersistenceError(undefined)).toBe(false);
      expect(tracedRuntime.isPersistenceError({ code: 'UNIQUE_VIOLATION' })).toBe(false);
    });
  });

  /**
   * Conditional by necessity, not by convenience — the same reason 1d's bundle guard is.
   *
   * `pnpm verify` runs the suite before `build:web`, so on a clean checkout there is no artefact to
   * read and a hard failure here would only mean "you have not built yet". The Gate 5 runbook
   * requires this to be asserted against a real production build before the deployment is created.
   */
  describe('the built server output', () => {
    const built = existsSync(BUILD_SERVER_DIR);

    it.runIf(built)('leaves no undeclared PersistenceError identifier in the server chunks', () => {
      const offenders = serverBundleFiles(BUILD_SERVER_DIR).filter((file) => {
        const code = readFileSync(file, 'utf8');
        // A minified local class declaration is fine; a bare free variable is the hazard. Look for
        // the identifier used without ever being declared or assigned in the same file.
        if (!/\bPersistenceError\b/.test(code)) {
          return false;
        }
        const declared =
          /class\s+PersistenceError\b/.test(code) ||
          /\bPersistenceError\s*[=:]/.test(code) ||
          /['"]PersistenceError['"]/.test(code);
        return !declared;
      });
      expect(
        offenders.map((file) => path.relative(webRoot, file)),
        'PersistenceError must never appear in a server chunk as an undeclared free variable',
      ).toEqual([]);
    });

    it.runIf(built)('reaches the predicate through the runtime object in the built chunk', () => {
      const chunks = serverBundleFiles(BUILD_SERVER_DIR).filter((file) =>
        readFileSync(file, 'utf8').includes('suggestion.process.claim_released'),
      );
      expect(chunks.length, 'no server chunk contains the suggestion processor').toBeGreaterThan(0);
      const reached = chunks.some((file) =>
        /\.isPersistenceError\s*\(/.test(readFileSync(file, 'utf8')),
      );
      expect(reached, 'the processor must call isPersistenceError off the loaded runtime').toBe(
        true,
      );
    });
  });
});
