import {
  test,
  expect,
  signInAsOwner,
  setAuthDoubleHostedDomain,
  resetAuthDouble,
} from '../support/fixtures';

/**
 * Owner authentication gate — current truthful behaviour (A3).
 * Verifies protected Task content is never rendered before authentication.
 */

test.afterEach(async () => {
  await resetAuthDouble();
});

test('unauthenticated Owner route redirects to sign-in and exposes no Task content', async ({
  page,
  diagnostics,
}) => {
  const response = await page.goto('/tasks');

  // Truthful redirect to the sign-in state, preserving the intended destination.
  await expect(page).toHaveURL(/\/login\?next=%2Ftasks$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Owner sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();

  // No protected Owner surface leaked into the unauthenticated response.
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toHaveCount(0);
  const body = (await page.locator('body').textContent()) ?? '';
  expect(body).not.toContain('Open a Task to review details');
  expect(response?.status()).toBeLessThan(400);

  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.failedRequests).toEqual([]);
});

test('unauthenticated Task detail route also redirects without leaking the Task', async ({
  page,
}) => {
  await page.goto('/tasks/00000000-0000-4000-8000-0000000000ff');

  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole('heading', { level: 1, name: 'Owner sign in' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Task' })).toHaveCount(0);
});

test('authenticated Owner reaches the Task list through the real sign-in flow', async ({
  page,
}) => {
  await signInAsOwner(page, '/tasks');

  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
});

test('Google account without the verified Workspace domain is refused', async ({ page }) => {
  // The auth double stops asserting the verified `hd` claim; application logic is unchanged.
  await setAuthDoubleHostedDomain('');

  await page.goto('/login?next=%2Ftasks');
  await page.getByRole('button', { name: 'Sign in with Google' }).click();

  // Real allowlist rejection: signed out and returned to sign-in with the truthful reason.
  await page.waitForURL(/\/login\?error=unauthorized_domain/, { timeout: 30_000 });
  await expect(
    page.getByRole('alert').filter({ hasText: 'not authorized for this application' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toHaveCount(0);
});
