// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Removal of the last P1.4 compatibility aliases from the Recipient capability surface.
 *
 * P1.4 tokenized the Owner stylesheets but deliberately left `/c/{token}` alone, because that
 * surface is externally visible and security-sensitive and P1 touches it last. It bridged the
 * gap by declaring `--ink`, `--muted`, `--line`, and `--accent` in `globals.css` as direct
 * aliases of the `--aicaa-*` tokens, and recorded that P1.5 should migrate the stylesheet and
 * delete the block.
 *
 * This is that migration: eighteen `var(--short)` references became `var(--aicaa-color-*)`,
 * and the four declarations went. Because each alias was a single unconditional reference
 * with no fallback and no transformation, the resolved value at every use is unchanged —
 * proven separately by comparing computed styles before and after across every state and both
 * viewports.
 */

const webApp = join(__dirname, '../app');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const capabilityPath = join(webApp, 'c/[token]/recipient-capability.module.css');
const capability = readFileSync(capabilityPath, 'utf8');
const capabilityCode = stripComments(capability);
const globalsCode = stripComments(readFileSync(join(webApp, 'globals.css'), 'utf8'));

const LEGACY_ALIASES = ['--ink', '--muted', '--line', '--accent'] as const;

/**
 * Colour literals present before the cleanup, which was authorized to change no literal.
 * Recorded as a multiset so a token reference silently becoming a hard-coded colour, or a
 * literal quietly disappearing, both fail.
 */
const PRE_CLEANUP_LITERALS = [
  '#fff',
  '#fff',
  '#fff',
  '#fff',
  '#b91c1c',
  '#b91c1c',
  '#991b1b',
  'rgba(255, 255, 255, 0.65)',
  'rgba(255, 255, 255, 0.75)',
  'rgba(28, 25, 23, 0.45)',
  'rgba(28, 25, 23, 0.18)',
];

/** Class selectors present before the cleanup. Renaming one would break the components. */
const PRE_CLEANUP_CLASSES = [
  'actions',
  'alert',
  'alertError',
  'backdrop',
  'danger',
  'dialog',
  'dialogActions',
  'field',
  'formActions',
  'hint',
  'lede',
  'meta',
  'noteBody',
  'notes',
  'page',
  'point',
  'pointLabel',
  'points',
  'primary',
  'section',
  'srOnly',
];

describe('Recipient capability stylesheet uses canonical tokens (P1.5 / D116)', () => {
  it.each(LEGACY_ALIASES)('no longer consumes %s', (alias) => {
    expect(capabilityCode).not.toContain(`var(${alias})`);
  });

  it.each(LEGACY_ALIASES)('no longer has %s declared for it in globals.css', (alias) => {
    expect(globalsCode).not.toMatch(new RegExp(`${alias}\\s*:`));
  });

  it('references the canonical token for every colour it used an alias for', () => {
    for (const token of [
      '--aicaa-color-ink',
      '--aicaa-color-muted',
      '--aicaa-color-line',
      '--aicaa-color-accent',
    ]) {
      expect(capabilityCode).toContain(`var(${token})`);
    }
  });

  it('replaced each alias use one-for-one, with no use lost or invented', () => {
    const count = (needle: string) => capabilityCode.split(needle).length - 1;

    // The pre-cleanup counts, so a dropped declaration or a stray extra one is visible.
    expect(count('var(--aicaa-color-ink)')).toBe(6);
    expect(count('var(--aicaa-color-muted)')).toBe(2);
    expect(count('var(--aicaa-color-line)')).toBe(5);
    expect(count('var(--aicaa-color-accent)')).toBe(5);
  });

  it('introduced no replacement colour literal', () => {
    const hex = [...capabilityCode.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0]);
    const rgb = [...capabilityCode.matchAll(/\brgba?\([^)]*\)/gi)].map((m) => m[0]);

    expect([...hex, ...rgb].sort()).toEqual([...PRE_CLEANUP_LITERALS].sort());
  });

  it('renamed no class', () => {
    const classes = [
      ...new Set([...capabilityCode.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])),
    ];

    expect(classes.sort()).toEqual([...PRE_CLEANUP_CLASSES].sort());
  });

  it('defines no design token of its own, so ownership stays in the token layer', () => {
    // Consuming `--aicaa-*` is the point; declaring one here would fork the palette (D124).
    expect(capabilityCode).not.toMatch(/^\s*--aicaa-[a-z0-9-]+\s*:/m);
    expect(capabilityCode).not.toMatch(/^\s*--[a-z0-9-]+\s*:/m);
  });

  it('leaves the short names unused everywhere else too', () => {
    for (const relative of [
      '(owner)/owner-boundary.module.css',
      '(owner)/owner-shell.module.css',
      '(owner)/tasks/tasks.module.css',
      '(owner)/_components/presentation.module.css',
      'globals.css',
    ]) {
      const css = stripComments(readFileSync(join(webApp, relative), 'utf8'));
      for (const alias of LEGACY_ALIASES) {
        expect(css, `${relative} must not consume ${alias}`).not.toContain(`var(${alias})`);
      }
    }
  });
});
