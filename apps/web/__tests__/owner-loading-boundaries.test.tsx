// @vitest-environment jsdom
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import TaskListLoading from '@/app/(owner)/tasks/loading';
import TaskDetailLoading from '@/app/(owner)/tasks/[taskId]/loading';

/**
 * P1.3 route loading boundaries (D112). These are deliberately minimal: they must be
 * truthful and announced, and must not imply anything about a Task before the server
 * has answered. Application shell and navigation remain P1.4.
 */
describe('Owner route loading boundaries', () => {
  afterEach(cleanup);

  it('announces the Task list load truthfully', () => {
    render(<TaskListLoading />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading Tasks');
  });

  it('announces the Task detail load truthfully', () => {
    render(<TaskDetailLoading />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading Task');
  });

  it.each([
    ['list', TaskListLoading],
    ['detail', TaskDetailLoading],
  ])('renders no Task content or optimistic status in the %s boundary', (_label, Component) => {
    const { container } = render(<Component />);
    const text = container.textContent ?? '';

    // No fabricated Task data, status, or outcome.
    expect(text).not.toMatch(/open|in progress|waiting|completed|dismissed/i);
    expect(text).not.toMatch(/assigned|recipient|note|summary|handoff|due/i);
    // No links, buttons, or forms: the boundary is not a shell.
    expect(container.querySelectorAll('a, button, form, nav')).toHaveLength(0);
  });

  it('exposes no capability token or Recipient content', () => {
    const { container } = render(<TaskDetailLoading />);
    const text = container.textContent ?? '';

    expect(text).not.toMatch(/\/c\/|token|capability|@/i);
  });

  /*
   * P1.3 asserted the Recipient capability route had no loading boundary, recording a
   * deliberate deferral rather than an oversight. P1.5 added one, so that guard is rewritten
   * into its positive form here and `p1-5-capability-loading.test.tsx` owns its behaviour.
   * The claim that still matters at this level is that the capability boundary is a separate
   * file: these Owner boundaries speak about Tasks, and reusing one on `/c/{token}` would
   * tell a stranger holding a dead link that a Task exists.
   */
  it('gives the Recipient capability route a boundary of its own', () => {
    const capabilityRoute = join(__dirname, '../app/c/[token]');

    expect(existsSync(join(capabilityRoute, 'loading.tsx'))).toBe(true);
  });

  /*
   * P1.4 asserted that no global boundary existed at all. P1.5 adds the error and not-found
   * boundaries deliberately, and `p1-5-boundaries.test.tsx` is the positive guard for them.
   * What survives here is the one absence that is still intended: a global `loading.tsx`
   * would apply a Task-shaped loading state to `/` and `/login`, neither of which loads a
   * Task, and would pre-empt the capability route's own generic boundary.
   */
  it('adds no application-wide loading boundary', () => {
    const appRoot = join(__dirname, '../app');

    expect(existsSync(join(appRoot, 'loading.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'loading.jsx'))).toBe(false);
  });
});
