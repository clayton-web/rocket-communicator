// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CapabilityLoading from '@/app/c/[token]/loading';

/**
 * P1.5 Recipient capability loading boundary (D112).
 *
 * D112 permits a loading affordance for reads and applies to the capability surface as well
 * as the Owner one. What is specific to this boundary is that it renders before the token has
 * been validated, so the same markup is served to a Recipient holding a live link and to a
 * stranger holding an expired, revoked, or invented one. Every assertion below exists because
 * of that: the boundary may not distinguish those visitors, and it may not carry anything
 * that only the first of them is entitled to see.
 */

const appRoot = join(__dirname, '../app');
const loadingSource = readFileSync(join(appRoot, 'c/[token]/loading.tsx'), 'utf8');

/**
 * The boundary with its comments removed, so a guard reads what the file *does*.
 *
 * The module documents the imports and behaviour it deliberately omits, and a plain substring
 * search cannot tell that explanation apart from the thing it is explaining.
 */
const loadingCode = loadingSource.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '');

/**
 * Module specifiers the boundary actually imports.
 *
 * Scanning raw text would also match this file's own prose explaining which imports are
 * deliberately absent, which is the opposite of what these guards assert.
 */
const importSpecifiers = [
  ...loadingCode.matchAll(/^import\s+(?:[\s\S]*?\sfrom\s+)?'([^']+)';$/gm),
].map((match) => match[1]);

describe('capability loading boundary presentation', () => {
  afterEach(cleanup);

  it('announces the load through one status region with readable text', () => {
    render(<CapabilityLoading />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading task');
    // One region, so a screen reader announces the state once rather than twice.
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('renders no empty container and no text-free spinner', () => {
    const { container } = render(<CapabilityLoading />);

    expect((container.textContent ?? '').trim().length).toBeGreaterThan(0);
    expect(screen.getByRole('status').textContent?.trim()).not.toBe('');
  });

  it('claims nothing about the link, the Task, or the visitor', () => {
    const { container } = render(<CapabilityLoading />);
    const text = container.textContent ?? '';

    // Validity in either direction: the server has not answered yet.
    expect(text).not.toMatch(/valid|invalid|expired|revoked|unavailable|not found|authorized/i);
    // Existence, ownership, or assignment of a Task.
    expect(text).not.toMatch(/assigned by|assigned to|owner|recipient|your task/i);
    // Availability of actions the capability scope may or may not permit.
    expect(text).not.toMatch(/complete|note|return|clarification|work request|acknowledge/i);
    // Fabricated progress.
    expect(text).not.toMatch(/\d+\s*%|almost|nearly done/i);
  });

  it('renders no Task, Recipient, or capability content', () => {
    const { container } = render(<CapabilityLoading />);
    const text = container.textContent ?? '';

    expect(text).not.toMatch(/token|capability|@|\/c\//i);
    expect(text).not.toMatch(/due|waiting until|status:|instructions/i);
    // No skeleton shaped like private content: nothing but the one status paragraph.
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.querySelectorAll('h1, h2, h3, ul, ol, li, dl, table')).toHaveLength(0);
  });

  it('renders no chrome, navigation, or interactive control', () => {
    const { container } = render(<CapabilityLoading />);

    expect(
      container.querySelectorAll('a, button, form, input, textarea, select, nav, header'),
    ).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/sign out|signed in|attention|tasks/i);
  });

  it('keeps the same page frame as both resolved views so the layout does not jump', () => {
    const { container } = render(<CapabilityLoading />);
    const main = container.querySelector('main');

    expect(main).not.toBeNull();
    // Same `page` class the panel and the unavailable view use, so width, centring, and
    // padding are already correct when the real content replaces this.
    expect(main?.className).toContain('page');
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });

  it('moves focus nowhere and traps nothing', () => {
    const { container } = render(<CapabilityLoading />);

    expect(document.activeElement).toBe(document.body);
    expect(container.querySelector('[autofocus]')).toBeNull();
    expect(container.querySelector('[tabindex]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('capability loading boundary isolation', () => {
  it('is a static server component taking no arguments', () => {
    // No props means no token, no `params`, and no view model can reach it.
    expect(CapabilityLoading.length).toBe(0);
    expect(loadingCode).not.toMatch(/^'use client';/m);
  });

  it.each([
    ['@/lib/auth'],
    ['@/lib/owner'],
    ['require-owner'],
    ['@/lib/capability'],
    ['@aicaa/db'],
    ['@prisma/client'],
    ['next/headers'],
    ['server-only'],
    ['@/lib/observability'],
    ['_components/owner-'],
    ['owner-shell.module.css'],
  ])('does not import %s', (forbidden) => {
    expect(importSpecifiers.length).toBeGreaterThan(0);
    expect(importSpecifiers.filter((specifier) => specifier.includes(forbidden))).toEqual([]);
  });

  it('imports only the capability stylesheet it renders with', () => {
    expect(importSpecifiers).toEqual(['./recipient-capability.module.css']);
  });

  it('performs no data access, token handling, or client work', () => {
    // Owner identity, which must stay at zero operations on this route.
    expect(loadingCode).not.toContain('getUser');
    expect(loadingCode).not.toContain('requireOwner');
    expect(loadingCode).not.toContain('owner_authentication');
    // Token inspection or decoding.
    expect(loadingCode).not.toContain('createHash');
    expect(loadingCode).not.toContain('pepper');
    expect(loadingCode).not.toMatch(/\bparams\b/);
    // Data access and client behaviour.
    expect(loadingCode).not.toContain('fetch(');
    expect(loadingCode).not.toContain('useEffect');
    expect(loadingCode).not.toContain('setInterval');
    expect(loadingCode).not.toContain('setTimeout');
    expect(loadingCode).not.toContain('loadCapabilityPageView');
  });

  it('adds no animation, so there is no reduced-motion preference to honour', () => {
    const stylesheet = readFileSync(
      join(appRoot, 'c/[token]/recipient-capability.module.css'),
      'utf8',
    );

    // The boundary renders `page` and `lede` only. Neither may acquire motion without a
    // `prefers-reduced-motion` answer, so the guard is that no animation exists at all.
    expect(loadingCode).not.toMatch(/animate|animation|transition|spinner|@keyframes/i);
    expect(stylesheet).not.toMatch(/@keyframes|animation:/i);
  });

  it('leaves one generic boundary rather than a variant per outcome', () => {
    const route = join(appRoot, 'c/[token]');

    // The boundary this suite describes is the one the route actually has.
    expect(existsSync(join(route, 'loading.tsx'))).toBe(true);

    // A second loading file, or a route-local error/not-found boundary, would let the
    // pre-validation state differ by outcome and reveal which one applies.
    expect(existsSync(join(route, 'error.tsx'))).toBe(false);
    expect(existsSync(join(route, 'not-found.tsx'))).toBe(false);
    expect(existsSync(join(route, 'layout.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'c/loading.tsx'))).toBe(false);
  });
});
