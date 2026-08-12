import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A7.4 packaging guard.
 *
 * The A7.3 closure exposed a serverless packaging regression caused by a bare *runtime value*
 * import of `@aicaa/domain` inside `packages/db`. The compiled db runtime is loaded from a traced
 * relative layout that has no resolvable `@aicaa/domain` package, so runtime value imports must use
 * the relative `../../../domain/dist/index.js` convention instead.
 *
 * This guard scans `packages/db/src` and fails on any non-type runtime import/re-export that uses
 * the bare `@aicaa/domain` specifier. `import type` / `export type` (erased at build time) and
 * fully inline-`type` bindings are allowed.
 */

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip comments so prose can never be read as part of a declaration.
 *
 * Same helper the A8.7b-1j web import guard uses. The `[^:]` before `//` leaves `https://` alone.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Return the offending `@aicaa/domain` runtime import/re-export statements in a source string.
 *
 * Deliberately avoids a full TypeScript parser — a focused regex over import/export forms, the
 * approach the A8.7b-1j web import guard already established. Three things keep a match confined
 * to the single declaration it is classifying, so no neighbouring text can change the verdict:
 *
 *  - comments are removed first, so a doc block that merely discusses an import cannot bridge into
 *    the declaration below it;
 *  - a match may only begin at the start of a line, which is where a static import/export
 *    declaration always begins (they are legal only at module top level, and Prettier never puts
 *    two statements on one line);
 *  - the clause is bounded at `;`, which `semi: true` in `.prettierrc.json` guarantees is present.
 *
 * Within that one declaration, `(?!type\b)` skips whole-statement `import type` / `export type`,
 * and the brace clause is checked specifier by specifier — so multiline type-only blocks are
 * still distinguishable from multiline value blocks.
 */
export function findBareDomainRuntimeImports(content: string): string[] {
  const offenders: string[] = [];
  const code = stripComments(content);

  // Side-effect import: `import '@aicaa/domain'` — always a runtime import.
  const sideEffect = /^[ \t]*import\s+['"]@aicaa\/domain['"]/gm;
  for (const match of code.matchAll(sideEffect)) {
    offenders.push(match[0].trim());
  }

  // import/export ... from '@aicaa/domain' (with a binding clause).
  const withClause =
    /^[ \t]*(import|export)\s+(?!type\b)([^;]*?)\s+from\s+['"]@aicaa\/domain['"]/gm;
  for (const match of code.matchAll(withClause)) {
    const clause = match[2].trim();

    // Namespace or default value bindings are runtime values.
    const namedOnly = /^\{[\s\S]*\}$/.test(clause);
    if (!namedOnly) {
      offenders.push(match[0].trim());
      continue;
    }

    // Named bindings: allowed only when EVERY binding is `type`-prefixed.
    const inner = clause.replace(/^\{|\}$/g, '');
    const bindings = inner
      .split(',')
      .map((b) => b.trim())
      .filter((b) => b.length > 0);
    const allTypeOnly = bindings.every((b) => /^type\s+/.test(b));
    if (!allTypeOnly) {
      offenders.push(match[0].trim());
    }
  }

  return offenders;
}

describe('A7.4 packages/db domain-import packaging guard', () => {
  it('has no bare runtime @aicaa/domain value imports under packages/db/src', () => {
    const files = listTsFiles(srcRoot);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const offenders = findBareDomainRuntimeImports(content);
      for (const offender of offenders) {
        violations.push(`${path.relative(srcRoot, file)}: ${offender}`);
      }
    }

    expect(
      violations,
      `Runtime value imports of @aicaa/domain must use the relative '../../../domain/dist/index.js' ` +
        `convention (see packages/db/src/mappers/domain-mappers.ts). Offenders:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('allows type-only imports (import type / inline type bindings)', () => {
    expect(findBareDomainRuntimeImports(`import type { Foo } from '@aicaa/domain';`)).toEqual([]);
    expect(findBareDomainRuntimeImports(`export type { Bar } from '@aicaa/domain';`)).toEqual([]);
    expect(findBareDomainRuntimeImports(`import { type A, type B } from '@aicaa/domain';`)).toEqual(
      [],
    );

    // Multiline whole-statement `import type` must not be treated as a value import.
    expect(
      findBareDomainRuntimeImports(`import type {
  CommunicationEvent,
  TaskSuggestion,
} from '@aicaa/domain';`),
    ).toEqual([]);

    // A prior non-domain import must not span into a following type-only domain import
    // (the a6-transactions.ts false positive under the old cross-statement regex).
    expect(
      findBareDomainRuntimeImports(`import { randomBytes } from 'node:crypto';
import type { CommunicationEvent, TaskSuggestion } from '@aicaa/domain';`),
    ).toEqual([]);

    // Prose that discusses an import is not an import. A doc block carries no `;` to stop a
    // clause, so before comments were stripped it bridged into the declaration beneath it —
    // the same defect as the statement-spanning case above, with a comment as the bridge.
    expect(
      findBareDomainRuntimeImports(`/**
 * Callers must not import { normalizeRecipientEmail } from the bare specifier.
 */
import type { Task } from '@aicaa/domain';`),
    ).toEqual([]);
    expect(
      findBareDomainRuntimeImports(`// see packages/db/src/mappers/domain-mappers.ts for the runtime import convention
import type { Task } from '@aicaa/domain';`),
    ).toEqual([]);

    // A trailing comment on the declaration itself is likewise not a binding.
    expect(
      findBareDomainRuntimeImports(`import type { Task } from '@aicaa/domain'; // erased at build`),
    ).toEqual([]);
  });

  it('rejects runtime value imports and re-exports (actionable failure)', () => {
    expect(
      findBareDomainRuntimeImports(`import { normalizeRecipientEmail } from '@aicaa/domain';`),
    ).toHaveLength(1);
    expect(
      findBareDomainRuntimeImports(`import { foo, type Bar } from '@aicaa/domain';`),
    ).toHaveLength(1);
    expect(findBareDomainRuntimeImports(`import domain from '@aicaa/domain';`)).toHaveLength(1);
    expect(findBareDomainRuntimeImports(`import * as domain from '@aicaa/domain';`)).toHaveLength(
      1,
    );
    expect(findBareDomainRuntimeImports(`import '@aicaa/domain';`)).toHaveLength(1);
    expect(
      findBareDomainRuntimeImports(`export { normalizeRecipientEmail } from '@aicaa/domain';`),
    ).toHaveLength(1);

    // Multiline value import still fails.
    expect(
      findBareDomainRuntimeImports(`import {
  normalizeRecipientEmail,
} from '@aicaa/domain';`),
    ).toHaveLength(1);

    // A prior import must not hide a genuine following runtime domain import.
    expect(
      findBareDomainRuntimeImports(`import { randomBytes } from 'node:crypto';
import { normalizeRecipientEmail } from '@aicaa/domain';`),
    ).toHaveLength(1);

    // Stripping comments must not blind the detector: a documented violation is still a violation.
    expect(
      findBareDomainRuntimeImports(`/**
 * Reaching the runtime through the bare specifier — this is the regression A7.4 exists for.
 */
import { normalizeRecipientEmail } from '@aicaa/domain';`),
    ).toHaveLength(1);
    expect(
      findBareDomainRuntimeImports(
        `import { normalizeRecipientEmail } from '@aicaa/domain'; // needed at runtime`,
      ),
    ).toHaveLength(1);
  });
});
