// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Recipient capability stylesheet on the S4 role tokens (S4.2 / D174).
 *
 * P1.5 migrated `/c/{token}` off the `--ink`/`--muted`/`--line`/`--accent` aliases onto the
 * `--aicaa-color-*` names those aliases pointed at, and left the light presentation in place.
 * S4.2 is the authorized visual migration: the same stylesheet now consumes the S4 semantic
 * roles directly, scoped to the Recipient page container, without remapping the legacy tokens
 * the way the Owner shell does.
 *
 * Counts cannot detect a swap of which element gets which role, so the companion browser
 * spec compares computed style against the token value read from `:root` at runtime.
 */

const webApp = join(__dirname, '../app');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const capabilityPath = join(webApp, 'c/[token]/recipient-capability.module.css');
const capability = readFileSync(capabilityPath, 'utf8');
const capabilityCode = stripComments(capability);
const globalsCode = stripComments(readFileSync(join(webApp, 'globals.css'), 'utf8'));

const LEGACY_ALIASES = ['--ink', '--muted', '--line', '--accent'] as const;
const LEGACY_SHARED_TOKENS = [
  '--aicaa-color-ink',
  '--aicaa-color-muted',
  '--aicaa-color-line',
  '--aicaa-color-accent',
] as const;

/**
 * Colour literals present after S4.2. The pre-migration light multiset is gone; the dialog
 * shadow uses `--aicaa-color-scrim-dark` rather than a second elevation literal. An empty
 * multiset is the exact post-migration expectation, not a loosened guard: a token reference
 * silently becoming a hard-coded colour still fails.
 */
const POST_S4_2_LITERALS: string[] = [];

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

describe('Recipient capability stylesheet uses S4 role tokens (S4.2 / D174)', () => {
  it.each(LEGACY_ALIASES)('no longer consumes %s', (alias) => {
    expect(capabilityCode).not.toContain(`var(${alias})`);
  });

  it.each(LEGACY_ALIASES)('no longer has %s declared for it in globals.css', (alias) => {
    expect(globalsCode).not.toMatch(new RegExp(`${alias}\\s*:`));
  });

  it.each(LEGACY_SHARED_TOKENS)('no longer consumes legacy shared token %s', (token) => {
    expect(capabilityCode).not.toContain(`var(${token})`);
  });

  it('references every S4 role the Recipient surface was authorized to consume', () => {
    for (const token of [
      '--aicaa-color-background',
      '--aicaa-color-text',
      '--aicaa-color-text-muted',
      '--aicaa-color-surface-raised-solid',
      '--aicaa-color-surface-base',
      '--aicaa-color-surface-cool',
      '--aicaa-color-border',
      '--aicaa-color-border-strong',
      '--aicaa-color-border-cool',
      '--aicaa-color-primary',
      '--aicaa-color-on-primary',
      '--aicaa-color-info',
      '--aicaa-color-destructive',
      '--aicaa-color-focus',
      '--aicaa-color-scrim-dark',
      '--aicaa-target-min',
    ]) {
      expect(capabilityCode).toContain(`var(${token})`);
    }
  });

  it('replaced each role use one-for-one, with no use lost or invented', () => {
    const count = (needle: string) => capabilityCode.split(needle).length - 1;

    expect(count('var(--aicaa-color-background)')).toBe(2);
    expect(count('var(--aicaa-color-text)')).toBe(8);
    expect(count('var(--aicaa-color-text-muted)')).toBe(2);
    expect(count('var(--aicaa-color-surface-raised-solid)')).toBe(3);
    expect(count('var(--aicaa-color-surface-base)')).toBe(1);
    expect(count('var(--aicaa-color-surface-cool)')).toBe(1);
    expect(count('var(--aicaa-color-border)')).toBe(4);
    expect(count('var(--aicaa-color-border-strong)')).toBe(1);
    expect(count('var(--aicaa-color-border-cool)')).toBe(1);
    expect(count('var(--aicaa-color-primary)')).toBe(2);
    expect(count('var(--aicaa-color-on-primary)')).toBe(1);
    expect(count('var(--aicaa-color-info)')).toBe(1);
    expect(count('var(--aicaa-color-destructive)')).toBe(3);
    expect(count('var(--aicaa-color-focus)')).toBe(1);
    expect(count('var(--aicaa-color-scrim-dark)')).toBe(2);
    expect(count('var(--aicaa-target-min)')).toBe(2);
    expect(count('var(--aicaa-font-sans)')).toBe(2);
    expect(count('var(--aicaa-font-serif)')).toBe(1);
  });

  it('introduced no replacement colour literal', () => {
    const hex = [...capabilityCode.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0]);
    const rgb = [...capabilityCode.matchAll(/\brgba?\([^)]*\)/gi)].map((m) => m[0]);

    expect([...hex, ...rgb].sort()).toEqual([...POST_S4_2_LITERALS].sort());
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

  it('introduces no motion', () => {
    expect(capabilityCode).not.toMatch(/transition(?:-|$|\s*:)/i);
    expect(capabilityCode).not.toMatch(/animation(?:-|$|\s*:)/i);
    expect(capabilityCode).not.toMatch(/@keyframes/i);
  });

  it('establishes the dark canvas on the Recipient page container, not globally', () => {
    expect(capabilityCode).toMatch(/color-scheme:\s*dark/);
    expect(globalsCode).toMatch(/color-scheme:\s*light/);
    expect(globalsCode).not.toMatch(/color-scheme:\s*dark/);
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
