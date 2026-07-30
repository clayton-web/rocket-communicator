import { test, expect, uniqueLabel } from '../support/fixtures';
import { createTask } from '../support/owner-api';

/**
 * P1.4 attention destination (D118).
 *
 * The risk with an intentionally empty page is not that it breaks — it is that it implies
 * machinery that does not exist. These assertions are mostly negative for that reason: they
 * check the page does not claim to be monitoring, queueing, counting, or scheduling anything.
 */

test('the attention destination is truthfully empty and claims no automation', async ({
  ownerPage,
  diagnostics,
}) => {
  // A Task exists, so an empty attention page cannot be explained away by an empty database.
  await createTask(ownerPage.request, 'Fixture point', uniqueLabel('attention'));

  await ownerPage.goto('/attention');

  await expect(ownerPage.getByRole('heading', { level: 1, name: 'Attention' })).toBeVisible();
  await expect(
    ownerPage.getByRole('status').filter({ hasText: 'There is nothing to show here.' }),
  ).toBeVisible();

  const body = await ownerPage.locator('main').innerText();

  // No fabricated operational claim.
  for (const forbidden of [
    'monitoring',
    'queued',
    'scheduled',
    'reminder',
    'checking',
    'watching',
    'syncing',
    'running',
    'healthy',
    'up to date',
  ]) {
    expect(body.toLowerCase()).not.toContain(forbidden);
  }

  // No Task queue and no count of anything. Scoped to `main`: the shell navigation is itself a
  // list, so an unscoped list assertion would measure the chrome rather than the page.
  await expect(ownerPage.getByRole('main').getByRole('listitem')).toHaveCount(0);
  expect(body).not.toMatch(/\b\d+\s+(task|item|pending|due|overdue)/i);

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test('the attention destination is authenticated like every other Owner route', async ({
  page,
}) => {
  await page.goto('/attention');

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { level: 1, name: 'Attention' })).toHaveCount(0);
});
