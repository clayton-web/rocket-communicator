// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * P1.4 token extraction evidence (D116).
 *
 * `packages/ui` is authorized as a semantic-token layer only, and its tokens had to land as
 * a no-op refactor: every value identical to the literal it replaced, so any later visual
 * change is traceable. This suite is the proof, and it is deliberately three separate
 * claims:
 *
 *   1. the package contains no component;
 *   2. every token equals the pre-P1.4 literal recorded below;
 *   3. every `var(--aicaa-*)` referenced in `apps/web` resolves to a defined token.
 *
 * Claim 3 matters because a mistyped custom property does not fail loudly — CSS drops the
 * declaration and the page silently loses a colour or a font. Reading both sides from disk
 * is what makes that detectable.
 */

const repoRoot = join(__dirname, '../../..');
const uiPackage = join(repoRoot, 'packages/ui');
const tokensPath = join(uiPackage, 'tokens.css');
const webApp = join(__dirname, '../app');

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Parse `--name: value;` declarations, tolerating values that wrap across lines. */
function parseTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const declaration of stripComments(css).split(';')) {
    const match = /(--[a-z0-9-]+)\s*:\s*([\s\S]+)/i.exec(declaration);
    if (match) {
      tokens.set(match[1], match[2].replace(/\s+/g, ' ').trim());
    }
  }
  return tokens;
}

function collectFiles(dir: string, extensions: string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectFiles(full, extensions));
    } else if (extensions.some((extension) => entry.endsWith(extension))) {
      found.push(full);
    }
  }
  return found;
}

const tokens = parseTokens(readFileSync(tokensPath, 'utf8'));

/**
 * Values read from `globals.css` and `tasks.module.css` at commit 34d048e7, before token
 * extraction. This table is the no-op contract: changing a value here without a recorded
 * visual decision is exactly the drift D116 prohibits.
 */
const PRE_P1_4_LITERALS: Record<string, string> = {
  // Colour — these five were `--ink`, `--muted`, `--paper`, `--line`, `--accent`.
  '--aicaa-color-ink': '#1c1917',
  '--aicaa-color-muted': '#57534e',
  '--aicaa-color-paper': '#f5f5f4',
  '--aicaa-color-line': '#d6d3d1',
  '--aicaa-color-accent': '#0f766e',
  '--aicaa-color-surface': '#fff',
  '--aicaa-color-canvas-top': '#fafaf9',
  '--aicaa-color-surface-veil': 'rgba(255, 255, 255, 0.7)',
  '--aicaa-color-surface-raised': 'rgba(255, 255, 255, 0.72)',
  '--aicaa-color-surface-card': 'rgba(255, 255, 255, 0.75)',
  '--aicaa-color-surface-banner': 'rgba(255, 255, 255, 0.8)',
  '--aicaa-color-positive': '#15803d',
  '--aicaa-color-critical': '#b91c1c',
  '--aicaa-color-caution': '#b45309',
  '--aicaa-color-accent-glow': 'rgba(15, 118, 110, 0.08)',
  '--aicaa-color-focus-ring-subtle': 'rgba(15, 118, 110, 0.35)',
  '--aicaa-color-focus-ring': 'rgba(15, 118, 110, 0.55)',
  '--aicaa-color-scrim': 'rgba(28, 25, 23, 0.45)',

  // Typeface — the sans stack previously appeared twelve times in tasks.module.css.
  '--aicaa-font-serif':
    "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  '--aicaa-font-sans': "'Segoe UI', system-ui, -apple-system, sans-serif",

  // Type scale
  '--aicaa-text-xs': '0.8rem',
  '--aicaa-text-sm': '0.9rem',
  '--aicaa-text-md': '0.95rem',
  '--aicaa-text-lg': '1.05rem',
  '--aicaa-text-heading-sm': '1.15rem',
  '--aicaa-text-heading-md': '1.2rem',
  '--aicaa-text-heading-page': 'clamp(1.6rem, 4vw, 2.1rem)',
  '--aicaa-text-heading-hero': 'clamp(1.75rem, 4vw, 2.35rem)',

  // Type rhythm
  '--aicaa-leading-tight': '1.45',
  '--aicaa-leading-normal': '1.5',
  '--aicaa-leading-relaxed': '1.55',
  '--aicaa-weight-semibold': '600',
  '--aicaa-tracking-tight': '-0.02em',

  // Spacing
  '--aicaa-space-3xs': '0.25rem',
  '--aicaa-space-2xs': '0.4rem',
  '--aicaa-space-xs': '0.65rem',
  '--aicaa-space-sm': '0.75rem',
  '--aicaa-space-md': '0.9rem',
  '--aicaa-space-lg': '1rem',
  '--aicaa-space-xl': '1.25rem',
  '--aicaa-space-2xl': '1.5rem',
  '--aicaa-space-3xl': '1.75rem',
  '--aicaa-space-4xl': '2.5rem',
  '--aicaa-space-5xl': '4rem',

  // Borders
  '--aicaa-border-width': '1px',
  '--aicaa-border-emphasis-width': '3px',
  '--aicaa-border-style': 'solid',

  // Radius and motion: the shipped interface is square and static. These record the
  // CURRENT value, not a placeholder, which is why they are asserted rather than omitted.
  '--aicaa-radius-none': '0',
  '--aicaa-radius-control': '0',
  '--aicaa-radius-surface': '0',
  '--aicaa-motion-duration-none': '0s',
  '--aicaa-motion-transition-none': 'none',

  // Interaction targets and measure
  '--aicaa-target-min': '2.75rem',
  '--aicaa-measure-content': '40rem',
  '--aicaa-focus-ring-width': '2px',
  '--aicaa-focus-ring-offset': '2px',
};

describe('packages/ui is a tokens-only layer (D116)', () => {
  it('ships no React component, hook, or logic module', () => {
    const files = collectFiles(uiPackage, ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

    expect(files).toEqual([]);
  });

  it('contains only the token stylesheet, its manifest, and documentation', () => {
    const entries = readdirSync(uiPackage).filter((entry) => entry !== 'node_modules');

    expect(entries.sort()).toEqual(['README.md', 'package.json', 'tokens.css']);
  });

  it('declares no build, lint, or test script, so it adds no gate machinery', () => {
    const manifest = JSON.parse(readFileSync(join(uiPackage, 'package.json'), 'utf8'));

    expect(manifest.scripts).toBeUndefined();
    expect(manifest.name).toBe('@aicaa/ui');
    expect(manifest.exports).toEqual({ './tokens.css': './tokens.css' });
  });

  it('exposes no JavaScript entry point that could import React', () => {
    const manifest = JSON.parse(readFileSync(join(uiPackage, 'package.json'), 'utf8'));
    const exported = Object.values(manifest.exports as Record<string, string>);

    expect(exported.every((target) => target.endsWith('.css'))).toBe(true);
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.peerDependencies).toBeUndefined();
  });
});

describe('token extraction was a verified no-op (D116)', () => {
  it.each(Object.entries(PRE_P1_4_LITERALS))(
    'preserves the pre-P1.4 value of %s',
    (name, expected) => {
      expect(tokens.get(name)).toBe(expected);
    },
  );

  it('defines no token beyond the recorded set, so nothing arrived undocumented', () => {
    const unexpected = [...tokens.keys()].filter(
      (name) => name.startsWith('--aicaa-') && !(name in PRE_P1_4_LITERALS),
    );

    expect(unexpected).toEqual([]);
  });

  it('resolves every --aicaa- reference in apps/web to a defined token', () => {
    const stylesheets = collectFiles(webApp, ['.css']);
    expect(stylesheets.length).toBeGreaterThan(0);

    const dangling: string[] = [];
    for (const file of stylesheets) {
      const css = stripComments(readFileSync(file, 'utf8'));
      for (const [, name] of css.matchAll(/var\((--aicaa-[a-z0-9-]+)/gi)) {
        if (!tokens.has(name)) {
          dangling.push(`${file.replace(repoRoot, '')} → ${name}`);
        }
      }
    }

    expect(dangling).toEqual([]);
  });

  it('leaves no bare colour literal in the Owner stylesheets it extracted', () => {
    // Scoped to the two files P1.4 tokenized. `/c/[token]` keeps its own stylesheet until
    // P1.5 legitimately touches that surface, and is deliberately excluded here.
    for (const relative of ['globals.css', '(owner)/tasks/tasks.module.css']) {
      const css = stripComments(readFileSync(join(webApp, relative), 'utf8'));
      const hexColours = [...css.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => match[0]);
      const rgbColours = [...css.matchAll(/\brgba?\([^)]*\)/gi)].map((match) => match[0]);

      expect(hexColours, `${relative} must not hardcode hex colours`).toEqual([]);
      // One shadow colour remains a literal: it is a single-use elevation value with no
      // second consumer, so a token would add indirection without removing duplication.
      expect(rgbColours.filter((value) => !value.includes('28, 25, 23, 0.18'))).toEqual([]);
    }
  });

  it('no longer needs compatibility aliases for the Recipient capability stylesheet', () => {
    const globals = stripComments(readFileSync(join(webApp, 'globals.css'), 'utf8'));
    const capability = stripComments(
      readFileSync(join(webApp, 'c/[token]/recipient-capability.module.css'), 'utf8'),
    );

    /*
     * This assertion is the inverse of the P1.4 one it replaces. While the capability
     * stylesheet consumed the short names, they HAD to stay defined or that page silently
     * lost its palette; P1.5 migrated it to the tokens they aliased, so now their continued
     * presence would mean the migration had regressed.
     */
    for (const legacy of ['--ink', '--muted', '--line', '--accent']) {
      expect(capability, `${legacy} must not be consumed`).not.toContain(`var(${legacy})`);
      expect(globals, `${legacy} must not be declared`).not.toMatch(
        new RegExp(`${legacy}\\s*:`, 'm'),
      );
    }
  });
});
