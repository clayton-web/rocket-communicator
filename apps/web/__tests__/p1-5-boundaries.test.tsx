// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import GlobalError from '@/app/global-error';
import RootError from '@/app/error';
import RootNotFound from '@/app/not-found';
import OwnerError from '@/app/(owner)/error';
import OwnerNotFound from '@/app/(owner)/not-found';

/**
 * P1.5 error and not-found boundary coverage.
 *
 * P1.4 asserted these files were absent; that guard has been rewritten into the positive
 * claims below rather than deleted, so the structure stays pinned in both directions.
 *
 * The point of the suite is truthfulness under failure. A fallback is the one surface that
 * renders when everything else has gone wrong, which makes it the easiest place to leak an
 * internal error or to reassure someone about work that was never saved.
 */

const appRoot = join(__dirname, '../app');
const PRODUCT_NAME = 'AI Communication Action Assistant';

function source(relative: string): string {
  return readFileSync(join(appRoot, relative), 'utf8');
}

/**
 * Module specifiers a file actually imports.
 *
 * Scanning raw file text instead would match the prose in a comment that explains why an
 * import is absent, which is the opposite of what this suite is asserting.
 */
function importSpecifiers(relative: string): string[] {
  return [...source(relative).matchAll(/^import\s+(?:[\s\S]*?\sfrom\s+)?'([^']+)';$/gm)].map(
    (match) => match[1],
  );
}

const failure = Object.assign(new Error('DATABASE_URL=postgres://user:secret@host/db'), {
  digest: '1234567890',
});

describe('P1.5 boundary structure', () => {
  it.each([
    ['global-error.tsx'],
    ['error.tsx'],
    ['not-found.tsx'],
    ['(owner)/error.tsx'],
    ['(owner)/not-found.tsx'],
  ])('provides %s', (relative) => {
    expect(existsSync(join(appRoot, relative))).toBe(true);
  });

  it('keeps the Task segment error boundary, which speaks specifically about Tasks', () => {
    expect(existsSync(join(appRoot, '(owner)/tasks/error.tsx'))).toBe(true);
  });

  /*
   * `/attention` has no boundary of its own. That is the coverage claim: it inherits the
   * route-group boundary, so an Owner segment cannot ship without failure handling by
   * forgetting to add a file.
   */
  it('covers /attention through the Owner route-group boundary', () => {
    expect(existsSync(join(appRoot, '(owner)/attention/error.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, '(owner)/error.tsx'))).toBe(true);
  });

  it('leaves the Recipient capability route outside the Owner group', () => {
    expect(existsSync(join(appRoot, 'c/[token]/page.tsx'))).toBe(true);
    expect(existsSync(join(appRoot, '(owner)/c'))).toBe(false);
  });
});

describe('global-error isolation', () => {
  const global = source('global-error.tsx');

  it('is a client boundary that supplies its own document', () => {
    expect(global).toMatch(/^'use client';/);
    expect(global).toContain('<html');
    expect(global).toContain('<body>');
  });

  /*
   * This boundary renders when the root layout itself failed. Anything it imports could be
   * the thing that broke, so it must not reach for Owner identity, the shell, the database,
   * or any server-only module.
   */
  it.each([
    ['@/lib/auth'],
    ['@/lib/owner'],
    ['@aicaa/db'],
    ['@prisma/client'],
    ['server-only'],
    ['next/headers'],
    ['_components/owner-'],
    ['owner-shell.module.css'],
  ])('does not import %s', (forbidden) => {
    const imports = importSpecifiers('global-error.tsx');

    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((specifier) => specifier.includes(forbidden))).toEqual([]);
  });

  it('imports only the stylesheets the failed root layout would have supplied', () => {
    expect(importSpecifiers('global-error.tsx')).toEqual(['@aicaa/ui/tokens.css', './globals.css']);
  });
});

/*
 * Rendering `GlobalError` here logs "In HTML, <html> cannot be a child of <div>". That is
 * expected and is the point of the component: it supplies the document Next.js no longer has
 * a root layout to supply. The warning comes from the test container, not from the app.
 */
describe('boundary rendering', () => {
  afterEach(cleanup);

  it.each([
    ['global error', () => <GlobalError error={failure} reset={() => {}} />],
    ['root error', () => <RootError error={failure} reset={() => {}} />],
    ['owner error', () => <OwnerError error={failure} reset={() => {}} />],
  ])('never reveals the raw error in the %s fallback', (_label, boundary) => {
    const { baseElement } = render(boundary());
    const text = baseElement.textContent ?? '';

    expect(text).not.toContain('DATABASE_URL');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain(failure.message);
    // The framework digest is a hash, is already the Task boundary's log reference, and is
    // the only way to correlate what someone saw with what the server recorded.
    expect(text).toContain('1234567890');
  });

  it.each([
    ['global error', () => <GlobalError error={failure} reset={() => {}} />],
    ['root error', () => <RootError error={failure} reset={() => {}} />],
    ['root not-found', () => <RootNotFound />],
    ['owner error', () => <OwnerError error={failure} reset={() => {}} />],
    ['owner not-found', () => <OwnerNotFound />],
  ])('claims nothing about saved work in the %s fallback', (_label, boundary) => {
    const { baseElement } = render(boundary());
    const text = baseElement.textContent ?? '';

    expect(text).not.toMatch(/saved|queued|preserved|will be retried|created|deleted|sent/i);
  });

  it('brands the global error with the official product name', () => {
    render(<GlobalError error={failure} reset={() => {}} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(PRODUCT_NAME);
  });

  it('offers a truthful recovery action in every error fallback', () => {
    render(<GlobalError error={failure} reset={() => {}} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    cleanup();

    render(<RootError error={failure} reset={() => {}} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    cleanup();

    render(<OwnerError error={failure} reset={() => {}} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('root not-found is safe for an unauthenticated visitor', () => {
  afterEach(cleanup);

  it('is branded and offers a way back into the application', () => {
    render(<RootNotFound />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found');
    expect(screen.getByText(new RegExp(PRODUCT_NAME))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to the application' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('exposes no Owner identity or sign-out control', () => {
    const { baseElement } = render(<RootNotFound />);

    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
    expect(baseElement.querySelectorAll('nav')).toHaveLength(0);
    expect(baseElement.textContent ?? '').not.toMatch(/signed in|owner/i);
  });

  /*
   * A mistyped capability link still carries a live token. Echoing the requested address
   * would print that secret into the page and into any screenshot of it (D114), so the
   * component takes no path and reads none.
   */
  it('cannot echo the requested address', () => {
    const { baseElement } = render(<RootNotFound />);

    expect(baseElement.textContent ?? '').not.toContain('/c/');
    expect(RootNotFound.length).toBe(0);
    expect(source('not-found.tsx')).not.toMatch(/usePathname|next\/headers|searchParams/);
  });
});

describe('Owner not-found distinguishes a missing Task from a failure', () => {
  afterEach(cleanup);

  it('names the missing Task and routes back to the Task list', () => {
    render(<OwnerNotFound />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Task not found');
    expect(screen.getByRole('link', { name: 'Back to Tasks' })).toHaveAttribute('href', '/tasks');
  });

  it('does not present itself as an application failure', () => {
    const { baseElement } = render(<OwnerNotFound />);
    const text = baseElement.textContent ?? '';

    expect(text).not.toMatch(/did not respond|try again later|operator attention/i);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('states no cause it cannot know', () => {
    const { baseElement } = render(<OwnerNotFound />);
    const text = baseElement.textContent ?? '';

    expect(text).not.toMatch(/was deleted|was removed|no longer exists|expired/i);
  });
});
