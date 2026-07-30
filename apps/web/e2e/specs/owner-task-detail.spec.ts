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

  // P1.4: the heading is the Task's derived title, not the literal word "Task".
  await expect(ownerPage.getByRole('heading', { level: 1, name: title })).toBeVisible();
  // P1.4: status reads as a human label rather than the raw `open` enum value.
  await expect(ownerPage.getByText('Open', { exact: true })).toBeVisible();
  await expect(ownerPage.getByText('Unassigned')).toBeVisible();

  await expect(ownerPage.getByRole('heading', { level: 2, name: 'Summary' })).toBeVisible();
  // The title now appears as both the heading and the first summary point, so scope the
  // summary assertion to the list rather than matching the page twice.
  await expect(ownerPage.getByRole('listitem').filter({ hasText: title }).first()).toBeVisible();

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

  await expect(ownerPage.getByText('Completed', { exact: true })).toBeVisible();

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
  // No Task detail rendered: neither the summary section nor the handoff panel appears.
  await expect(ownerPage.getByRole('heading', { level: 2, name: 'Summary' })).toHaveCount(0);
  await expect(ownerPage.getByRole('heading', { level: 2, name: 'Handoff' })).toHaveCount(0);
});
