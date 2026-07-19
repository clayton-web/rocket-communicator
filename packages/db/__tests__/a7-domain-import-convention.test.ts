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
 * Return the offending `@aicaa/domain` runtime import/re-export statements in a source string.
 * Deliberately avoids a full TypeScript parser — a focused regex over import/export forms.
 */
export function findBareDomainRuntimeImports(content: string): string[] {
  const offenders: string[] = [];

  // Side-effect import: `import '@aicaa/domain'` — always a runtime import.
  const sideEffect = /import\s+['"]@aicaa\/domain['"]/g;
  for (const match of content.matchAll(sideEffect)) {
    offenders.push(match[0]);
  }

  // import/export ... from '@aicaa/domain' (with a binding clause).
  const withClause = /(import|export)\s+([\s\S]*?)\s+from\s+['"]@aicaa\/domain['"]/g;
  for (const match of content.matchAll(withClause)) {
    const clause = match[2].trim();

    // `import type { ... }` / `export type { ... }` — fully type-only, erased at build.
    if (/^type\b/.test(clause)) {
      continue;
    }

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
  });
});
