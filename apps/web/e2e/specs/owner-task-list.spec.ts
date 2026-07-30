import { test, expect, uniqueLabel } from '../support/fixtures';
import { completeTask, createTask } from '../support/owner-api';

/**
 * Owner Task list — current truthful behaviour (A4/A7 thin list).
 * Asserts seeded Tasks render with truthful status, and detail navigation works.
 */

test('Task list renders seeded Tasks with truthful status and navigates to detail', async ({
  ownerPage,
  diagnostics,
}) => {
  const openTitle = uniqueLabel('list-open');
  const completedTitle = uniqueLabel('list-completed');

  const openTask = await createTask(ownerPage.request, 'Fixture point', openTitle);
  const toComplete = await createTask(ownerPage.request, 'Fixture point', completedTitle);
  await completeTask(ownerPage.request, toComplete, 'completed', 'Closed by harness fixture.');

  await ownerPage.goto('/tasks');

  await expect(ownerPage.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
  await expect(ownerPage.getByText('Open a Task to review details')).toBeVisible();

  const openLink = ownerPage.getByRole('link', { name: new RegExp(openTitle) });
  const completedLink = ownerPage.getByRole('link', { name: new RegExp(completedTitle) });

  // Truthful primary identifier, status, and assignment state. P1.4 renders human labels
  // instead of the raw `open` / `completed` enum values.
  await expect(openLink).toBeVisible();
  await expect(openLink).toContainText('Open');
  await expect(openLink).toContainText('Unassigned');
  await expect(completedLink).toContainText('Completed');

  await openLink.click();
  await expect(ownerPage).toHaveURL(new RegExp(`/tasks/${openTask.id}$`));
  // P1.4: the detail heading is the Task's derived title.
  await expect(ownerPage.getByRole('heading', { level: 1, name: openTitle })).toBeVisible();

  // List navigation remains functional in both directions.
  await ownerPage.goBack();
  await expect(ownerPage).toHaveURL(/\/tasks$/);
  await expect(ownerPage.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
  // P1.4 replaced the per-page "Home" link with the persistent Owner shell navigation.
  await ownerPage
    .getByRole('navigation', { name: 'Owner' })
    .getByRole('link', { name: 'Attention' })
    .click();
  await expect(ownerPage).toHaveURL(/\/attention$/);

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.failedRequests).toEqual([]);
});
