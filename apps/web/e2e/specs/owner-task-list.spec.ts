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

  // Truthful primary identifier, status, and assignment state.
  await expect(openLink).toBeVisible();
  await expect(openLink).toContainText('open');
  await expect(openLink).toContainText('unassigned');
  await expect(completedLink).toContainText('completed');

  await openLink.click();
  await expect(ownerPage).toHaveURL(new RegExp(`/tasks/${openTask.id}$`));
  await expect(ownerPage.getByRole('heading', { level: 1, name: 'Task' })).toBeVisible();

  // List navigation remains functional in both directions.
  await ownerPage.goBack();
  await expect(ownerPage).toHaveURL(/\/tasks$/);
  await expect(ownerPage.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
  await ownerPage.getByRole('link', { name: 'Home' }).click();
  await expect(ownerPage).toHaveURL(/127\.0\.0\.1:\d+\/$/);

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.failedRequests).toEqual([]);
});
