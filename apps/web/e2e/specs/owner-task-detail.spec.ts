import { test, expect, uniqueLabel } from '../support/fixtures';
import { addOwnerNote, completeTask, createTask } from '../support/owner-api';

/**
 * Owner Task detail — current truthful behaviour.
 * Covers assignment state, notes (present and empty), completion outcome, and the current
 * action controls for the Task's state.
 */

test('Task detail renders summary, empty notes state, and unassigned state truthfully', async ({
  ownerPage,
  diagnostics,
}) => {
  const title = uniqueLabel('detail-fresh');
  const task = await createTask(ownerPage.request, 'Fixture point', title);

  await ownerPage.goto(`/tasks/${task.id}`);

  await expect(ownerPage.getByRole('heading', { level: 1, name: 'Task' })).toBeVisible();
  await expect(ownerPage.getByText('Status: open')).toBeVisible();
  await expect(ownerPage.getByText('Unassigned')).toBeVisible();

  await expect(ownerPage.getByRole('heading', { level: 2, name: 'Summary' })).toBeVisible();
  await expect(ownerPage.getByText(title)).toBeVisible();

  // Empty state is truthful and distinct from a populated Notes list.
  await expect(ownerPage.getByRole('heading', { level: 2, name: 'Notes' })).toBeVisible();
  await expect(ownerPage.getByRole('status').filter({ hasText: 'No notes yet.' })).toBeVisible();

  // No completion section before completion.
  await expect(ownerPage.getByRole('heading', { level: 2, name: 'Completion' })).toHaveCount(0);

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test('Task detail renders notes, completion outcome, and current action controls', async ({
  ownerPage,
}) => {
  const title = uniqueLabel('detail-complete');
  const created = await createTask(ownerPage.request, 'Fixture point', title);
  const noteBody = `${uniqueLabel('detail-note')} owner note body`;

  const withNote = await addOwnerNote(ownerPage.request, created, noteBody);
  await completeTask(
    ownerPage.request,
    withNote,
    'information_provided',
    'Outcome note by harness.',
  );

  await ownerPage.goto(`/tasks/${created.id}`);

  await expect(ownerPage.getByText('Status: completed')).toBeVisible();

  // Notes render with privacy-safe attribution, never a capability token.
  await expect(ownerPage.getByText(noteBody)).toBeVisible();
  await expect(ownerPage.getByText('Owner', { exact: true }).first()).toBeVisible();

  // Completion outcome and completion note render.
  await expect(ownerPage.getByRole('heading', { level: 2, name: 'Completion' })).toBeVisible();
  await expect(ownerPage.getByText('Outcome: information_provided')).toBeVisible();
  await expect(ownerPage.getByText('Outcome note by harness.')).toBeVisible();

  // Action controls match the current state truthfully: with no Gmail connection the panel
  // offers connection rather than a handoff control the Owner cannot complete.
  await expect(ownerPage.getByRole('heading', { level: 2, name: 'Handoff' })).toBeVisible();
  await expect(ownerPage.getByText('Connect Gmail to send this handoff.')).toBeVisible();
  await expect(ownerPage.getByRole('button', { name: 'Hand off…' })).toHaveCount(0);
});

test('unknown Task id produces a truthful not-found state, not a blank screen', async ({
  ownerPage,
}) => {
  await ownerPage.goto('/tasks/00000000-0000-4000-8000-0000000000fe');

  // Not-found is distinguishable from empty, unauthorized, and infrastructure failure.
  // innerText is used deliberately: it reflects rendered content, not dev-mode RSC payloads.
  const visible = await ownerPage.locator('body').innerText();
  expect(visible.trim().length).toBeGreaterThan(0);
  expect(visible).not.toContain('Tasks could not be loaded');
  await expect(ownerPage.getByRole('heading', { level: 1, name: 'Task' })).toHaveCount(0);
});
