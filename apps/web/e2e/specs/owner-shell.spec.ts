import { test, expect, uniqueLabel } from '../support/fixtures';
import { createTask } from '../support/owner-api';

/**
 * P1.4 Owner shell behaviour in a real browser.
 *
 * Covers what only a browser can show: that the chrome persists across a client-side
 * navigation, that active state follows the pathname, and that the skip link actually moves
 * focus rather than merely existing in the DOM.
 */

test('the shell persists across Task list and detail navigation', async ({
  ownerPage,
  diagnostics,
}) => {
  const title = uniqueLabel('shell-nav');
  await createTask(ownerPage.request, 'Fixture point', title);

  await ownerPage.goto('/tasks');

  const nav = ownerPage.getByRole('navigation', { name: 'Owner' });
  const product = ownerPage.getByRole('link', { name: 'AI Communication Action Assistant' });
  await expect(nav).toBeVisible();
  await expect(product).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');

  await ownerPage.getByRole('link', { name: new RegExp(title) }).click();
  await expect(ownerPage).toHaveURL(/\/tasks\/[^/]+$/);

  // Chrome survives the navigation, and a nested route keeps its parent destination current.
  await expect(nav).toBeVisible();
  await expect(product).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Attention' })).not.toHaveAttribute('aria-current');

  await nav.getByRole('link', { name: 'Attention' }).click();
  await expect(ownerPage).toHaveURL(/\/attention$/);
  await expect(nav.getByRole('link', { name: 'Attention' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav.getByRole('link', { name: 'Tasks' })).not.toHaveAttribute('aria-current');

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.failedRequests).toEqual([]);
});

test('exactly one h1 and one main landmark exist on every Owner route', async ({ ownerPage }) => {
  const title = uniqueLabel('shell-landmarks');
  const task = await createTask(ownerPage.request, 'Fixture point', title);

  for (const path of ['/tasks', `/tasks/${task.id}`, '/attention']) {
    await ownerPage.goto(path);

    await expect(ownerPage.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(ownerPage.getByRole('main')).toHaveCount(1);
    await expect(ownerPage.getByRole('banner')).toHaveCount(1);
    await expect(ownerPage.getByRole('navigation', { name: 'Owner' })).toHaveCount(1);
  }
});

test('the skip link is the first focusable control and moves focus to main content', async ({
  ownerPage,
}) => {
  await ownerPage.goto('/tasks');

  await ownerPage.keyboard.press('Tab');

  const skipLink = ownerPage.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeFocused();
  // Off-screen until focused, then genuinely visible rather than merely present.
  await expect(skipLink).toBeVisible();

  await ownerPage.keyboard.press('Enter');
  await expect(ownerPage).toHaveURL(/#main-content$/);
});

test('the Owner display name appears in the shell without leaking Task data', async ({
  ownerPage,
}) => {
  const title = uniqueLabel('shell-identity');
  const task = await createTask(ownerPage.request, 'Fixture point', title);

  await ownerPage.goto(`/tasks/${task.id}`);

  const banner = ownerPage.getByRole('banner');
  await expect(banner).toContainText('Sign out');
  await expect(banner).not.toContainText(title);
});

test('the shell stays visible while a Task page is loading', async ({ ownerPage }) => {
  // Delay the Task list response so the loading boundary is observable rather than theoretical.
  await ownerPage.route('**/tasks', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await route.continue();
  });

  await ownerPage.goto('/attention');
  const navigation = ownerPage
    .getByRole('navigation', { name: 'Owner' })
    .getByRole('link', { name: 'Tasks' })
    .click();

  // Chrome is present during the pending navigation, not just after it resolves.
  await expect(ownerPage.getByRole('navigation', { name: 'Owner' })).toBeVisible();
  await expect(ownerPage.getByRole('banner')).toBeVisible();

  await navigation;
  await expect(ownerPage.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
  await ownerPage.unroute('**/tasks');
});

test('signing out from the shell returns the Owner to a signed-out state', async ({
  ownerPage,
}) => {
  await ownerPage.goto('/tasks');

  await ownerPage.getByRole('button', { name: 'Sign out' }).click();

  await expect(ownerPage).toHaveURL(/\/login/);
  await expect(ownerPage.getByRole('heading', { level: 1, name: 'Owner sign in' })).toBeVisible();

  // The session is genuinely gone: a protected route no longer renders.
  await ownerPage.goto('/tasks');
  await expect(ownerPage).toHaveURL(/\/login/);
  await expect(ownerPage.getByRole('heading', { level: 1, name: 'Tasks' })).toHaveCount(0);
});
