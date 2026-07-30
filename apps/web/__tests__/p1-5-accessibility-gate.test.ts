import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural guards for the D119 automated accessibility gate.
 *
 * The gate itself is a browser suite; these are the properties that would let it rot
 * silently. A severity filter quietly narrowed, a rule disabled globally, or the axe package
 * drifting into the application bundle would all leave a green suite that no longer proves
 * what D119 asks for.
 */

const root = process.cwd();
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');
/** Comments explain what the helper avoids, so guards run against code alone. */
const stripComments = (source: string) =>
  source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');

const helperSource = read('e2e/support/accessibility.ts');
const helperCode = stripComments(helperSource);
const packageJson = JSON.parse(read('package.json')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe('D119 accessibility gate configuration', () => {
  it('fails on serious and critical impacts', () => {
    expect(helperCode).toContain("'critical'");
    expect(helperCode).toContain("'serious'");
    // Both, not one: a gate that only caught `critical` would pass a serious finding.
    expect(helperCode).toMatch(/BLOCKING_IMPACTS\s*=\s*\[\s*'critical',\s*'serious'\s*\]/);
  });

  it('disables no rule and narrows to no tag subset', () => {
    /*
     * D119 states a severity threshold and says nothing about tags. Restricting to
     * `withTags(['wcag2a'])` or similar would shrink the gate while still reporting green,
     * which is the failure mode worth guarding against.
     */
    expect(helperCode).not.toMatch(/\.disableRules\(/);
    expect(helperCode).not.toMatch(/\.withTags\(/);
    expect(helperCode).not.toMatch(/\.withRules\(/);
  });

  it('scans the whole page rather than a narrowed root', () => {
    // `include()` on a subtree is how a scan comes back clean while the problem sits outside.
    expect(helperCode).not.toMatch(/\.include\(/);
    expect(helperCode).not.toMatch(/\.exclude\(/);
  });
});

describe('D119 accessibility gate reporting stays private (D114)', () => {
  it('never emits the scanned URL, which on the Recipient surface is the secret', () => {
    expect(helperCode).not.toMatch(/results\.url|\.url\b/);
  });

  it('never emits the raw markup of a failing element', () => {
    // `node.html` is the element's outerHTML and can contain a Task title or a note.
    expect(helperCode).not.toMatch(/\.html\b/);
  });

  it('routes everything it does print through the existing capability redaction', () => {
    expect(helperCode).toContain('redactCapabilityPaths');
    for (const field of ['violation.help', 'node.target', 'node.failureSummary']) {
      expect(helperCode).toMatch(new RegExp(`sanitize\\(\\s*${field.replace('.', '\\.')}`));
    }
  });
});

describe('D119 accessibility dependency stays out of the product', () => {
  it('is a development dependency only', () => {
    expect(packageJson.devDependencies?.['@axe-core/playwright']).toBeTruthy();
    expect(packageJson.dependencies?.['@axe-core/playwright']).toBeUndefined();
    expect(packageJson.dependencies?.['axe-core']).toBeUndefined();
  });

  it('is imported only from browser-test code', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!['node_modules', '.next', 'e2e'].includes(entry.name)) {
            walk(relative);
          }
          continue;
        }
        if (!/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
          continue;
        }
        if (/axe-core|axe\.run|AxeBuilder/.test(read(relative))) {
          offenders.push(relative);
        }
      }
    };
    for (const dir of ['app', 'lib', 'components']) {
      try {
        walk(dir);
      } catch {
        // Directory absent in this workspace layout.
      }
    }
    expect(offenders).toEqual([]);
  });

  it('adds no production accessibility hook or debug switch', () => {
    const spec = read('e2e/specs/p1-5-accessibility-gate.spec.ts');
    expect(spec).not.toMatch(/process\.env\.[A-Z_]*A11Y|__a11y|\?a11y|debug=/);
    // States are reached through real interaction, never by injecting markup.
    expect(spec).not.toMatch(/innerHTML\s*=|document\.write|insertAdjacentHTML/);
  });
});
