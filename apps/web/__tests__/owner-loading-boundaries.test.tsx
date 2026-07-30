// @vitest-environment jsdom
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import TaskListLoading from '@/app/tasks/loading';
import TaskDetailLoading from '@/app/tasks/[taskId]/loading';

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

  it('adds no loading boundary to the Recipient capability route', () => {
    const capabilityRoute = join(__dirname, '../app/c/[token]');

    expect(existsSync(join(capabilityRoute, 'loading.tsx'))).toBe(false);
    expect(existsSync(join(capabilityRoute, 'loading.jsx'))).toBe(false);
  });

  it('adds no global loading, error, or not-found boundary', () => {
    const appRoot = join(__dirname, '../app');

    expect(existsSync(join(appRoot, 'loading.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'error.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'global-error.tsx'))).toBe(false);
  });
});
